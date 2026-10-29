import { describe, expect, it } from 'vitest';
import { analyze, brtMonth, buildSubs, continueRates, DAY_MS, retention, type RecCharge, type RecEvent, type RecSubInput } from './core';

const NOW = new Date('2026-10-29T15:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);
const charge = (ago: number, usd = 69, refundedAgo?: number): RecCharge => ({ at: daysAgo(ago), usd, refundedAt: refundedAgo == null ? null : daysAgo(refundedAgo) });

let n = 0;
function sub(charges: RecCharge[], extra: Partial<RecSubInput> = {}): RecSubInput {
  n++;
  return {
    key: `k${n}`, platform: 'jvzoo', productKey: 'jvzoo:blessed', product: 'Blessed Kit',
    email: `c${n}@x.com`, name: `Cliente ${n}`, phone: null, charges, events: [], ...extra,
  };
}
const ev = (kind: RecEvent['kind'], ago: number): RecEvent => ({ kind, at: daysAgo(ago) });

describe('estado da assinatura', () => {
  it('ciclo pelas próprias cobranças; dentro do prazo = ativa, com a próxima cobrança estimada', () => {
    const [s] = buildSubs([sub([charge(70), charge(40), charge(10)])], NOW);
    expect(s.cycleDays).toBe(30);
    expect(s.cycleSource).toBe('cobrancas');
    expect(s.status).toBe('active');
    expect(s.nextChargeAt).toEqual(daysAgo(-20));
    expect(s.cycles).toBe(3);
    expect(s.totalPaidUsd).toBe(207);
  });

  it('cobrança que não veio: +3 dias = em atraso, +15 dias = parou de pagar (encerrada na data esperada)', () => {
    const [late, lapsed] = buildSubs([sub([charge(65), charge(35)]), sub([charge(80), charge(50)])], NOW);
    expect(late.status).toBe('late');
    expect(lapsed.status).toBe('ended');
    expect(lapsed.endReason).toBe('sem_pagamento');
    expect(lapsed.endedAt).toEqual(daysAgo(20));
  });

  it('cancelamento avisado depois da última cobrança encerra; reativação depois desfaz', () => {
    const [canceled, resumed] = buildSubs([
      sub([charge(40), charge(10)], { events: [ev('cancel', 5)] }),
      sub([charge(40), charge(10)], { events: [ev('cancel', 5), ev('resume', 2)] }),
    ], NOW);
    expect(canceled.status).toBe('ended');
    expect(canceled.endReason).toBe('pediu');
    expect(canceled.endedAt).toEqual(daysAgo(5));
    expect(resumed.status).toBe('active');
  });

  it('aviso antigo (antes da última cobrança) não encerra; falha depois da última = em atraso', () => {
    const [old, failed] = buildSubs([
      sub([charge(40), charge(10)], { events: [ev('cancel', 20)] }),
      sub([charge(40), charge(10)], { events: [ev('failed', 1)] }),
    ], NOW);
    expect(old.status).toBe('active');
    expect(failed.status).toBe('late');
    expect(failed.lastFailedAt).toEqual(daysAgo(1));
  });

  it('última cobrança estornada = encerrada por reembolso; estorno não soma no pago', () => {
    const [s] = buildSubs([sub([charge(40), charge(10, 69, 3)])], NOW);
    expect(s.status).toBe('ended');
    expect(s.endReason).toBe('reembolso');
    expect(s.endedAt).toEqual(daysAgo(3));
    expect(s.totalPaidUsd).toBe(69);
  });

  it('sem renovação: ciclo do produto (≥ 3 intervalos), senão o da oferta, senão 30 dias', () => {
    const subs = buildSubs([
      sub([charge(200), charge(140), charge(80)], { productKey: 'p:60' }),
      sub([charge(130), charge(70)], { productKey: 'p:60' }),
      sub([charge(10)], { productKey: 'p:60' }),
      sub([charge(10)], { productKey: 'p:novo', cycleHintDays: 60 }),
      sub([charge(10)], { productKey: 'p:nada' }),
    ], NOW);
    expect(subs.slice(2).map((s) => [s.cycleDays, s.cycleSource])).toEqual([[60, 'produto'], [60, 'oferta'], [30, 'padrao']]);
  });

  it('cobranças a menos de 5 dias contam como o mesmo ciclo (2 unidades, nova tentativa)', () => {
    const [s] = buildSubs([sub([charge(40), charge(39), charge(10)])], NOW);
    expect(s.cycles).toBe(2);
    expect(s.charges).toHaveLength(3);
  });

  it('valor da próxima renovação: a última renovação; sem renovação, a mediana das renovações do produto', () => {
    const subs = buildSubs([
      sub([charge(70, 197), charge(40, 69), charge(10, 69)]),
      sub([charge(10, 197)]),
    ], NOW);
    expect(subs.map((s) => s.renewalUsd)).toEqual([69, 69]);
  });
});

describe('retenção e previsão', () => {
  it('só conta na n-ª cobrança quem já teve tempo de pagá-la', () => {
    const subs = buildSubs([
      sub([charge(100), charge(70), charge(40), charge(10)]),
      sub([charge(100), charge(70)]),
      sub([charge(100)]),
      sub([charge(5)]), // assinou agora: fora da 2ª
    ], NOW);
    const r = retention(subs, NOW, 3);
    expect(r[0]).toEqual({ n: 1, eligible: 4, reached: 4, pct: 1 });
    expect(r[1]).toMatchObject({ n: 2, eligible: 3, reached: 2 });
    expect(r[2]).toMatchObject({ n: 3, eligible: 3, reached: 1 });
  });

  it('taxa de continuar: medida por ciclo com amostra; sem amostra nenhuma = null', () => {
    expect(continueRates(buildSubs([sub([charge(100)])], NOW), NOW).pooled).toBeNull();
    const many = buildSubs(Array.from({ length: 20 }, (_, i) => sub(i < 10 ? [charge(100), charge(70)] : [charge(100)])), NOW);
    const rates = continueRates(many, NOW);
    expect(rates.byCycle[1]).toBe(0.5);
  });

  it('previsão de 30 dias: máximo = todo mundo paga; esperado = com a retenção medida', () => {
    const base = Array.from({ length: 20 }, (_, i) => sub(i < 10 ? [charge(100), charge(70)] : [charge(100)]));
    const fresh = sub([charge(10, 69)]);
    const d = analyze(buildSubs([...base, fresh], NOW), { start: daysAgo(30), end: NOW, now: NOW });
    // Só a nova tem cobrança nos próximos 30 dias (dia +20); a chance de pagar a 2ª é 50%.
    expect(d.kpis.forecast30MaxUsd).toBe(69);
    expect(d.kpis.forecast30Usd).toBe(34.5);
    expect(d.kpis.forecastHasHistory).toBe(true);
  });
});

describe('painel', () => {
  it('período: renovações recebidas, ticket médio, novas, encerradas por motivo, tempo até encerrar', () => {
    const subs = buildSubs([
      sub([charge(70, 197), charge(40, 69), charge(10, 69)]),            // ativa, 2 renovações (1 no período)
      sub([charge(50, 197), charge(20, 79)], { events: [ev('cancel', 12)] }), // pediu, 38 dias
      sub([charge(25, 197)]),                                            // nova no período
      sub([charge(60, 197), charge(29, 69, 2)]),                         // reembolso da renovação
    ], NOW);
    const d = analyze(subs, { start: daysAgo(30), end: NOW, now: NOW });
    expect(d.kpis.renewals).toBe(2);
    expect(d.kpis.renewalsUsd).toBe(148);
    expect(d.kpis.avgTicketUsd).toBe(74);
    expect(d.kpis.refundedRenewalsUsd).toBe(69);
    expect(d.kpis.newSubs).toBe(1);
    expect(d.kpis.ended).toBe(2);
    expect(d.kpis.endedPediu).toBe(1);
    expect(d.kpis.endedReembolso).toBe(1);
    expect(d.kpis.avgDaysToEnd).toBe(48);
    expect(d.kpis.avgCyclesToEnd).toBe(2);
    expect(d.kpis.active).toBe(2);
    expect(d.endTiming.find((b) => b.id === '2')!.count).toBe(2);
  });

  it('mês a mês: recebido por mês BRT e previsão nos meses seguintes', () => {
    const subs = buildSubs([sub([charge(70), charge(40), charge(10)])], NOW);
    const d = analyze(subs, { start: daysAgo(30), end: NOW, now: NOW, pastMonths: 3, futureMonths: 3 });
    expect(d.months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    expect(d.months.find((m) => m.month === brtMonth(daysAgo(10)))!.renewalsUsd).toBe(69);
    expect(d.months.find((m) => m.month === '2026-11')!.maxUsd).toBe(69);
    expect(d.months.find((m) => m.month === '2026-12')!.maxUsd).toBe(69);
  });

  it('por produto e lista de assinantes', () => {
    const subs = buildSubs([
      sub([charge(70), charge(40), charge(10)]),
      sub([charge(10, 49)], { platform: 'vupim', productKey: 'vupim:o1', product: 'NeuroRecall 1 Bottle' }),
    ], NOW);
    const d = analyze(subs, { start: daysAgo(30), end: NOW, now: NOW });
    expect(d.byProduct.map((p) => [p.label, p.active, p.mrrUsd])).toEqual([['Blessed Kit', 1, 69], ['NeuroRecall 1 Bottle', 1, 49]]);
    expect(d.byPlatform.map((p) => p.platform).sort()).toEqual(['jvzoo', 'vupim']);
    expect(d.rows[0]).toMatchObject({ product: 'Blessed Kit', status: 'active', cycles: 3 });
  });
});
