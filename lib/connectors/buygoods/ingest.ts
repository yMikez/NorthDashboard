// Parser BuyGoods IPN → NormalizedOrder.
//
// BuyGoods envia form-urlencoded com ~100 campos. Nossos campos-chave:
//   - order_id           ID local da transação (string)
//   - order_id_global    ID compartilhado entre FE+UPs da mesma sessão (parent)
//   - action_type        evento ("neworder", "refund", "chargeback", ...)
//   - product_codename   slug do produto (usado como externalId pra Product)
//   - rr_createdate      timestamp da venda em YYYY-MM-DD HH:mm:ss (UTC observado)
//   - total_amount_charged  / total_clean   gross numérico (USD)
//   - aff_commission     CPA pago ao afiliado
//   - flag_frontend / flag_upsell   indica tipo de produto no funnel
//
// Gotcha 1: campo `total` chega corrompido em alguns IPNs ("1.95")
// — encoding bug do lado BG. Usamos sempre total_amount_charged | total_clean.
//
// Gotcha 2: rr_createdate sem timezone. BuyGoods opera em EST/EDT (sede US).
// Observação empírica de payloads reais: o timestamp já chega em UTC. Se
// futuramente descobrir que é EST, ajustar pela função convertToUtc().

import type {
  NormalizedOrder,
  NormalizedOrderStatus,
  NormalizedProductType,
} from '../../shared/types';
import type { BuyGoodsPayload } from './types';

export function parseBuyGoodsIngest(payload: BuyGoodsPayload): NormalizedOrder {
  const action = (payload.action_type ?? '').toLowerCase().trim();

  const externalId = required(payload, 'order_id');
  const globalId = payload.order_id_global || null;
  // ProductExternalId: prefere product_codename (slug humano) > product_id.
  // O composite sku ("12595-prod_cod:1") mistura account+codename e não
  // serve como chave estável entre vendor accounts. account_id é guardado
  // separado em vendorAccount.
  const productExternalId =
    payload.product_codename || payload.product_id || 'unknown';

  const currency = (payload.currency || 'USD').toUpperCase();
  // gross: prefere total_amount_charged (preciso) > total_clean (fallback).
  const gross = decimal(payload.total_amount_charged ?? payload.total_clean);
  const tax = decimal(payload.taxes);
  const shipping = decimal(payload.shipping_cost_total ?? payload.shipping_cost);
  const merchantFee = decimal(payload.merchant_commission);
  const cpa = decimal(payload.aff_commission);

  // BG não envia "amount_vendor" explícito → derivamos.
  // net = gross - merchant_commission - aff_commission - shipping_cost (estimado)
  // Aproximação; pode ser refinada conforme observação de mais payloads.
  const net = round2(gross - merchantFee - cpa - shipping);

  const status = mapStatus(action, payload.payment_status, payload.was_canceled);
  const productType = mapProductType(payload);
  const funnelStep = parseFunnelStep(payload, productType);

  return {
    platformSlug: 'buygoods',
    externalId,
    parentExternalId: globalId,
    previousTransactionId: null,
    vendorAccount: payload.account_id || null,

    productExternalId,
    productName: cleanString(payload.product_name) || cleanString(payload.product) || '',
    productType,

    affiliateExternalId: notEmpty(payload.aff_id),
    affiliateNickname: notEmpty(payload.aff_name),

    customerExternalId: notEmpty(payload.user_id) ?? notEmpty(payload.customer_emailaddress),
    customerEmail: notEmpty(payload.customer_emailaddress),
    customerFirstName:
      notEmpty(payload.customer_firstname) ?? notEmpty(payload.billing_firstname),
    customerLastName:
      notEmpty(payload.customer_lastname) ?? notEmpty(payload.billing_lastname),
    customerLanguage: notEmpty(payload.lang),

    status,
    eventType: action || 'unknown',
    billingType: 'SINGLE_PAYMENT',
    paySequenceNo: null,
    numberOfInstallments: null,

    currencyOriginal: currency,
    grossAmountOrig: gross,
    grossAmountUsd: currency === 'USD' ? gross : gross, // FX conversion TODO se BG suportar não-USD
    taxAmount: tax,
    fees: round2(merchantFee + shipping),
    netAmountUsd: net,
    cpaPaidUsd: cpa,

    paymentMethod: notEmpty(payload.payment_cardtype) ?? notEmpty(payload.payment_method),
    country: notEmpty(payload.country_2letter) ?? notEmpty(payload.country),
    state: notEmpty(payload.state) ?? notEmpty(payload.billing_state),
    city: notEmpty(payload.city) ?? notEmpty(payload.billing_city),

    funnelSessionId: globalId ?? notEmpty(payload.sessid2),
    funnelStep,
    clickId: notEmpty(payload.subid) ?? notEmpty(payload.referrer_sid),
    trackingId: notEmpty(payload.sid),
    campaignKey: notEmpty(payload.subid2) ?? notEmpty(payload.referrer_url),
    trafficSource: notEmpty(payload.traffic_source),
    deviceType: detectDevice(payload.browser_user_agent),
    browser: detectBrowser(payload.browser_user_agent),

    detailsUrl: notEmpty(payload.buy_url),

    orderedAt: parseBuyGoodsTimestamp(payload.rr_createdate),
    rawMetadata: payload as unknown as Record<string, unknown>,
  };
}

