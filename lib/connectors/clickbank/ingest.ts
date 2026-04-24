import type {
  NormalizedBillingType,
  NormalizedOrder,
  NormalizedOrderStatus,
  NormalizedProductType,
} from '../../shared/types';
import type {
  ClickBankIngestPayload,
  ClickBankLineItemType,
  ClickBankTransactionType,
} from './types';

export function parseClickBankIngest(payload: ClickBankIngestPayload): NormalizedOrder {
  const primary = payload.lineItems[0];
  if (!primary) {
    throw new Error('ClickBank payload has no lineItems');
  }

  const productType = mapProductType(primary.lineItemType);
  const status = mapStatus(payload.transactionType);

  const tracking = payload.commonTrackingParameters ?? {};
  const vendorVars = payload.vendorVariables ?? {};

  const billing = payload.customer?.billing?.address;
  const shipping = payload.customer?.shipping?.address;

  const country = tracking.country ?? billing?.country ?? shipping?.country ?? null;
  const state = tracking.state ?? billing?.state ?? shipping?.state ?? null;
  const city = tracking.city ?? shipping?.city ?? billing?.city ?? null;

  const receipt = payload.receipt;
  const upsellOriginalReceipt = payload.upsell?.upsellOriginalReceipt ?? null;
  const parentExternalId =
    productType === 'FRONTEND' || upsellOriginalReceipt === receipt
      ? null
      : upsellOriginalReceipt;

  const totalAffiliatePayout = payload.lineItems.reduce(
    (sum, item) => sum + (item.affiliatePayout ?? 0),
    0,
  );

  const taxAmount = payload.totalTaxAmount ?? 0;
  const gross = payload.totalOrderAmount;
  const net = payload.totalAccountAmount;

  return {
    platformSlug: 'clickbank',
    externalId: receipt,
    parentExternalId,
    previousTransactionId: null,
    vendorAccount: payload.vendor ?? null,

    productExternalId: primary.itemNo,
    productName: primary.productTitle,
    productType,

    affiliateExternalId: payload.affiliate ?? null,
    affiliateNickname: payload.affiliate ?? null,

    customerExternalId: null,
    customerEmail: payload.customer?.billing?.email ?? payload.customer?.shipping?.email ?? null,
    customerFirstName: payload.customer?.billing?.firstName ?? null,
    customerLastName: payload.customer?.billing?.lastName ?? null,
    customerLanguage: payload.orderLanguage?.toLowerCase() ?? null,

    status,
    eventType: payload.transactionType,
    billingType: mapBillingType(primary.recurring),
    paySequenceNo: null,
    numberOfInstallments: null,

    currencyOriginal: payload.currency,
    grossAmountOrig: gross,
    grossAmountUsd: payload.currency === 'USD' ? gross : gross,
    taxAmount,
    fees: 0,
    netAmountUsd: net,
    cpaPaidUsd: totalAffiliatePayout,

    paymentMethod: payload.paymentMethod ?? null,
    country,
    state,
    city,

    funnelSessionId: payload.upsell?.upsellSession ?? null,
    funnelStep: productType === 'FRONTEND' ? 0 : parseFunnelStep(payload.upsell?.upsellPath),
    clickId: tracking.clickId ?? null,
    trackingId: vendorVars.aff_sub1 ?? vendorVars.tid ?? null,
    campaignKey: vendorVars.campaignkey ?? null,
    trafficSource: vendorVars.traffic_source ?? null,
    deviceType: tracking.deviceType ?? vendorVars.traffic_type ?? null,
    browser: tracking.browser ?? null,

    detailsUrl: null,

    orderedAt: parseClickBankTimestamp(payload.transactionTime),
    rawMetadata: payload as unknown as Record<string, unknown>,
  };
}

function mapProductType(lineItemType: ClickBankLineItemType): NormalizedProductType {
  switch (lineItemType) {
    case 'ORIGINAL':
      return 'FRONTEND';
    case 'UPSELL':
      return 'UPSELL';
    case 'DOWNSELL':
      return 'DOWNSELL';
    case 'BUMP':
      return 'BUMP';
    default:
      return 'FRONTEND';
  }
}

function mapStatus(transactionType: ClickBankTransactionType): NormalizedOrderStatus {
  const normalized = transactionType.toUpperCase();
  if (normalized === 'RFND' || normalized === 'TEST_RFND') return 'REFUNDED';
  if (normalized === 'CGBK' || normalized === 'TEST_CGBK') return 'CHARGEBACK';
  if (normalized === 'SALE' || normalized === 'BILL') return 'APPROVED';
  if (normalized === 'TEST_SALE' || normalized === 'TEST_BILL') return 'APPROVED';
  return 'PENDING';
}

function mapBillingType(recurring: boolean | undefined): NormalizedBillingType {
  if (recurring === true) return 'SUBSCRIPTION';
  if (recurring === false) return 'SINGLE_PAYMENT';
  return 'UNKNOWN';
}

function parseFunnelStep(upsellPath: string | undefined): number | null {
  if (!upsellPath) return null;
  const char = upsellPath.toLowerCase().charCodeAt(0);
  if (char >= 97 && char <= 122) return char - 96;
  return null;
}

/**
 * ClickBank transactionTime format: "20260423T175704-0700"
 * Convert to ISO 8601 and parse.
 */
export function parseClickBankTimestamp(raw: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})$/.exec(raw);
  if (!match) {
    const fallback = new Date(raw);
    if (Number.isNaN(fallback.getTime())) {
      throw new Error(`Invalid ClickBank timestamp: ${raw}`);
    }
    return fallback;
  }
  const [, y, mo, d, h, mi, s, tz] = match;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${tz.slice(0, 3)}:${tz.slice(3)}`;
  return new Date(iso);
}
