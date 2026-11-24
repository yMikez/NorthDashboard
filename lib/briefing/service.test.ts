import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({
  rows: new Map<string, { payload: unknown; model: string; createdAt: Date }>(),
  reads: 0,
  ai: vi.fn(),
  release: null as null | (() => void),
}));

vi.mock('../db', () => {
  const db = {
    aiBriefing: {
      findUnique: async ({ where }: { where: { scopeKey_windowEnd: { scopeKey: string; windowEnd: string } } }) => {
        const k = `${where.scopeKey_windowEnd.scopeKey}|${where.scopeKey_windowEnd.windowEnd}`;
        return st.rows.get(k) ?? null;
      },
      upsert: async ({ create }: { create: { scopeKey: string; windowEnd: string; payload: unknown; model: string } }) => {
        st.rows.set(`${create.scopeKey}|${create.windowEnd}`, { payload: create.payload, model: create.model, createdAt: new Date() });
      },
      deleteMany: async () => ({ count: 0 }),
    },
    decision: { findMany: async () => [] },
    clickUpChannel: { findMany: async () => [] },
    $queryRaw: async () => [
      { family: 'NeuroRecall', platform: 'jvzoo', aid: 'a1', ext: '3552295', nick: 'Ana', internal: null, pid: null, pname: null, cur: 60_000, prev: 40_000 },
    ],
  };
  return { db, dbRead: db };
});
vi.mock('../insights/windowMetrics', () => ({
  readWindow: async () => {
    st.reads++;
    const day = (d: string, g: number) => ({ date: d, gross: g, orders: 10, refundUsd: 0, refundCount: 0, netAfterCpa: 0, feSessions: 0, feRevenue: 0, front: 0, backend: 0, recovery: 0 });
    return {
      totals: { faturamento: 70_000, pedidos: 700, aov: 100, net_after_cpa: 20_000, aprovacao: 0.9, reembolso: 2_000, chargeback: 0.004 },
      previous: { faturamento: 50_000, pedidos: 520, aov: 96, net_after_cpa: 15_000, aprovacao: 0.88, reembolso: 1_800, chargeback: 0.003 },
      daily: [day('2026-11-17', 10_000)], previousDaily: [day('2026-11-10', 7_000)],
      stages: { front: 60_000, backend: 5_000, recovery: 5_000, backendAvailable: true },
    };
  },
}));
vi.mock('../insights/llm', () => ({ askStructured: (...a: unknown[]) => st.ai(...a), InsightsRefusedError: class extends Error {} }));
vi.mock('../shared/affiliateFilter', () => ({ resolveAffiliateFilter: async () => ['acc_h1'] }));

import { getBriefing } from './service';
import type { SessionUser } from '../auth/session';

const NOW = new Date('2026-11-24T18:00:00Z');
const admin: SessionUser = { id: 'adm', email: 'mike@x', name: 'Mike', role: 'ADMIN', allowedTabs: [], networkId: null, portfolioRole: null };
const hunter: SessionUser = { id: 'h1', email: 'h@x', name: 'H', role: 'MEMBER', allowedTabs: ['overview', 'decisions'], networkId: null, portfolioRole: 'HUNTER' };
const AI = { headline: 'Semana forte: faturamento +40%', summary: 'S', highlights: [], attention: null, decisions: [] };

beforeEach(() => {
  st.rows.clear(); st.reads = 0; st.ai.mockReset();
});

describe('briefing — geração e cache', () => {
  it('1ª abertura gera 1x; enquanto gera não recalcula; depois sai do banco', async () => {
    let release!: () => void;
    st.ai.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ data: AI, model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 1 }); }));
    const a = await getBriefing(admin, { now: NOW });
    expect(a.status).toBe('generating');
    expect(a.scopeKey).toBe('all+d');
    expect(a.pack.windows.cur).toEqual({ from: '2026-11-17', to: '2026-11-23' });
    expect(a.pack.metrics.find((m) => m.key === 'faturamento')).toMatchObject({ curFmt: '$70,000', deltaFmt: '+40.0%', good: true });
    expect(a.pack.movers.up[0]).toMatchObject({ name: 'NeuroRecall', deltaFmt: '+$20,000' });
    const readsAfterFirst = st.reads;

    const b = await getBriefing(admin, { now: NOW });
    expect(b.status).toBe('generating');
    expect(st.reads).toBe(readsAfterFirst); // pacote da geração em andamento, sem recalcular
    expect(st.ai).toHaveBeenCalledTimes(1);

    release();
    await new Promise((r) => setTimeout(r, 0));
    const c = await getBriefing(admin, { now: NOW });
    expect(c).toMatchObject({ status: 'ready', ai: { headline: AI.headline }, model: 'claude-opus-5-5' });
    expect(st.reads).toBe(readsAfterFirst);
    expect(st.ai).toHaveBeenCalledTimes(1);
  });

  it('quem tem carteira tem recorte próprio e não leva decisões', async () => {
    st.ai.mockResolvedValue({ data: AI, model: 'm', inputTokens: 1, outputTokens: 1 });
    const r = await getBriefing(hunter, { now: NOW });
    expect(r.scopeKey).toBe('u:h1');
    expect(r.pack.scope).toEqual({ kind: 'carteira', label: 'Sua carteira de afiliados' });
    expect(r.pack.decisions).toEqual([]);
    const prompt = (st.ai.mock.calls[0][0] as { user: string }).user;
    expect(prompt).toContain('"recorte":"Sua carteira de afiliados"');
    expect(prompt).toContain('"variacao":"+40.0%"');
  });
});
