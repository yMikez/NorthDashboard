// Vupim → NormalizedOrder (doc relida em 2026-10-22).
//
// Eventos que viram pedido (os demais ficam só no IngestLog):
//   sale.approved         → APPROVED
//   sale.refunded         → REFUNDED (estorno total)
//   sale.partial_refund   → REFUNDED com o valor devolvido até agora
//   sale.chargeback       → CHARGEBACK
//   sale.chargeback_won   → APPROVED (a venda fica de pé e o dinheiro volta)
//   sale.chargeback_lost  → CHARGEBACK
//   subscription.renewed  → APPROVED (cobrança da renovação, pedido próprio)
// sale.created (toda tentativa), sale.declined, sale.shipped, os outros
// subscription.*, checkout.* e webhook.test não criam pedido. Evento com
// livemode=false (teste) nunca vira pedido — quem decide é a rota.
//
// Estorno é IN-PLACE (como JVZoo/CB/BG): o evento reescreve a linha da venda
// (mesmo transactionId) com gross negativo = o devolvido. A data do estorno é
// data.refundedAt / data.chargebackAt (o `timestamp` do envelope é só a hora
// da entrega — fallback); `createdAt` continua sendo a da venda.
//
// Sessão do funil: checkoutSessionId é o mesmo na venda de front e em todos os
// upsells/downsells (doc) → parentExternalId = funnelSessionId, como na
// Cartpanda. Renovação ancora em si mesma (despacha a própria remessa, como o
// rebill da JVZoo). Papel pelo `origin`: direct/call_center → FRONTEND,
// upsell → UPSELL, downsell → DOWNSELL; funnelStep 0 no front.
//
// Dinheiro: unidade mínima da moeda. Venda em outra moeda usa os campos *Usd
// (centavos de dólar, na taxa da própria venda) ou exchangeRate; sem nenhum
// dos dois, lança VupimCurrencyError (fica registrado no log).

import type { NormalizedOrder, NormalizedOrderStatus, NormalizedProductType } from '../../shared/types';
import { normalizePhone } from '../../shared/phone';
import type { VupimData, VupimEnvelope } from './types';

export const VUPIM_ORDER_EVENTS: Record<string, NormalizedOrderStatus> = {
  'sale.approved': 'APPROVED',
  'sale.refunded': 'REFUNDED',
  'sale.partial_refund': 'REFUNDED',
  'sale.chargeback': 'CHARGEBACK',
  'sale.chargeback_won': 'APPROVED',
  'sale.chargeback_lost': 'CHARGEBACK',
  'subscription.renewed': 'APPROVED',
};

// Nomes antigos em português continuam válidos na Vupim ("cada um é lido como
// o evento que significava"): aceitamos os óbvios por garantia.
const LEGACY_EVENTS: Record<string, string> = {
  'venda.aprovada': 'sale.approved',
  'venda.reembolsada': 'sale.refunded',
  reembolso: 'sale.refunded',
  'reembolso.parcial': 'sale.partial_refund',
  chargeback: 'sale.chargeback',
};

export function vupimEventKey(raw: unknown): string {
  const k = String(raw ?? '').trim().toLowerCase();
  return LEGACY_EVENTS[k] ?? k;
}

export class VupimCurrencyError extends Error {
  constructor(public currency: string) {
    super(`moeda ${currency} sem valor em USD nem exchangeRate no payload`);
    this.name = 'VupimCurrencyError';
  }
}

// Moedas sem casa decimal (9700 JPY = ¥9.700).
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CLP', 'VND', 'PYG', 'UGX', 'XAF', 'XOF', 'ISK']);

