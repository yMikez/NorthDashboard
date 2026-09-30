import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverviewResponse, OrdersResponse, AffiliateDetailResponse, ProductsResponse } from './metrics';
import type { ProfitSplitResponse } from './profitSplit';

// Serviços e banco mockados: os testes olham a FIAÇÃO (o que chega no
// serviço e o que volta pro modelo), sem Postgres.
const m = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getAffiliateDetail: vi.fn(),
  getOrders: vi.fn(),
  getPlatforms: vi.fn(),
  getProducts: vi.fn(),
  getProfitSplit: vi.fn(),
  getCallCenterSales: vi.fn(),
  getHealth: vi.fn(),
  refreshDailyMetricsNow: vi.fn(async () => undefined),
  findMany: vi.fn(),
  queryRaw: vi.fn(),
  normalizeScope: vi.fn(async (_tool: string, input: Record<string, unknown>) => ({ input, notes: [] as string[] })),
  dataQualityFor: vi.fn(async (_tool: string, _platforms?: string[]): Promise<Array<{ platform?: string; issue: string; effect: string }>> => []),
}));

vi.mock('./metrics', async (orig) => ({
  ...(await orig<typeof import('./metrics')>()),
  getOverview: m.getOverview,
  getAffiliateDetail: m.getAffiliateDetail,
  getOrders: m.getOrders,
  getPlatforms: m.getPlatforms,
  getProducts: m.getProducts,
}));
vi.mock('./dailyMetrics', async (orig) => ({ ...(await orig<typeof import('./dailyMetrics')>()), refreshDailyMetricsNow: m.refreshDailyMetricsNow }));
vi.mock('./profitSplit', () => ({ getProfitSplit: m.getProfitSplit }));
vi.mock('./callCenterSales', async (orig) => ({ ...(await orig<typeof import('./callCenterSales')>()), getCallCenterSales: m.getCallCenterSales }));
vi.mock('./health', () => ({ getHealth: m.getHealth }));
vi.mock('../db', () => ({ db: { affiliate: { findMany: m.findMany }, $queryRaw: m.queryRaw } }));
vi.mock('../ai/normalizeScope', () => ({ normalizeScope: m.normalizeScope }));
vi.mock('../ai/coverage', () => ({ dataQualityFor: m.dataQualityFor }));

import {
  TOOLS,
  TERMINAL_TOOL,
  HANDLED_TOOL_NAMES,
  TOOL_TIMEOUT_MS,
  parseFilters,
  parseBrtStart,
  parseBrtEnd,
  uiRangeContext,
  fitToolResult,
  executeTool,
} from './aiTools';
import { fitToolResult as fitV2 } from '../ai/fit';

type R = Record<string, unknown> & { _meta?: Record<string, unknown> };
const schemaOf = (name: string) => TOOLS.find((t) => t.name === name)!.input_schema as {
  properties: Record<string, { enum?: string[]; description?: string; items?: unknown }>;
  required?: string[];
};

// 2026-09-30 14:05 BRT.
const NOW = new Date('2026-09-30T17:05:00.000Z');

const KPIS = {
  gross: 1000, grossOriginal: 1100, net: 700, cpa: 200, netProfit: 500, approvalRate: 0.9, refundRate: 0.05, cbRate: 0.01,
  aov: 100, approvedCount: 9, totalCount: 10, orderGroups: 10, epo: 70, cogs: 50, fulfillment: 40, estimatedProfit: 610, estimatedMarginPct: 61,
};

function overviewFixture(withPrevious = false): OverviewResponse {
  return {
    range: { start: '2026-09-01T03:00:00.000Z', end: '2026-10-01T02:59:59.999Z' },
    kpis: { ...KPIS },
    ...(withPrevious ? { previous: { ...KPIS, gross: 800, netProfit: 400, refundRate: 0.04 } } : {}),
    daily: [],
    byCountry: [],
    byProductType: [],
    topAffiliates: [],
    platformHealth: [],
    hourlyHeatmap: [{ dow: 1, hour: 10, orders: 2, gross: 90 }],
  };
}

