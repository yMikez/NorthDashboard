import type { OrderStatus, ProductType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import type { NormalizedOrder } from '../shared/types';

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
      productType: normalized.productType as ProductType,
    },
    update: {
      name: normalized.productName || undefined,
    },
    select: { id: true },
  });

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
  };

  const existing = await db.order.findUnique({
    where: {
      platformId_externalId: { platformId: platform.id, externalId: normalized.externalId },
    },
    select: { id: true },
  });

  if (existing) {
    await db.order.update({ where: { id: existing.id }, data: orderData });
    return { created: false, orderId: existing.id };
  }

  const created = await db.order.create({ data: orderData, select: { id: true } });
  return { created: true, orderId: created.id };
}
