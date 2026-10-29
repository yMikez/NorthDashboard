import { describe, expect, it } from 'vitest';
import type { VupimEnvelope } from '../connectors/vupim/types';
import { smsPhoneUS } from '../shared/phone';
import {
  bottlesFromName, parseVupimSubscriptionEvent, projectSubscription, type SubEventRow,
} from './core';

const env = (event: string, data: Record<string, unknown>, extra: Partial<VupimEnvelope> = {}): VupimEnvelope =>
  ({ id: `dlv_${event}`, eventId: `evt_${event}_${data.chargeNumber ?? data.attempt ?? ''}`, event, timestamp: '2026-11-01T10:00:00Z', livemode: true, data, ...extra });

const ev = (kind: SubEventRow['kind'], at: string, extra: Partial<SubEventRow> = {}): SubEventRow => ({
  eventId: `${kind}-${at}`, kind, at: new Date(at), amountUsd: null, chargeNumber: null, attempt: null,
  nextRetryAt: null, periodEnd: null, reason: null, transactionId: null, ...extra,
});

describe('evento da Vupim → histórico da assinatura', () => {
  it('1ª venda com subscriptionId vira cobrança, com cliente, oferta e ciclo pelo nome', () => {
    const p = parseVupimSubscriptionEvent(env('sale.approved', {
      subscriptionId: 'sub_1', chargeNumber: 1, transactionId: 'tx_1', amountUsd: 13800, currency: 'USD', amount: 13800,
      approvedAt: '2026-10-28T12:00:00Z', offerName: 'NeuroRecall 2 Bottles - keep treatment', src: 'qz_abc',
      customer: { email: 'Ann@X.com', firstName: 'Ann', lastName: 'Lee', phone: '+1 (307) 640-5805' },
    }), 'sale.approved');
    expect(p).toMatchObject({
      externalId: 'sub_1', kind: 'charge', amountUsd: 138, transactionId: 'tx_1', src: 'qz_abc',
      customer: { email: 'ann@x.com', name: 'Ann Lee' }, product: { bottles: 2 },
    });
    expect(p!.at.toISOString()).toBe('2026-10-28T12:00:00.000Z');
  });

  it('venda sem assinatura, evento de teste ou sem id não mexem em nada', () => {
    expect(parseVupimSubscriptionEvent(env('sale.approved', { subscriptionId: null }), 'sale.approved')).toBeNull();
    expect(parseVupimSubscriptionEvent(env('subscription.renewed', { subscriptionId: 's' }, { livemode: false }), 'subscription.renewed')).toBeNull();
    expect(parseVupimSubscriptionEvent(env('sale.created', { subscriptionId: 's' }), 'sale.created')).toBeNull();
  });

  it('falha de pagamento e cancelamento trazem tentativa, próxima tentativa e motivo', () => {
    const f = parseVupimSubscriptionEvent(env('subscription.payment_failed', {
      subscriptionId: 's', amount: 6900, currency: 'USD', attempt: 2, nextRetryAt: '2026-11-03T00:00:00Z', reason: 'insufficient_funds',
    }), 'subscription.payment_failed');
    expect(f).toMatchObject({ kind: 'failed', attempt: 2, amountUsd: 69, reason: 'insufficient_funds' });
    const c = parseVupimSubscriptionEvent(env('subscription.canceled', { subscriptionId: 's', canceledAt: '2026-11-05T00:00:00Z', reason: 'customer' }), 'subscription.canceled');
    expect(c).toMatchObject({ kind: 'canceled', reason: 'customer', amountUsd: null });
    expect(c!.at.toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });

  it('ciclo pelo nome da oferta', () => {
    expect(bottlesFromName('NeuroRecall 6 Bottles - complete treatment')).toBe(6);
    expect(bottlesFromName(null, 'Recompra 4 Frascos')).toBe(4);
    expect(bottlesFromName('NeuroRecall 1 bottle keep treatment')).toBe(1);
    expect(bottlesFromName('NeuroRecall')).toBeNull();
  });
});

describe('estado da assinatura', () => {
  it('cobranças somam uma vez cada (mesma transação em dois eventos)', () => {
    const p = projectSubscription([
      ev('charge', '2026-10-01', { transactionId: 't1', amountUsd: 69, chargeNumber: 1 }),
      ev('renewed', '2026-11-01', { transactionId: 't2', amountUsd: 69, chargeNumber: 2, periodEnd: new Date('2026-12-01') }),
      ev('renewed', '2026-11-01', { eventId: 'dup', transactionId: 't2', amountUsd: 69, chargeNumber: 2 }),
    ]);
    expect(p).toMatchObject({ status: 'active', chargeCount: 2, totalPaidUsd: 138, amountUsd: 69, firstTransactionId: 't1', lastTransactionId: 't2' });
    expect(p.periodEnd?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('falha depois da última cobrança = em atraso; cobrança depois da falha volta a ativa', () => {
    const failed = [
      ev('charge', '2026-10-01', { transactionId: 't1', amountUsd: 69 }),
      ev('failed', '2026-11-01', { attempt: 1, nextRetryAt: new Date('2026-11-03'), reason: 'card_declined' }),
      ev('failed', '2026-11-03', { attempt: 2, nextRetryAt: new Date('2026-11-06') }),
    ];
    expect(projectSubscription(failed)).toMatchObject({ status: 'past_due', failedAttempts: 2, nextRetryAt: new Date('2026-11-06') });
    const recovered = projectSubscription([...failed, ev('renewed', '2026-11-06', { transactionId: 't2', amountUsd: 69 })]);
    expect(recovered).toMatchObject({ status: 'active', failedAttempts: 0, nextRetryAt: null, chargeCount: 2 });
  });

  it('cancelada mesmo se o cancelamento chegar antes da cobrança (fora de ordem)', () => {
    const p = projectSubscription([
      ev('canceled', '2026-11-05', { reason: 'customer' }),
      ev('charge', '2026-10-01', { transactionId: 't1', amountUsd: 138 }),
    ]);
    expect(p).toMatchObject({ status: 'canceled', cancelReason: 'customer', totalPaidUsd: 138 });
  });
});

describe('telefone pra SMS', () => {
  it('11 dígitos com 1 = pronto; 10 dígitos ganham +1 marcado; o resto não', () => {
    expect(smsPhoneUS('13076405805')).toEqual({ e164: '+13076405805', inferred: false });
    expect(smsPhoneUS('5596739317')).toEqual({ e164: '+15596739317', inferred: true });
    expect(smsPhoneUS('5511999998888')).toBeNull();
    expect(smsPhoneUS('1234567890')).toBeNull();
  });
});
