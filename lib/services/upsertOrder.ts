import type { OrderStatus, ProductType, Prisma as PrismaTypes } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import type { NormalizedOrder } from '../shared/types';
import {
  classifyProduct, CONNECTOR_ROLE_PLATFORMS, hasNumberedRoleMarker,
  isStructuredSku, sameFamilyKey, type ComboComponent,
} from './productClassification';
import { resolveFamilyDynamic } from './familyDictionary';
import { calcCogs, type ComboComponentInput } from './cogs';
import { rebalanceSessionFulfillment } from './sessionFulfillment';
import { scheduleDailyMetricsRefresh } from './dailyMetrics';
import { autoLinkAffiliateByEmail } from './affiliateIdentity';
import { logger } from '../logger';

export interface UpsertOrderResult {
  created: boolean;
  // Prisma cuid interno (Order.id). Útil pra debug em logs/admin endpoints.
  orderId: string;
  // ID da transação original da plataforma (Order.externalId). É o que
  // o vendor reconhece — order_id da BG, transaction_id da Digistore,
  // receipt da CB. Devolvido na response do webhook pra confirmação
  // round-trip.
  externalId: string;
  // Slug da plataforma — pra quem consome a response saber a origem.
  platformSlug: string;
}

// Display names oficiais por slug. Quando uma plataforma nova é cadastrada
// automaticamente pelo primeiro ingest, usa esse map.
const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  clickbank: 'ClickBank',
  digistore24: 'Digistore24',
  buygoods: 'BuyGoods',
  cartpanda: 'Cartpanda',
  // Sessão via anchor: parentExternalId = prekey (receipt da FE) — não
  // entra em SESSION_GROUPED_PLATFORMS.
  jvzoo: 'JVZoo',
};

// Plataformas cuja sessão de funil é agrupada por funnelSessionId (não pelo
// parentExternalId/anchor): BuyGoods (sessid2), JVZoo (email+dia Eastern).
const SESSION_GROUPED_PLATFORMS = new Set(['buygoods', 'jvzoo']);

// Plataformas onde o CLASSIFICADOR (nome/SKU) manda no papel do pedido
// quando reconhece a família — o role do IPN é ruidoso (BG marca "Last
// Chance" como UPSELL; upsell_no da D24 só diz posição; CB o SKU é a
// verdade). Cartpanda fica fora (connector); JVZoo tem as exceções de
// marcador/sessão tratadas abaixo.
const CLASSIFIER_ROLE_PLATFORMS = new Set(['clickbank', 'buygoods', 'digistore24', 'jvzoo']);

const PRODUCT_SELECT = {
  id: true, fulfillmentSupplier: true, verified: true, family: true,
  productType: true, funnelStep: true, bottles: true, bonusBottles: true,
  comboComponents: true, name: true, nameAtVerification: true,
} as const;

type ProductRow = PrismaTypes.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

function parseCombo(json: PrismaTypes.JsonValue | null): ComboComponentInput[] | null {
  if (!Array.isArray(json)) return null;
  const out: ComboComponentInput[] = [];
  for (const item of json) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const family = (item as Record<string, unknown>).family;
      const bottles = (item as Record<string, unknown>).bottles;
      if (typeof family === 'string' && typeof bottles === 'number') {
        out.push({ family, bottles });
      }
    }
  }
  return out.length >= 2 ? out : null;
}

