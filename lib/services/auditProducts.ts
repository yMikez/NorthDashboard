import { Prisma } from '@prisma/client';
import { db } from '../db';

export interface ProductAuditResponse {
  generatedAt: string;
  summary: {
    totalOrders: number;
    totalGroups: number;
    avgOrdersPerGroup: number;
    distinctProducts: number;
  };
  byPlatform: Record<
    string,
    {
      totalOrders: number;
      byProductType: Record<string, number>;
      distinctProducts: number;
      funnelStepsSeen: Record<string, number>;
    }
  >;
  topProducts: Array<{
    platformSlug: string;
    externalId: string;
    name: string;
    productType: string;
    totalOrders: number;
    approvedOrders: number;
    refunded: number;
    chargebacks: number;
    samplesOrderIds: string[];
  }>;
  anomalies: {
    soloFrontendGroups: number;
    multipleFrontendGroups: number;
    upsellWithoutFrontendInGroup: number;
    upsellsWithoutParentExternalId: number;
    productsWithoutAnyOrders: number;
  };
  digistoreLimitation: {
    note: string;
    digistoreByProductType: Record<string, number>;
  };
  sampleFunnelChains: Array<{
    platformSlug: string;
    groupKey: string;
    orders: Array<{
      externalId: string;
      parentExternalId: string | null;
      productType: string;
      productName: string;
      funnelStep: number | null;
      grossAmountUsd: number;
      status: string;
      orderedAt: string;
    }>;
  }>;
}

