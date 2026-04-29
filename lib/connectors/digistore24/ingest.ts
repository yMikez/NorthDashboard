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
  // Digistore Order ID is per-step, not per-session: FE = "ABC123", UP1 =
  // "ABC1231", UP2 = "ABC1232". Strip the upsell_no suffix to recover the
  // session's "base" order id — the value all steps of one buyer's funnel
  // share. We use this as parentExternalId for both FE (= itself) and the
  // upsells, so the metrics layer can group them under the same key.
  const baseOrderId = deriveBaseOrderId(orderId, upsellNo);

  const currency = payload.currency || 'USD';
  const gross = decimal(payload.amount_brutto);
  const tax = decimal(payload.amount_vat);
  const net = decimal(payload.amount_vendor);
  const cpa = decimal(payload.amount_affiliate);

  return {
    platformSlug: 'digistore24',
    externalId: transactionId,
    parentExternalId: baseOrderId,
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
 * Strip the upsell_no suffix from a Digistore order_id to recover the
 * session's base id (= FE order_id). Pure function — exported for backfill
 * + tests.
 *
 *   FE   (upsellNo=0): "ABC123"  → "ABC123"
 *   UP1  (upsellNo=1): "ABC1231" → "ABC123"
 *   UP2  (upsellNo=2): "ABC1232" → "ABC123"
 *   UP10 (upsellNo=10):"ABC12310"→ "ABC123"
 *
 * If the suffix doesn't actually appear at the end (defensive fallback for
 * unexpected payload shapes), returns orderId unchanged so we don't corrupt
 * data for edge cases.
 */
export function deriveBaseOrderId(orderId: string, upsellNo: number): string {
  if (!upsellNo || upsellNo <= 0) return orderId;
  const suffix = String(upsellNo);
  return orderId.endsWith(suffix) ? orderId.slice(0, -suffix.length) : orderId;
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
  const trimmed = raw.trim();
  // Quando o payload já trouxe timezone explícito (Z, +HH:MM, -HH:MM no fim),
  // o motor JS resolve corretamente — só normalizamos espaço pra T.
  if (trimmed.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Sem TZ explícito — Digistore manda wall-clock em Europe/Berlin (CET no
  // inverno, CEST no verão). ANTES tratávamos como UTC, o que causava bug
  // de +1h ou +2h em todos os orderedAt.
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, Y, M, D, h, mi, s] = m.map(Number);
  // Itera 2x no máximo: faz uma estimativa UTC, descobre a wall-clock que
  // ela representaria em Berlin, ajusta pelo offset, refaz. Converge em
  // 1 iteração mesmo cruzando borda de DST.
  let utcMs = Date.UTC(Y, M - 1, D, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const berlinH = get('hour');
    const berlinMi = get('minute');
    const diffMin = (berlinH - h) * 60 + (berlinMi - mi);
    if (diffMin === 0) break;
    utcMs -= diffMin * 60 * 1000;
  }
  const d = new Date(utcMs);
  return Number.isNaN(d.getTime()) ? null : d;
}
