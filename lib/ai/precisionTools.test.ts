import { describe, expect, it, vi } from 'vitest';

const evaluate = vi.fn();
vi.mock('../services/netProfit', () => ({
  DAILY_MAX_DAYS: 62,
  getNetProfitParams: async () => ({ params: {}, updatedAt: '2026-09-16T00:00:00.000Z' }),
  evaluateNetProfit: (...a: unknown[]) => evaluate(...a),
  evaluateNetProfitDaily: async () => [{ start: 'x', end: 'y', kpis: { profit: 1 }, channels: [] }],
}));

import { PRECISION_TOOL_MODULE } from './precisionTools';
import { ResultStore } from './resultStore';
import type { ToolContext } from './toolTypes';

const { tools, handlers } = PRECISION_TOOL_MODULE;
const NAMES = ['calc', 'aggregate_result', 'aggregate_orders', 'compare_periods', 'get_data_coverage', 'resolve_entities', 'get_profit_model', 'get_net_profit'];
const NOW = new Date('2026-09-30T17:05:00Z');

describe('catálogo do módulo', () => {
  it('as 8 tools do contrato, cada uma com handler', () => {
    expect(tools.map((t) => t.name)).toEqual(NAMES);
    expect(Object.keys(handlers).sort()).toEqual([...NAMES].sort());
  });

  it('schemas fechados (additionalProperties:false), sem strict, descrição em PT-BR e sem datas obrigatórias', () => {
    for (const t of tools) {
      const s = t.input_schema as { type: string; additionalProperties?: boolean; required?: string[] };
      expect(s.type, t.name).toBe('object');
      expect(s.additionalProperties, t.name).toBe(false);
      expect(s.required ?? [], t.name).not.toContain('start_date');
      expect((t as { strict?: boolean }).strict, t.name).toBeUndefined();
      expect((t.description ?? '').length, t.name).toBeGreaterThan(120);
    }
  });

  it('enums das tools novas batem com o que os handlers aceitam', () => {
    const cmp = tools.find((t) => t.name === 'compare_periods')!.input_schema as { properties: Record<string, { enum?: string[] }> };
    expect(cmp.properties.tool.enum).toContain('aggregate_orders');
    expect(cmp.properties.tool.enum).not.toContain('get_orders');
  });
});

function ctxRound(store: ResultStore, extra: Partial<ToolContext> = {}): ToolContext {
  return { results: store, now: NOW, ...extra };
}

describe('calc / aggregate_result pelo handler', () => {
  it('lê só rodadas anteriores; grava as contas pro grounding', async () => {
    const store = new ResultStore();
    store.nextRound();
    store.put('get_overview', {}, { kpis: { gross: 200, prev: 160 }, rows: [{ a: 1 }, { a: 3 }] });
    const sameRound = await handlers.calc({ expressions: [{ name: 'x', expr: '$r1.kpis.gross' }] }, ctxRound(store));
    expect(sameRound).toMatchObject({ results: [], errors: [{ name: 'x', message: expect.stringMatching(/desta mesma rodada/) }] });
    store.nextRound();
    const out = await handlers.calc({ expressions: [{ name: 'var', expr: 'pct_change($r1.kpis.gross, $r1.kpis.prev)' }] }, ctxRound(store));
    expect(out).toMatchObject({ results: [{ name: 'var', value: 25, unit: 'percent', display: '25.0%' }], errors: [] });
    expect(store.calcValues().get('var')).toBe(25);
    const missing = await handlers.calc({ expressions: [{ name: 'y', expr: '$r7.a' }] }, ctxRound(store));
    expect((missing as { errors: Array<{ message: string }> }).errors[0].message).toMatch(/disponíveis: \$r1 \(get_overview\)/);
    expect(await handlers.calc({ expressions: 'x' }, ctxRound(store))).toMatchObject({ error: 'invalid_input' });
  });

  it('aggregate_result: ref inválida, rodada atual e sucesso com a origem', async () => {
    const store = new ResultStore();
    store.nextRound();
    store.put('get_affiliates', {}, { affiliates: [{ p: 'a', revenue: 10 }, { p: 'a', revenue: 5 }, { p: 'b', revenue: 1 }] });
    expect(await handlers.aggregate_result({ ref: 'x1' }, ctxRound(store))).toMatchObject({ error: 'invalid_input' });
    expect(await handlers.aggregate_result({ ref: 'r1' }, ctxRound(store))).toMatchObject({ error: 'invalid_input', message: expect.stringMatching(/mesma rodada/) });
    store.nextRound();
    const out = await handlers.aggregate_result({ ref: '$r1', group_by: ['p'], metrics: [{ name: 'receita', op: 'sum', field: 'revenue' }] }, ctxRound(store));
    expect(out).toMatchObject({ source: { ref: 'r1', tool: 'get_affiliates' }, rows: [{ p: 'a', receita: 15 }, { p: 'b', receita: 1 }], totals: { receita: 16 } });
    expect(await handlers.aggregate_result({ ref: 'r1', where: [{ field: 'p', op: 'like', value: 'a' }] }, ctxRound(store))).toMatchObject({ error: 'invalid_input' });
  });
});

