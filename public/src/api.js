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
  };
  return fetchJSON('/api/metrics/affiliates', params);
}

window.NSApi = { fetchOverview, fetchOrders, fetchAffiliates };
