import { describe, expect, it } from 'vitest';
import { maxRelDiff, runInvariants, type ToolFetcher } from './invariants';

const RANGE = { start_date: '2026-08-01', end_date: '2026-08-31' };

function fetcher(overrides: Record<string, unknown> = {}): ToolFetcher {
  const base: Record<string, unknown> = {
    get_overview: { kpis: { gross: 1_000, cpa: 300, aov: 250 } },
    'get_overview:DigestFlow': { kpis: { gross: 400, aov: 260 } },
    get_platforms: { platforms: [{ totalRevenue: 600 }, { totalRevenue: 400 }] },
    get_profit_split: { front: { grossUsd: 1_000 } },
    get_costs_overview: { kpis: { grossUsd: 1_000, cpaUsd: 300 } },
    get_funnel: { summary: { aov: 250 } },
    get_affiliates: { summary: { totalRevenue: 1_000 } },
    get_families: { families: [{ family: 'DigestFlow', grossRevenue: 400, aov: 180 }] },
    ...overrides,
  };
  return async (tool, args) => {
    const fam = Array.isArray(args.families) ? `:${(args.families as string[])[0]}` : '';
    return base[`${tool}${fam}`] ?? base[tool];
  };
}

describe('invariantes entre tools', () => {
  it('tudo consistente: ok, e AOV por família só informativo', async () => {
    const r = await runInvariants(fetcher(), RANGE);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.I1.status).toBe('ok');
    expect(by.I4.status).toBe('ok');
    expect(by.I5.status).toBe('ok');
    expect(by.I6.status).toBe('ok');
    expect(by['I2:DigestFlow'].status).toBe('ok');
    expect(by['I3:DigestFlow'].status).toBe('info');
    expect(by['I3:DigestFlow'].maxRelDiff).toBeCloseTo(80 / 260, 4);
  });

  it('divergência além da tolerância e tool com erro são reportadas', async () => {
    const r = await runInvariants(fetcher({ get_costs_overview: { kpis: { grossUsd: 1_000, cpaUsd: 330 } }, get_funnel: { error: 'tool_execution_failed' } }), RANGE);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.I4.status).toBe('diff');
    expect(by.I4.maxRelDiff).toBeCloseTo(30 / 330, 4);
    expect(by.I5.status).toBe('error');
    expect(by.I9.detail).toContain('tool_execution_failed');
  });

  it('sem visão geral não há o que comparar', async () => {
    const r = await runInvariants(fetcher({ get_overview: { error: 'x' } }), RANGE);
    expect(r).toEqual([expect.objectContaining({ id: 'I0', status: 'error' })]);
  });

  it('maxRelDiff pega o pior par', () => {
    expect(maxRelDiff([100, 101, 110])).toBeCloseTo(10 / 110, 5);
    expect(maxRelDiff([5, null])).toBeNull();
  });
});