export async function auditProducts(
  startDate?: Date,
  endDate?: Date,
): Promise<ProductAuditResponse> {
  const where: Prisma.OrderWhereInput = {};
  if (startDate && endDate) {
    where.orderedAt = { gte: startDate, lte: endDate };
  }

  const orders = await db.order.findMany({
    where,
    select: {
      externalId: true,
      parentExternalId: true,
      status: true,
      grossAmountUsd: true,
      funnelStep: true,
      orderedAt: true,
      productType: true,
      platform: { select: { slug: true } },
      product: { select: { externalId: true, name: true, productType: true, id: true } },
    },
    orderBy: { orderedAt: 'desc' },
  });

  const totalOrders = orders.length;
  const groupKeys = new Set<string>();
  const productKeys = new Set<string>();
  const byPlatform: ProductAuditResponse['byPlatform'] = {};

  // Per-platform aggregates
  for (const o of orders) {
    const slug = o.platform.slug;
    const groupKey = `${slug}:${o.parentExternalId ?? o.externalId}`;
    groupKeys.add(groupKey);
    productKeys.add(`${slug}:${o.product.externalId}`);

    const p =
      byPlatform[slug] ??
      {
        totalOrders: 0,
        byProductType: {} as Record<string, number>,
        distinctProducts: 0,
        funnelStepsSeen: {} as Record<string, number>,
      };
    p.totalOrders++;
    p.byProductType[o.productType] = (p.byProductType[o.productType] ?? 0) + 1;
    const stepKey = o.funnelStep === null ? 'null' : String(o.funnelStep);
    p.funnelStepsSeen[stepKey] = (p.funnelStepsSeen[stepKey] ?? 0) + 1;
    byPlatform[slug] = p;
  }

  // distinctProducts per platform
  const productsByPlatform = new Map<string, Set<string>>();
  for (const o of orders) {
    const slug = o.platform.slug;
    if (!productsByPlatform.has(slug)) productsByPlatform.set(slug, new Set());
    productsByPlatform.get(slug)!.add(o.product.externalId);
  }
  for (const [slug, set] of productsByPlatform) {
    if (byPlatform[slug]) byPlatform[slug].distinctProducts = set.size;
  }

  // Top products by order count
  const productOrderMap = new Map<
    string,
    {
      platformSlug: string;
      externalId: string;
      name: string;
      productType: string;
      totalOrders: number;
      approvedOrders: number;
      refunded: number;
      chargebacks: number;
      samplesOrderIds: string[];
    }
  >();
  for (const o of orders) {
    const key = `${o.platform.slug}:${o.product.externalId}`;
    let entry = productOrderMap.get(key);
    if (!entry) {
      entry = {
        platformSlug: o.platform.slug,
        externalId: o.product.externalId,
        name: o.product.name,
        productType: o.productType,
        totalOrders: 0,
        approvedOrders: 0,
        refunded: 0,
        chargebacks: 0,
        samplesOrderIds: [],
      };
      productOrderMap.set(key, entry);
    }
    entry.totalOrders++;
    if (o.status === 'APPROVED') entry.approvedOrders++;
    else if (o.status === 'REFUNDED') entry.refunded++;
    else if (o.status === 'CHARGEBACK') entry.chargebacks++;
    if (entry.samplesOrderIds.length < 3) entry.samplesOrderIds.push(o.externalId);
  }
  const topProducts = Array.from(productOrderMap.values())
    .sort((a, b) => b.totalOrders - a.totalOrders)
    .slice(0, 20);

  // Anomaly detection
  const groupOrders = new Map<string, typeof orders>();
  for (const o of orders) {
    const groupKey = `${o.platform.slug}:${o.parentExternalId ?? o.externalId}`;
    if (!groupOrders.has(groupKey)) groupOrders.set(groupKey, []);
    groupOrders.get(groupKey)!.push(o);
  }
  let soloFrontend = 0;
  let multipleFrontend = 0;
  let upsellWithoutFrontend = 0;
  let upsellsWithoutParent = 0;
  for (const o of orders) {
    if (o.productType === 'UPSELL' && !o.parentExternalId) upsellsWithoutParent++;
  }
  for (const [, groupOrdersArr] of groupOrders) {
    const types = groupOrdersArr.map((x) => x.productType);
    const feCount = types.filter((t) => t === 'FRONTEND').length;
    const hasUpsell = types.some((t) => t === 'UPSELL' || t === 'BUMP' || t === 'DOWNSELL');
    if (feCount === 1 && !hasUpsell) soloFrontend++;
    if (feCount > 1) multipleFrontend++;
    if (feCount === 0 && hasUpsell) upsellWithoutFrontend++;
  }

  const productsWithoutOrders = await db.product.count({
    where: { orders: { none: {} } },
  });

  // Digistore limitation breakdown
  const digistoreByProductType: Record<string, number> = {
    FRONTEND: 0,
    UPSELL: 0,
    DOWNSELL: 0,
    BUMP: 0,
  };
  for (const o of orders) {
    if (o.platform.slug === 'digistore24') {
      digistoreByProductType[o.productType] =
        (digistoreByProductType[o.productType] ?? 0) + 1;
    }
  }

  // Sample funnel chains (groups with FE + at least 1 upsell/bump/downsell)
  const sampleChains: ProductAuditResponse['sampleFunnelChains'] = [];
  for (const [groupKey, groupOrdersArr] of groupOrders) {
    if (sampleChains.length >= 5) break;
    const types = groupOrdersArr.map((x) => x.productType);
    const hasUpsell = types.some((t) => t === 'UPSELL' || t === 'BUMP' || t === 'DOWNSELL');
    const hasFE = types.includes('FRONTEND');
    if (!hasUpsell || !hasFE) continue;
    sampleChains.push({
      platformSlug: groupOrdersArr[0].platform.slug,
      groupKey,
      orders: groupOrdersArr
        .sort((a, b) => a.orderedAt.getTime() - b.orderedAt.getTime())
        .map((o) => ({
          externalId: o.externalId,
          parentExternalId: o.parentExternalId,
          productType: o.productType,
          productName: o.product.name,
          funnelStep: o.funnelStep,
          grossAmountUsd: Number(o.grossAmountUsd),
          status: o.status,
          orderedAt: o.orderedAt.toISOString(),
        })),
    });
  }

  // Note: top products list still uses Product.productType as catalog hint.
  // Per-order misclassifications are visible in sampleFunnelChains and the
  // anomalies counters (computed from o.productType).

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalOrders,
      totalGroups: groupKeys.size,
      avgOrdersPerGroup:
        groupKeys.size > 0 ? Math.round((totalOrders / groupKeys.size) * 100) / 100 : 0,
      distinctProducts: productKeys.size,
    },
    byPlatform,
    topProducts,
    anomalies: {
      soloFrontendGroups: soloFrontend,
      multipleFrontendGroups: multipleFrontend,
      upsellWithoutFrontendInGroup: upsellWithoutFrontend,
      upsellsWithoutParentExternalId: upsellsWithoutParent,
      productsWithoutAnyOrders: productsWithoutOrders,
    },
    digistoreLimitation: {
      note:
        'Digistore24 IPN não diferencia DOWNSELL ou BUMP — todos os upsell_no >= 1 viram UPSELL. Se os contadores DOWNSELL/BUMP em digistoreByProductType > 0, indica seed manual ou dados de outra origem.',
      digistoreByProductType,
    },
    sampleFunnelChains: sampleChains,
  };
}
