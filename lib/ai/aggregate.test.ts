import { describe, expect, it } from 'vitest';
import { AggregateInputError, parseAggregateSpec, runAggregate } from './aggregate';

// Ranking realista: taxa média por afiliado ≠ taxa agregada (um afiliado
// pequeno com 50% de refund puxa a média simples pra cima).
const AFFILIATES = [
  { externalId: 'a1', nickname: 'nitro', platformSlug: 'digistore24', revenue: 50000, refunds: 30, realOrders: 400, refundRate: 0.075, aov: 125 },
  { externalId: 'a2', nickname: 'fenix', platformSlug: 'digistore24', revenue: 2000, refunds: 8, realOrders: 16, refundRate: 0.5, aov: 125 },
  { externalId: 'a3', nickname: 'lusk', platformSlug: 'clickbank', revenue: 30000, refunds: 12, realOrders: 250, refundRate: 0.048, aov: 120 },
  { externalId: 'a4', nickname: 'zeta', platformSlug: 'clickbank', revenue: 8000, refunds: 0, realOrders: 70, refundRate: 0, aov: 114.29 },
  { externalId: 'a5', nickname: null, platformSlug: 'buygoods', revenue: 0, refunds: 0, realOrders: 0, refundRate: null, aov: null },
];
const VALUE = {
  summary: { revenue: 90000 },
  affiliates: AFFILIATES,
  windows: [{ label: 'J1', rows: [{ k: 'x', v: 1 }, { k: 'y', v: 2 }] }, { label: 'J2', rows: [{ k: 'x', v: 10 }] }],
};

const run = (raw: Record<string, unknown>) => runAggregate(VALUE, parseAggregateSpec(raw));

