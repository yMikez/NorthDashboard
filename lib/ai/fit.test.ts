import { describe, expect, it } from 'vitest';
import { CHECKPOINT_AGES, fitToolResult, policyFor, tagTool, type TruncationNote } from './fit';

interface Parsed {
  _truncated?: TruncationNote[];
  _hint?: string;
  [k: string]: unknown;
}

// Sequência realista: 8 janelas × 600 linhas de ranking + evolução — o caso
// que a v1 errava (sobravam as 2 janelas MAIS ANTIGAS).
function sequenceFixture(windows = 8, rows = 600) {
  return {
    asOf: '2026-09-30T12:00:00.000Z',
    window: 7,
    count: windows,
    windows: Array.from({ length: windows }, (_, w) => ({
      index: w,
      label: `Janela ${w + 1}`,
      start: `2026-0${1 + Math.floor(w / 4)}-0${1 + (w % 4)}`,
      end: `2026-0${1 + Math.floor(w / 4)}-0${2 + (w % 4)}`,
      totals: { revenue: 100_000 + w, sales: 900 + w },
      active: rows,
      rows: Array.from({ length: rows }, (_, i) => ({
        key: `aff:${w}-${i}`,
        name: `afiliado número ${i} da janela ${w}`,
        kind: 'affiliate',
        platforms: ['clickbank'],
        rank: i + 1,
        m: { revenue: 1000 - i, sales: 10, aov: 99.5, refundRate: 0.0712, activeDays: 7, netAfterCpaTotal: 12.5 },
      })),
    })),
    transitions: Array.from({ length: windows - 1 }, (_, i) => ({ from: i, to: i + 1, retained: 400, note: 'estável' })),
    evolution: Array.from({ length: rows }, (_, i) => ({
      key: `aff:${i}`,
      name: `afiliado ${i}`,
      tag: 'estavel',
      deltas: Array.from({ length: windows - 1 }, () => 0.0123),
      per: Array.from({ length: windows }, () => ({ revenue: 100, sales: 1, aov: 100, rank: i })),
    })),
  };
}

describe('policyFor', () => {
  it('séries diárias guardam o fim; janelas de sequência nunca são cortadas; padrão = topo', () => {
    expect(policyFor(undefined, 'daily')).toBe('tail');
    expect(policyFor('get_affiliate_detail', 'detail.daily')).toBe('tail');
    expect(policyFor('get_affiliate_sequence', 'windows')).toBe('never');
    expect(policyFor('get_affiliate_sequence', 'windows[].rows')).toBe('head');
    expect(policyFor('get_funnel_sequence', 'windows')).toBe('never');
    expect(policyFor('get_funnel_sequence', 'scopes.all.transitions')).toBe('never');
    expect(policyFor('get_refund_cohorts', 'cohorts[].cells')).toBe('compact');
    expect(policyFor('get_affiliates', 'affiliates')).toBe('head');
  });
});

