// Assinaturas da Vupim: evento da plataforma → linha de histórico →
// estado da assinatura. Tudo puro (sem banco) pra testar e pra recalcular o
// estado do zero a cada evento — a Vupim entrega "pelo menos uma vez" e fora
// de ordem, então o estado nunca é "o último evento", e sim o histórico todo.
//
// Vupim (https://vupim.com/docs/webhook, relida em 2026-10-28):
//   sale.approved com subscriptionId → 1ª cobrança (chargeNumber 1)
//   subscription.renewed             → cobrança de um novo período (periodStart/periodEnd)
//   subscription.payment_failed      → renovação não cobrada (attempt, nextRetryAt, reason)
//   subscription.canceled            → assinatura terminou (canceledAt, reason)
//   sale.refunded/partial_refund/chargeback com subscriptionId → anotado no histórico
// A doc não diz o ciclo nem a próxima cobrança na 1ª venda: o ciclo sai do
// nome da oferta ("2 bottles" = a cada 2 meses; 1 frasco = mensal).

import type { VupimEnvelope } from '../connectors/vupim/types';

export type SubEventKind = 'charge' | 'renewed' | 'failed' | 'canceled' | 'refunded' | 'chargeback';
export type SubStatus = 'active' | 'past_due' | 'canceled';

export const DAYS_PER_BOTTLE = 30;

export interface SubEventRow {
  eventId: string;
  kind: SubEventKind;
  at: Date;
  amountUsd: number | null;
  chargeNumber: number | null;
  attempt: number | null;
  nextRetryAt: Date | null;
  periodEnd: Date | null;
  reason: string | null;
  transactionId: string | null;
}