export async function upsertOrder(normalized: NormalizedOrder): Promise<UpsertOrderResult> {
  const platform = await db.platform.upsert({
    where: { slug: normalized.platformSlug },
    create: {
      slug: normalized.platformSlug,
      displayName: PLATFORM_DISPLAY_NAMES[normalized.platformSlug] ?? normalized.platformSlug,
    },
    update: {},
    select: { id: true },
  });

  // Classificador = SUGESTOR (v2, 2026-08-31). A autoridade é o catálogo
  // (Product.verified). Quando a família não resolve pelas canônicas
  // estáticas, tenta o dicionário dinâmico (FamilyAlias + famílias com
  // custo + verificadas) — cadastrou uma vez, resolve pra sempre.
  let classified = classifyProduct(
    normalized.productExternalId,
    normalized.productName || normalized.productExternalId,
    normalized.platformSlug,
  );
  if (classified.family == null) {
    try {
      const dyn = await resolveFamilyDynamic(normalized.productName || normalized.productExternalId);
      if (dyn.family) {
        classified = { ...classified, family: dyn.family, variant: classified.variant ?? dyn.variant };
      }
    } catch (err) {
      logger.warn({ err }, '[upsertOrder] dicionário de famílias falhou (ignorado)');
    }
  }

  const connectorRole = CONNECTOR_ROLE_PLATFORMS.has(normalized.platformSlug);
  // JVZoo sem marcador no nome: o type do parser é só default — o papel sai
  // da sessão (reconcileJvzooSession) e da memória do catálogo.
  const jvzooUnmarked = normalized.platformSlug === 'jvzoo' && !classified.roleMarked;
  const catalogType: ProductType =
    connectorRole
      ? (normalized.productType as ProductType)
      : classified.family !== null && !jvzooUnmarked
        ? classified.type
        : (normalized.productType as ProductType);
  // Etapa canônica do SKU pro catálogo (null = sessão/connector decide).
  const catalogStep: number | null = connectorRole
    ? (normalized.funnelStep ?? null)
    : classified.family !== null && !jvzooUnmarked
      ? classified.funnelStep
      : null;

  // BG codename collision handling: BuyGoods compartilha o mesmo
  // product_codename entre produtos distintos (NeuroMindPro ↔ NeuroPulse).
  // Nome do IPN classifica pra família DIFERENTE da gravada → roteia pro
  // Product sintético {codename}__{family}.
  let resolvedExternalId = normalized.productExternalId;
  if (
    normalized.platformSlug === 'buygoods'
    && classified.family
    && !resolvedExternalId.includes('__')  // já é sintético, deixa
  ) {
    const existing = await db.product.findUnique({
      where: {
        platformId_externalId: {
          platformId: platform.id,
          externalId: resolvedExternalId,
        },
      },
      select: { family: true },
    });
    if (
      existing
      && existing.family
      && !sameFamilyKey(existing.family, classified.family)
    ) {
      // Colisão detectada → roteia pro Product sintético.
      resolvedExternalId = `${normalized.productExternalId}__${classified.family}`;
    }
  }

  // ------------------------------------------------------------------
  // Product — catálogo. CONTRATO (2026-08-31):
  //   verified=true  → ingest atualiza SÓ o nome (e reconhece drift quando
  //                    a sugestão CONCORDA); família/papel/etapa/potes são
  //                    IMUNES a rename/estorno/backfill.
  //   verified=false → família só preenche VAZIO ou grafia equivalente —
  //                    valor→valor-diferente NUNCA escreve (anti-fantasma;
  //                    o conflito aparece na fila do catálogo).
  // ------------------------------------------------------------------
  const productWhere = {
    platformId_externalId: { platformId: platform.id, externalId: resolvedExternalId },
  };
  const incomingName = normalized.productName || normalized.productExternalId;
  const comboJson = classified.comboComponents && classified.comboComponents.length >= 2
    ? (classified.comboComponents as unknown as Prisma.InputJsonValue)
    : undefined;

  let product: ProductRow;
  const existingProduct = await db.product.findUnique({ where: productWhere, select: PRODUCT_SELECT });
  if (!existingProduct) {
    // SKU estruturado (formato ClickBank/NS, vendor-controlado) nasce
    // VERIFICADO — o vendor é quem define o SKU, não há ambiguidade.
    const autoVerified = isStructuredSku(normalized.productExternalId) && classified.family !== null;
    try {
      product = await db.product.create({
        data: {
          platformId: platform.id,
          externalId: resolvedExternalId,
          name: incomingName,
          productType: catalogType,
          family: classified.family,
          variant: classified.variant,
          bottles: classified.bottles,
          bonusBottles: classified.bonusBottles,
          funnelStep: catalogStep,
          ...(comboJson !== undefined ? { comboComponents: comboJson } : {}),
          ...(autoVerified
            ? { verified: true, verifiedAt: new Date(), verifiedBy: 'auto-sku', nameAtVerification: incomingName }
            : {}),
        },
        select: PRODUCT_SELECT,
      });
    } catch (err) {
      // Corrida entre IPNs simultâneos do mesmo SKU novo (P2002) — o outro
      // create venceu; segue com a linha existente.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      product = (await db.product.findUnique({ where: productWhere, select: PRODUCT_SELECT }))!;
    }
  } else if (existingProduct.verified) {
    const data: PrismaTypes.ProductUpdateInput = {};
    if (normalized.productName && normalized.productName !== existingProduct.name) {
      data.name = normalized.productName;
    }
    // Drift auto-reconhecido: o vendor renomeou mas a sugestão do nome novo
    // CONCORDA com o verificado → re-snapshot sem clique. Divergiu → mantém
    // tudo e o badge de drift/conflito aparece na fila (computado on-read).
    if (
      normalized.productName
      && existingProduct.nameAtVerification
      && normalized.productName !== existingProduct.nameAtVerification
    ) {
      const agree = sameFamilyKey(classified.family, existingProduct.family)
        && (!classified.roleMarked || classified.type === existingProduct.productType);
      if (agree) data.nameAtVerification = normalized.productName;
    }
    product = Object.keys(data).length > 0
      ? await db.product.update({ where: { id: existingProduct.id }, data, select: PRODUCT_SELECT })
      : existingProduct;
  } else {
    // Anti-fantasma: família nova só entra em campo VAZIO; equivalente a
    // menos de grafia mantém a grafia JÁ gravada (evita flip-flop).
    const familyOk = classified.family != null
      && (existingProduct.family == null || sameFamilyKey(existingProduct.family, classified.family));
    const familyValue = familyOk ? (existingProduct.family ?? classified.family) : undefined;
    const roleOk = familyOk && classified.family !== null && !jvzooUnmarked;
    product = await db.product.update({
      where: { id: existingProduct.id },
      data: {
        name: normalized.productName || undefined,
        ...(familyValue !== undefined ? { family: familyValue } : {}),
        ...(roleOk ? { productType: catalogType, funnelStep: catalogStep } : {}),
        ...(familyOk
          ? {
            variant: classified.variant ?? undefined,
            bottles: classified.bottles ?? undefined,
            bonusBottles: classified.bonusBottles ?? undefined,
            ...(comboJson !== undefined ? { comboComponents: comboJson } : {}),
          }
          : {}),
      },
      select: PRODUCT_SELECT,
    });
  }

  // Snapshot COGS at ingest — a partir do CATÁLOGO efetivo: verificado usa
  // o que está gravado; não-verificado usa a sugestão com fallback no que
  // já existe. Custo irresolvível → NULL + classificationPending (nunca
  // $0 falso — SUM ignora NULL, e a fila mostra o $ pendente).
  const eff = product.verified
    ? {
      family: product.family,
      bottles: product.bottles,
      bonus: product.bonusBottles,
      combo: parseCombo(product.comboComponents),
    }
    : {
      family: classified.family ?? product.family,
      bottles: classified.bottles ?? product.bottles,
      bonus: classified.bonusBottles ?? product.bonusBottles,
      combo: (classified.comboComponents as ComboComponent[] | null) ?? parseCombo(product.comboComponents),
    };
  const cogs = await calcCogs(eff.family, eff.bottles, eff.bonus, product.fulfillmentSupplier, eff.combo);

  let affiliateId: string | null = null;
  if (normalized.affiliateExternalId) {
    const affiliate = await db.affiliate.upsert({
      where: {
        platformId_externalId: {
          platformId: platform.id,
          externalId: normalized.affiliateExternalId,
        },
      },
      create: {
        platformId: platform.id,
        externalId: normalized.affiliateExternalId,
        nickname: normalized.affiliateNickname,
        email: normalized.affiliateEmail ?? undefined,
        firstSeenAt: normalized.orderedAt,
        lastOrderAt: normalized.orderedAt,
      },
      update: {
        nickname: normalized.affiliateNickname ?? undefined,
        email: normalized.affiliateEmail ?? undefined,
        lastOrderAt: normalized.orderedAt,
      },
      select: { id: true, partnerId: true },
    });
    affiliateId = affiliate.id;
    // Conta nova com e-mail conhecido → tenta vincular a um parceiro já
    // existente com o mesmo e-mail (outra plataforma). Nunca falha o IPN.
    if (normalized.affiliateEmail && !affiliate.partnerId) {
      try {
        await autoLinkAffiliateByEmail(affiliate.id, normalized.affiliateEmail);
      } catch (err) {
        logger.warn({ err, affiliateId }, '[upsertOrder] auto-link por e-mail falhou');
      }
    }
  }

  let customerId: string | null = null;
  if (normalized.customerExternalId) {
    const customer = await db.customer.upsert({
      where: {
        platformId_externalId: {
          platformId: platform.id,
          externalId: normalized.customerExternalId,
        },
      },
      create: {
        platformId: platform.id,
        externalId: normalized.customerExternalId,
        email: normalized.customerEmail,
        firstName: normalized.customerFirstName,
        lastName: normalized.customerLastName,
        language: normalized.customerLanguage,
        country: normalized.country,
        firstSeenAt: normalized.orderedAt,
        lastOrderAt: normalized.orderedAt,
      },
      update: {
        email: normalized.customerEmail ?? undefined,
        lastOrderAt: normalized.orderedAt,
      },
      select: { id: true },
    });
    customerId = customer.id;
  }

  // ------------------------------------------------------------------
  // Papel/etapa DO PEDIDO — precedência (2026-08-31):
  //   1. connector (Cartpanda) — sempre;
  //   2. marcador NUMERADO no nome deste payload — vale MESMO com família
  //      null ("DS3-TAB-NerveBOX" sai DOWNSELL etapa 4 no dia 1);
  //   3. catálogo VERIFICADO (exceção: FE-verificado JVZoo sem marcador —
  //      a sessão confirma via reconcile, que usa o catálogo como memória);
  //   4. classificador com família reconhecida (comportamento clássico);
  //   5. memória não-verificada (JVZoo) / role do connector.
  // ------------------------------------------------------------------
  const numberedMarker = !connectorRole
    && classified.roleMarked
    && hasNumberedRoleMarker(normalized.productName);
  let orderType: ProductType;
  let orderStep: number | null;
  if (connectorRole) {
    orderType = normalized.productType as ProductType;
    orderStep = normalized.funnelStep ?? null;
  } else if (numberedMarker) {
    orderType = classified.type;
    orderStep = classified.funnelStep ?? normalized.funnelStep ?? null;
  } else if (
    product.verified
    && !(normalized.platformSlug === 'jvzoo' && product.productType === 'FRONTEND' && jvzooUnmarked)
  ) {
    orderType = product.productType;
    orderStep = product.funnelStep ?? normalized.funnelStep ?? null;
  } else if (
    CLASSIFIER_ROLE_PLATFORMS.has(normalized.platformSlug)
    && classified.family !== null
    && !jvzooUnmarked
  ) {
    orderType = catalogType;
    orderStep = classified.funnelStep ?? normalized.funnelStep ?? null;
  } else if (jvzooUnmarked && product.productType !== 'FRONTEND') {
    // Memória do catálogo (SKU já chegou marcado antes) — sessão refina.
    orderType = product.productType;
    orderStep = normalized.funnelStep ?? null;
  } else {
    orderType = normalized.productType as ProductType;
    orderStep = normalized.funnelStep ?? null;
  }

  const orderData = {
    platformId: platform.id,
    externalId: normalized.externalId,
    parentExternalId: normalized.parentExternalId,
    previousTransactionId: normalized.previousTransactionId,
    vendorAccount: normalized.vendorAccount,
    productId: product.id,
    affiliateId,
    customerId,

    productType: orderType,

    currencyOriginal: normalized.currencyOriginal,
    grossAmountOrig: new Prisma.Decimal(normalized.grossAmountOrig),
    grossAmountUsd: new Prisma.Decimal(normalized.grossAmountUsd),
    taxAmount: new Prisma.Decimal(normalized.taxAmount),
    fees: new Prisma.Decimal(normalized.fees),
    netAmountUsd: new Prisma.Decimal(normalized.netAmountUsd),
    cpaPaidUsd: new Prisma.Decimal(normalized.cpaPaidUsd),

    status: normalized.status as OrderStatus,
    eventType: normalized.eventType,
    billingType: normalized.billingType,
    paySequenceNo: normalized.paySequenceNo,
    numberOfInstallments: normalized.numberOfInstallments,

    paymentMethod: normalized.paymentMethod,
    country: normalized.country,
    state: normalized.state,
    city: normalized.city,

    funnelSessionId: normalized.funnelSessionId,
    funnelStep: orderStep,
    clickId: normalized.clickId,
    trackingId: normalized.trackingId,
    campaignKey: normalized.campaignKey,
    trafficSource: normalized.trafficSource,
    deviceType: normalized.deviceType,
    browser: normalized.browser,

    detailsUrl: normalized.detailsUrl,

    orderedAt: normalized.orderedAt,
    approvedAt: normalized.status === 'APPROVED' ? normalized.orderedAt : null,
    // Instante do ESTORNO, não da venda. Na Digistore o refund é linha
    // extra carimbada com a data da VENDA em orderedAt (coorte), então sem
    // o eventAt do connector o estorno de hoje sumia do "hoje". Nas
    // plataformas in-place eventAt é null e o fallback pra orderedAt é o
    // certo (a linha JÁ é o evento).
    refundedAt: normalized.status === 'REFUNDED' ? (normalized.eventAt ?? normalized.orderedAt) : null,
    chargebackAt: normalized.status === 'CHARGEBACK' ? (normalized.eventAt ?? normalized.orderedAt) : null,

    rawMetadata: normalized.rawMetadata as Prisma.InputJsonValue,

    cogsUsd: cogs.resolved ? new Prisma.Decimal(cogs.cogsUsd) : null,
    fulfillmentUsd: cogs.resolved ? new Prisma.Decimal(cogs.fulfillmentUsd) : null,
    // Snapshot de volume: potes que esta order despacha (ver schema).
    bottlesShipped: cogs.totalBottles > 0 ? cogs.totalBottles : null,
    classificationPending: !cogs.resolved,
  };

  const existing = await db.order.findUnique({
    where: {
      platformId_externalId: { platformId: platform.id, externalId: normalized.externalId },
    },
    select: {
      id: true, orderedAt: true, approvedAt: true,
      productId: true, productType: true, funnelStep: true,
      cogsUsd: true, fulfillmentUsd: true, bottlesShipped: true,
      classificationPending: true, funnelSessionId: true,
    },
  });

  let result: UpsertOrderResult;
  if (existing) {
    // UPDATE: NÃO mexe em originalGrossUsd. grossAmountUsd vai ser overwritten
    // (refund/chargeback negativo); originalGrossUsd permanece o valor da
    // venda inicial pra reconciliação CB-style "Date of Event".
    //
    // GUARD CATEGÓRICO de evento não-venda (2026-08-31): estorno/cancel/
    // chargeback NUNCA reclassifica a venda — preserva data da venda,
    // produto, papel, etapa, custos e sessão já gravados. O payload do
    // evento pode vir com o nome RENOMEADO do produto; só status/datas de
    // evento/valores atualizam. (Rebill BILL/UNCANCEL chega APPROVED e não
    // cai aqui.)
    const isNonSaleEvent = normalized.status !== 'APPROVED';
    const updateData = isNonSaleEvent
      ? {
        ...orderData,
        orderedAt: existing.orderedAt,
        approvedAt: existing.approvedAt,
        productId: existing.productId,
        productType: existing.productType,
        funnelStep: existing.funnelStep,
        cogsUsd: existing.cogsUsd,
        fulfillmentUsd: existing.fulfillmentUsd,
        bottlesShipped: existing.bottlesShipped,
        classificationPending: existing.classificationPending,
        funnelSessionId: existing.funnelSessionId,
      }
      : orderData;
    await db.order.update({ where: { id: existing.id }, data: updateData });
    result = {
      created: false,
      orderId: existing.id,
      externalId: normalized.externalId,
      platformSlug: normalized.platformSlug,
    };
  } else {
    // CREATE: snapshot do grossAmountUsd como originalGrossUsd.
    const created = await db.order.create({
      data: {
        ...orderData,
        originalGrossUsd: new Prisma.Decimal(normalized.grossAmountUsd),
      },
      select: { id: true },
    });
    result = {
      created: true,
      orderId: created.id,
      externalId: normalized.externalId,
      platformSlug: normalized.platformSlug,
    };
  }

  // Session shipping is paid once per package, not per item. After saving
  // the order, recompute the session's total fulfillment and assign it
  // to a single primary order (FE preferred).
  const isSessionGrouped = SESSION_GROUPED_PLATFORMS.has(normalized.platformSlug);
  const sessionKey = isSessionGrouped
    ? (normalized.funnelSessionId ?? normalized.externalId)
    : (normalized.parentExternalId ?? normalized.externalId);
  await rebalanceSessionFulfillment(platform.id, sessionKey, isSessionGrouped ? 'session' : 'anchor');

  // Venda nova → MV fica stale. Agenda refresh com debounce (15s).
  scheduleDailyMetricsRefresh();

  return result;
}
