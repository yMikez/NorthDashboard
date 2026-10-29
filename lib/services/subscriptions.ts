// Assinaturas da Vupim. Cada evento da plataforma entra no histórico
// (SubscriptionEvent, idempotente pelo eventId) e o estado da assinatura é
// recalculado do histórico inteiro (lib/subscriptions/core.ts). A aba
// Recorrências lê daqui junto com as outras plataformas (lib/services/recurrences.ts).
// A Vupim não tem API pra cancelar/alterar — quem mexe é o painel dela.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import type { VupimEnvelope } from '../connectors/vupim/types';
import { normalizePhone } from '../shared/phone';
import { parseVupimSubscriptionEvent, projectSubscription, type SubEventKind, type SubEventRow } from '../subscriptions/core';

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
