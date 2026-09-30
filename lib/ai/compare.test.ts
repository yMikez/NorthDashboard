import { describe, expect, it } from 'vitest';
import { ResultStore } from './resultStore';
import {
  PeriodInputError, addDays, brtDayOf, daysInclusive, diffKeyedArrays, diffLeaves, diffResults, instantsFor,
  periodB, planPeriods, resolveInstants, runComparePeriods, unitOf, type LeafDelta,
} from './compare';
import type { ToolContext } from './toolTypes';

// 30/09/2026 14:05 BRT (quarta-feira).
const NOW = new Date('2026-09-30T17:05:00Z');

describe('dias BRT', () => {
  it('dia do instante, soma de dias, tamanho inclusivo e instantes exatos', () => {
    expect(brtDayOf(new Date('2026-10-01T02:59:59.999Z'))).toBe('2026-09-30');
    expect(brtDayOf(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInclusive({ start: '2026-09-01', end: '2026-09-30' })).toBe(30);
    const { startAt, endAt } = instantsFor({ start: '2026-09-29', end: '2026-09-29' }, 14 * 60 + 5);
    expect(startAt.toISOString()).toBe('2026-09-29T03:00:00.000Z');
    expect(endAt.toISOString()).toBe('2026-09-29T17:05:59.999Z');
  });

  it('resolveInstants: datas explícitas, UI e default de 30 dias BRT', () => {
    const e = resolveInstants({ start_date: '2026-09-01', end_date: '2026-09-02', end_time: '10:30' }, {}, NOW);
    expect(e.startAt.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(e.endAt.toISOString()).toBe('2026-09-02T13:30:59.999Z');
    const ui = { defaultStart: new Date('2026-09-10T03:00:00Z'), defaultEnd: new Date('2026-09-20T02:59:59.999Z') };
    expect(resolveInstants({}, ui, NOW)).toMatchObject({ startAt: ui.defaultStart, endAt: ui.defaultEnd, source: 'ui' });
    const d = resolveInstants({}, {}, NOW);
    expect(d.startAt.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(d.endAt).toBe(NOW);
    expect(() => resolveInstants({ start_date: '2026-02-30' }, {}, NOW)).toThrow(/data real/);
    expect(() => resolveInstants({ end_time: '10:00' }, {}, NOW)).toThrow(/exige end_date/);
    expect(() => resolveInstants({ start_date: '2026-09-10', end_date: '2026-09-01' }, {}, NOW)).toThrow(/anterior/);
  });
});

describe('períodos A/B e alinhamento', () => {
  const A = { start: '2026-09-21', end: '2026-09-27' };

  it('presets de B', () => {
    expect(periodB(A, 'previous')).toEqual({ start: '2026-09-14', end: '2026-09-20' });
    expect(periodB(A, 'same_weekday_last_week')).toEqual({ start: '2026-09-14', end: '2026-09-20' });
    expect(periodB({ start: '2026-09-01', end: '2026-09-10' }, 'same_weekday_last_week')).toEqual({ start: '2026-08-18', end: '2026-08-27' });
    expect(periodB({ start: '2028-02-29', end: '2028-02-29' }, 'previous_year')).toEqual({ start: '2027-02-28', end: '2027-02-28' });
  });

  it('período fechado: full e alinhado', () => {
    const p = planPeriods(A, periodB(A, 'previous'), 'auto', NOW, false);
    expect(p).toMatchObject({ applied: 'full', aligned: true, aIncludesToday: false });
  });

  it('same_elapsed com hora de corte (aggregate_orders): B corta na mesma hora BRT', () => {
    const a = { start: '2026-09-30', end: '2026-09-30' };
    const p = planPeriods(a, periodB(a, 'previous'), 'auto', NOW, true);
    expect(p.applied).toBe('same_elapsed');
    expect(p.a).toEqual({ start: '2026-09-30', end: '2026-09-30', endTime: '14:05' });
    expect(p.b).toEqual({ start: '2026-09-29', end: '2026-09-29', endTime: '14:05' });
  });

  it('same_elapsed sem hora de corte: só dias fechados dos dois lados', () => {
    const a = { start: '2026-09-24', end: '2026-09-30' };
    const p = planPeriods(a, periodB(a, 'previous'), 'auto', NOW, false);
    expect(p.applied).toBe('closed_days');
    expect(p.a).toEqual({ start: '2026-09-24', end: '2026-09-29' });
    expect(p.b).toEqual({ start: '2026-09-17', end: '2026-09-22' });
    expect(daysInclusive(p.a)).toBe(daysInclusive(p.b));
  });

  it('só hoje sem hora de corte: não alinha e avisa', () => {
    const a = { start: '2026-09-30', end: '2026-09-30' };
    const p = planPeriods(a, periodB(a, 'previous'), 'auto', NOW, false);
    expect(p.aligned).toBe(false);
    expect(p.notes.join(' ')).toMatch(/aggregate_orders/);
  });

  it('A no futuro é cortado em hoje; tamanhos diferentes pedem perDay', () => {
    const p = planPeriods({ start: '2026-09-01', end: '2026-10-15' }, { start: '2026-08-01', end: '2026-08-31' }, 'full', NOW, false);
    expect(p.a.end).toBe('2026-09-30');
    expect(p.aligned).toBe(false);
    expect(p.notes.join(' ')).toMatch(/futuro/);
  });
});

describe('diff', () => {
  it('folhas numéricas com deltaPct em pontos e deltaPp nas taxas (fração ×100, Pct direto)', () => {
    const a = { kpis: { gross: 110, approvalRate: 0.92, estimatedMarginPct: 12, upsellLiftPct: 0.3 }, range: { start: 'x' }, _meta: { x: 1 } };
    const b = { kpis: { gross: 100, approvalRate: 0.9, estimatedMarginPct: 10, upsellLiftPct: 0.25 } };
    const d = diffLeaves(a, b, null) as { kpis: Record<string, LeafDelta> };
    expect(d.kpis.gross).toEqual({ a: 110, b: 100, delta: 10, deltaPct: 10 });
    expect(d.kpis.approvalRate.deltaPp).toBeCloseTo(2, 9);
    expect(d.kpis.estimatedMarginPct.deltaPp).toBe(2);
    expect(d.kpis.upsellLiftPct.deltaPp).toBeCloseTo(5, 9); // *Pct que é fração no serviço
    expect(Object.keys(d)).toEqual(['kpis']); // range/_meta fora
  });

  it('unidade do _meta.units vence o nome do campo', () => {
    expect(unitOf('fooPct', 'x.fooPct', { fooPct: 'fraction' })).toBe('fraction');
    expect(unitOf('refundRate', 'refundRate', null)).toBe('fraction');
    expect(unitOf('valuePct', 'refunds.valuePct', null)).toBe('percent');
    expect(unitOf('gross', 'gross', null)).toBe('other');
  });

  it('listas casadas por chave: movers por |Δ|, onlyInA/onlyInB; séries temporais ficam fora', () => {
    const a = {
      affiliates: [
        { platformSlug: 'cb', externalId: '1', nickname: 'um', revenue: 500, orders: 5 },
        { platformSlug: 'cb', externalId: '2', nickname: 'dois', revenue: 100, orders: 1 },
        { platformSlug: 'd24', externalId: '9', nickname: 'novo', revenue: 80, orders: 1 },
      ],
      daily: [{ date: '2026-09-01', gross: 1 }],
    };
    const b = {
      affiliates: [
        { platformSlug: 'cb', externalId: '1', nickname: 'um', revenue: 200, orders: 2 },
        { platformSlug: 'cb', externalId: '2', nickname: 'dois', revenue: 300, orders: 3 },
        { platformSlug: 'bg', externalId: '7', nickname: 'saiu', revenue: 900, orders: 9 },
      ],
      daily: [{ date: '2026-08-01', gross: 2 }],
    };
    const [k] = diffKeyedArrays(a, b, 10, null);
    expect(diffKeyedArrays(a, b, 10, null)).toHaveLength(1);
    expect(k).toMatchObject({ path: 'affiliates', keyBy: 'platformSlug:externalId', metric: 'revenue', matched: 2, onlyInACount: 1, onlyInBCount: 1 });
    expect(k.movers.map((m) => [m.key, m.delta])).toEqual([['cb:1', 300], ['cb:2', -200]]);
    expect(k.movers[0].fields.orders).toMatchObject({ a: 5, b: 2, delta: 3 });
    expect(k.onlyInA).toEqual([{ key: 'd24:9', label: 'novo', value: 80 }]);
    expect(k.onlyInB).toEqual([{ key: 'bg:7', label: 'saiu', value: 900 }]);
  });

  it('get_funnel reaproveita funnelTransition (volume × AOV fecha o Δ receita) e perDay só em somas', () => {
    const scope = (fe: number, rev: number, up: number) => ({
      stages: [
        { id: 'fe', label: 'Front', volume: fe, revenue: rev - up, takeRate: 1 },
        { id: 'up1', label: 'UP1', volume: Math.round(fe * 0.3), revenue: up, takeRate: 0.3 },
      ],
      summary: { feGroups: fe, totalGroups: fe, totalRevenue: rev, aov: rev / fe, aovFEOnly: 80, aovWithUpsell: 150, revenueLiftFromUpsells: 0.2, revenueFeSessions: rev },
    });
    const a = { ...scope(120, 13200, 3000), byFamily: [{ family: 'NeuroMindPro', ...scope(120, 13200, 3000) }] };
    const b = { ...scope(100, 10000, 2000), byFamily: [{ family: 'NeuroMindPro', ...scope(100, 10000, 2000) }] };
    const d = diffResults('get_funnel', a, b, 7, 6, 5);
    expect(d.funnel?.all.revenueDelta).toBe(3200);
    expect((d.funnel!.all.volumeEffect) + (d.funnel!.all.aovEffect)).toBeCloseTo(3200, 6);
    expect(d.funnel?.all.volumeEffect).toBe(2000); // (120 − 100) × AOV anterior 100
    expect(d.funnel?.byFamily[0].family).toBe('NeuroMindPro');
    expect(d.perDayNormalized?.['summary.totalRevenue'].a).toBeCloseTo(13200 / 7, 5);
    expect(d.perDayNormalized?.['summary.totalRevenue'].b).toBeCloseTo(10000 / 6, 5);
    expect(d.perDayNormalized?.['summary.aov']).toBeUndefined();
  });

  it('get_overview: decomposição da receita das sessões (orderGroups × AOV)', () => {
    const d = diffResults('get_overview', { kpis: { orderGroups: 110, aov: 120, gross: 1 } }, { kpis: { orderGroups: 100, aov: 100, gross: 1 } }, 7, 7, 5);
    expect(d.decomposition).toMatchObject({ revenueDelta: 3200, volumeEffect: 1000, aovEffect: 2200 });
    expect(d.perDayNormalized).toBeUndefined();
  });
});

describe('runComparePeriods', () => {
  function ctxWith(exec: ToolContext['exec'], store = new ResultStore()): ToolContext {
    store.nextRound();
    return { exec, results: store, now: NOW };
  }

  it('roda a tool 2× com os períodos alinhados, guarda A e B no store e devolve o diff', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const store = new ResultStore();
    const ctx = ctxWith(async (name, input) => {
      calls.push({ name, input });
      return { kpis: { gross: input.start_date === '2026-09-24' ? 1200 : 1000, orderGroups: 10, aov: 100 } };
    }, store);
    const out = (await runComparePeriods({ tool: 'get_overview', a: { start_date: '2026-09-24', end_date: '2026-09-30' }, filters: { platforms: ['clickbank'] } }, ctx)) as Record<string, any>;
    expect(calls).toEqual([
      { name: 'get_overview', input: { platforms: ['clickbank'], start_date: '2026-09-24', end_date: '2026-09-29', compare: false } },
      { name: 'get_overview', input: { platforms: ['clickbank'], start_date: '2026-09-17', end_date: '2026-09-22', compare: false } },
    ]);
    expect(out.align).toEqual({ requested: 'auto', applied: 'closed_days', aligned: true });
    expect(out.deltas.kpis.gross).toEqual({ a: 1200, b: 1000, delta: 200, deltaPct: 20 });
    expect(out.a.ref).toBe('r1');
    expect(store.get('r2')?.value).toEqual({ kpis: { gross: 1000, orderGroups: 10, aov: 100 } });
  });

  it('aggregate_orders: passa o bloco aggregate e a hora de corte nos dois lados', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const ctx = ctxWith(async (_n, input) => { calls.push(input); return { totals: { gross_approved: 1 } }; });
    await runComparePeriods({ tool: 'aggregate_orders', a: { start_date: '2026-09-30', end_date: '2026-09-30' }, aggregate: { group_by: ['hour'], metrics: ['gross_approved'] } }, ctx);
    expect(calls[0]).toMatchObject({ group_by: ['hour'], start_date: '2026-09-30', end_date: '2026-09-30', end_time: '14:05' });
    expect(calls[1]).toMatchObject({ start_date: '2026-09-29', end_date: '2026-09-29', end_time: '14:05' });
  });

  it('erro de uma das execuções volta identificado; input inválido é PeriodInputError', async () => {
    const ctx = ctxWith(async (_n, input) => (input.start_date === '2026-09-14' ? { error: 'invalid_input', message: 'families: x' } : { a: 1 }));
    const out = await runComparePeriods({ tool: 'get_platforms', a: { start_date: '2026-09-21', end_date: '2026-09-27' } }, ctx);
    expect(out).toEqual({ error: 'invalid_input', message: 'período B: families: x' });
    await expect(runComparePeriods({ tool: 'get_orders' }, ctx)).rejects.toThrow(PeriodInputError);
    await expect(runComparePeriods({ tool: 'get_overview', filters: { foo: 1 } }, ctx)).rejects.toThrow(/filters\.foo/);
    await expect(runComparePeriods({ tool: 'get_overview', aggregate: {} }, ctx)).rejects.toThrow(/aggregate só vale/);
    await expect(runComparePeriods({ tool: 'get_overview', b: { preset: 'last_month' } }, ctx)).rejects.toThrow(/b\.preset/);
  });
});
