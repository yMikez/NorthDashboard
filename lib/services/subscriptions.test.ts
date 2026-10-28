import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// Banco em memória: Subscription + SubscriptionEvent.
type Row = Record<string, any> & { id: string };
const mem = vi.hoisted(() => ({ subs: [] as Row[], events: [] as Row[] }));
const mockDb = vi.hoisted(() => ({
  subscription: {
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const k = where.platform_externalId;
      const found = mem.subs.find((x) => x.platform === k.platform && x.externalId === k.externalId);
      if (found) return Object.assign(found, update);
      const s: Row = { id: `s${mem.subs.length + 1}`, totalPaidUsd: 0, chargeCount: 0, ...create };
      mem.subs.push(s);
      return s;
    }),
    update: vi.fn(async ({ where, data }: any) => Object.assign(mem.subs.find((x) => x.id === where.id)!, data)),
  },
  subscriptionEvent: {
    create: vi.fn(async ({ data }: any) => {
      if (mem.events.some((e) => e.eventId === data.eventId)) {
        throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
      }
      const e = { id: `e${mem.events.length + 1}`, ...data };
      mem.events.push(e);
      return e;
    }),
    findMany: vi.fn(async ({ where }: any) => mem.events.filter((e) => e.subscriptionId === where.subscriptionId)),
  },
}));
vi.mock('../db', () => ({ db: mockDb, dbRead: mockDb }));

import { trackVupimSubscription } from './subscriptions';

const env = (eventId: string, event: string, data: Record<string, unknown>) =>
  ({ id: `d_${eventId}`, eventId, event, timestamp: '2026-11-01T10:00:00Z', livemode: true, data }) as never;

beforeEach(() => {
  mem.subs.length = 0;
  mem.events.length = 0;
});

describe('assinatura pelo webhook da Vupim', () => {
  it('1ª cobrança cria; evento repetido não conta de novo; falha e cancelamento mudam o estado', async () => {
    const first = env('ev1', 'sale.approved', {
      subscriptionId: 'sub_9', chargeNumber: 1, transactionId: 'tx1', amountUsd: 6900, approvedAt: '2026-10-28T12:00:00Z',
      offerName: 'NeuroRecall 1 Bottle - keep treatment', src: 'qz_r1', customer: { email: 'A@B.com', name: 'Ann', phone: '(307) 640-5805' },
    });
    expect(await trackVupimSubscription(first, 'sale.approved')).toBe('tracked');
    expect(await trackVupimSubscription(first, 'sale.approved')).toBe('duplicate');
    expect(mem.subs[0]).toMatchObject({
      externalId: 'sub_9', status: 'active', chargeCount: 1, totalPaidUsd: 69, email: 'a@b.com', phone: '3076405805', bottles: 1, src: 'qz_r1',
    });

    await trackVupimSubscription(env('ev2', 'subscription.payment_failed', {
      subscriptionId: 'sub_9', amount: 6900, currency: 'USD', attempt: 1, nextRetryAt: '2026-11-30T00:00:00Z', reason: 'card_declined',
      updatedAt: '2026-11-28T00:00:00Z',
    }), 'subscription.payment_failed');
    expect(mem.subs[0]).toMatchObject({ status: 'past_due', failedAttempts: 1, lastFailureReason: 'card_declined' });
    // Falha não apaga o que já se sabia do cliente.
    expect(mem.subs[0].email).toBe('a@b.com');

    await trackVupimSubscription(env('ev3', 'subscription.canceled', { subscriptionId: 'sub_9', canceledAt: '2026-12-05T00:00:00Z', reason: 'max_retries' }), 'subscription.canceled');
    expect(mem.subs[0]).toMatchObject({ status: 'canceled', cancelReason: 'max_retries', totalPaidUsd: 69 });
  });

  it('venda sem assinatura não cria nada', async () => {
    expect(await trackVupimSubscription(env('ev4', 'sale.approved', { transactionId: 'tx', amountUsd: 100 }), 'sale.approved')).toBe('ignored');
    expect(mem.subs).toHaveLength(0);
  });
});
