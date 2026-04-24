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

window.NSApi = { fetchOverview };