describe('aggregate_result', () => {
  it('ratio_of_sums ≠ avg de taxas (o erro clássico)', () => {
    const out = run({
      path: 'affiliates',
      where: [{ field: 'realOrders', op: 'gt', value: 0 }],
      metrics: [
        { name: 'taxa_agregada', op: 'ratio_of_sums', num: 'refunds', den: 'realOrders' },
        { name: 'media_das_taxas', op: 'avg', field: 'refundRate' },
      ],
    });
    expect(out.totals?.taxa_agregada).toBeCloseTo(50 / 736, 9);
    expect(out.totals?.media_das_taxas).toBeCloseTo((0.075 + 0.5 + 0.048 + 0) / 4, 9);
    expect(out.matched).toBe(4);
    expect(out.sourceRows).toBe(5);
  });

  it('group_by com sum/count/weighted_avg e sort desc padrão pela 1ª métrica', () => {
    const out = run({
      path: 'affiliates',
      group_by: ['platformSlug'],
      metrics: [
        { name: 'receita', op: 'sum', field: 'revenue' },
        { name: 'n', op: 'count' },
        { name: 'aov_pond', op: 'weighted_avg', field: 'aov', weight: 'realOrders' },
      ],
    });
    expect(out.groups).toBe(3);
    expect(out.rows.map((r) => r.platformSlug)).toEqual(['digistore24', 'clickbank', 'buygoods']);
    expect(out.rows[0]).toMatchObject({ receita: 52000, n: 2, aov_pond: 125 });
    expect(out.rows[1].aov_pond).toBeCloseTo((120 * 250 + 114.29 * 70) / 320, 6);
    expect(out.rows[2].aov_pond).toBeNull(); // peso zero
    expect(out.totals).toMatchObject({ receita: 90000, n: 5 });
  });

  it('filtros: in, contains (sem caixa), is_null, ne; eq numérico', () => {
    expect(run({ path: 'affiliates', where: [{ field: 'platformSlug', op: 'in', value: ['clickbank', 'buygoods'] }] }).matched).toBe(3);
    expect(run({ path: 'affiliates', where: [{ field: 'nickname', op: 'contains', value: 'NIT' }] }).rows[0].externalId).toBe('a1');
    expect(run({ path: 'affiliates', where: [{ field: 'nickname', op: 'is_null' }] }).matched).toBe(1);
    expect(run({ path: 'affiliates', where: [{ field: 'platformSlug', op: 'ne', value: 'DIGISTORE24' }] }).matched).toBe(3);
    expect(run({ path: 'affiliates', where: [{ field: 'revenue', op: 'eq', value: '30000' }] }).matched).toBe(1);
    expect(run({ path: 'affiliates', where: [{ field: 'refundRate', op: 'gte', value: 0.075 }] }).matched).toBe(2);
  });

  it('linhas sem agrupamento: select, sort e limit', () => {
    const out = run({ path: 'affiliates', select: ['nickname', 'revenue'], sort: { by: 'revenue', dir: 'desc' }, limit: 2 });
    expect(out.rows).toEqual([{ nickname: 'nitro', revenue: 50000 }, { nickname: 'lusk', revenue: 30000 }]);
    expect(out.returned).toBe(2);
    expect(out.matched).toBe(5);
  });

  it('nulos vão pro fim em qualquer direção', () => {
    const out = run({ path: 'affiliates', select: ['externalId', 'aov'], sort: { by: 'aov', dir: 'asc' } });
    expect(out.rows.map((r) => r.externalId)).toEqual(['a4', 'a3', 'a1', 'a2', 'a5']);
  });

  it('path com [*] junta as listas de todas as janelas; median/count_distinct/first', () => {
    const out = run({
      path: 'windows[*].rows',
      metrics: [
        { name: 'total', op: 'sum', field: 'v' },
        { name: 'chaves', op: 'count_distinct', field: 'k' },
        { name: 'mediana', op: 'median', field: 'v' },
        { name: 'primeiro', op: 'first', field: 'k' },
      ],
    });
    expect(out.totals).toEqual({ total: 13, chaves: 2, mediana: 2, primeiro: 'x' });
    expect(run({ path: 'windows[-1].rows' }).sourceRows).toBe(1);
  });

  it('path omitido: única lista do resultado ou erro listando as listas', () => {
    const only = runAggregate({ rows: [{ a: 1 }, { a: 2 }] }, parseAggregateSpec({ metrics: [{ name: 's', op: 'sum', field: 'a' }] }));
    expect(only.totals).toEqual({ s: 3 });
    expect(only.notes[0]).toMatch(/rows/);
    expect(() => run({})).toThrow(/affiliates, windows/);
  });

  it('valida input: op, campos proibidos, métricas incompletas, sort desconhecido', () => {
    expect(() => parseAggregateSpec({ where: [{ field: 'x', op: 'like', value: 1 }] })).toThrow(AggregateInputError);
    expect(() => parseAggregateSpec({ group_by: ['__proto__'] })).toThrow(/proibido/);
    expect(() => parseAggregateSpec({ metrics: [{ name: 'r', op: 'ratio_of_sums', num: 'a' }] })).toThrow(/den/);
    expect(() => parseAggregateSpec({ metrics: [{ name: 'a', op: 'sum', field: 'x' }, { name: 'a', op: 'count' }] })).toThrow(/repetido/);
    expect(() => parseAggregateSpec({ sort: { by: 'constructor' } })).toThrow(/proibido/);
    expect(() => parseAggregateSpec({ metrics: [{ name: '__proto__', op: 'count' }] })).toThrow(/name inválido/);
    expect(() => run({ path: 'affiliates', group_by: ['platformSlug'], sort: { by: 'nada' } })).toThrow(/sort\.by/);
    expect(() => run({ path: 'summary' })).toThrow(/não é uma lista/);
    expect(() => run({ path: 'nope' })).toThrow(/não existe/);
  });

  it('roda sobre a lista COMPLETA mesmo com 5000 linhas', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ revenue: i % 10, platformSlug: i % 2 ? 'a' : 'b' }));
    const out = runAggregate({ affiliates: rows }, parseAggregateSpec({ path: 'affiliates', metrics: [{ name: 's', op: 'sum', field: 'revenue' }] }));
    expect(out.totals?.s).toBe(22500);
  });
});
