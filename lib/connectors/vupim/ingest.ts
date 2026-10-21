// Vupim → NormalizedOrder.
//
// Só quatro eventos viram pedido (os demais ficam só no IngestLog):
//   sale.approved        → APPROVED
//   sale.refunded        → REFUNDED (estorno total)
//   sale.partial_refund  → REFUNDED com o valor devolvido até agora
//   sale.chargeback      → CHARGEBACK
// sale.created (toda tentativa, inclusive pendente/recusada), sale.declined,
// sale.shipped, subscription.*, checkout.* e webhook.test não criam pedido.
//
// Estorno é IN-PLACE (como JVZoo/CB/BG): o evento reescreve a linha da venda
// (mesmo transactionId) com gross negativo = o devolvido; a data do estorno é
// o `timestamp` do envelope (eventAt → refundedAt/chargebackAt) e `createdAt`
// continua sendo a da venda.
//
// Sessão do funil: a Vupim não manda o pedido pai — só checkoutSessionId e
// origin (direct | upsell). Igual à Cartpanda: parentExternalId =
// funnelSessionId = checkoutSessionId agrupa front e upsells da mesma sessão.
// Papel: direct → FRONTEND; upsell → UPSELL (DOWNSELL só se o nome marcar).
//
// Dinheiro: unidade mínima da moeda. Só USD por enquanto — o dash não tem
// câmbio; outra moeda lança VupimCurrencyError (fica registrado no log).

import type { NormalizedOrder, NormalizedOrderStatus, NormalizedProductType } from '../../shared/types';
import { normalizePhone } from '../../shared/phone';
import { classifyProduct } from '../../services/productClassification';
import type { VupimData, VupimEnvelope } from './types';

export const VUPIM_ORDER_EVENTS: Record<string, NormalizedOrderStatus> = {
  'sale.approved': 'APPROVED',
  'sale.refunded': 'REFUNDED',
  'sale.partial_refund': 'REFUNDED',
  'sale.chargeback': 'CHARGEBACK',
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
    super(`moeda ${currency} sem conversão pra USD (o dash ainda só converte USD)`);
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

function productType(d: VupimData, name: string): NormalizedProductType {
  if (String(d.origin ?? '').toLowerCase() !== 'upsell') return 'FRONTEND';
  const c = classifyProduct(str(d.offerId) ?? str(d.productId) ?? name, name, 'vupim');
  return c.roleMarked && c.type === 'DOWNSELL' ? 'DOWNSELL' : 'UPSELL';
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
  if (currency !== 'USD') throw new VupimCurrencyError(currency);

  const createdAt = str(d.createdAt);
  const orderedAt = new Date(createdAt ?? env.timestamp);
  if (Number.isNaN(orderedAt.getTime())) throw new Error('Vupim: createdAt inválido');
  const eventAt = new Date(env.timestamp);

  const gross = vupimMajor(d.amount, currency);
  const tax = vupimMajor(d.taxAmount, currency);
  const net = vupimMajor(d.commission, currency);
  const cpa = vupimMajor(d.affiliateCommission, currency);
  // Estorno: o devolvido ATÉ AGORA (parcial soma refundAmount a cada evento).
  const reversed = status === 'APPROVED'
    ? 0
    : status === 'CHARGEBACK'
      ? gross
      : Math.min(gross, vupimMajor(d.totalRefunded ?? d.refundAmount ?? d.amount, currency));

  const name = vupimProductName(d);
  const sessionId = str(d.checkoutSessionId);
  const email = str(d.customer?.email)?.toLowerCase() ?? null;
  const { first, last } = splitName(str(d.customer?.name));

  return {
    platformSlug: 'vupim',
    externalId,
    parentExternalId: sessionId,
    previousTransactionId: null,
    vendorAccount: null,

    productExternalId: str(d.offerId) ?? str(d.productId) ?? 'unknown',
    productName: name,
    productType: productType(d, name),

    affiliateExternalId: str(d.affiliateId),
    affiliateNickname: null,

    customerExternalId: email,
    customerEmail: email,
    customerFirstName: first,
    customerLastName: last,
    customerLanguage: null,
    customerPhone: normalizePhone(d.customer?.phone) ?? normalizePhone(d.shipping?.phone),

    status,
    eventType: opts.asSale ? 'sale.approved' : event,
    billingType: 'SINGLE_PAYMENT',
    paySequenceNo: null,
    numberOfInstallments: null,

    currencyOriginal: currency,
    grossAmountOrig: status === 'APPROVED' ? gross : -reversed,
    grossAmountUsd: status === 'APPROVED' ? gross : -reversed,
    taxAmount: tax,
    // O que sobra depois do produtor, do afiliado e do imposto = taxa da Vupim.
    fees: round2(Math.max(0, gross - tax - net - cpa)),
    netAmountUsd: net,
    cpaPaidUsd: cpa,

    paymentMethod: str(d.paymentMethod),
    country: str(d.country)?.toUpperCase() ?? null,
    state: str(d.shipping?.state),
    city: str(d.shipping?.city),

    funnelSessionId: sessionId,
    funnelStep: null,
    clickId: str(d.clickId),
    trackingId: str(d.src) ?? str(d.sck),
    campaignKey: str(d.utmCampaign),
    trafficSource: str(d.utmSource),
    deviceType: null,
    browser: null,

    detailsUrl: null,

    orderedAt,
    eventAt: status === 'APPROVED' ? null : eventAt,
    rawMetadata: {
      vupimEvent: event,
      deliveryId: env.id,
      origin: str(d.origin),
      productId: str(d.productId),
      offerId: str(d.offerId),
      reason: str(d.reason),
      chargebackFee: d.chargebackFee ?? null,
      utmMedium: str(d.utmMedium),
      utmContent: str(d.utmContent),
      utmTerm: str(d.utmTerm),
    },
  };
}

/** Aplica o evento sobre o que já está gravado? (a Vupim pode entregar fora de ordem) */
export function vupimShouldApply(
  incoming: 'APPROVED' | 'REFUNDED' | 'CHARGEBACK',
  existing: { status: string; grossAmountUsd: number } | null,
  reversedUsd: number,
): boolean {
  if (!existing) return true;
  if (incoming === 'CHARGEBACK') return true;
  if (existing.status === 'CHARGEBACK') return false;
  if (incoming === 'APPROVED') return existing.status !== 'REFUNDED';
  // Estorno: só avança (parcial antigo não desfaz um estorno maior).
  return existing.status !== 'REFUNDED' || Math.abs(existing.grossAmountUsd) < reversedUsd;
}
