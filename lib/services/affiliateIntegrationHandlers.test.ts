import { describe, expect, it, vi } from 'vitest';
import { checkIntegrationKey, handleAffiliateWebhook, handleAffiliateMetrics } from './affiliateIntegrationHandlers';
import { createMetricsCache } from './affiliateMetricsExport';
import type { ApplyResult } from './affiliateMapping';

const KEY = 'vpeOm73FGTbOvKwYTF8SmxCVjWmGFXmIC6HsvfioU';

function req(headers: Record<string, string>, body?: unknown, rawJsonError = false) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    header: (n: string) => h[n.toLowerCase()] ?? null,
    json: async () => { if (rawJsonError) throw new SyntaxError('bad json'); return body; },
  };
}

// Exatamente o corpo do curl da seção 6 do contrato.
const CONTRACT_BODY = {
  event: 'affiliate.updated', affiliate_id: 'cmfgq1x2a0000v8l4h3k9d2pw', name: 'Maria Silva', status: 'active',
  platforms: [
    { platform: 'buygoods', external_id: 'mariasilva' }, { platform: 'buygoods', external_id: 'ms8841' },
    { platform: 'digistore24', external_id: 'maria_ds' }, { platform: 'jvzoo', external_id: '1234567' },
  ],
  occurred_at: '2026-09-12T13:37:00.123Z',
};
const CONTRACT_HEADERS = {
  'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': KEY,
  'X-Event-Id': 'cmfgqz7yk0003v8l4b1c2d3e4', 'X-Event-Type': 'affiliate.updated', 'X-Webhook-Attempt': '1',
  'User-Agent': 'NorthScale-Afiliados/1.0',
};

const applied = (over: Partial<ApplyResult> = {}): ApplyResult => ({
  action: 'apply', added: [{ platform: 'jvzoo', externalId: '1234567' }], removed: [], transferred: [],
  reprocess: { accounts: 1, resolved: 1, unresolved: 0, changed: 1, ordersUpdated: 3, queued: 0, dequeued: 1 },
  ...over,
});

describe('checkIntegrationKey', () => {
  it('aceita chave igual (com trim, header repetido usa o primeiro)', () => {
    expect(checkIntegrationKey(KEY, KEY)).toBe(true);
    expect(checkIntegrationKey(` ${KEY} `, KEY)).toBe(true);
    expect(checkIntegrationKey(`${KEY}, outra`, KEY)).toBe(true);
  });
  it('recusa ausente, vazia, diferente, tamanho diferente e servidor sem chave', () => {
    expect(checkIntegrationKey(null, KEY)).toBe(false);
    expect(checkIntegrationKey('', KEY)).toBe(false);
    expect(checkIntegrationKey('x'.repeat(KEY.length), KEY)).toBe(false);
    expect(checkIntegrationKey(KEY.slice(0, -1), KEY)).toBe(false);
    expect(checkIntegrationKey(KEY, '')).toBe(false);
    expect(checkIntegrationKey(KEY, null)).toBe(false);
  });
});

