/* global window */
/* Frontend API client. Wraps calls to /api/metrics/* endpoints. */

const API_BASE = '';

function toISODate(d) {
  // start_date / end_date expected as ISO 8601 (we include time)
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function setToCSV(set) {
  if (!set || set.size === 0) return null;
  return Array.from(set).join(',');
}

// Cache client-side de GETs + dedup de requests em voo. Navegar entre abas
// e voltar (mesmo filtro) vira resposta instantânea; duas páginas pedindo a
// mesma URL ao mesmo tempo compartilham 1 request. TTL curto (15s) porque
// empilha com o cache server-side de 30s — pior caso de staleness ~45s.
// structuredClone no retorno é obrigatório: páginas mutam o payload; uma
// referência compartilhada causaria bugs cruzados entre páginas.
const _respCache = new Map(); // url -> { ts, promise }
const _RESP_TTL_MS = 15_000;
const _clone = typeof structuredClone === 'function'
  ? structuredClone
  : (v) => JSON.parse(JSON.stringify(v));

async function fetchJSON(path, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    qs.set(k, v);
  }
  const url = `${API_BASE}${path}?${qs.toString()}`;

  const hit = _respCache.get(url);
  if (hit && Date.now() - hit.ts < _RESP_TTL_MS) {
    return _clone(await hit.promise);
  }

  const promise = (async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} ${path}: ${body}`);
    }
    return res.json();
  })();

  if (_respCache.size > 200) _respCache.clear();
  _respCache.set(url, { ts: Date.now(), promise });
  try {
    return _clone(await promise);
  } catch (e) {
    _respCache.delete(url); // erro não fica cacheado
    throw e;
  }
}

/**
 * Fetch /api/metrics/overview.
 *
 * filters: { dateRange: {start: Date, end: Date}, platforms: Set, countries: Set, funnels: Set, compare: bool }
 *
 * Returns the raw response shape from OverviewResponse — kpis, daily, byCountry,
 * byProductType, topAffiliates, platformHealth, optional previous.
 */
async function fetchOverview(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
    compare: filters.compare ? '1' : null,
  };
  return fetchJSON('/api/metrics/overview', params);
}

/**
 * Fetch /api/metrics/orders.
 *
 * filters: shared dashboard filters.
 * options: { status, search, limit, offset }.
 *
 * Response: { orders, statusCounts, total, limit, offset }.
 */
// URL do download CSV das transações (mesmos filtros do fetchOrders, sem
// paginação — o servidor exporta TODAS as linhas do filtro). Navegação
// direta (href) em vez de fetch: o browser cuida do download e a sessão
// vai no cookie.
function ordersExportUrl(filters, options = {}) {
  const qs = new URLSearchParams();
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
    status: options.status && options.status !== 'all' ? options.status : null,
    product_type: options.productType && options.productType !== 'all' ? options.productType : null,
    search: options.search || null,
  };
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') qs.set(k, v);
  }
  return `/api/metrics/orders-export?${qs}`;
}

async function fetchOrders(filters, options = {}) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
    status: options.status && options.status !== 'all' ? options.status : null,
    product_type: options.productType && options.productType !== 'all' ? options.productType : null,
    search: options.search || null,
    limit: options.limit != null ? String(options.limit) : null,
    offset: options.offset != null ? String(options.offset) : null,
  };
  return fetchJSON('/api/metrics/orders', params);
}

/**
 * Fetch /api/metrics/affiliates.
 *
 * Returns { summary, affiliates } — serves both Leaderboard and AllAffiliates
 * pages. `affiliates` includes every affiliate known to the platform, with
 * zero-valued period aggregates when no orders fall in the range. UI decides
 * whether to filter by minOrders or show all.
 */
async function fetchRefundCohorts(filters, horizon) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    families: setToCSV(filters.families),
    products: setToCSV(filters.funnels),
    stages: setToCSV(filters.stages),
    horizon: String(horizon || 30),
  };
  return fetchJSON('/api/metrics/refund-cohorts', params);
}

async function fetchAffiliates(filters, { unify = false } = {}) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
    // unify=1: contas do mesmo parceiro viram uma linha (com `accounts`).
    unify: unify ? '1' : null,
  };
  return fetchJSON('/api/metrics/affiliates', params);
}

/**
 * Fetch /api/metrics/platforms.
 *
 * Returns { platforms } — per-platform aggregates for the period:
 * revenue, orders, approval/refund/cb rates, affiliate counts, top product.
 */
async function fetchPlatforms(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
  };
  return fetchJSON('/api/metrics/platforms', params);
}

/**
 * Fetch /api/metrics/products.
 *
 * Returns { byType, products } — per-productType summaries (FRONTEND/UPSELL/
 * BUMP/DOWNSELL) + full product list with per-SKU aggregates.
 */
async function fetchProducts(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
  };
  return fetchJSON('/api/metrics/products', params);
}

/**
 * Fetch /api/metrics/affiliates/:externalId — drill-down detail for one affiliate.
 *
 * Returns { affiliate, kpis, ltv, daily, byProduct, byCountry, flags }.
 * 404 if affiliate not found in DB.
 */
async function fetchAffiliateDetail(externalId, filters, platformHint) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
    platform: platformHint || null,
  };
  return fetchJSON(`/api/metrics/affiliates/${encodeURIComponent(externalId)}`, params);
}

/**
 * Fetch /api/metrics/funnel.
 *
 * Returns { stages, summary } — funnel stages FE → Bump → Upsell1 → Upsell2 → Downsell
 * computed from order groups (parentExternalId). Take rates relative to FE count.
 */
async function fetchFunnel(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
  };
  return fetchJSON('/api/metrics/funnel', params);
}

/**
 * Fetch /api/metrics/filters — universe of options for the FilterBar pickers
 * (real platforms, FE products, families, and countries derived from the catalog).
 */
async function fetchFilterOptions() {
  return fetchJSON('/api/metrics/filters', {});
}

/**
 * Fetch /api/metrics/families — per-ProductFamily aggregates for the
 * FamilyGrid page. Returns catalog SKU counts + period metrics per family.
 */
async function fetchFamilies(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
  };
  return fetchJSON('/api/metrics/families', params);
}

/**
 * Fetch /api/metrics/page-states — último estado de página (Black/White)
 * reportado por cada (plataforma, produto). Sem filtros (é "agora").
 */
async function fetchPageStates() {
  return fetchJSON('/api/metrics/page-states', {});
}

/**
 * Fetch /api/metrics/health — operational signals about ingestion freshness,
 * approval/refund rates, and catalog classification coverage. No filters
 * apply (it's "right now" data).
 */
async function fetchHealth() {
  return fetchJSON('/api/metrics/health', {});
}

/**
 * Fetch /api/metrics/orders/:externalId — full detail for one order.
 * Returns order + product + affiliate + customer + session siblings,
 * plus computed financial breakdown (platform retention, company kept).
 */
async function fetchOrderDetail(externalId, platformSlug) {
  const params = platformSlug ? { platform: platformSlug } : {};
  return fetchJSON(`/api/metrics/orders/${encodeURIComponent(externalId)}`, params);
}

/**
 * Fetch current cost tables (read-only). For editing call adminSaveCosts()
 * with the bearer token.
 */
async function fetchCosts() {
  return fetchJSON('/api/metrics/costs', {});
}

/**
 * Fetch /api/metrics/costs-overview — dashboard agregado de custos & margem.
 *
 * Retorna kpis (gross, profit, margem, fulfillment/cogs/fees/cpa), série diária,
 * breakdown por plataforma e família, e snapshot de allowance (rolling 60d).
 */
async function fetchCostsOverview(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
  };
  return fetchJSON('/api/metrics/costs-overview', params);
}

/**
 * Fetch /api/metrics/fulfillment-overview — distribuição APPROVED orders
 * entre RedRock e ShipOffers. Resolve supplier on-the-fly (Product override
 * → família default → 'shipoffers'). Respeita filtros globais.
 */
// Aba Fulfillment reformulada: enviado/gasto/mix/projeções num payload só.
async function fetchFulfillment(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    families: setToCSV(filters.families),
  };
  return fetchJSON('/api/metrics/fulfillment', params);
}

// Saúde do custo (sem filtros de dimensão de propósito — problemas de
// cadastro não podem ser escondidos por filtro).
async function fetchFulfillmentHealth(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
  };
  return fetchJSON('/api/metrics/fulfillment-health', params);
}

async function fetchFulfillmentOverview(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    stages: setToCSV(filters.stages),
  };
  return fetchJSON('/api/metrics/fulfillment-overview', params);
}

/**
 * Admin: GET /api/admin/product-suppliers. Lista Products com supplier
 * resolvido (override → família default → fallback). Token bearer.
 * Opcional: { platform, family, search } pra filtrar.
 */
async function adminListProductSuppliers(token, opts = {}) {
  const qs = new URLSearchParams();
  if (opts.platform) qs.set('platform', opts.platform);
  if (opts.family) qs.set('family', opts.family);
  if (opts.search) qs.set('search', opts.search);
  const url = `/api/admin/product-suppliers${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

/**
 * Admin: PATCH /api/admin/product-suppliers. Bulk update do supplier
 * por Product. updates: [{ productId, supplier: 'redrock'|'shipoffers'|null }].
 * null = remove override e herda do default da família.
 */
async function adminUpdateProductSuppliers(token, updates) {
  const res = await fetch('/api/admin/product-suppliers', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

async function adminListUsers(opts = {}) {
  const search = new URLSearchParams();
  if (opts.page) search.set('page', String(opts.page));
  if (opts.pageSize) search.set('pageSize', String(opts.pageSize));
  if (opts.q) search.set('q', opts.q);
  const qs = search.toString();
  const res = await fetch('/api/admin/users' + (qs ? `?${qs}` : ''), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} listUsers`);
  return res.json();
}

async function adminCreateUser(body) {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminPatchUser(id, body) {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminResetUserPassword(id, password) {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminDeleteUser(id) {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminSaveCosts(token, body) {
  const res = await fetch('/api/admin/costs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

// Dispara o backfill em BACKGROUND. Retorna { started, running, startedAt }
// imediatamente (202) — não espera o job terminar (evita timeout HTTP).
async function adminBackfillCogs(token) {
  const res = await fetch('/api/admin/backfill-cogs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

// Status do job de backfill (polling). { running, startedAt, finishedAt,
// result, error }.
async function adminBackfillStatus(token) {
  const res = await fetch('/api/admin/backfill-cogs', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

// Classifica produtos não-reconhecidos pelo regex via IA (Claude).
// dryRun=true retorna propostas sem gravar; false aplica + recalcula COGS.
async function adminClassifyAi(token, { dryRun = false } = {}) {
  const res = await fetch('/api/admin/classify-ai', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ dryRun }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${txt}`);
  }
  return res.json();
}

/* -------- AI Chat -------- */

async function aiListConversations() {
  const res = await fetch('/api/chat/conversations', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function aiGetConversation(id) {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function aiDeleteConversation(id) {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/**
 * Envia message ao /api/chat e consome o SSE stream. Callbacks:
 *   onToken({text})       — chunk de texto da resposta
 *   onToolUse({name})     — tool sendo executada (UI mostra "consultando X...")
 *   onConversation({id})  — id da conversa (importante quando é nova)
 *   onDone()              — finalizou
 *   onError({message})    — erro
 */
async function aiSendMessage({ conversationId, message }, callbacks) {
  // Estado da UI (aba + filtros ativos) vai junto — o backend injeta no
  // system pro modelo entender "por que caiu aqui?" / "esse período".
  let uiState;
  try { uiState = window.NSUiState || undefined; } catch (e) { uiState = undefined; }
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ conversationId, message, uiState }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // 429 = rate_limited; expor message amigável.
    if (res.status === 429) {
      const err = new Error(data.message || 'Rate limit atingido');
      err.code = 'rate_limited';
      throw err;
    }
    throw new Error(data.error || `${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Fim explícito ('done' ou 'error'). Se o stream fechar sem nenhum dos
  // dois (proxy derrubou, container reiniciou), avisa em vez de sumir em
  // silêncio com a resposta.
  let ended = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE: separate por \n\n.
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      if (!part.trim()) continue;
      const lines = part.split('\n');
      let event = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }
      switch (event) {
        case 'conversation': callbacks.onConversation?.(payload); break;
        case 'token':        callbacks.onToken?.(payload); break;
        case 'tool_use_start': callbacks.onToolUse?.(payload); break;
        case 'tool_use_result': callbacks.onToolUseResult?.(payload); break;
        case 'blocks':       callbacks.onBlocks?.(payload); break;
        case 'truncated':    callbacks.onTruncated?.(payload); break;
        case 'done':         ended = true; callbacks.onDone?.(payload); break;
        case 'error':        ended = true; callbacks.onError?.(payload); break;
      }
    }
  }
  if (!ended) {
    callbacks.onError?.({ message: 'A conexão caiu antes da resposta terminar. Tente de novo.' });
  }
}

async function adminPatchPlatformFees(slug, { feeRatePct, allowancePct, refundCbPct }) {
  const res = await fetch(`/api/admin/platforms/${encodeURIComponent(slug)}/fees`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feeRatePct, allowancePct, refundCbPct }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------- Copy Optimizer (admin, session-cookie auth) ----------
// Endpoints usam requireAdmin() → cookie de sessão (same-origin), sem bearer.

async function fetchCopyRules() {
  const res = await fetch('/api/admin/copy-rules', { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function createCopyRule(body) {
  const res = await fetch('/api/admin/copy-rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function patchCopyRule(id, body) {
  const res = await fetch(`/api/admin/copy-rules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function deleteCopyRule(id) {
  const res = await fetch(`/api/admin/copy-rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function coGet(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
  return res.json();
}
async function coSend(path, method, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
  return res.json();
}

// ---------- Análise de afiliados ----------
// Janelas fixas (3/7/15/30/60 dias terminando hoje) — só plataforma/família
// do filtro global entram; o período global não se aplica.
async function fetchAffiliateAnalysis(filters, { window = 7, view = 'partner', internal = false, today = false } = {}) {
  return fetchJSON('/api/metrics/affiliate-analysis', {
    window: String(window), view, internal: internal ? '1' : '0', today: today ? '1' : '0',
    platforms: setToCSV(filters.platforms), families: setToCSV(filters.families),
  });
}
async function fetchAffiliateExplain(filters, key, { window = 7, internal = false, today = false } = {}) {
  return fetchJSON('/api/metrics/affiliate-analysis/explain', {
    key, window: String(window), internal: internal ? '1' : '0', today: today ? '1' : '0',
    platforms: setToCSV(filters.platforms), families: setToCSV(filters.families),
  });
}
async function adminListAffiliateIdentity() { return coGet('/api/admin/affiliate-identity'); }
async function adminAffiliateIdentity(action, body) { return coSend('/api/admin/affiliate-identity', 'POST', { action, ...(body || {}) }); }

function fetchCopyFunnel(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v !== null && v !== undefined && v !== '') qs.set(k, v); }
  return coGet(`/api/metrics/copy-funnel${qs.toString() ? `?${qs}` : ''}`);
}
function calcCopyAov(body) { return coSend('/api/metrics/copy-aov-calculator', 'POST', body); }
function batchApplyCopyRules(body) { return coSend('/api/admin/copy-rules/batch-apply', 'POST', body); }
function applyCopyRulesToAll(body) { return coSend('/api/admin/copy-rules/apply-all', 'POST', body); }

// ---------- Recuperação ----------
function fetchRecovery(filters) {
  const qs = new URLSearchParams({
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
  });
  return coGet(`/api/metrics/recovery?${qs}`);
}
// Tauk Solutions (recuperação por telefone/SMS) — aba própria.
// Aba Call Center (Tauk + Logicall). Endpoint segue /api/metrics/tauk (id da
// tab preservado). `provider` = 'all' | 'tauk' | 'logicall'.
function fetchTauk(filters, provider = 'all') {
  const qs = new URLSearchParams({
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    provider,
  });
  return coGet(`/api/metrics/tauk?${qs}`);
}
// Logicall: sync manual (admin). Sem datas = janela deslizante default.
async function adminLogicallSync(range) {
  const qs = range ? `?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}` : '';
  const res = await fetch(`/api/admin/logicall-sync${qs}`, { method: 'POST', headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `${res.status} logicallSync`);
  return body;
}
async function adminListIntegrationSettings() {
  const res = await fetch('/api/admin/integration-settings', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} integrationSettings`);
  return res.json();
}
async function adminSaveIntegrationSetting(key, value) {
  const res = await fetch('/api/admin/integration-settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} saveSetting`);
  return body;
}
// SMS health (Mautic → n8n → Twilio) — aba própria. `extra` leva os
// filtros locais da tela: { brand, campaign } (slug da campanha).
function fetchSms(filters, extra = {}) {
  const qs = new URLSearchParams({
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
  });
  if (extra.brand) qs.set('brand', extra.brand);
  if (extra.campaign) qs.set('campaign', extra.campaign);
  return coGet(`/api/metrics/sms?${qs}`);
}
// Monitor de call center (aba Produtos): vendas/dia dos produtos vigiados
// + watchlist admin (adicionar/remover produto do monitoramento).
function fetchCallCenter() { return coGet('/api/metrics/callcenter'); }
// Config do modelo de lucro CPA (opex% + régua do status). Admin.
function fetchProfitConfig() { return coGet('/api/admin/profit-config'); }
function patchProfitConfig(body) { return coSend('/api/admin/profit-config', 'PATCH', body); }
// Lucro FRONT (funil, modelo CPA) × BACK (recuperação/Tauk/SMS...).
// Manda plataforma/família/país junto — o card respeita o filtro da UI
// (com filtro ativo o backend omite a fonte Tauk, que não é atribuível).
function fetchProfitSplit(filters) {
  const qs = new URLSearchParams({
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
  });
  if (filters.platforms?.size) qs.set('platforms', Array.from(filters.platforms).join(','));
  if (filters.families?.size) qs.set('families', Array.from(filters.families).join(','));
  if (filters.countries?.size) qs.set('countries', Array.from(filters.countries).join(','));
  return coGet(`/api/metrics/profit-split?${qs}`);
}
// Override de refund&cb% por afiliado (null = herda da plataforma).
function patchAffiliateRefundOverride(body) { return coSend('/api/admin/affiliates/refund-override', 'PATCH', body); }
function addCallCenterWatch(body) { return coSend('/api/admin/callcenter-watches', 'POST', body); }
function deleteCallCenterWatch(id) {
  return fetch(`/api/admin/callcenter-watches/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Accept: 'application/json' } })
    .then(async (r) => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); } return r.json(); });
}
function fetchRecoveryAffiliates() { return coGet('/api/admin/recovery-affiliates'); }
function addRecoveryAffiliate(body) { return coSend('/api/admin/recovery-affiliates', 'POST', body); }
function deleteRecoveryAffiliate(id) {
  return fetch(`/api/admin/recovery-affiliates/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Accept: 'application/json' } })
    .then(async (r) => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); } return r.json(); });
}
function fetchCopyAutotuneConfig() { return coGet('/api/admin/copy-autotune/config'); }
function patchCopyAutotuneConfig(body) { return coSend('/api/admin/copy-autotune/config', 'PATCH', body); }
function fetchCopyAutotuneLogs(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v !== null && v !== undefined && v !== '') qs.set(k, v); }
  return coGet(`/api/admin/copy-autotune/logs${qs.toString() ? `?${qs}` : ''}`);
}

