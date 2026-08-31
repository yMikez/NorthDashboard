// Backfill: re-classify ALL Products (not just family=null) so SKUs whose
// productType was set wrong by the original IPN payload get corrected by
// the catalog-aware classifier. Idempotent (re-running yields same result).
// The classifier is pure (regex over SKU/name), so cost is O(products) with
// no external I/O beyond per-row updates.
//
// Why re-scan all (vs only family=null)?
// Some SKUs have correct family but wrong productType. Example seen in prod:
// Digistore SKU 687054 (UP2 - Glyco Pulse 3 Bottles) was created with
// productType=FRONTEND because the first IPN happened to be misclassified.
// We trust the SKU pattern over the IPN payload for catalog-level role.

import type { ProductType } from '@prisma/client';
import { db } from '../db';
import {
  classifyProduct, CONNECTOR_ROLE_PLATFORMS, hasNumberedRoleMarker, sameFamilyKey,
} from './productClassification';
import { resolveFamilyDynamic } from './familyDictionary';

export interface BackfillStats {
  scanned: number;
  classified: number;
  productTypeFixed: number;
  ordersFixed: number;
  funnelStepFixed: number;
  unrecognized: string[];
}

export async function classifyExistingProducts(): Promise<BackfillStats> {
  const products = await db.product.findMany({
    select: {
      id: true,
      externalId: true,
      name: true,
      productType: true,
      family: true,
      verified: true,
      funnelStep: true,
      platform: { select: { slug: true } },
    },
  });

  const stats: BackfillStats = {
    scanned: products.length,
    classified: 0,
    productTypeFixed: 0,
    ordersFixed: 0,
    funnelStepFixed: 0,
    unrecognized: [],
  };

  // Track SKUs cuja role o IPN errou, pra reconciliar Order.productType
  // num segundo passo. O classifier de catálogo (SKU/nome) é autoritativo
  // — o productType de um único IPN é ruidoso (BuyGoods classifica
  // "Last Chance" como UPSELL; Digistore manda upsell_no=0 em DW).
  const productsToFixOrders: Array<{ id: string; toType: ProductType }> = [];
  // Track funnelStep of every classified product so we can reconcile
  // Order.funnelStep with the catalog (IPN's upsell_no can disagree —
  // notably Digistore DW orders arrive with upsell_no=0, but the SKU
  // pattern says step=3 for DW2).
  const productsToFixFunnelStep: Array<{ id: string; funnelStep: number }> = [];

  for (const p of products) {
    const isCartpandaV = CONNECTOR_ROLE_PLATFORMS.has(p.platform?.slug ?? '');
    // Catálogo VERIFICADO: o Product é intocável — só PROPAGA o que está
    // gravado pras Orders (papel/etapa). JVZoo com funnelStep null deixa a
    // etapa com a sessão; Cartpanda nunca propaga (connector).
    if (p.verified) {
      stats.classified++;
      if (isCartpandaV) continue;
      productsToFixOrders.push({ id: p.id, toType: p.productType });
      if (p.funnelStep != null) {
        productsToFixFunnelStep.push({ id: p.id, funnelStep: p.funnelStep });
      }
      continue;
    }

    let c = classifyProduct(p.externalId, p.name, p.platform?.slug);
    if (!c.family) {
      // Família fora das canônicas estáticas → tenta o dicionário dinâmico
      // (alias/custo/verificadas) antes de desistir.
      const dyn = await resolveFamilyDynamic(p.name);
      if (dyn.family) c = { ...c, family: dyn.family, variant: c.variant ?? dyn.variant };
    }
    if (!c.family) {
      // Classifier has no confident opinion — leave the row alone.
      if (!p.family) stats.unrecognized.push(p.externalId);
      continue;
    }
    // Anti-fantasma: família já gravada DIFERENTE (além de grafia) nunca é
    // trocada por backfill — o conflito fica visível na fila do catálogo.
    if (p.family != null && !sameFamilyKey(p.family, c.family)) {
      continue;
    }
    // Cartpanda: o PAPEL (productType/funnelStep) é do connector (up_sell_id),
    // não do nome. O classificador só dá a família. Então aqui atualizamos
    // família/potes mas NUNCA o productType, e NÃO reconciliamos
    // Order.productType/funnelStep — senão upsell (que o nome não anota como
    // upgrade) seria reescrito pra FRONTEND e o funil quebraria.
    // (JVZoo saiu deste grupo em 2026-08-12: lá o nome anota o papel.)
    const isCartpanda = isCartpandaV;
    // JVZoo SEM marcador no nome: o type do classificador é só o default
    // (FRONTEND) — não é opinião. Família/potes sim; papel fica com a
    // sessão (backfill-jvzoo-sessions) e a memória do catálogo.
    const roleUnknown = isCartpanda || (p.platform?.slug === 'jvzoo' && !c.roleMarked);

    const productTypeChanged = !roleUnknown && p.productType !== c.type;
    await db.product.update({
      where: { id: p.id },
      data: {
        // Mantém a grafia já gravada quando equivalente (sameFamilyKey acima).
        family: p.family ?? c.family,
        variant: c.variant,
        bottles: c.bottles,
        // bonusBottles também — combos BuyGoods/RC ("3 + 3 Bottles")
        // precisam disso pro total de potes (COGS+frete) no backfill.
        bonusBottles: c.bonusBottles,
        ...(c.comboComponents && c.comboComponents.length >= 2
          ? { comboComponents: c.comboComponents as unknown as object }
          : {}),
        ...(roleUnknown ? {} : { productType: c.type, funnelStep: c.funnelStep }),
      },
    });
    stats.classified++;
    if (productTypeChanged) stats.productTypeFixed++;

    if (roleUnknown) continue;

    // Catálogo é autoritativo pro Order.productType de TODA order desse
    // produto (qualquer direção, não só FE→outro). Sem isso, um "Last
    // Chance" BuyGoods que entrou como UPSELL nunca virava DOWNSELL e o
    // funil mostrava Downsell=0. Idempotente (filtro `not` abaixo).
    productsToFixOrders.push({ id: p.id, toType: c.type });

    // JVZoo com marcador SEM número ("(Upgrade)"): o step do classificador é
    // âncora de família, não o slot real — quem decide é a posição na sessão
    // (reconcileJvzooSession). Forçar aqui desfazia o step da posição.
    const stepUnreliable = p.platform?.slug === 'jvzoo' && !hasNumberedRoleMarker(p.name);
    if (c.funnelStep != null && !stepUnreliable) {
      productsToFixFunnelStep.push({ id: p.id, funnelStep: c.funnelStep });
    }
  }

  for (const { id, toType } of productsToFixOrders) {
    const result = await db.order.updateMany({
      where: { productId: id, productType: { not: toType } },
      data: { productType: toType },
    });
    stats.ordersFixed += result.count;
  }

  // Reconcile Order.funnelStep with the classifier's verdict. Idempotent:
  // the `not: funnelStep` filter ensures already-correct rows are skipped.
  for (const { id, funnelStep } of productsToFixFunnelStep) {
    const result = await db.order.updateMany({
      where: { productId: id, funnelStep: { not: funnelStep } },
      data: { funnelStep },
    });
    stats.funnelStepFixed += result.count;
  }

  return stats;
}