const SPLIT: ProfitSplitResponse = {
  range: { start: '', end: '' },
  opexPct: 10,
  front: { grossUsd: 950, cpaUsd: 200, orders: 9, profitUsd: 432.1, refundCbUsd: 90 },
  back: { sources: [], profitUsd: 10 },
  totalUsd: 442.1,
  refunds: { salesCount: 10, refundedCount: 1, chargebackCount: 0, pct: 10, grossUsd: 1000, refundedUsd: 85, valuePct: 8.5 },
  refunds7d: { salesCount: 50, refundedCount: 3, chargebackCount: 0, pct: 6, grossUsd: 5000, refundedUsd: 300, valuePct: 6 },
};

function ordersFixture(n: number): OrdersResponse {
  return {
    orders: Array.from({ length: n }, (_, i) => ({
      externalId: `o${i}`, parentExternalId: null, platformSlug: 'clickbank', productExternalId: 'NMP', productName: 'NeuroMind FE',
      productType: 'FRONTEND', affiliateExternalId: 'aff', affiliateNickname: 'nitro', mappedAffiliateId: null, mappedAffiliateName: null,
      mappedAffiliateStatus: null, country: 'US', paymentMethod: 'card', grossAmountUsd: 49, fees: 5, netAmountUsd: 20, cpaPaidUsd: 24,
      status: 'APPROVED', orderedAt: '2026-09-30T02:30:00.000Z', eventAt: '2026-09-30T02:30:00.000Z',
    })),
    statusCounts: { all: n }, typeCounts: { all: n }, total: n, limit: 1000, offset: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getProfitSplit.mockResolvedValue(SPLIT);
  m.normalizeScope.mockImplementation(async (_tool: string, input: Record<string, unknown>) => ({ input, notes: [] }));
  m.dataQualityFor.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TOOLS — catálogo', () => {
  it('nomes únicos e TODA tool tem handler (e vice-versa)', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(HANDLED_TOOL_NAMES, `sem handler: ${n}`).toContain(n);
    for (const n of HANDLED_TOOL_NAMES) expect(names, `handler órfão: ${n}`).toContain(n);
    expect(names).toContain(TERMINAL_TOOL);
  });

  it('ordem estável: as tools CORE vêm primeiro, na ordem de sempre (prefixo cacheado)', () => {
    expect(TOOLS.slice(0, 21).map((t) => t.name)).toEqual([
      'get_overview', 'get_affiliates', 'get_affiliate_detail', 'get_affiliate_analysis', 'get_affiliate_explain',
      'get_affiliate_sequence', 'get_funnel', 'get_funnel_sequence', 'get_products', 'get_families', 'get_platforms',
      'get_orders', 'get_profit_split', 'get_costs_overview', 'get_fulfillment', 'get_refund_cohorts', 'get_call_center',
      'get_recovery', 'get_sms', 'get_health', 'respond_with_blocks',
    ]);
  });

  it('affiliate_ids SÓ nas tools cujo serviço filtra tudo por afiliado (auditado) — nas outras a IA diria filtrado sem estar', () => {
    const core = TOOLS.slice(0, 21);
    const withAff = core.filter((t) => 'affiliate_ids' in ((t.input_schema as { properties?: object }).properties ?? {})).map((t) => t.name).sort();
    expect(withAff).toEqual([
      'get_affiliate_detail', 'get_affiliates', 'get_costs_overview', 'get_families', 'get_fulfillment', 'get_funnel',
      'get_funnel_sequence', 'get_orders', 'get_overview', 'get_platforms', 'get_products', 'get_profit_split', 'get_refund_cohorts',
    ]);
  });

  it('datas NÃO são obrigatórias (default = período da UI)', () => {
    for (const t of TOOLS) {
      const req = (t.input_schema as { required?: string[] }).required ?? [];
      expect(req, t.name).not.toContain('start_date');
    }
  });

  it('call center seleciona SalesBound (enum gerado dos PROVIDERS)', () => {
    expect(schemaOf('get_call_center').properties.provider.enum).toEqual(['all', 'tauk', 'logicall', 'salesbound']);
  });

  it('get_orders expõe search; get_products expõe include_urls', () => {
    expect(schemaOf('get_orders').properties.search).toBeDefined();
    expect(schemaOf('get_products').properties.include_urls).toBeDefined();
  });

  it('respond_with_blocks: scope obrigatório, sources opcional, percent = pontos percentuais e fraction = 0–1', () => {
    const s = schemaOf(TERMINAL_TOOL);
    expect(s.required).toEqual(['blocks', 'scope']);
    expect(s.properties.sources).toMatchObject({ type: 'array' });
    const cols = (s.properties.blocks.items as { properties: { columns: { items: { properties: { format: { enum: string[]; description: string } } } } } }).properties.columns;
    expect(cols.items.properties.format.enum).toEqual(['currency', 'percent', 'fraction', 'number', 'text']);
    expect(cols.items.properties.format.description).toMatch(/pontos percentuais/);
  });

  it('descrições sem as definições velhas (lucro estimado como card, CPA pelo valor mais frequente, SalesBound ausente)', () => {
    const d = (n: string) => TOOLS.find((t) => t.name === n)!.description!;
    expect(d('get_overview')).toMatch(/screenCards/);
    expect(d('get_overview')).toMatch(/NÃO é o card/);
    expect(d('get_affiliates')).toMatch(/ÚLTIMO cpaPaidUsd/);
    expect(d('get_affiliates')).toMatch(/reserva%/);
    expect(d('get_affiliates')).not.toMatch(/mais frequente/);
    expect(d('get_profit_split')).toMatch(/SalesBound NÃO entra no BACK/);
    expect(d('get_call_center')).toMatch(/SalesBound/);
    expect(d('get_costs_overview')).toMatch(/dia UTC/);
  });

  it('fitToolResult exportado daqui é a v2 (o motor importa deste arquivo)', () => {
    expect(fitToolResult).toBe(fitV2);
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
    const ctx = uiRangeContext('2026-08-23T03:00:00.000Z', '2026-08-24T02:59:59.999Z', '2026-08-23', '2026-08-24');
    expect(ctx.defaultStart?.toISOString()).toBe('2026-08-23T03:00:00.000Z');
    expect(ctx.defaultEnd?.toISOString()).toBe('2026-08-24T02:59:59.999Z');
  });

  it('só start_date → até agora; só end_date → início da UI se couber, senão 30 dias BRT antes', () => {
    const ui = { ...uiRangeContext(undefined, undefined, '2026-07-01', '2026-07-31'), now: NOW };
    const a = parseFilters({ start_date: '2026-08-10' }, ui);
    expect(a.startDate.toISOString()).toBe('2026-08-10T03:00:00.000Z');
    expect(a.endDate).toEqual(NOW);
    const b = parseFilters({ end_date: '2026-07-15' }, ui);
    expect(b.startDate).toEqual(ui.defaultStart);
    const c = parseFilters({ end_date: '2026-06-15' }, ui);
    expect(c.startDate).toEqual(parseBrtStart('2026-05-17'));
    expect(c.endDate).toEqual(parseBrtEnd('2026-06-15'));
  });

  it('sem datas e sem UI → 30 dias BRT alinhados (29 fechados + hoje até agora)', () => {
    const f = parseFilters({}, { now: NOW });
    expect(f.startDate).toEqual(parseBrtStart('2026-09-01'));
    expect(f.endDate).toEqual(NOW);
  });

  it('stages aceita FE/Front/UPSELL e mapeia pro enum; filtros vazios viram undefined', () => {
    const f = parseFilters({ stages: ['FE', 'Upsell', 'lixo'], platforms: [], products: ['NSNMP6'] });
    expect(f.productTypes).toEqual(['FRONTEND', 'UPSELL']);
    expect(f.platformSlugs).toBeUndefined();
    expect(f.productExternalIds).toEqual(['NSNMP6']);
  });

  it('affiliate_ids vira mappedAffiliateIds, com a mesma higiene das rotas (sem lixo, sem duplicado)', () => {
    const f = parseFilters({ affiliate_ids: ['cm1abc', 'cm1abc', 'x; drop', ' cm2xyz '] });
    expect(f.mappedAffiliateIds).toEqual(['cm1abc', 'cm2xyz']);
    expect(parseFilters({ affiliate_ids: [] }).mappedAffiliateIds).toBeUndefined();
    expect(parseFilters({}).mappedAffiliateIds).toBeUndefined();
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

describe('executeTool — forma única de erro', () => {
  it('tool desconhecida', async () => {
    expect(await executeTool('get_nada', {})).toEqual({ error: 'unknown_tool', message: 'tool desconhecida: get_nada', retryable: false, hint: 'Use só as tools da lista.' });
  });

  it('input inválido (data, id obrigatório, window) → invalid_input, nunca exceção', async () => {
    expect(await executeTool('get_orders', { start_date: 'ontem' })).toMatchObject({ error: 'invalid_input', message: expect.stringMatching(/start_date/), retryable: false });
    expect(await executeTool('get_affiliate_detail', {})).toMatchObject({ error: 'invalid_input', message: 'external_id obrigatório', retryable: false });
    expect(await executeTool('get_affiliate_analysis', { window: 500 })).toMatchObject({ error: 'invalid_input', message: expect.stringMatching(/window/) });
  });

  it('filtro desconhecido do normalizeScope → invalid_input com os valores válidos; o serviço nem é chamado', async () => {
    m.normalizeScope.mockRejectedValueOnce(Object.assign(new Error('invalid_input: plataforma "digistor" desconhecida'), { validValues: ['clickbank', 'digistore24'] }));
    const r = await executeTool('get_platforms', { platforms: ['digistor'] });
    expect(r).toMatchObject({ error: 'invalid_input', message: 'plataforma "digistor" desconhecida', retryable: false, validValues: ['clickbank', 'digistore24'] });
    expect(m.getPlatforms).not.toHaveBeenCalled();
  });

  it('erro do Prisma → query_failed genérico (mensagem crua fica no log)', async () => {
    m.getPlatforms.mockRejectedValueOnce(Object.assign(new Error('Raw query failed: column "x" does not exist'), { name: 'PrismaClientKnownRequestError', code: 'P2010', clientVersion: '5.22.0' }));
    const r = await executeTool('get_platforms', {});
    expect(r).toEqual({ error: 'query_failed', message: 'A consulta ao banco falhou.', retryable: false, hint: expect.any(String) });
  });

  it('timeout → retryable com dica de estreitar o período', async () => {
    vi.useFakeTimers();
    m.getHealth.mockReturnValueOnce(new Promise(() => undefined));
    const p = executeTool('get_health', {});
    await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS + 10);
    expect(await p).toMatchObject({ error: 'timeout', retryable: true, hint: expect.stringMatching(/Estreite o período/) });
  });
});

describe('executeTool — _meta', () => {
  it('normalizeScope roda antes do handler; o input corrigido chega ao serviço e as notas vão pro _meta', async () => {
    m.normalizeScope.mockResolvedValueOnce({ input: { platforms: ['digistore24'] }, notes: ['"d24" → digistore24'] });
    m.getPlatforms.mockResolvedValueOnce({ platforms: [{ slug: 'digistore24', allOrders: 5, refundRate: 0.07, observedRefundCbPct: 10.45 }] });
    const r = (await executeTool('get_platforms', { platforms: ['d24'] }, { now: NOW })) as R;
    expect(m.normalizeScope).toHaveBeenCalledWith('get_platforms', { platforms: ['d24'] });
    expect(m.getPlatforms.mock.calls[0][0].platformSlugs).toEqual(['digistore24']);
    expect(r._meta).toMatchObject({
      filtersApplied: { platforms: ['digistore24'] },
      units: { refundRate: 'fraction', observedRefundCbPct: 'pp' },
      notes: ['"d24" → digistore24'],
    });
    expect(Object.keys(r)[0]).toBe('_meta');
  });

  it('range em BRT com hoje parcial (período da UI)', async () => {
    m.getPlatforms.mockResolvedValueOnce({ platforms: [{ slug: 'clickbank', allOrders: 3 }] });
    const ctx = { ...uiRangeContext(undefined, undefined, '2026-09-24', '2026-09-30'), now: NOW };
    const r = (await executeTool('get_platforms', {}, ctx)) as R;
    expect(r._meta!.range).toEqual({
      startBrt: '2026-09-24 00:00', endBrt: '2026-09-30 14:05', days: 7, closedDays: 6,
      includesToday: true, partialToday: true, hoursElapsedToday: 14.1, source: 'ui',
    });
  });

  it('dataQuality vem do coverage (que decide a relevância por tool), com as plataformas do escopo', async () => {
    m.dataQualityFor.mockImplementation(async (tool: string) => (tool === 'get_platforms' ? [{ platform: 'buygoods', issue: 'refund_silent', effect: 'taxa subestimada' }] : []));
    m.getPlatforms.mockResolvedValueOnce({ platforms: [{ slug: 'buygoods', allOrders: 3 }] });
    const r = (await executeTool('get_platforms', { platforms: ['buygoods'] }, { now: NOW })) as R;
    expect(m.dataQualityFor).toHaveBeenCalledWith('get_platforms', ['buygoods']);
    expect(r._meta!.dataQuality).toEqual([{ platform: 'buygoods', issue: 'refund_silent', effect: 'taxa subestimada' }]);
    m.getHealth.mockResolvedValueOnce({ ingestion: { perPlatform: [] } });
    const h = (await executeTool('get_health', {}, { now: NOW })) as R;
    expect(m.dataQualityFor).toHaveBeenLastCalledWith('get_health', undefined);
    expect(h._meta).toBeUndefined();
  });

  it('resultado vazio COM filtro → emptyWithFilters', async () => {
    m.getOrders.mockResolvedValueOnce(ordersFixture(0));
    const r = (await executeTool('get_orders', { platforms: ['cartpanda'] }, { now: NOW })) as R;
    expect(r._meta!.emptyWithFilters).toBe(true);
    m.getOrders.mockResolvedValueOnce(ordersFixture(0));
    const r2 = (await executeTool('get_orders', {}, { now: NOW })) as R;
    expect(r2._meta!.emptyWithFilters).toBeUndefined();
  });
});

describe('handlers — fiação com os serviços', () => {
  it('get_orders: status em minúsculo (eixo do estorno), search repassado, horário BRT por linha', async () => {
    m.getOrders.mockResolvedValueOnce(ordersFixture(2));
    const r = (await executeTool('get_orders', { status: 'REFUNDED', search: ' abc123 ', limit: 50 }, { now: NOW })) as R & { orders: Array<Record<string, unknown>>; page: unknown };
    expect(m.getOrders.mock.calls[0][1]).toEqual({ status: 'refunded', limit: 50, offset: 0, search: 'abc123' });
    expect(r.orders[0]).toMatchObject({ orderedAt: '2026-09-30T02:30:00.000Z', orderedAtBrt: '2026-09-29 23:30', eventAtBrt: '2026-09-29 23:30' });
    expect(r.page).toEqual({ limit: 50, offset: 0, returned: 2, total: 2, hasMore: false });
  });

  it('get_orders grande: o fit usa a política da tool (etiqueta) e manda paginar', async () => {
    m.getOrders.mockResolvedValueOnce(ordersFixture(1000));
    const r = await executeTool('get_orders', { limit: 1000 }, { now: NOW });
    const parsed = JSON.parse(fitToolResult({ _ref: 'r1', ...(r as object) }, 40_000));
    expect(parsed._hint).toMatch(/offset/);
    expect(parsed.orders[0].externalId).toBe('o0');
  });

  it('get_overview: sem netProfit (CPA 2×), screenCards da tela, heatmap rotulado', async () => {
    m.getOverview.mockResolvedValueOnce(overviewFixture());
    const r = (await executeTool('get_overview', { start_date: '2026-09-01', end_date: '2026-09-29' }, { now: NOW })) as R & {
      kpis: Record<string, unknown>; screenCards: Array<{ card: string; value: number }>; hourlyHeatmap: Array<{ dowLabel: string }>;
    };
    expect(m.refreshDailyMetricsNow).toHaveBeenCalled();
    expect('netProfit' in r.kpis).toBe(false);
    expect(r.screenCards.find((c) => c.card === 'Taxa de reembolso')!.value).toBe(8.5);
    expect(r.screenCards.find((c) => c.card === 'Net after CPA (modelo)')!.value).toBe(432.1);
    expect(r.hourlyHeatmap[0].dowLabel).toBe('seg');
    expect(m.getProfitSplit.mock.calls[0][0]).toMatchObject({ startDate: parseBrtStart('2026-09-01'), endDate: parseBrtEnd('2026-09-29') });
    expect(r.previous).toBeUndefined();
  });

  it('get_overview compare com janela FECHADA: anterior do serviço + deltas prontos', async () => {
    m.getOverview.mockResolvedValueOnce(overviewFixture(true));
    const r = (await executeTool('get_overview', { start_date: '2026-09-22', end_date: '2026-09-28', compare: true }, { now: NOW })) as R & {
      previous: Record<string, unknown>; deltas: Record<string, { abs: number; pct: number | null; pp?: number }>;
    };
    expect(m.getOverview.mock.calls[0][1]).toBe(true);
    expect('netProfit' in r.previous).toBe(false);
    expect(r.deltas.gross).toMatchObject({ abs: 200, pct: 0.25 });
    expect(r.deltas.refundRate).toMatchObject({ abs: 0.01, pp: 1 });
    expect(r._meta).toMatchObject({ previousRange: { startBrt: '2026-09-15 00:00', endBrt: '2026-09-21 23:59' } });
    expect(r._meta!.aligned).toBeUndefined();
  });

  it('get_overview compare com HOJE PARCIAL: anterior cortado no mesmo horário (agregação por instante)', async () => {
    m.getOverview.mockResolvedValueOnce(overviewFixture());
    m.queryRaw
      .mockResolvedValueOnce([{ total_count: 8n, approved_count: 7n, refunded_count: 1n, chargeback_count: 0n, gross: 800, gross_original: 850, net: 560, cpa: 150, cogs: 40, fulfillment: 30 }])
      .mockResolvedValueOnce([{ sessions: 8n, revenue: 790, net: 550 }]);
    const ctx = { ...uiRangeContext(undefined, undefined, '2026-09-30', '2026-09-30'), now: NOW };
    const r = (await executeTool('get_overview', { compare: true }, ctx)) as R & { previous: Record<string, number>; deltas: Record<string, { abs: number }> };
    expect(m.getOverview.mock.calls[0][1]).toBe(false); // o anterior de dia inteiro do serviço não serve
    expect(m.queryRaw).toHaveBeenCalledTimes(2);
    expect(r.previous).toMatchObject({ gross: 800, totalCount: 8, refundRate: 0.125, aov: 98.75 });
    expect(r.deltas.gross.abs).toBe(200);
    expect(r._meta).toMatchObject({ aligned: true, previousRange: { startBrt: '2026-09-29 00:00', endBrt: '2026-09-29 14:05' } });
    expect((r._meta!.range as { partialToday: boolean }).partialToday).toBe(true);
  });

  it('get_overview alinhado com filtro de afiliado: o anterior vem do próprio serviço (caminho por instante)', async () => {
    m.getOverview.mockResolvedValueOnce(overviewFixture()).mockResolvedValueOnce(overviewFixture());
    const ctx = { ...uiRangeContext(undefined, undefined, '2026-09-30', '2026-09-30'), now: NOW };
    await executeTool('get_overview', { compare: true, affiliate_ids: ['cm1abc'] }, ctx);
    expect(m.refreshDailyMetricsNow).not.toHaveBeenCalled();
    expect(m.queryRaw).not.toHaveBeenCalled();
    const prevCall = m.getOverview.mock.calls.find((c) => c[0].endDate.toISOString() === '2026-09-29T17:05:00.000Z');
    expect(prevCall![0]).toMatchObject({ startDate: parseBrtStart('2026-09-29'), mappedAffiliateIds: ['cm1abc'] });
  });

  it('get_call_center: salesbound chega ao serviço (antes virava "all")', async () => {
    m.getCallCenterSales.mockResolvedValue({ totals: { sales: 1, commissionPct: 0.3 } });
    await executeTool('get_call_center', { provider: 'salesbound' }, { now: NOW });
    expect(m.getCallCenterSales.mock.calls[0][0].provider).toBe('salesbound');
    await executeTool('get_call_center', { provider: 'qualquer' }, { now: NOW });
    expect(m.getCallCenterSales.mock.calls[1][0].provider).toBe('all');
  });

  it('get_affiliate_detail: várias contas com o mesmo nick → usa a mais recente e devolve alternatives', async () => {
    m.findMany.mockResolvedValueOnce([
      { externalId: 'NITRO', nickname: 'nitrocompany', lastOrderAt: new Date('2026-09-29T10:00:00Z'), platform: { slug: 'digistore24' } },
      { externalId: 'nitro01', nickname: 'nitrocompany', lastOrderAt: new Date('2026-08-01T10:00:00Z'), platform: { slug: 'clickbank' } },
    ]);
    const detail = { affiliate: { externalId: 'NITRO', platformSlug: 'digistore24' }, kpis: { revenue: 10 } } as unknown as AffiliateDetailResponse;
    m.getAffiliateDetail.mockResolvedValueOnce(detail);
    const r = (await executeTool('get_affiliate_detail', { external_id: 'nitrocompany' }, { now: NOW })) as R & { alternatives: unknown[] };
    expect(m.getAffiliateDetail.mock.calls[0][0]).toBe('NITRO');
    expect(m.getAffiliateDetail.mock.calls[0][2]).toBe('digistore24');
    expect(r.alternatives).toEqual([{ externalId: 'nitro01', nickname: 'nitrocompany', platform: 'clickbank', lastOrderAt: '2026-08-01T10:00:00.000Z' }]);
    expect((r._meta!.notes as string[])[0]).toMatch(/2 contas/);
  });

  it('get_affiliate_detail: conta inexistente → not_found com dica', async () => {
    m.findMany.mockResolvedValueOnce([]);
    m.getAffiliateDetail.mockResolvedValueOnce(null);
    expect(await executeTool('get_affiliate_detail', { external_id: 'fantasma' }, { now: NOW })).toMatchObject({ error: 'not_found', retryable: false, hint: expect.stringMatching(/resolve_entities/) });
  });

  it('get_products: URLs fora por padrão, taxas por SKU sobre realOrders', async () => {
    const product = {
      externalId: 'GP-FE', name: 'GP', productType: 'FRONTEND', family: 'GlycoPulse', variant: null, bottles: 6, catalogPriceUsd: 294,
      salesPageUrl: 'https://s', checkoutUrl: 'https://c', thanksPageUrl: null, driveUrl: null, catalogStatus: null, platformSlug: 'digistore24',
      vendorAccount: null, revenue: 1, orders: 1, allOrders: 110, refunds: 8, chargebacks: 2, net: 1, cpa: 1, cogs: 1, fulfillment: 1,
      estimatedProfit: 1, estimatedMarginPct: 1, attributedSessions: 0, attributedOrders: 0, attributedRevenue: 0, attributedNet: 0,
      attributedCpa: 0, attributedCogs: 0, attributedFulfillment: 0, attributedProfit: 0, attributedMarginPct: 0, approvalRate: 0.9,
      firstSoldAt: null, lastSoldAt: null,
    };
    m.getProducts.mockResolvedValue({ byType: [], products: [product] } satisfies ProductsResponse);
    const r = (await executeTool('get_products', {}, { now: NOW })) as R & { products: Array<Record<string, unknown>> };
    expect(r.products[0]).toMatchObject({ realOrders: 100, refundRate: 0.08, cbRate: 0.02 });
    expect('salesPageUrl' in r.products[0]).toBe(false);
    expect(r._meta!.units).toMatchObject({ refundRate: 'fraction', cbRate: 'fraction' });
    const withUrls = (await executeTool('get_products', { include_urls: true }, { now: NOW })) as R & { products: Array<Record<string, unknown>> };
    expect(withUrls.products[0].salesPageUrl).toBe('https://s');
  });
});