describe('POST /api/integrations/affiliates/webhook', () => {
  type WebhookDeps = Parameters<typeof handleAffiliateWebhook>[1];
  const deps = (over: { inboundKey?: WebhookDeps['inboundKey']; applyState?: WebhookDeps['applyState']; log?: NonNullable<WebhookDeps['log']> } = {}) => ({
    inboundKey: over.inboundKey ?? (async () => KEY),
    applyState: vi.fn(over.applyState ?? (async () => applied())),
    log: vi.fn(over.log ?? (async () => {})),
  });

  it('503 quando a chave não está configurada no servidor', async () => {
    const r = await handleAffiliateWebhook(req(CONTRACT_HEADERS, CONTRACT_BODY), deps({ inboundKey: async () => null }));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ statusCode: 503, message: 'Integração não configurada no servidor' });
  });

  it('401 sem/errada X-Api-Key, sem tocar no banco', async () => {
    const d = deps();
    expect((await handleAffiliateWebhook(req({ ...CONTRACT_HEADERS, 'X-Api-Key': 'errada' }, CONTRACT_BODY), d)).status).toBe(401);
    const { 'X-Api-Key': _drop, ...noKey } = CONTRACT_HEADERS;
    expect((await handleAffiliateWebhook(req(noKey, CONTRACT_BODY), d)).status).toBe(401);
    expect(d.applyState).not.toHaveBeenCalled();
  });

  it('200 e aplica o estado completo (curl do contrato); log guarda X-Event-Id e tentativa', async () => {
    const d = deps();
    const r = await handleAffiliateWebhook(req(CONTRACT_HEADERS, CONTRACT_BODY), d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, affiliate_id: 'cmfgq1x2a0000v8l4h3k9d2pw', action: 'apply', added: 1, reprocessed_orders: 3, dropped: [] });
    const state = d.applyState.mock.calls[0][0];
    expect(state.platforms).toHaveLength(4);
    expect(state.name).toBe('Maria Silva');
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'cmfgqz7yk0003v8l4b1c2d3e4', attempt: '1', ok: true }));
  });

  it('repetir o mesmo comando continua 2xx sem duplicar (unchanged) e evento atrasado também (stale)', async () => {
    const d = deps({ applyState: vi.fn(async () => applied({ action: 'unchanged', added: [], reprocess: null })) });
    const r = await handleAffiliateWebhook(req(CONTRACT_HEADERS, CONTRACT_BODY), d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: 'unchanged', reprocessed_orders: 0 });
    const d2 = deps({ applyState: vi.fn(async () => applied({ action: 'stale', added: [], reprocess: null })) });
    expect((await handleAffiliateWebhook(req(CONTRACT_HEADERS, CONTRACT_BODY), d2)).body).toMatchObject({ action: 'stale' });
  });

  it('corpo inválido (não-JSON ou sem affiliate_id) → 200 ignored (reenviar não ajudaria), nada aplicado', async () => {
    const d = deps();
    const bad = await handleAffiliateWebhook(req(CONTRACT_HEADERS, undefined, true), d);
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ ok: true, ignored: 'invalid-json' });
    const noId = await handleAffiliateWebhook(req(CONTRACT_HEADERS, { ...CONTRACT_BODY, affiliate_id: '' }), d);
    expect(noId.body).toMatchObject({ ignored: 'invalid-payload' });
    expect(d.applyState).not.toHaveBeenCalled();
  });

  it('evento desconhecido é ignorado com 200', async () => {
    const d = deps();
    const r = await handleAffiliateWebhook(req(CONTRACT_HEADERS, { ...CONTRACT_BODY, event: 'affiliate.deleted' }), d);
    expect(r.body).toMatchObject({ ignored: 'unknown-event', event: 'affiliate.deleted' });
    expect(d.applyState).not.toHaveBeenCalled();
  });

  it('plataforma fora do contrato no corpo é descartada e reportada (não invalida o evento)', async () => {
    const d = deps();
    const r = await handleAffiliateWebhook(req(CONTRACT_HEADERS, { ...CONTRACT_BODY, platforms: [...CONTRACT_BODY.platforms, { platform: 'cartpanda', external_id: 'x' }] }), d);
    expect(r.status).toBe(200);
    expect((r.body as { dropped: unknown[] }).dropped).toHaveLength(1);
    expect(d.applyState).toHaveBeenCalledTimes(1);
  });

  it('erro de banco → 500 (eles fazem retry); log registra o erro', async () => {
    const d = deps({ applyState: vi.fn(async () => { throw new Error('db down'); }) });
    const r = await handleAffiliateWebhook(req(CONTRACT_HEADERS, CONTRACT_BODY), d);
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, retry: true });
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ ok: false, note: 'erro: db down' }));
  });

  it('falha no log de auditoria não muda a resposta', async () => {
    const d = deps({ log: vi.fn(async () => { throw new Error('log down'); }) });
    expect((await handleAffiliateWebhook(req(CONTRACT_HEADERS, CONTRACT_BODY), d)).status).toBe(200);
  });
});

