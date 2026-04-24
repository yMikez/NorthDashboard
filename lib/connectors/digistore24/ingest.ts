import type {
  NormalizedBillingType,
  NormalizedOrder,
  NormalizedOrderStatus,
  NormalizedProductType,
} from '../../shared/types';
import type { DigistorePayload } from './types';

export function parseDigistoreIngest(payload: DigistorePayload): NormalizedOrder {
  const event = normalizeEvent(payload.event);

  const transactionId = required(payload, 'transaction_id');
  const orderId = required(payload, 'order_id');
  const parentTransactionId = payload.parent_transaction_id || null;

  const upsellNo = numberOrNull(payload.upsell_no) ?? 0;
  const productType: NormalizedProductType = upsellNo === 0 ? 'FRONTEND' : 'UPSELL';

  const currency = payload.currency || 'USD';
  const gross = decimal(payload.amount_brutto);
  const tax = decimal(payload.amount_vat);
  const net = decimal(payload.amount_vendor);
  const cpa = decimal(payload.amount_affiliate);

  return {
    platformSlug: 'digistore24',
    externalId: transactionId,
    parentExternalId: orderId === transactionId ? null : orderId,
    previousTransactionId: parentTransactionId,
    vendorAccount: payload.merchant_name || payload.merchant_id || null,

    productExternalId: required(payload, 'product_id'),
    productName: payload.product_name_intern || payload.product_name || '',
    productType,

    affiliateExternalId: payload.affiliate_id || payload.tags || null,
    affiliateNickname: payload.affiliate_name || payload.tags || null,

    customerExternalId: payload.buyer_id || null,
    customerEmail: payload.buyer_email || payload.email || null,
    customerFirstName: payload.buyer_first_name || payload.address_first_name || null,
    customerLastName: payload.buyer_last_name || payload.address_last_name || null,
    customerLanguage: payload.buyer_language || payload.language || null,

    status: mapStatus(event),
    eventType: event,
    billingType: mapBillingType(payload.billing_type),
    paySequenceNo: numberOrNull(payload.pay_sequence_no),
    numberOfInstallments: numberOrNull(payload.number_of_installments),

    currencyOriginal: currency,
    grossAmountOrig: gross,
    grossAmountUsd: currency === 'USD' ? gross : gross,
    taxAmount: tax,
    fees: decimal(payload.amount_provider) + decimal(payload.amount_fee),
    netAmountUsd: net,
    cpaPaidUsd: cpa,

    paymentMethod: payload.pay_method || null,
    country: payload.country || payload.address_country || null,
    state: payload.address_state || payload.billing_state || null,
    city: payload.address_city || payload.billing_city || null,

    funnelSessionId: orderId,
    funnelStep: upsellNo,
    clickId: payload.click_id || null,
    trackingId: payload.trackingkey || payload.custom || null,
    campaignKey: payload.campaignkey || null,
    trafficSource: null,
    deviceType: null,
    browser: null,

    detailsUrl: payload.order_details_url || null,

    orderedAt: parseDigistoreTimestamp(
      payload.order_date_time,
      payload.transaction_date,
      payload.transaction_time,
      payload.server_time,
    ),
    rawMetadata: payload as unknown as Record<string, unknown>,
  };
}

function required(p: DigistorePayload, key: string): string {
  const value = p[key];
  if (!value) {
    throw new Error(`Digistore payload missing required field: ${key}`);
  }
  return value;
}

function normalizeEvent(raw: string | undefined): string {
  if (!raw) return '';
  return raw.startsWith('on_') ? raw.slice(3) : raw;
}

function mapStatus(event: string): NormalizedOrderStatus {
  switch (event) {
    case 'payment':
    case 'rebill_resumed':
      return 'APPROVED';
    case 'refund':
      return 'REFUNDED';
    case 'chargeback':
      return 'CHARGEBACK';
    case 'payment_missed':
    case 'payment_denial':
    case 'rebill_cancelled':
    case 'last_paid_day':
      return 'CANCELED';
    default:
      return 'PENDING';
  }
}

function mapBillingType(raw: string | undefined): NormalizedBillingType {
  switch (raw) {
    case 'single_payment':
      return 'SINGLE_PAYMENT';
    case 'installment':
      return 'INSTALLMENT';
    case 'subscription':
      return 'SUBSCRIPTION';
    default:
      return 'UNKNOWN';
  }
}

function decimal(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Digistore sends dates as "2026-04-24 03:56:47" (no timezone — treated as UTC).
 * Fallback chain: order_date_time → transaction_date+time → server_time → now.
 */
export function parseDigistoreTimestamp(
  orderDateTime?: string,
  transactionDate?: string,
  transactionTime?: string,
  serverTime?: string,
): Date {
  if (orderDateTime) {
    const parsed = parseDigistoreDateString(orderDateTime);
    if (parsed) return parsed;
  }
  if (transactionDate && transactionTime) {
    const parsed = parseDigistoreDateString(`${transactionDate} ${transactionTime}`);
    if (parsed) return parsed;
  }
  if (serverTime) {
    const parsed = parseDigistoreDateString(serverTime);
    if (parsed) return parsed;
  }
  return new Date();
}

function parseDigistoreDateString(raw: string): Date | null {
  const iso = raw.trim().replace(' ', 'T') + (raw.includes('Z') || raw.includes('+') ? '' : 'Z');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
