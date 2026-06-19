import type { OrderStatus, ProductType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import type { NormalizedOrder } from '../shared/types';
import { classifyProduct } from './productClassification';
import { calcCogs } from './cogs';
import { rebalanceSessionFulfillment } from './sessionFulfillment';
import { accrueCommissionForOrder } from './networkAccrual';
import { scheduleDailyMetricsRefresh } from './dailyMetrics';
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
// automaticamente pelo primeiro ingest, usa esse map. Caso o slug não esteja
// aqui, cai pro próprio slug — admin pode renomear depois no painel.
const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  clickbank: 'ClickBank',
  digistore24: 'Digistore24',
  buygoods: 'BuyGoods',
  cartpanda: 'Cartpanda',
};

// Plataformas cuja sessão de funil é agrupada por funnelSessionId (não pelo
// parentExternalId/anchor): BuyGoods (sessid2) — o order_id_global é
// por-transação, então a sessão real é o sessid2. (Cartpanda NÃO entra aqui:
// o webhook traz FE+upsells como line items do MESMO pedido, então o
// parentExternalId = order_id já agrupa a sessão pelo anchor padrão.)
const SESSION_GROUPED_PLATFORMS = new Set(['buygoods']);

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

  // Classify SKU into family/variant/bottles via catalog-aware patterns.
  // When the classifier matches (family != null), it's authoritative for
  // Product.productType too — the catalog knows the SKU's role better than
  // a single IPN payload, which can mark an UPSELL as FRONTEND if the first
  // sale we observed of that SKU happened to be a frontend slot in some
  // funnel. Per-order role still lives in Order.productType (untouched here).
  const classified = classifyProduct(
    normalized.productExternalId,
    normalized.productName || normalized.productExternalId,
    normalized.platformSlug,
  );
  // Cartpanda: o papel (productType) do catálogo vem do connector (up_sell_id),
  // não do classificador de nome — o classifyCartpanda só derivou a família.
  // Demais plataformas: o classificador é autoritativo quando reconhece a família.
  const catalogType: ProductType =
    normalized.platformSlug === 'cartpanda'
      ? (normalized.productType as ProductType)
      : classified.family !== null
        ? classified.type
        : (normalized.productType as ProductType);

  // BG codename collision handling: BuyGoods compartilha o mesmo
  // product_codename entre produtos distintos (NeuroMindPro ↔ NeuroPulse).
  // Quando o nome do IPN classifica pra uma família DIFERENTE da que está
  // gravada no Product existente, usa um externalId sintético
  // {codename}__{family} pra rotear o pedido pro Product certo. Só aplica
  // pra BG e só quando o classifier tem família confiante.
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
      && existing.family !== classified.family
    ) {
      // Colisão detectada → roteia pro Product sintético.
      resolvedExternalId = `${normalized.productExternalId}__${classified.family}`;
    }
  }

  const product = await db.product.upsert({
    where: {
      platformId_externalId: {
        platformId: platform.id,
        externalId: resolvedExternalId,
      },
    },
    create: {
      platformId: platform.id,
      externalId: resolvedExternalId,
      name: normalized.productName || normalized.productExternalId,
      productType: catalogType,
      family: classified.family,
      variant: classified.variant,
      bottles: classified.bottles,
      bonusBottles: classified.bonusBottles,
    },
    update: {
      name: normalized.productName || undefined,
      // Only override productType when the classifier had a confident match;
      // otherwise leave whatever was there (avoids regressing rows for SKUs
      // whose pattern we don't know yet).
      productType: classified.family !== null ? catalogType : undefined,
      family: classified.family ?? undefined,
      variant: classified.variant ?? undefined,
      bottles: classified.bottles ?? undefined,
      bonusBottles: classified.bonusBottles ?? undefined,
    },
    // fulfillmentSupplier (override por SKU) — preservado entre ingests.
    // Não mexemos aqui, só leitura pra alimentar o calcCogs abaixo.
    select: { id: true, fulfillmentSupplier: true },
  });

  // Snapshot COGS at ingest. Reads cached cost tables; refreshing the cache
  // happens after admin edits via invalidateCogsCache().
  // O 4º arg é o override por SKU; quando null, calcCogs cai pro default
  // da família. Permite que SKUs marcados manualmente no painel
  // (ex: NeuroMindPro-2 → RedRock individualmente) sobrescrevam o default.
  const cogs = await calcCogs(
    classified.family,
    classified.bottles,
    classified.bonusBottles,
    product.fulfillmentSupplier,
  );

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
        firstSeenAt: normalized.orderedAt,
        lastOrderAt: normalized.orderedAt,
      },
      update: {
        nickname: normalized.affiliateNickname ?? undefined,
        lastOrderAt: normalized.orderedAt,
      },
      select: { id: true },
    });
    affiliateId = affiliate.id;
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

  // Forward-fix: when the classifier confidently recognized the SKU, prefer
  // its funnelStep over the IPN's. Why: Digistore DW orders arrive with
  // upsell_no=0 (panel treats a downsell as a fresh sale), but the SKU
  // pattern says DW2→step 3 / DW3→step 4. Without this, new ingests would
  // need the periodic backfill to land correctly. Only override when the
  // classifier has both family AND a derived step.
  //
  // EXCEÇÃO Cartpanda: o product_name NÃO carrega anotação de funil (ao
  // contrário de CB/D24/BG), então o classificador leria todo upsell como FE.
  // Aqui o role/step vem do upsell_no do postback (confiável) — nunca do nome.
  const trustParserRole = normalized.platformSlug === 'cartpanda';
  const finalFunnelStep =
    !trustParserRole && classified.family != null && classified.funnelStep != null
      ? classified.funnelStep
      : normalized.funnelStep;

  // Order.productType: pro BuyGoods o role do IPN é pouco confiável — marca
  // "Last Chance" (downsell) como UPSELL. Quando o classificador reconhece a
  // família, ele sabe o role certo pelo NOME (DOWNSELL/UPSELL/RC). Então pra BG
  // confiamos no classificador; demais plataformas mantêm o role do IPN.
  const orderType: ProductType =
    normalized.platformSlug === 'buygoods' && classified.family !== null
      ? catalogType
      : (normalized.productType as ProductType);

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
    funnelStep: finalFunnelStep,
    clickId: normalized.clickId,
    trackingId: normalized.trackingId,
    campaignKey: normalized.campaignKey,
    trafficSource: normalized.trafficSource,
    deviceType: normalized.deviceType,
    browser: normalized.browser,

    detailsUrl: normalized.detailsUrl,

    orderedAt: normalized.orderedAt,
    approvedAt: normalized.status === 'APPROVED' ? normalized.orderedAt : null,
    refundedAt: normalized.status === 'REFUNDED' ? normalized.orderedAt : null,
    chargebackAt: normalized.status === 'CHARGEBACK' ? normalized.orderedAt : null,

    rawMetadata: normalized.rawMetadata as Prisma.InputJsonValue,

    cogsUsd: new Prisma.Decimal(cogs.cogsUsd),
    fulfillmentUsd: new Prisma.Decimal(cogs.fulfillmentUsd),
  };

  const existing = await db.order.findUnique({
    where: {
      platformId_externalId: { platformId: platform.id, externalId: normalized.externalId },
    },
    select: { id: true },
  });

  let result: UpsertOrderResult;
  if (existing) {
    // UPDATE: NÃO mexe em originalGrossUsd. grossAmountUsd vai ser overwritten
    // (refund/chargeback negativo); originalGrossUsd permanece o valor da
    // venda inicial pra reconciliação CB-style "Date of Event".
    await db.order.update({ where: { id: existing.id }, data: orderData });
    result = {
      created: false,
      orderId: existing.id,
      externalId: normalized.externalId,
      platformSlug: normalized.platformSlug,
    };
  } else {
    // CREATE: snapshot do grossAmountUsd como originalGrossUsd. Pra orders
    // que nascem APPROVED os dois ficam iguais (positivo). Pra orders que
    // nascem como refund/cb (raríssimo — sale + cb instantâneo), original
    // fica negativo, mas usamos COALESCE com ABS no MV pra normalizar.
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
  // to a single primary order (FE preferred). Per-order fulfillmentUsd
  // values from the orderData snapshot get rewritten here for correctness.
  // BuyGoods/Cartpanda: a sessão (FE+upsells, mesmo pacote/frete) é
  // identificada por funnelSessionId (sessid2/cid), não por parentExternalId
  // (que é por-transação ou se repete entre upsells).
  const isSessionGrouped = SESSION_GROUPED_PLATFORMS.has(normalized.platformSlug);
  const sessionKey = isSessionGrouped
    ? (normalized.funnelSessionId ?? normalized.externalId)
    : (normalized.parentExternalId ?? normalized.externalId);
  await rebalanceSessionFulfillment(platform.id, sessionKey, isSessionGrouped ? 'session' : 'anchor');

  // Network commission accrual. Idempotent (UNIQUE on orderId). Only fires
  // for FE+APPROVED orders whose affiliate is linked to a Network. Errors
  // here are logged but don't fail the ingest — accrual can be backfilled.
  try {
    await accrueCommissionForOrder(result.orderId);
  } catch (err) {
    logger.error({ err, orderId: result.orderId }, '[upsertOrder] networkAccrual failed');
  }

  // Venda nova → MV fica stale. Agenda refresh com debounce (15s) pra
  // bursts de IPN da mesma sessão coalescerem num REFRESH só. O dashboard
  // não espera esse refresh — leitura é stale-while-revalidate.
  scheduleDailyMetricsRefresh();

  return result;
}