// ---------------------- helpers ----------------------

function required(p: BuyGoodsPayload, key: keyof BuyGoodsPayload): string {
  const v = p[key];
  if (!v) throw new Error(`BuyGoods payload missing required field: ${String(key)}`);
  return v as string;
}

function notEmpty(v: string | undefined | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s === '0' && false ? null : s.length > 0 ? s : null;
}

function cleanString(v: string | undefined | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function decimal(v: string | undefined | null): number {
  if (v == null) return 0;
  const cleaned = String(v).replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Mapeia action_type + payment_status + was_canceled → NormalizedOrderStatus.
 * Combinação cobre o ciclo completo: venda nova, refund, CB, cancel manual.
 */
function mapStatus(
  action: string,
  paymentStatus: string | undefined,
  wasCanceled: string | undefined,
): NormalizedOrderStatus {
  if (wasCanceled === '1') return 'CANCELED';
  switch (action) {
    case 'neworder':
    case 'newsale':
    case 'rebill':
      return (paymentStatus ?? '').toLowerCase() === 'pending' ? 'PENDING' : 'APPROVED';
    case 'refund':
      return 'REFUNDED';
    case 'chargeback':
      return 'CHARGEBACK';
    case 'cancel':
    case 'canceledfromrebill':
      return 'CANCELED';
    case 'failedrebill':
      return 'PENDING';
    default:
      // Fallback: lê do payment_status.
      switch ((paymentStatus ?? '').toLowerCase()) {
        case 'completed':
          return 'APPROVED';
        case 'refunded':
          return 'REFUNDED';
        case 'pending':
          return 'PENDING';
        default:
          return 'PENDING';
      }
  }
}

/**
 * flag_frontend=1 → FRONTEND. flag_upsell=1 → UPSELL.
 * Se nada estiver setado, inferir do funnel_step (>0 = UPSELL/DOWNSELL).
 * Downsell detectado pelo padrão de SKU/codename (dw, downsell, ds).
 */
function mapProductType(payload: BuyGoodsPayload): NormalizedProductType {
  const isFE = payload.flag_frontend === '1';
  const isUP = payload.flag_upsell === '1';
  const slug = (payload.product_codename ?? '').toLowerCase();
  const name = (payload.product_name ?? '').toLowerCase();

  if (/(dw\d|downsell|ds\d)/.test(slug + ' ' + name)) return 'DOWNSELL';
  if (isFE) return 'FRONTEND';
  if (isUP) return 'UPSELL';

  // Se tem funnel_step > 0 sem flags, é provavelmente upsell.
  const step = parseInt(payload.funnel_step ?? '0', 10);
  if (step > 1) return 'UPSELL';
  return 'FRONTEND';
}

/**
 * funnelStep numérico pro grouping em métricas.
 * FE = 1; UP1 = 2; UP2 = 3 ... espelhando a convenção das outras plataformas.
 */
function parseFunnelStep(
  payload: BuyGoodsPayload,
  productType: NormalizedProductType,
): number | null {
  const explicit = parseInt(payload.funnel_step ?? '', 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (productType === 'FRONTEND') return 1;
  if (productType === 'UPSELL') return 2;
  if (productType === 'DOWNSELL') return 2;
  return null;
}

/**
 * Parse rr_createdate "2026-05-14 01:06:55". Assume UTC.
 * Se virar empírico que BuyGoods envia em EST, trocar pra explicit offset.
 */
function parseBuyGoodsTimestamp(raw: string | undefined): Date {
  if (!raw) return new Date();
  // Aceita "YYYY-MM-DD HH:mm:ss" ou variants.
  const normalized = raw.trim().replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
}

/**
 * Heurística simples pra extrair device do user agent. Não é exato mas
 * cobre desktop/mobile/tablet — suficiente pra dashboard.
 */
function detectDevice(ua: string | undefined): string | null {
  if (!ua) return null;
  const s = ua.toLowerCase();
  if (/ipad|tablet/.test(s)) return 'tablet';
  if (/iphone|ipod|android.*mobile|mobile/.test(s)) return 'mobile';
  return 'desktop';
}

function detectBrowser(ua: string | undefined): string | null {
  if (!ua) return null;
  const s = ua.toLowerCase();
  if (s.includes('edg/')) return 'Edge';
  if (s.includes('chrome/') && !s.includes('edg/')) return 'Chrome';
  if (s.includes('safari/') && !s.includes('chrome/')) return 'Safari';
  if (s.includes('firefox/')) return 'Firefox';
  return null;
}
