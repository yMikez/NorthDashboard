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
};
