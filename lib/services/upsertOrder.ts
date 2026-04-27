import type { OrderStatus, ProductType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import type { NormalizedOrder } from '../shared/types';
import { classifyProduct } from './productClassification';
import { calcCogs } from './cogs';
import { rebalanceSessionFulfillment } from './sessionFulfillment';

export interface UpsertOrderResult {
  created: boolean;
  orderId: string;
}

export async function upsertOrder(normalized: NormalizedOrder): Promise<UpsertOrderResult> {
  const platform = await db.platform.upsert({
    where: { slug: normalized.platformSlug },
    create: {
      slug: normalized.platformSlug,
      displayName: normalized.platformSlug === 'clickbank' ? 'ClickBank' : 'Digistore24',
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
  );
  const catalogType: ProductType =
    classified.family !== null ? classified.type : (normalized.productType as ProductType);

  const product = await db.product.upsert({
    where: {
      platformId_externalId: {
        platformId: platform.id,
        externalId: normalized.productExternalId,
      },
    },
    create: {
      platformId: platform.id,
      externalId: normalized.productExternalId,
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
    select: { id: true },
  });

  // Snapshot COGS at ingest. Reads cached cost tables; refreshing the cache
  // happens after admin edits via invalidateCogsCache().
  const cogs = await calcCogs(
    classified.family,
    classified.bottles,
    classified.bonusBottles,
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

  const orderData = {
    platformId: platform.id,
    externalId: normalized.externalId,
    parentExternalId: normalized.parentExternalId,
    previousTransactionId: normalized.previousTransactionId,
    vendorAccount: normalized.vendorAccount,
    productId: product.id,
    affiliateId,
    customerId,

    productType: normalized.productType as ProductType,

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
    funnelStep: normalized.funnelStep,
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
    await db.order.update({ where: { id: existing.id }, data: orderData });
    result = { created: false, orderId: existing.id };
  } else {
    const created = await db.order.create({ data: orderData, select: { id: true } });
    result = { created: true, orderId: created.id };
  }

  // Session shipping is paid once per package, not per item. After saving
  // the order, recompute the session's total fulfillment and assign it
  // to a single primary order (FE preferred). Per-order fulfillmentUsd
  // values from the orderData snapshot get rewritten here for correctness.
  const sessionKey = normalized.parentExternalId ?? normalized.externalId;
  await rebalanceSessionFulfillment(platform.id, sessionKey);

  return result;
}
