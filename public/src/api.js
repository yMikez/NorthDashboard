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

async function fetchJSON(path, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    qs.set(k, v);
  }
  const url = `${API_BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  return res.json();
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
async function fetchOrders(filters, options = {}) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
    status: options.status && options.status !== 'all' ? options.status : null,
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
async function fetchAffiliates(filters) {
  const params = {
    start_date: toISODate(filters.dateRange.start),
    end_date: toISODate(filters.dateRange.end),
    platforms: setToCSV(filters.platforms),
    countries: setToCSV(filters.countries),
    products: setToCSV(filters.funnels),
    families: setToCSV(filters.families),
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
  };
  return fetchJSON('/api/metrics/families', params);
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
 * Fetch /api/metrics/insights — daily snapshot of curated narrative cards.
 * Cached server-side per day; pass refresh=1 to force recompute.
 */
async function fetchInsights() {
  return fetchJSON('/api/metrics/insights', {});
}

/* -------- Admin: Users -------- */

async function adminListUsers() {
  const res = await fetch('/api/admin/users', { headers: { Accept: 'application/json' } });
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

/* -------- Admin: Networks -------- */

async function adminListNetworks() {
  const res = await fetch('/api/admin/networks', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} listNetworks`);
  return res.json();
}

async function adminCreateNetwork(body) {
  const res = await fetch('/api/admin/networks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminGetNetwork(id) {
  const res = await fetch(`/api/admin/networks/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} getNetwork`);
  return res.json();
}

async function adminPatchNetwork(id, body) {
  const res = await fetch(`/api/admin/networks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminDeleteNetwork(id) {
  const res = await fetch(`/api/admin/networks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminListAvailableAffiliates(q) {
  const url = `/api/admin/networks/available-affiliates${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function adminAttachAffiliates(networkId, affiliateIds) {
  const res = await fetch(`/api/admin/networks/${encodeURIComponent(networkId)}/affiliates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ affiliateIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminDetachAffiliate(networkId, affiliateId) {
  const res = await fetch(
    `/api/admin/networks/${encodeURIComponent(networkId)}/affiliates/${encodeURIComponent(affiliateId)}`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminCreatePayout(networkId) {
  const res = await fetch(`/api/admin/networks/${encodeURIComponent(networkId)}/payouts`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

async function adminMarkPayoutPaid(networkId, payoutId, body) {
  const res = await fetch(
    `/api/admin/networks/${encodeURIComponent(networkId)}/payouts/${encodeURIComponent(payoutId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: 'mark_paid', ...(body || {}) }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function adminContractPdfUrl(networkId) {
  return `/api/admin/networks/${encodeURIComponent(networkId)}/contract.pdf`;
}

/* -------- Network Partner self -------- */

async function fetchNetworkMe() {
  const res = await fetch('/api/network/me', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function networkSignContract() {
  const res = await fetch('/api/network/me/contract/sign', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

const networkContractPdfUrl = '/api/network/me/contract.pdf';

window.NSApi = {
  fetchOverview,
  fetchOrders,
  fetchAffiliates,
  fetchAffiliateDetail,
  fetchPlatforms,
  fetchProducts,
  fetchFunnel,
  fetchFilterOptions,
  fetchFamilies,
  fetchHealth,
  fetchOrderDetail,
  fetchCosts,
  adminSaveCosts,
  adminBackfillCogs,
  fetchInsights,
  adminListUsers,
  adminCreateUser,
  adminPatchUser,
  adminResetUserPassword,
  adminDeleteUser,
  adminListNetworks,
  adminCreateNetwork,
  adminGetNetwork,
  adminPatchNetwork,
  adminDeleteNetwork,
  adminListAvailableAffiliates,
  adminAttachAffiliates,
  adminDetachAffiliate,
  adminCreatePayout,
  adminMarkPayoutPaid,
  adminContractPdfUrl,
  fetchNetworkMe,
  networkSignContract,
  networkContractPdfUrl,
};
