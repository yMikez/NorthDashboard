import { describe, expect, it, vi } from 'vitest';

const coverage = vi.fn();
vi.mock('../services/refundCoverage', () => ({ getRefundCoverage: (...a: unknown[]) => coverage(...a) }));
vi.mock('../db', () => ({ db: { $queryRaw: async () => [] } }));
vi.mock('../services/integrationSettings', () => ({ getProviderCommission: async () => ({ pct: 0.35, assumed: true, source: 'default' }) }));
vi.mock('../services/health', () => ({ getHealth: async () => { throw new Error('não usado'); } }));

import { dataQualityFor, notesFromSnapshot, type CoverageSnapshot } from './coverage';

const NOW = new Date('2026-09-30T17:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const SNAP: CoverageSnapshot = {
  refund: {
    windowDays: 30,
    generatedAt: NOW.toISOString(),
    platforms: [
      { platform: 'buygoods', displayName: 'BuyGoods', sales: 29000, refundEvents: 0, silent: true },
      { platform: 'clickbank', displayName: 'ClickBank', sales: 5000, refundEvents: 400, silent: false },
      { platform: 'digistore24', displayName: 'Digistore24', sales: 8000, refundEvents: 700, silent: false },
      { platform: 'cartpanda', displayName: 'Cartpanda', sales: 20, refundEvents: 0, silent: false },
    ],
  },
  lastCsvReconcileAt: '2026-09-20T12:00:00.000Z',
  ingestion: [
    { platform: 'buygoods', lastReceivedAt: hoursAgo(0.2), received7d: 9000, received24h: 1300, failed24h: 2 },
    { platform: 'clickbank', lastReceivedAt: hoursAgo(9), received7d: 800, received24h: 0, failed24h: 0 },
    { platform: 'digistore24', lastReceivedAt: hoursAgo(1), received7d: 2000, received24h: 300, failed24h: 40 },
  ],
  logicallCommissionAssumed: true,
};

const issues = (tool: string, platforms?: string[]) => notesFromSnapshot(tool, platforms, SNAP, NOW).map((n) => `${n.issue}:${n.platform}`);

describe('notesFromSnapshot', () => {
  it('reembolso: plataforma silenciosa e lacuna de IPN da Digistore (com data do último reconcile)', () => {
    const notes = notesFromSnapshot('get_profit_split', undefined, SNAP, NOW);
    expect(notes.map((n) => n.issue)).toEqual(expect.arrayContaining(['refund_silent', 'digistore_refund_ipn_gap', 'commission_assumed']));
    const d24 = notes.find((n) => n.issue === 'digistore_refund_ipn_gap')!;
    expect(d24.effect).toMatch(/~28%/);
    expect(d24.effect).toMatch(/2026-09-20/);
    expect(notes.find((n) => n.issue === 'refund_silent')!.effect).toMatch(/nunca chame a taxa dela de boa/);
  });

  it('respeita o escopo de plataformas: BuyGoods silenciosa só aparece quando está no filtro', () => {
    expect(issues('get_platforms', ['clickbank'])).not.toContain('refund_silent:buygoods');
    expect(issues('get_platforms', ['buygoods'])).toContain('refund_silent:buygoods');
    expect(issues('get_platforms', ['clickbank'])).not.toContain('digistore_refund_ipn_gap:digistore24');
  });

  it('ingestão: parada há 6h+ numa plataforma ativa e falhas ≥ 5%; base pequena não alarma', () => {
    const all = issues('get_overview');
    expect(all).toContain('ingestion_stale:clickbank');
    expect(all).toContain('ingestion_failures:digistore24');
    expect(all).not.toContain('ingestion_failures:buygoods'); // 2 de 1300
    expect(all).not.toContain('ingestion_stale:cartpanda'); // sem volume: silêncio é normal
  });

  it('comissão assumida só nas tools de lucro/call center; tools sem reembolso não recebem nota de reembolso', () => {
    expect(issues('get_call_center')).toEqual(['commission_assumed:logicall']);
    expect(issues('get_funnel')).toEqual(expect.not.arrayContaining(['refund_silent:buygoods']));
    expect(issues('get_funnel')).toContain('ingestion_stale:clickbank');
    expect(issues('calc')).toEqual([]);
  });
});

describe('dataQualityFor', () => {
  it('tool fora da lista não consulta nada; falha do banco vira lista vazia (nunca derruba a tool)', async () => {
    expect(await dataQualityFor('calc')).toEqual([]);
    expect(coverage).not.toHaveBeenCalled();
    coverage.mockRejectedValueOnce(new Error('timeout'));
    expect(await dataQualityFor('get_overview', ['buygoods'])).toEqual([]);
  });
});