describe('GET /api/integrations/affiliates/metrics', () => {
  const NOW = new Date('2026-09-12T15:00:00.000Z');
  const rows = [
    { affiliate_id: 'cmfgq1x2a0000v8l4h3k9d2pw', gross_sales: 1250.5, refunds: 50, net_sales: 1200.5, orders_count: 31, refund_rate: 4.2 },
    { affiliate_id: 'cmfgq5abc0001v8l4qq77zz10', gross_sales: 0, refunds: 0, net_sales: 0, orders_count: 0, refund_rate: 0 },
  ];
  type MetricsDeps = Parameters<typeof handleAffiliateMetrics>[2];
  const deps = (over: { inboundKey?: MetricsDeps['inboundKey']; compute?: MetricsDeps['compute']; cache?: MetricsDeps['cache'] } = {}) => ({
    inboundKey: over.inboundKey ?? (async () => KEY),
    compute: vi.fn(over.compute ?? (async () => rows)),
    cache: over.cache ?? createMetricsCache(),
    now: () => NOW,
  });
  const url = (qs: string) => new URL(`https://dash.thenorthscales.com/api/integrations/affiliates/metrics?${qs}`);
  const hdr = { 'X-Api-Key': KEY, Accept: 'application/json', 'User-Agent': 'NorthScale-Afiliados/1.0' };

  it('401 sem chave; 503 sem chave configurada', async () => {
    expect((await handleAffiliateMetrics(url('period=7d'), req({}), deps())).status).toBe(401);
    expect((await handleAffiliateMetrics(url('period=7d'), req(hdr), deps({ inboundKey: async () => null }))).status).toBe(503);
  });

  it('400 em period inválido ou custom incompleto/inválido', async () => {
    expect((await handleAffiliateMetrics(url('period=90d'), req(hdr), deps())).status).toBe(400);
    expect((await handleAffiliateMetrics(url('period=custom'), req(hdr), deps())).status).toBe(400);
    expect((await handleAffiliateMetrics(url('period=custom&from=2026-09-12&to=2026-09-01'), req(hdr), deps())).status).toBe(400);
    expect((await handleAffiliateMetrics(url('period=custom&from=2025-01-01&to=2026-06-01'), req(hdr), deps())).status).toBe(400);
  });

  it('200 com LISTA JSON de números (formato principal do contrato) e headers da janela', async () => {
    const d = deps();
    const r = await handleAffiliateMetrics(url('period=7d'), req(hdr), d);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toEqual(rows);
    for (const row of r.body as typeof rows) {
      for (const k of ['gross_sales', 'refunds', 'net_sales', 'orders_count', 'refund_rate'] as const) {
        expect(typeof row[k]).toBe('number');
        expect(Number.isFinite(row[k])).toBe(true);
      }
      expect(Number.isInteger(row.orders_count)).toBe(true);
    }
    expect(r.headers).toMatchObject({ 'X-Period': '7d', 'X-Period-From': '2026-09-06', 'X-Period-To': '2026-09-12', 'X-Cache': 'MISS' });
    const [start, end] = d.compute.mock.calls[0];
    expect(start.toISOString()).toBe('2026-09-06T03:00:00.000Z');
    expect(end).toEqual(NOW);
  });

  it('cache curto: segunda chamada do mesmo período não recomputa; período diferente recomputa', async () => {
    const d = deps();
    await handleAffiliateMetrics(url('period=30d'), req(hdr), d);
    const again = await handleAffiliateMetrics(url('period=30d'), req(hdr), d);
    expect(again.headers?.['X-Cache']).toBe('HIT');
    expect(d.compute).toHaveBeenCalledTimes(1);
    await handleAffiliateMetrics(url('period=mtd'), req(hdr), d);
    await handleAffiliateMetrics(url('period=custom&from=2026-09-01&to=2026-09-12'), req(hdr), d);
    expect(d.compute).toHaveBeenCalledTimes(3);
    const custom = d.compute.mock.calls[2];
    expect(custom[0].toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(custom[1].toISOString()).toBe('2026-09-13T02:59:59.999Z');
  });

  it('cache expira pelo TTL e limpa com clear()', async () => {
    const cache = createMetricsCache(1);
    const d = deps({ cache });
    await handleAffiliateMetrics(url('period=7d'), req(hdr), d);
    await new Promise((res) => setTimeout(res, 5));
    await handleAffiliateMetrics(url('period=7d'), req(hdr), d);
    expect(d.compute).toHaveBeenCalledTimes(2);
    const d2 = deps();
    await handleAffiliateMetrics(url('period=7d'), req(hdr), d2);
    d2.cache.clear();
    await handleAffiliateMetrics(url('period=7d'), req(hdr), d2);
    expect(d2.compute).toHaveBeenCalledTimes(2);
  });

  it('lista vazia é válida (ninguém vendeu)', async () => {
    const d = deps({ compute: vi.fn(async () => []) });
    const r = await handleAffiliateMetrics(url('period=mtd'), req(hdr), d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
});