export function vupimMajor(minor: number | null | undefined, currency: string): number {
  const n = Number(minor ?? 0);
  if (!Number.isFinite(n)) return 0;
  return ZERO_DECIMAL.has(currency) ? n : Math.round(n) / 100;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const str = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return t || null;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const date = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

function splitName(name: string | null): { first: string | null; last: string | null } {
  if (!name) return { first: null, last: null };
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? null, last: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

/** Nome do SKU: oferta (pacote) com o produto quando a oferta não o repete. */
export function vupimProductName(d: VupimData): string {
  const product = str(d.productName);
  const offer = str(d.offerName);
  if (product && offer) return offer.toLowerCase().includes(product.toLowerCase()) ? offer : `${product} - ${offer}`;
  return offer ?? product ?? str(d.offerId) ?? str(d.productId) ?? 'unknown';
}

function productType(d: VupimData): NormalizedProductType {
  const origin = String(d.origin ?? '').toLowerCase();
  if (origin === 'upsell') return 'UPSELL';
  if (origin === 'downsell') return 'DOWNSELL';
  return 'FRONTEND';
}

/**
 * Conversor de valores da venda pra USD. USD: unidade mínima ÷ 100. Outra
 * moeda: o campo *Usd quando veio (centavos), senão exchangeRate, senão a
 * proporção amountUsd/amount (pros valores sem campo *Usd, ex. estorno).
 */
function usdConverter(d: VupimData, currency: string) {
  if (currency === 'USD') {
    return { fromSale: (minor: unknown) => vupimMajor(num(minor), 'USD'), usd: (_usdCents: unknown, minor: unknown) => vupimMajor(num(minor), 'USD') };
  }
  const rate = num(d.exchangeRate);
  const amount = num(d.amount);
  const amountUsd = num(d.amountUsd);
  const perMinor = rate != null
    ? (ZERO_DECIMAL.has(currency) ? rate : rate / 100)
    : amount && amountUsd != null ? amountUsd / 100 / amount : null;
  if (perMinor == null) throw new VupimCurrencyError(currency);
  const fromSale = (minor: unknown) => round2((num(minor) ?? 0) * perMinor);
  return { fromSale, usd: (usdCents: unknown, minor: unknown) => (num(usdCents) != null ? round2(num(usdCents)! / 100) : fromSale(minor)) };
}

/**
 * Evento de pedido → NormalizedOrder. `asSale` força a versão APROVADA (usado
 * quando o estorno chega antes da venda: grava a venda primeiro pra que o
 * valor original fique certo e depois aplica o estorno).
 */
export function parseVupimOrder(env: VupimEnvelope, opts: { asSale?: boolean } = {}): NormalizedOrder {
  const event = vupimEventKey(env.event);
  const status: NormalizedOrderStatus = opts.asSale ? 'APPROVED' : VUPIM_ORDER_EVENTS[event];
  if (!status) throw new Error(`evento ${event} não gera pedido`);
  const d = env.data ?? {};
  const externalId = str(d.transactionId);
  if (!externalId) throw new Error('Vupim: data.transactionId ausente');
  const currency = (str(d.currency) ?? 'USD').toUpperCase();
  const conv = usdConverter(d, currency);

  const orderedAt = date(d.createdAt) ?? date(d.approvedAt) ?? date(env.timestamp);
  if (!orderedAt) throw new Error('Vupim: createdAt inválido');
  const eventAt = status === 'REFUNDED'
    ? date(d.refundedAt) ?? date(env.timestamp)
    : status === 'CHARGEBACK' ? date(d.chargebackAt) ?? date(env.timestamp) : null;

  const gross = conv.usd(d.amountUsd, d.amount);
  const tax = conv.usd(d.taxAmountUsd, d.taxAmount);
  const net = conv.usd(d.netAmountUsd, d.netAmount ?? d.commission);
  const cpa = conv.usd(d.affiliateCommissionUsd, d.affiliateCommission);
  const feesMinor = d.fees && typeof d.fees === 'object'
    ? Object.values(d.fees).reduce<number | null>((s, v) => (num(v) != null ? (s ?? 0) + num(v)! : s), null)
    : null;
  // Taxa da Vupim: a informada; sem ela, o que sobra depois de imposto, produtor e afiliado.
  const fees = num(d.feesUsd) != null || feesMinor != null
    ? conv.usd(d.feesUsd, feesMinor)
    : round2(Math.max(0, gross - tax - net - cpa));
  // Estorno: o devolvido ATÉ AGORA (o parcial traz o acumulado em totalRefunded).
  const refundedMinor = d.totalRefunded ?? d.refundAmount ?? d.amount;
  const reversed = status === 'APPROVED'
    ? 0
    : status === 'CHARGEBACK' ? gross : Math.min(gross, conv.fromSale(refundedMinor));
  const grossOrig = vupimMajor(d.amount, currency);
  const reversedOrig = status === 'CHARGEBACK' ? grossOrig : Math.min(grossOrig, vupimMajor(num(refundedMinor), currency));

  const name = vupimProductName(d);
  const type = productType(d);
  const renewal = event === 'subscription.renewed' || String(d.origin ?? '').toLowerCase() === 'renewal';
  const sessionId = renewal ? externalId : str(d.checkoutSessionId);
  const c = d.customer ?? {};
  const email = str(c.email)?.toLowerCase() ?? null;
  const split = splitName(str(c.name));
  const items = Array.isArray(d.items) ? d.items : [];
  const mainSku = str(items.find((i) => i?.type === 'main')?.sku) ?? str(items[0]?.sku);
  const subIds = d.subIds ?? d.affiliate?.subIds ?? null;

  return {
    platformSlug: 'vupim',
    externalId,
    parentExternalId: sessionId,
    previousTransactionId: null,
    vendorAccount: null,

    productExternalId: str(d.offerId) ?? str(d.productId) ?? 'unknown',
    productName: name,
    productType: type,

    affiliateExternalId: str(d.affiliateId) ?? str(d.affiliate?.id),
    affiliateNickname: str(d.affiliate?.name),
    affiliateEmail: str(d.affiliate?.email)?.toLowerCase() ?? null,

    // customer.id é o mesmo em toda compra do comprador; e-mail é o fallback.
    customerExternalId: str(c.id) ?? email,
    customerEmail: email,
    customerFirstName: str(c.firstName) ?? split.first,
    customerLastName: str(c.lastName) ?? split.last,
    customerLanguage: str(c.locale),
    customerPhone: normalizePhone(c.phone) ?? normalizePhone(d.shipping?.phone),

    status,
    eventType: opts.asSale ? 'sale.approved' : event,
    billingType: renewal || str(d.subscriptionId) ? 'SUBSCRIPTION' : 'SINGLE_PAYMENT',
    paySequenceNo: num(d.chargeNumber),
    numberOfInstallments: null,

    currencyOriginal: currency,
    grossAmountOrig: status === 'APPROVED' ? grossOrig : -reversedOrig,
    grossAmountUsd: status === 'APPROVED' ? gross : -reversed,
    taxAmount: tax,
    fees,
    netAmountUsd: net,
    cpaPaidUsd: cpa,

    paymentMethod: str(d.paymentMethod),
    country: (str(d.country) ?? str(c.country))?.toUpperCase() ?? null,
    state: str(c.state) ?? str(d.shipping?.state),
    city: str(c.city) ?? str(d.shipping?.city),

    funnelSessionId: sessionId,
    funnelStep: type === 'FRONTEND' ? 0 : num(d.funnelStep),
    clickId: str(d.clickId),
    trackingId: str(d.src) ?? str(d.sck) ?? str(subIds?.sub1),
    campaignKey: str(d.utmCampaign),
    trafficSource: str(d.utmSource),
    deviceType: null,
    browser: null,

    detailsUrl: null,

    orderedAt,
    eventAt,
    rawMetadata: {
      vupimEvent: event,
      deliveryId: env.id,
      eventId: str(env.eventId),
      // Guardada pra descartar evento atrasado (rota: versão menor não sobrescreve).
      vupimVersion: num(d.version),
      livemode: env.livemode ?? null,
      origin: str(d.origin),
      parentTransactionId: str(d.parentTransactionId),
      stepCheckoutSessionId: str(d.stepCheckoutSessionId),
      funnelStepName: str(d.funnelStepName),
      productId: str(d.productId),
      offerId: str(d.offerId),
      sku: mainSku,
      items: items.map((i) => ({ type: str(i?.type), sku: str(i?.sku), offerId: str(i?.offerId), quantity: num(i?.quantity), amount: num(i?.amount) })),
      exchangeRate: num(d.exchangeRate),
      coproducerCommission: num(d.coproducerCommission),
      reserveAmount: num(d.reserveAmount),
      reserveReleaseAt: str(d.reserveReleaseAt),
      subscriptionId: str(d.subscriptionId),
      reason: str(d.reason),
      refundId: str(d.refundId),
      chargebackFee: num(d.chargebackFee),
      outcome: str(d.outcome),
      chargebackResolvedAt: str(d.chargebackResolvedAt),
      subIds,
      landingUrl: str(d.landingUrl),
      referrer: str(d.referrer),
      utmMedium: str(d.utmMedium),
      utmContent: str(d.utmContent),
      utmTerm: str(d.utmTerm),
    },
  };
}

/**
 * Aplica o evento sobre o que já está gravado? A Vupim entrega "pelo menos
 * uma vez" e fora de ordem. Com `version` (doc de 22/10) a regra é a deles: só
 * aplica versão MAIOR que a gravada. Sem versão (webhook antigo), a regra
 * nossa: chargeback sempre; chargeback ganho só desfaz chargeback; aprovação
 * não desfaz estorno; estorno só avança.
 */
export function vupimShouldApply(
  incoming: 'APPROVED' | 'REFUNDED' | 'CHARGEBACK',
  existing: { status: string; grossAmountUsd: number; version?: number | null } | null,
  reversedUsd: number,
  opts: { version?: number | null; chargebackWon?: boolean } = {},
): boolean {
  if (!existing) return true;
  if (opts.version != null && existing.version != null) return opts.version > existing.version;
  if (opts.chargebackWon) return existing.status === 'CHARGEBACK';
  if (incoming === 'CHARGEBACK') return true;
  if (existing.status === 'CHARGEBACK') return false;
  if (incoming === 'APPROVED') return existing.status !== 'REFUNDED';
  // Estorno: só avança (parcial antigo não desfaz um estorno maior).
  return existing.status !== 'REFUNDED' || Math.abs(existing.grossAmountUsd) < reversedUsd;
}
