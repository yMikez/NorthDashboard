// Parser do POSTBACK Cartpanda → NormalizedOrder.
//
// Decisões de mapeamento (confirmadas com o usuário em 2026-06-13):
//   - Canal só dispara pra VENDA aprovada (front + upsell) → status SEMPRE
//     APPROVED. Refund/chargeback não vêm por aqui.
//   - Funil: upsell_no=0 → FRONTEND; upsell_no>=1 → UPSELL. order_type pode
//     marcar downsell/bump explicitamente (vocabulário a confirmar com um
//     postback real; o default por upsell_no já cobre FE vs upsell).
//   - Sessão: order_id é o anchor (parentExternalId); cid (click) é a chave de
//     agrupamento do funil (funnelSessionId) — compartilhada por FE+upsells do
//     mesmo visitante, mais robusta que order_id (mesma lição do BuyGoods/sessid2).
//   - externalId precisa ser único por (plataforma, externalId). Como os
//     upsells repetem o order_id, o upsell ganha sufixo `-uN`; o FE fica com o
//     order_id limpo.
//   - Timestamp: datetime_unix (epoch) é autoritativo; fallback datetime_utc
//     (tratado como UTC literal — a Cartpanda já entrega em UTC).

import type {
  NormalizedOrder,
  NormalizedProductType,
} from '../../shared/types';
import type { CartpandaPostback } from './types';

export function parseCartpandaIngest(payload: CartpandaPostback): NormalizedOrder {
  const orderId = required(payload, 'order_id');
  const upsellNo = parseIntSafe(payload.upsell_no, 0);

  // externalId único: FE = order_id; upsell = order_id-uN (Cartpanda reusa o
  // order_id entre FE e upsells da mesma compra).
  const externalId = upsellNo > 0 ? `${orderId}-u${upsellNo}` : orderId;

  const currency = (payload.currency || 'USD').toUpperCase();
  const gross = decimal(payload.total_price);
  const cpa = decimal(payload.amount_affiliate);
  // amount_net = residual do vendor conforme a Cartpanda reporta (mesma lente
  // de amount_vendor do Digistore / totalAccountAmount do CB: pós-comissão).
  const net = decimal(payload.amount_net);
  // Taxa implícita da plataforma = gross - net - cpa (>= 0). Sem breakdown de
  // fee no postback; isso aproxima pra página de Custos.
  const fees = round2(Math.max(0, gross - net - cpa));

  const productType = mapProductType(payload, upsellNo);
  const funnelStep = upsellNo > 0 ? upsellNo + 1 : 1;

  // Afiliado: afid (id numérico) é a chave; affiliate_slug é o nome. Se só o
  // slug vier, ele vira a chave também.
  const affExternalId = notEmpty(payload.afid) ?? notEmpty(payload.affiliate_slug);
  const affNickname = notEmpty(payload.affiliate_slug);

  return {
    platformSlug: 'cartpanda',
    externalId,
    parentExternalId: orderId,
    previousTransactionId: null,
    vendorAccount: notEmpty(payload.shop_slug),

    productExternalId: notEmpty(payload.product_id) ?? notEmpty(payload.product_name) ?? 'unknown',
    productName: notEmpty(payload.product_name) ?? '',
    productType,

    affiliateExternalId: affExternalId,
    affiliateNickname: affNickname,

    customerExternalId: notEmpty(payload.email),
    customerEmail: notEmpty(payload.email),
    customerFirstName: notEmpty(payload.first_name),
    customerLastName: notEmpty(payload.last_name),
    customerLanguage: null,

    // Canal só manda venda aprovada (FE + upsell).
    status: 'APPROVED',
    eventType: notEmpty(payload.order_type) ?? 'sale',
    billingType: 'SINGLE_PAYMENT',
    paySequenceNo: null,
    numberOfInstallments: null,

    currencyOriginal: currency,
    grossAmountOrig: gross,
    // FX TODO: se a Cartpanda enviar não-USD, converter aqui. Por ora passthrough.
    grossAmountUsd: gross,
    taxAmount: 0,
    fees,
    netAmountUsd: net,
    cpaPaidUsd: cpa,

    paymentMethod: null,
    country: notEmpty(payload.country),
    state: null,
    city: null,

    // Sessão do funil = click (cid). Fallback pro order_id quando ausente.
    funnelSessionId: notEmpty(payload.cid) ?? orderId,
    funnelStep,
    clickId: notEmpty(payload.cid),
    trackingId: notEmpty(payload.src) ?? notEmpty(payload.sck),
    campaignKey: notEmpty(payload.campaignkey),
    trafficSource: notEmpty(payload.utm_source),
    deviceType: null,
    browser: null,

    detailsUrl: null,

    orderedAt: parseCartpandaTimestamp(payload),
    rawMetadata: payload as unknown as Record<string, unknown>,
  };
}

// ---------------------- helpers ----------------------

function required(p: CartpandaPostback, key: keyof CartpandaPostback): string {
  const v = p[key];
  if (!v) throw new Error(`Cartpanda postback missing required field: ${String(key)}`);
  return String(v);
}

function notEmpty(v: string | undefined | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function decimal(v: string | undefined | null): number {
  if (v == null) return 0;
  const cleaned = String(v).replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseIntSafe(v: string | undefined | null, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * FE vs Upsell vem do upsell_no (confiável). order_type pode marcar downsell/
 * bump explicitamente — checamos o texto. Default: upsell_no>=1 → UPSELL.
 */
function mapProductType(payload: CartpandaPostback, upsellNo: number): NormalizedProductType {
  const t = (payload.order_type ?? '').toLowerCase();
  const name = (payload.product_name ?? '').toLowerCase();
  if (/down\s*sell|downsell|\bds\b|last\s*chance/.test(t + ' ' + name)) return 'DOWNSELL';
  if (/\bbump\b|order\s*bump/.test(t + ' ' + name)) return 'BUMP';
  if (upsellNo >= 1 || /up\s*sell|upsell/.test(t)) return 'UPSELL';
  return 'FRONTEND';
}

/**
 * datetime_unix (epoch segundos) é autoritativo. Fallback: datetime_utc, que a
 * Cartpanda entrega em UTC — parseado como wall clock UTC literal (sem shift de
 * fuso, diferente do BuyGoods que vem em horário do Leste). Último fallback: now.
 */
function parseCartpandaTimestamp(payload: CartpandaPostback): Date {
  const unix = parseInt(String(payload.datetime_unix ?? ''), 10);
  if (Number.isFinite(unix) && unix > 0) {
    // Heurística: epoch em segundos (10 dígitos) vs ms (13 dígitos).
    return new Date(unix < 1e12 ? unix * 1000 : unix);
  }
  const utc = (payload.datetime_utc ?? '').trim();
  if (utc) {
    // ISO com Z/offset → parse direto. "YYYY-MM-DD HH:mm:ss" → tratar como UTC.
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(utc)
      ? utc
      : utc.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