// Mutações invalidam o cache client-side de GETs: depois de salvar algo, o
// refetch da página precisa ver o dado novo — não o cache de 15s. Cobertura
// por convenção de nome (add/create/patch/delete/save/apply/...); helpers
// fetch* são read-only e ficam de fora.
const _MUTATION_NAME_RE = /^(add|create|update|patch|delete|remove|save|apply|reset|sign|mark|run|batch|seed|attach|detach|admin(?!List|Get|ContractPdf|BackfillStatus)|network(?!Me|My|ContractPdf))/i;
function _wrapMutations(api) {
  for (const [name, fn] of Object.entries(api)) {
    if (typeof fn !== 'function' || !_MUTATION_NAME_RE.test(name)) continue;
    api[name] = async (...args) => {
      const out = await fn(...args);
      _respCache.clear();
      return out;
    };
  }
  return api;
}

window.NSApi = _wrapMutations({
  fetchCopyRules,
  createCopyRule,
  patchCopyRule,
  deleteCopyRule,
  applyCopyRulesToAll,
  fetchRecovery,
  fetchTauk,
  adminLogicallSync,
  adminListIntegrationSettings,
  adminSaveIntegrationSetting,
  fetchSms,
  fetchCallCenter,
  addCallCenterWatch,
  deleteCallCenterWatch,
  fetchProfitConfig,
  patchProfitConfig,
  fetchProfitSplit,
  patchAffiliateRefundOverride,
  fetchRecoveryAffiliates,
  addRecoveryAffiliate,
  deleteRecoveryAffiliate,
  fetchCopyFunnel,
  calcCopyAov,
  batchApplyCopyRules,
  fetchCopyAutotuneConfig,
  patchCopyAutotuneConfig,
  fetchCopyAutotuneLogs,
  fetchOverview,
  fetchOrders,
  ordersExportUrl,
  fetchAffiliates,
  fetchAffiliateDetail,
  fetchAffiliateAnalysis,
  fetchAffiliateExplain,
  adminListAffiliateIdentity,
  adminAffiliateIdentity,
  fetchRefundCohorts,
  fetchPlatforms,
  adminPatchPlatformFees,
  fetchProducts,
  fetchFunnel,
  fetchFilterOptions,
  fetchFamilies,
  fetchPageStates,
  fetchHealth,
  fetchOrderDetail,
  fetchCosts,
  fetchCostsOverview,
  fetchFulfillment,
  fetchFulfillmentHealth,
  fetchFulfillmentOverview,
  adminListProductSuppliers,
  adminUpdateProductSuppliers,
  adminSaveCosts,
  adminBackfillCogs,
  adminBackfillStatus,
  adminClassifyAi,
  adminListUsers,
  adminCreateUser,
  adminPatchUser,
  adminResetUserPassword,
  adminDeleteUser,
  aiListConversations,
  aiGetConversation,
  aiDeleteConversation,
  aiSendMessage,
});
