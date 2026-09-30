import { describe, expect, it } from 'vitest';
import { SpecError, parsePath, resolveArgs, resolveDate, resolvePath, validateGoldenCase } from './spec';
import { GOLDEN_CASES } from './goldens';

// 2026-09-30 14:00 BRT (quarta-feira) = 17:00Z
const NOW = new Date('2026-09-30T17:00:00Z');

describe('datas relativas no calendário BRT', () => {
  it('resolve os tokens', () => {
    expect(resolveDate('$today', NOW)).toBe('2026-09-30');
    expect(resolveDate('$yesterday', NOW)).toBe('2026-09-29');
    expect(resolveDate('$d-7', NOW)).toBe('2026-09-23');
    expect(resolveDate('$mstart', NOW)).toBe('2026-09-01');
    expect(resolveDate('$pmstart', NOW)).toBe('2026-08-01');
    expect(resolveDate('$pmend', NOW)).toBe('2026-08-31');
    // semana passada = segunda → domingo
    expect(resolveDate('$wstart', NOW)).toBe('2026-09-28');
    expect(resolveDate('$pwstart', NOW)).toBe('2026-09-21');
    expect(resolveDate('$pwend', NOW)).toBe('2026-09-27');
    expect(resolveDate('2026-01-15', NOW)).toBe('2026-01-15');
  });

  it('usa o dia BRT, não o UTC (22h BRT já é amanhã em UTC)', () => {
    const lateNight = new Date('2026-10-01T01:30:00Z'); // 30/09 22:30 BRT
    expect(resolveDate('$today', lateNight)).toBe('2026-09-30');
  });

  it('virada de ano no mês anterior', () => {
    const jan = new Date('2027-01-10T15:00:00Z');
    expect(resolveDate('$pmstart', jan)).toBe('2026-12-01');
    expect(resolveDate('$pmend', jan)).toBe('2026-12-31');
  });

  it('resolveArgs troca só tokens de data (refs $rN ficam)', () => {
    expect(resolveArgs({ start_date: '$pmstart', end_date: '$pmend', expr: '$r1.kpis.gross', list: ['$yesterday'] }, NOW)).toEqual({
      start_date: '2026-08-01',
      end_date: '2026-08-31',
      expr: '$r1.kpis.gross',
      list: ['2026-09-29'],
    });
  });

  it('token inválido lança', () => {
    expect(() => resolveDate('$amanha', NOW)).toThrow(SpecError);
  });
});

const RESULT = {
  kpis: { gross: 1000, aov: 250 },
  affiliates: [
    { nickname: 'ana', externalId: 'A1', revenue: 300, netAfterCpaTotalUsd: 50 },
    { nickname: null, externalId: 'B2', revenue: 500, netAfterCpaTotalUsd: null },
    { nickname: 'caio', externalId: 'C3', revenue: 200, netAfterCpaTotalUsd: 90 },
  ],
  providers: [{ provider: 'tauk', commissionPct: 0.3 }, { provider: 'logicall', commissionPct: 0.35 }],
  rows: [
    { name: 'x', cur: { revenue: 100 }, prev: { revenue: 400 } },
    { name: 'y', cur: { revenue: 90 }, prev: { revenue: 100 } },
  ],
  scopes: { all: { transitions: [{ aovEffect: 1 }, { aovEffect: -7 }] } },
  perPlatform: [{ platform: 'cb', secondsAgo: 30 }, { platform: 'jvz', secondsAgo: 90_000 }],
};

describe('resolvePath', () => {
  it('escalar simples', () => {
    expect(resolvePath(RESULT, 'kpis.gross')).toEqual({ items: [[1000]], list: false });
  });

  it('max com alternativas (nickname|externalId), ignorando nulos', () => {
    expect(resolvePath(RESULT, 'affiliates[max:revenue].nickname|externalId')).toEqual({ items: [['B2']], list: false });
  });

  it('sort desc + fatia = lista; nulos vão pro fim', () => {
    const r = resolvePath(RESULT, 'affiliates[sort:-netAfterCpaTotalUsd][0..2].nickname|externalId');
    expect(r).toEqual({ items: [['caio', 'C3'], ['ana', 'A1']], list: true });
  });

  it('sort + índice pega o N-ésimo', () => {
    expect(resolvePath(RESULT, 'affiliates[sort:-revenue][2].externalId')).toEqual({ items: [['C3']], list: false });
  });

  it('busca por campo=valor e índice negativo', () => {
    expect(resolvePath(RESULT, 'providers[provider=logicall].commissionPct').items).toEqual([[0.35]]);
    expect(resolvePath(RESULT, 'scopes.all.transitions[-1].aovEffect').items).toEqual([[-7]]);
  });

  it('min de uma diferença (maior queda absoluta)', () => {
    expect(resolvePath(RESULT, 'rows[min:cur.revenue-prev.revenue].name').items).toEqual([['x']]);
  });

  it('filtro numérico vira lista', () => {
    expect(resolvePath(RESULT, 'perPlatform[?secondsAgo>21600].platform')).toEqual({ items: [['jvz']], list: true });
  });

  it('caminho inexistente e seletor inválido lançam SpecError', () => {
    expect(() => resolvePath(RESULT, 'kpis.nope')).toThrow(SpecError);
    expect(() => resolvePath(RESULT, 'affiliates[9].revenue')).toThrow(SpecError);
    expect(() => parsePath('a[foo:bar]')).toThrow(SpecError);
    expect(() => parsePath('a|b.c')).toThrow(SpecError);
    expect(() => resolvePath(RESULT, 'affiliates[*].x[*]')).toThrow(SpecError);
  });
});

describe('validateGoldenCase', () => {
  it('todos os goldens do código são válidos e com id único', () => {
    const ids = new Set<string>();
    for (const c of GOLDEN_CASES) {
      const v = validateGoldenCase(c);
      expect(v.ok, `${c.id}: ${v.ok ? '' : v.errors.join('; ')}`).toBe(true);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
    expect(GOLDEN_CASES.length).toBeGreaterThanOrEqual(25);
    expect(GOLDEN_CASES.length).toBeLessThanOrEqual(35);
  });

  it('acusa campos quebrados', () => {
    const v = validateGoldenCase({ id: 'x y', category: 'nada', turns: [], facts: [{ label: '', kind: 'usd', lenses: [{ name: 'l', source: { tool: 'get_overview', path: 'a[' } }] }], mention: ['('] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.length).toBeGreaterThanOrEqual(5);
  });
});
