// Assinaturas (aba Recorrências → Assinaturas). Cada evento da plataforma
// entra no histórico (SubscriptionEvent, idempotente pelo eventId) e o estado
// da assinatura é recalculado do histórico inteiro (lib/subscriptions/core.ts).
// Hoje só a Vupim manda assinatura; ela não tem API pra cancelar/alterar —
// a aba acompanha, quem mexe é o painel da Vupim.

import { Prisma, type Subscription } from '@prisma/client';
import { db } from '../db';
import type { VupimEnvelope } from '../connectors/vupim/types';
import { normalizePhone, smsPhoneUS } from '../shared/phone';
import {
  monthlyValue, nextCharge, parseVupimSubscriptionEvent, projectSubscription, type SubEventKind, type SubEventRow,
} from '../subscriptions/core';
import { SURVEY_TRACKING_PREFIX } from '../surveys/fimTratamento';

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));
const notNull = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>;

/**
 * Chamado pelo ingest da Vupim em toda entrega (antes de virar pedido, pra
 * falha de pagamento e cancelamento — que não viram pedido — também contarem).
 */
export async function trackVupimSubscription(env: VupimEnvelope, event: string): Promise<'ignored' | 'duplicate' | 'tracked'> {
  const p = parseVupimSubscriptionEvent(env, event);
  if (!p) return 'ignored';
  const info = notNull({
    email: p.customer.email, name: p.customer.name, phone: normalizePhone(p.customer.phone),
    productName: p.product.productName, offerName: p.product.offerName, offerId: p.product.offerId,
    bottles: p.product.bottles, src: p.src,
  });
  const sub = await db.subscription.upsert({
    where: { platform_externalId: { platform: p.platform, externalId: p.externalId } },
    create: { platform: p.platform, externalId: p.externalId, status: 'active', ...info },
    update: info,
  });
  try {
    await db.subscriptionEvent.create({
      data: {
        subscriptionId: sub.id, eventId: p.eventId, kind: p.kind, at: p.at, amountUsd: p.amountUsd,
        chargeNumber: p.chargeNumber, attempt: p.attempt, nextRetryAt: p.nextRetryAt, periodEnd: p.periodEnd,
        reason: p.reason?.slice(0, 500) ?? null, transactionId: p.transactionId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate';
    throw err;
  }
  await refreshSubscription(sub.id);
  return 'tracked';
}

async function refreshSubscription(id: string): Promise<void> {
  const events = await db.subscriptionEvent.findMany({ where: { subscriptionId: id } });
  const rows: SubEventRow[] = events.map((e) => ({
    eventId: e.eventId, kind: e.kind as SubEventKind, at: e.at, amountUsd: num(e.amountUsd), chargeNumber: e.chargeNumber,
    attempt: e.attempt, nextRetryAt: e.nextRetryAt, periodEnd: e.periodEnd, reason: e.reason, transactionId: e.transactionId,
  }));
  await db.subscription.update({ where: { id }, data: projectSubscription(rows) });
}

// ---------- aba ----------

export interface SubscriptionRow {
  id: string; platform: string; externalId: string; status: string;
  name: string | null; email: string | null; phone: string | null; smsPhone: string | null; smsPhoneInferred: boolean;
  product: string | null; bottles: number | null;
  amountUsd: number | null; monthlyUsd: number; totalPaidUsd: number; chargeCount: number;
  startedAt: string | null; lastChargeAt: string | null;
  nextChargeAt: string | null; nextChargeEstimated: boolean;
  failedAttempts: number; lastFailedAt: string | null; nextRetryAt: string | null; lastFailureReason: string | null;
  canceledAt: string | null; cancelReason: string | null;
  /** Veio da pesquisa de recompra (src=qz_…). */
  fromSurvey: boolean;
}

export interface SubscriptionsDashboard {
  kpis: {
    active: number; pastDue: number; canceled: number; mrrUsd: number;
    newInPeriod: number; renewalsInPeriod: number; renewalsUsd: number; failedInPeriod: number; canceledInPeriod: number;
    /** Canceladas no período ÷ ativas no começo do período. */
    churn: number | null;
    fromSurvey: number;
  };
  byOffer: { offer: string; active: number; pastDue: number; canceled: number; mrrUsd: number; totalPaidUsd: number }[];
  pastDue: SubscriptionRow[];
  upcoming: SubscriptionRow[];
  rows: SubscriptionRow[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function subscriptionOut(s: Subscription): SubscriptionRow {
  const amount = num(s.amountUsd);
  const next = nextCharge(s);
  const sms = smsPhoneUS(s.phone);
  return {
    id: s.id, platform: s.platform, externalId: s.externalId, status: s.status,
    name: s.name, email: s.email, phone: s.phone, smsPhone: sms?.e164 ?? null, smsPhoneInferred: sms?.inferred ?? false,
    product: s.offerName ?? s.productName, bottles: s.bottles,
    amountUsd: amount, monthlyUsd: monthlyValue(amount, s.bottles), totalPaidUsd: Number(s.totalPaidUsd), chargeCount: s.chargeCount,
    startedAt: iso(s.startedAt), lastChargeAt: iso(s.lastChargeAt),
    nextChargeAt: iso(next?.at), nextChargeEstimated: next?.estimated ?? false,
    failedAttempts: s.failedAttempts, lastFailedAt: iso(s.lastFailedAt), nextRetryAt: iso(s.nextRetryAt), lastFailureReason: s.lastFailureReason,
    canceledAt: iso(s.canceledAt), cancelReason: s.cancelReason,
    fromSurvey: Boolean(s.src?.startsWith(SURVEY_TRACKING_PREFIX)),
  };
}

const inRange = (d: Date | null, start: Date, end: Date) => d != null && d >= start && d <= end;

export async function getSubscriptionsDashboard(opts: { start: Date; end: Date; now?: Date }): Promise<SubscriptionsDashboard> {
  const now = opts.now ?? new Date();
  const subs = await db.subscription.findMany({ orderBy: { startedAt: 'desc' }, take: 10000 });
  const events = await db.subscriptionEvent.findMany({
    where: { at: { gte: opts.start, lte: opts.end }, kind: { in: ['renewed', 'failed'] } },
    select: { kind: true, amountUsd: true, transactionId: true, eventId: true, subscriptionId: true },
  });
  const renewals = new Map<string, number>();
  const failedSubs = new Set<string>();
  for (const e of events) {
    if (e.kind === 'renewed') renewals.set(e.transactionId ?? e.eventId, num(e.amountUsd) ?? 0);
    else failedSubs.add(e.subscriptionId);
  }
  const rows = subs.map(subscriptionOut);
  const active = rows.filter((r) => r.status === 'active');
  const activeAtStart = subs.filter((s) => s.startedAt && s.startedAt < opts.start && (!s.canceledAt || s.canceledAt >= opts.start)).length;
  const canceledInPeriod = subs.filter((s) => inRange(s.canceledAt, opts.start, opts.end)).length;

  const offers = new Map<string, SubscriptionsDashboard['byOffer'][number]>();
  for (const r of rows) {
    const key = r.product ?? '—';
    const o = offers.get(key) ?? { offer: key, active: 0, pastDue: 0, canceled: 0, mrrUsd: 0, totalPaidUsd: 0 };
    if (r.status === 'active') { o.active++; o.mrrUsd += r.monthlyUsd; }
    else if (r.status === 'past_due') o.pastDue++;
    else o.canceled++;
    o.totalPaidUsd += r.totalPaidUsd;
    offers.set(key, o);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const horizon = now.getTime() + 14 * 86400000;

  return {
    kpis: {
      active: active.length,
      pastDue: rows.filter((r) => r.status === 'past_due').length,
      canceled: rows.filter((r) => r.status === 'canceled').length,
      mrrUsd: round(active.reduce((s, r) => s + r.monthlyUsd, 0)),
      newInPeriod: subs.filter((s) => inRange(s.startedAt, opts.start, opts.end)).length,
      renewalsInPeriod: renewals.size,
      renewalsUsd: round([...renewals.values()].reduce((s, v) => s + v, 0)),
      failedInPeriod: failedSubs.size,
      canceledInPeriod,
      churn: activeAtStart ? canceledInPeriod / activeAtStart : null,
      fromSurvey: rows.filter((r) => r.fromSurvey).length,
    },
    byOffer: [...offers.values()].map((o) => ({ ...o, mrrUsd: round(o.mrrUsd), totalPaidUsd: round(o.totalPaidUsd) }))
      .sort((a, b) => b.active - a.active || b.totalPaidUsd - a.totalPaidUsd),
    pastDue: rows.filter((r) => r.status === 'past_due')
      .sort((a, b) => (b.lastFailedAt ?? '').localeCompare(a.lastFailedAt ?? '')),
    upcoming: rows.filter((r) => r.status !== 'canceled' && r.nextChargeAt && Date.parse(r.nextChargeAt) <= horizon)
      .sort((a, b) => a.nextChargeAt!.localeCompare(b.nextChargeAt!)),
    rows,
  };
}