describe('fitToolResult v2', () => {
  it('cabe → JSON com floats arredondados a 4 casas, sem _truncated', () => {
    const s = fitToolResult({ a: 1 / 3, b: 2, c: [0.123456789], d: new Date('2026-08-24T00:00:00Z') }, 10_000);
    expect(JSON.parse(s)).toEqual({ a: 0.3333, b: 2, c: [0.1235], d: '2026-08-24T00:00:00.000Z' });
  });

  it('sequência de 8 janelas: TODAS as janelas ficam, o ranking de cada uma é cortado pelo topo', () => {
    const value = sequenceFixture();
    const full = JSON.stringify(value).length;
    const cap = 600_000;
    expect(full).toBeGreaterThan(cap * 2);
    const s = fitToolResult(value, cap, 'get_affiliate_sequence');
    expect(s.length).toBeLessThanOrEqual(cap);
    const parsed = JSON.parse(s) as Parsed & { windows: Array<{ label: string; rows: Array<{ rank: number; m: { revenue: number } }> }> };
    expect(parsed.windows.map((w) => w.label)).toEqual(Array.from({ length: 8 }, (_, i) => `Janela ${i + 1}`));
    for (const w of parsed.windows) {
      expect(w.rows.length).toBeGreaterThan(0);
      expect(w.rows.length).toBeLessThan(600);
      expect(w.rows[0].rank).toBe(1); // topo do ranking preservado
    }
    // A janela mais recente não é sacrificada pelas antigas (equilíbrio).
    const kept = parsed.windows.map((w) => w.rows.length);
    expect(Math.max(...kept) / Math.min(...kept)).toBeLessThanOrEqual(2);
    const note = parsed._truncated!.find((n) => n.path === 'windows[7].rows')!;
    expect(note).toMatchObject({ total: 600, keptEnd: 'head', kept: parsed.windows[7].rows.length });
    // droppedTotals = soma EXATA do que saiu (receita 1000−i das linhas cortadas).
    const droppedRevenue = Array.from({ length: 600 }, (_, i) => 1000 - i).slice(note.kept).reduce((a, b) => a + b, 0);
    expect(note.droppedTotals!['m.revenue']).toBe(droppedRevenue);
    expect(note.droppedTotals!['m.sales']).toBe((600 - note.kept) * 10);
    // Taxas e médias não são somadas.
    expect(note.droppedTotals!['m.refundRate']).toBeUndefined();
    expect(note.droppedTotals!['m.aov']).toBeUndefined();
    expect(parsed._truncated!.some((n) => n.path === 'windows')).toBe(false);
  });

  it('sob pressão de contexto (teto de 20 KB) a sequência ainda cabe, com as 8 janelas, rápido', () => {
    const t0 = Date.now();
    const s = fitToolResult(sequenceFixture(), 20_000, 'get_affiliate_sequence');
    expect(Date.now() - t0).toBeLessThan(3_000);
    const parsed = JSON.parse(s) as Parsed & { windows: Array<{ rows: unknown[] }> };
    expect(s.length).toBeLessThanOrEqual(20_000);
    expect(parsed.windows).toHaveLength(8);
    expect(parsed.windows.every((w) => w.rows.length >= 1)).toBe(true);
  });

  it('a etiqueta de tool posta pelo executeTool sobrevive ao spread do motor ({ _ref, ...valor })', () => {
    const tagged = tagTool(sequenceFixture(), 'get_affiliate_sequence');
    const withRef = { _ref: 'r4', ...tagged };
    const parsed = JSON.parse(fitToolResult(withRef, 600_000)) as Parsed & { windows: unknown[]; _ref: string };
    expect(parsed.windows).toHaveLength(8);
    expect(parsed._ref).toBe('r4');
    expect(parsed._hint).toMatch(/\$r4/);
    expect(parsed._hint).toMatch(/aggregate_result\/calc/);
    expect(parsed._hint).not.toMatch(/offset/);
    // O símbolo não vaza pro JSON.
    expect(JSON.stringify(tagged)).not.toMatch(/fitTool/);
  });

  it('série diária ascendente guarda os dias MAIS RECENTES', () => {
    const v = { detail: { daily: Array.from({ length: 4000 }, (_, i) => ({ date: `d${i}`, revenue: 1.5 })) } };
    const parsed = JSON.parse(fitToolResult(v, 20_000)) as Parsed & { detail: { daily: Array<{ date: string }> } };
    const days = parsed.detail.daily.map((d) => d.date);
    expect(days[days.length - 1]).toBe('d3999');
    expect(days).not.toContain('d0');
    const note = parsed._truncated![0];
    expect(note).toMatchObject({ path: 'detail.daily', total: 4000, keptEnd: 'tail' });
    expect(note.droppedTotals!.revenue).toBeCloseTo((4000 - note.kept) * 1.5, 2);
  });

  it('get_orders: corta pelo topo (mais recentes primeiro) e o aviso fala em offset', () => {
    const orders = Array.from({ length: 5000 }, (_, i) => ({ externalId: `o${i}`, grossAmountUsd: 49.99, cpaPaidUsd: 10, status: 'APPROVED' }));
    const v = { _ref: 'r2', orders, total: 5000, page: { limit: 1000, offset: 0 } };
    const parsed = JSON.parse(fitToolResult(v, 30_000, 'get_orders')) as Parsed & { orders: Array<{ externalId: string }> };
    expect(parsed.orders[0].externalId).toBe('o0');
    expect(parsed._hint).toMatch(/offset/);
    const note = parsed._truncated![0];
    expect(note.droppedTotals!.grossAmountUsd).toBeCloseTo((5000 - note.kept) * 49.99, 2);
    expect(note.droppedTotals!.cpaPaidUsd).toBe((5000 - note.kept) * 10);
  });

  it('outras tools: o aviso aponta pro resultado completo ($rN), nunca pra offset', () => {
    const v = { _ref: 'r7', products: Array.from({ length: 3000 }, (_, i) => ({ externalId: `p${i}`, revenue: 10, name: 'x'.repeat(40) })) };
    const parsed = JSON.parse(fitToolResult(v, 20_000, 'get_products')) as Parsed;
    expect(parsed._hint).toMatch(/\$r7/);
    expect(parsed._hint).not.toMatch(/offset/);
  });

  it('coortes: compacta nas idades-marco antes de cortar (célula ganha `age`)', () => {
    const horizon = 180;
    // Mais recente primeiro (como o serviço): coorte c tem c dias de vida.
    const cohorts = Array.from({ length: 200 }, (_, c) => ({
      day: `coorte-${c}`,
      ageDays: c,
      baseCount: 100,
      cells: Array.from({ length: horizon + 1 }, (_, age) => (age <= c ? { cumCount: age, cumUsd: age * 10, pctCount: 0.01, pctUsd: 0.012 } : null)),
    }));
    const curve = Array.from({ length: horizon + 1 }, (_, age) => ({ age, pctCount: 0.001 * age, eligibleBaseCount: 1000 }));
    const v = { todayBrt: '2026-09-30', horizonDays: horizon, cohorts, curve, totals: { baseCount: 12_000 } };
    const full = JSON.stringify(v).length;
    const parsed = JSON.parse(fitToolResult(v, Math.floor(full / 5), 'get_refund_cohorts')) as Parsed & {
      cohorts: Array<{ ageDays: number; cells: Array<{ age: number }> }>;
      curve: Array<{ age: number }>;
    };
    // Coorte madura: só idades-marco; coorte jovem: marcos até a idade + a última observada.
    const mature = parsed.cohorts.find((c) => c.ageDays >= 180)!;
    expect(mature.cells.map((x) => x.age)).toEqual([...CHECKPOINT_AGES]);
    const young = parsed.cohorts.find((c) => c.ageDays === 10)!;
    expect(young.cells.map((x) => x.age)).toEqual([0, 3, 7, 10]);
    expect(parsed.curve.map((x) => x.age)).toEqual([...CHECKPOINT_AGES]);
    // A compactação bastou: nenhuma coorte foi cortada.
    expect(parsed.cohorts).toHaveLength(200);
    expect(parsed._truncated).toEqual([
      { path: 'cohorts[*].cells', kept: CHECKPOINT_AGES.length, total: horizon + 1, keptEnd: 'checkpoints' },
      { path: 'curve', kept: CHECKPOINT_AGES.length, total: horizon + 1, keptEnd: 'checkpoints' },
    ]);
    expect(parsed._hint).toMatch(/idades-marco/);
  });

  it('só listas que não podem ser cortadas e ainda grande → erro estruturado', () => {
    const v = { windows: Array.from({ length: 4 }, (_, i) => ({ label: `Janela ${i + 1}`, blob: 'x'.repeat(20_000) })) };
    const parsed = JSON.parse(fitToolResult(v, 10_000, 'get_affiliate_sequence'));
    expect(parsed).toMatchObject({ error: 'result_too_large', retryable: true });
  });

  it('sem lista pra cortar e ainda grande → erro estruturado, nunca string cortada', () => {
    const parsed = JSON.parse(fitToolResult({ blob: 'x'.repeat(50_000) }, 1_000));
    expect(parsed.error).toBe('result_too_large');
  });

  it('raiz em lista vira { items } com a nota', () => {
    const parsed = JSON.parse(fitToolResult(Array.from({ length: 2000 }, (_, i) => ({ i, v: 'abc' })), 5_000)) as Parsed & { items: unknown[] };
    expect(parsed.items.length).toBeLessThan(2000);
    expect(parsed._truncated![0].path).toBe('items');
  });
});
