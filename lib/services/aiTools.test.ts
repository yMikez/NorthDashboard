import { describe, expect, it } from 'vitest';
import {
  TOOLS,
  TERMINAL_TOOL,
  HANDLED_TOOL_NAMES,
  parseFilters,
  uiRangeContext,
  fitToolResult,
  executeTool,
} from './aiTools';

describe('TOOLS — catálogo', () => {
  it('nomes únicos e TODA tool tem handler (e vice-versa)', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(HANDLED_TOOL_NAMES, `sem handler: ${n}`).toContain(n);
    for (const n of HANDLED_TOOL_NAMES) expect(names, `handler órfão: ${n}`).toContain(n);
    expect(names).toContain(TERMINAL_TOOL);
  });

  it('cobre todas as abas: call center, reembolsos, sms, recuperação, custos, fulfillment, plataformas, saúde', () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of ['get_call_center', 'get_refund_cohorts', 'get_sms', 'get_recovery', 'get_costs_overview',
      'get_fulfillment', 'get_platforms', 'get_health', 'get_profit_split', 'get_families']) {
      expect(names).toContain(n);
    }
  });

  it('datas NÃO são obrigatórias (default = período da UI)', () => {
    for (const t of TOOLS) {
      const req = (t.input_schema as { required?: string[] }).required ?? [];
      expect(req, t.name).not.toContain('start_date');
    }
  });
});