export interface ParsedSubEvent extends SubEventRow {
  platform: 'vupim';
  externalId: string;
  customer: { email: string | null; name: string | null; phone: string | null };
  product: { productName: string | null; offerName: string | null; offerId: string | null; bottles: number | null };
  src: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
function date(...vs: unknown[]): Date | null {
  for (const v of vs) {
    if (typeof v !== 'string' || !v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** "NeuroRecall 2 Bottles", "6 frascos", "3 potes" → frascos por cobrança. */
export function bottlesFromName(...names: (string | null | undefined)[]): number | null {
  for (const n of names) {
    const m = n ? /(\d{1,2})\s*(?:x\s*)?(?:bottles?|frascos?|potes?|jars?)\b/i.exec(n) : null;
    if (m) {
      const b = Number(m[1]);
      if (b >= 1 && b <= 24) return b;
    }
  }
  return null;
}

/** Dinheiro da Vupim vem em unidade mínima; *Usd em centavos de dólar. */
function usd(d: Record<string, unknown>): number | null {
  const amountUsd = typeof d.amountUsd === 'number' ? d.amountUsd : null;
  if (amountUsd != null) return Math.round(amountUsd) / 100;
  const currency = typeof d.currency === 'string' ? d.currency.toUpperCase() : 'USD';
  return currency === 'USD' && typeof d.amount === 'number' ? Math.round(d.amount) / 100 : null;
}

const KIND_BY_EVENT: Record<string, SubEventKind> = {
  'subscription.renewed': 'renewed',
  'subscription.payment_failed': 'failed',
  'subscription.canceled': 'canceled',
  'sale.refunded': 'refunded',
  'sale.partial_refund': 'refunded',
  'sale.chargeback': 'chargeback',
  'sale.chargeback_lost': 'chargeback',
};

/** Evento da Vupim que mexe numa assinatura (null = não mexe ou é teste). */
export function parseVupimSubscriptionEvent(env: VupimEnvelope, event: string): ParsedSubEvent | null {
  if (env.livemode === false) return null;
  const d = (env.data ?? {}) as Record<string, unknown>;
  const externalId = str(d.subscriptionId);
  const eventId = str(env.eventId) ?? str(env.id);
  if (!externalId || !eventId) return null;
  const chargeNumber = int(d.chargeNumber);
  let kind: SubEventKind | undefined = KIND_BY_EVENT[event];
  if (event === 'sale.approved') {
    kind = (chargeNumber ?? 1) > 1 || str(d.origin)?.toLowerCase() === 'renewal' ? 'renewed' : 'charge';
  }
  if (!kind) return null;
  const at = (kind === 'canceled' ? date(d.canceledAt, env.timestamp)
    : kind === 'refunded' ? date(d.refundedAt, env.timestamp)
    : kind === 'chargeback' ? date(d.chargebackAt, env.timestamp)
    : kind === 'failed' ? date(d.updatedAt, env.timestamp)
    : date(d.approvedAt, d.periodStart, d.createdAt, env.timestamp)) ?? new Date();
  const customer = (d.customer ?? {}) as Record<string, unknown>;
  const name = str(customer.name) ?? ([str(customer.firstName), str(customer.lastName)].filter(Boolean).join(' ') || null);
  const productName = str(d.productName);
  const offerName = str(d.offerName);
  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
  return {
    platform: 'vupim',
    externalId,
    eventId,
    kind,
    at,
    amountUsd: kind === 'canceled' ? null : usd(d),
    chargeNumber,
    attempt: int(d.attempt),
    nextRetryAt: date(d.nextRetryAt),
    periodEnd: date(d.periodEnd),
    reason: str(d.reason),
    transactionId: str(d.transactionId),
    customer: { email: str(customer.email)?.toLowerCase() ?? null, name, phone: str(customer.phone) },
    product: {
      productName, offerName, offerId: str(d.offerId),
      bottles: bottlesFromName(offerName, productName, ...items.map((i) => str(i.name) ?? str(i.productName))),
    },
    src: str(d.src),
  };
}

export interface SubProjection {
  status: SubStatus;
  chargeCount: number;
  totalPaidUsd: number;
  amountUsd: number | null;
  startedAt: Date | null;
  lastChargeAt: Date | null;
  periodEnd: Date | null;
  failedAttempts: number;
  lastFailedAt: Date | null;
  nextRetryAt: Date | null;
  lastFailureReason: string | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  firstTransactionId: string | null;
  lastTransactionId: string | null;
}

/**
 * Estado a partir do histórico inteiro. A mesma cobrança contada uma vez só
 * (pelo transactionId — se a Vupim mandar sale.approved E subscription.renewed
 * da mesma renovação). Falha depois da última cobrança = em atraso;
 * cancelamento depois da última cobrança = cancelada.
 */
export function projectSubscription(events: readonly SubEventRow[]): SubProjection {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const charges = new Map<string, SubEventRow>();
  let lastFailed: SubEventRow | null = null;
  let failedSinceCharge = 0;
  let canceled: SubEventRow | null = null;
  for (const e of sorted) {
    if (e.kind === 'charge' || e.kind === 'renewed') {
      const key = e.transactionId ?? e.eventId;
      if (!charges.has(key)) charges.set(key, e);
      failedSinceCharge = 0;
    } else if (e.kind === 'failed') {
      lastFailed = e;
      failedSinceCharge = Math.max(failedSinceCharge + 1, e.attempt ?? 0);
    } else if (e.kind === 'canceled') {
      canceled = e;
    }
  }
  const list = [...charges.values()];
  const first = list[0] ?? null;
  const last = list[list.length - 1] ?? null;
  const lastAt = last?.at.getTime() ?? -Infinity;
  const isCanceled = canceled != null && canceled.at.getTime() >= lastAt;
  const pastDue = !isCanceled && lastFailed != null && lastFailed.at.getTime() > lastAt;
  const periodEnds = list.map((e) => e.periodEnd?.getTime() ?? 0).filter((t) => t > 0);
  const total = list.reduce((s, e) => s + (e.amountUsd ?? 0), 0);
  return {
    status: isCanceled ? 'canceled' : pastDue ? 'past_due' : 'active',
    chargeCount: Math.max(list.length, ...list.map((e) => e.chargeNumber ?? 0)),
    totalPaidUsd: Math.round(total * 100) / 100,
    amountUsd: last?.amountUsd ?? null,
    startedAt: first?.at ?? null,
    lastChargeAt: last?.at ?? null,
    periodEnd: periodEnds.length ? new Date(Math.max(...periodEnds)) : null,
    failedAttempts: pastDue ? failedSinceCharge : 0,
    lastFailedAt: lastFailed?.at ?? null,
    nextRetryAt: pastDue ? lastFailed?.nextRetryAt ?? null : null,
    lastFailureReason: pastDue ? lastFailed?.reason ?? null : null,
    canceledAt: isCanceled ? canceled!.at : null,
    cancelReason: isCanceled ? canceled!.reason : null,
    firstTransactionId: first?.transactionId ?? null,
    lastTransactionId: last?.transactionId ?? null,
  };
}