describe('validação e erros estruturados', () => {
  it('aggregate_orders recusa métrica fora da whitelist antes de tocar no banco', async () => {
    const r = await handlers.aggregate_orders({ metrics: ['gross_approved', 'drop_table'] }, ctxRound(new ResultStore()));
    expect(r).toMatchObject({ error: 'invalid_input', retryable: false, message: expect.stringMatching(/metrics inválido: drop_table/) });
    expect((r as { validValues?: string[] }).validValues).toContain('gross_approved');
  });

  it('compare_periods sem exec/tool inválida vira invalid_input', async () => {
    const r = await handlers.compare_periods({ tool: 'get_orders' }, ctxRound(new ResultStore(), { exec: async () => ({}) }));
    expect(r).toMatchObject({ error: 'invalid_input', message: expect.stringMatching(/tool inválida/) });
  });

  it('resolve_entities valida terms e kinds', async () => {
    expect(await handlers.resolve_entities({ terms: [] }, {})).toMatchObject({ error: 'invalid_input' });
    const r = await handlers.resolve_entities({ terms: ['x'], kinds: ['planet'] }, {});
    expect(r).toMatchObject({ error: 'invalid_input', validValues: expect.arrayContaining(['platform', 'family']) });
  });
});

describe('get_net_profit (admin)', () => {
  it('membro recebe forbidden sem consultar nada', async () => {
    const r = await handlers.get_net_profit({}, { user: { id: 'u', role: 'MEMBER', allowedTabs: [] }, now: NOW });
    expect(r).toMatchObject({ error: 'forbidden' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('daily acima de 62 dias é invalid_input', async () => {
    const r = await handlers.get_net_profit({ start_date: '2026-06-01', end_date: '2026-09-29', daily: true }, { user: { id: 'u', role: 'ADMIN', allowedTabs: [] }, now: NOW });
    expect(r).toMatchObject({ error: 'invalid_input', message: expect.stringMatching(/62 dias/) });
  });

  it('admin: período BRT, lente declarada, afiliados ordenados por bruto, série diária', async () => {
    evaluate.mockResolvedValue({
      result: {
        kpis: { revenue: 1000, profit: 200, marginPct: 20 },
        channels: [{ key: 'front', breakdown: [{ key: 'cb', label: 'CB', gross: 1, orders: 1, revenue: 1, profit: 1, marginPct: 1, lines: [{ key: 'fee' }] }], lines: [] }],
        products: [{ family: 'A', gross: 1 }, { family: 'B', gross: 5 }],
        affiliates: [{ externalId: 'x', gross: 2 }, { externalId: 'y', gross: 9 }],
        salesbound: { mode: 'none' },
        observedProductCostPct: {},
        warnings: [],
      },
      needs: [{ key: 'k', severity: 'required', title: 't', detail: 'd', format: 'f' }],
    });
    const r = (await handlers.get_net_profit({ start_date: '2026-09-01', end_date: '2026-09-29', daily: true }, { user: { id: 'u', role: 'ADMIN', allowedTabs: [] }, now: NOW })) as Record<string, any>;
    const [start, end] = evaluate.mock.calls[0] as [Date, Date];
    expect(start.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T02:59:59.999Z');
    expect(r.period).toEqual({ startBrt: '2026-09-01', endBrt: '2026-09-29', days: 29, source: 'explicit' });
    expect(r.lens).toMatch(/OFICIAL/);
    expect(r.affiliates.map((a: { externalId: string }) => a.externalId)).toEqual(['y', 'x']);
    expect(r.channels[0].breakdown[0].lines).toBeUndefined();
    expect(r.needs).toEqual([{ key: 'k', severity: 'required', title: 't', detail: 'd' }]);
    expect(r.daily).toHaveLength(1);
  });
});