describe('parseFilters', () => {
  it('YYYY-MM-DD vira dia inteiro em BRT', () => {
    const f = parseFilters({ start_date: '2026-05-11', end_date: '2026-05-11' });
    expect(f.startDate.toISOString()).toBe('2026-05-11T03:00:00.000Z');
    expect(f.endDate.toISOString()).toBe('2026-05-12T02:59:59.999Z');
  });

  it('sem datas usa o período da UI quando existe', () => {
    const ctx = uiRangeContext(undefined, undefined, '2026-08-01', '2026-08-24');
    const f = parseFilters({}, ctx);
    expect(f.startDate).toEqual(ctx.defaultStart);
    expect(f.endDate).toEqual(ctx.defaultEnd);
  });

  it('instantes exatos da UI têm preferência sobre os rótulos (mesmo intervalo das abas)', () => {
    // preset "ontem" (23/08 BRT): fim = 24/08 02:59:59.999Z — o rótulo
    // antigo dizia 2026-08-24 e o chat consultava um dia a mais.
    const ctx = uiRangeContext('2026-08-23T03:00:00.000Z', '2026-08-24T02:59:59.999Z', '2026-08-23', '2026-08-24');
    expect(ctx.defaultStart?.toISOString()).toBe('2026-08-23T03:00:00.000Z');
    expect(ctx.defaultEnd?.toISOString()).toBe('2026-08-24T02:59:59.999Z');
  });

  it('só start_date → até agora; só end_date → início da UI se couber, senão 30d antes', () => {
    const ui = uiRangeContext(undefined, undefined, '2026-07-01', '2026-07-31');
    const a = parseFilters({ start_date: '2026-08-10' }, ui);
    expect(a.startDate.toISOString()).toBe('2026-08-10T03:00:00.000Z');
    expect(a.endDate.getTime()).toBeGreaterThan(a.startDate.getTime());
    const b = parseFilters({ end_date: '2026-07-15' }, ui);
    expect(b.startDate).toEqual(ui.defaultStart);
    const c = parseFilters({ end_date: '2026-06-15' }, ui);
    expect(c.endDate.getTime() - c.startDate.getTime()).toBe(30 * 24 * 3600 * 1000);
  });

  it('sem datas e sem UI → últimos 30 dias até agora', () => {
    const before = Date.now();
    const f = parseFilters({});
    expect(f.endDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(f.endDate.getTime() - f.startDate.getTime()).toBe(30 * 24 * 3600 * 1000);
  });

  it('stages aceita FE/Front/UPSELL e mapeia pro enum; filtros vazios viram undefined', () => {
    const f = parseFilters({ stages: ['FE', 'Upsell', 'lixo'], platforms: [], products: ['NSNMP6'] });
    expect(f.productTypes).toEqual(['FRONTEND', 'UPSELL']);
    expect(f.platformSlugs).toBeUndefined();
    expect(f.productExternalIds).toEqual(['NSNMP6']);
  });

  it('data inválida vira erro legível (não Date inválida silenciosa)', () => {
    expect(() => parseFilters({ start_date: '11/05/2026' })).toThrow(/start_date inválido/);
    expect(() => parseFilters({ start_date: '2026-08-20', end_date: '2026-08-01' })).toThrow(/anterior/);
  });

  it('uiRangeContext ignora lixo', () => {
    expect(uiRangeContext(undefined, undefined)).toEqual({});
    expect(uiRangeContext(undefined, undefined, '2026-08-24', '2026-08-01')).toEqual({});
    expect(uiRangeContext('hoje', 'agora', 'hoje', '2026-08-01')).toEqual({});
    expect(uiRangeContext('2026-08-24T03:00:00Z', '2026-08-01T03:00:00Z')).toEqual({});
  });
});

describe('fitToolResult', () => {
  it('cabe → devolve JSON com floats arredondados a 4 casas', () => {
    const s = fitToolResult({ a: 1 / 3, b: 2, c: [0.123456789], d: new Date('2026-08-24T00:00:00Z') }, 10_000);
    expect(JSON.parse(s)).toEqual({ a: 0.3333, b: 2, c: [0.1235], d: '2026-08-24T00:00:00.000Z' });
  });

  it('estoura → encolhe a MAIOR lista e anota _truncated, mantendo JSON válido', () => {
    const big = { summary: { total: 5000 }, orders: Array.from({ length: 5000 }, (_, i) => ({ id: i, amount: 99.9, name: `pedido ${i}` })), small: [1, 2, 3] };
    const s = fitToolResult(big, 20_000);
    expect(s.length).toBeLessThanOrEqual(20_000);
    const parsed = JSON.parse(s);
    expect(parsed.summary).toEqual({ total: 5000 });
    expect(parsed.small).toEqual([1, 2, 3]);
    expect(parsed.orders.length).toBeLessThan(5000);
    expect(parsed._truncated).toEqual([{ path: 'orders', kept: parsed.orders.length, total: 5000 }]);
    expect(parsed._hint).toMatch(/pagine/i);
  });

  it('encolhe listas aninhadas também (ex: detalhe.daily)', () => {
    const v = { detail: { daily: Array.from({ length: 2000 }, (_, i) => ({ d: i, v: 1.5 })) } };
    const parsed = JSON.parse(fitToolResult(v, 8_000));
    expect(parsed.detail.daily.length).toBeLessThan(2000);
    expect(parsed._truncated[0].path).toBe('detail.daily');
  });

  it('sem lista pra cortar e ainda grande → erro estruturado, nunca string cortada', () => {
    const parsed = JSON.parse(fitToolResult({ blob: 'x'.repeat(50_000) }, 1_000));
    expect(parsed.error).toBe('result_too_large');
  });
});

describe('executeTool — robustez', () => {
  it('tool desconhecida e input inválido viram objeto de erro (nunca exceção)', async () => {
    expect(await executeTool('get_nada', {})).toEqual({ error: 'tool desconhecida: get_nada' });
    const r = (await executeTool('get_orders', { start_date: 'ontem' })) as { error: string; message: string };
    expect(r.error).toBe('invalid_input');
    expect(r.message).toMatch(/start_date/);
  });

  it('get_affiliate_detail sem id → erro legível', async () => {
    expect(await executeTool('get_affiliate_detail', {})).toEqual({ error: 'external_id obrigatório' });
  });
});
