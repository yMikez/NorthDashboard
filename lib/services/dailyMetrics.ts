// Query layer for the daily_metrics materialized view.
//
// The MV (created in 20260427105720_add_daily_metrics_mv) pre-aggregates
// Order data by (day, platform, family, country, product_type), with
// per-status counts and sums computed via FILTER. Reads come from this
// table instead of scanning all orders for the period — the heavy work
// happens once during REFRESH, not on every dashboard request.
//
// Refresh strategy: in-process throttle. We track the last successful
// refresh timestamp; if a request finds it older than `STALE_AFTER_MS`,
// we kick off `REFRESH MATERIALIZED VIEW CONCURRENTLY` (non-blocking
// for readers) and return whatever the MV currently has. First request
// after a write may show data 1-2 minutes stale; subsequent ones are
// fresh. For cases that need real-time accuracy, callers can invoke
// `refreshDailyMetricsNow()` directly.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import type { MetricsFilters } from './metrics';

const STALE_AFTER_MS = 60_000; // 1 minute

let lastRefreshAt = 0;
let refreshInFlight: Promise<void> | null = null;

export async function refreshDailyMetricsIfStale(): Promise<void> {
  const age = Date.now() - lastRefreshAt;
  if (age < STALE_AFTER_MS) return;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh();
  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function refreshDailyMetricsNow(): Promise<void> {
  refreshInFlight = doRefresh();
  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function doRefresh(): Promise<void> {
  // CONCURRENTLY needs the unique index from the migration. Fails silently
  // on first call (before any data) — fall back to non-concurrent refresh
  // which is required for the initial population.
  try {
    await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY daily_metrics');
  } catch {
    await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW daily_metrics');
  }
  lastRefreshAt = Date.now();
}

// ---------- Query helpers ----------

export interface DailyMetricsRow {
  day: Date;
  platform: string;
  family: string;       // '_unknown' for nulls
  country: string;      // '_unknown' for nulls
  product_type: string; // ProductType enum value
  total_count: number;
  approved_count: number;
  refunded_count: number;
  chargeback_count: number;
  gross: number;
  net: number;
  cpa: number;
}

interface RawDailyMetricsRow {
  day: Date;
  platform: string;
  family: string;
  country: string;
  product_type: string;
  total_count: bigint;
  approved_count: bigint;
  refunded_count: bigint;
  chargeback_count: bigint;
  gross: Prisma.Decimal;
  net: Prisma.Decimal;
  cpa: Prisma.Decimal;
}

function toNum(v: bigint | number): number {
  return typeof v === 'bigint' ? Number(v) : v;
}
function toDec(v: Prisma.Decimal): number {
  return Number(v);
}

/**
 * Read aggregated rows from daily_metrics applying the dashboard's standard
 * filters. Returns one row per (day, platform, family, country, productType)
 * combination present in the data. Caller does any further reduction.
 *
 * Refresh is NOT triggered here — caller invokes refreshDailyMetricsIfStale()
 * once per request (typically at the top of getOverview).
 */
export async function queryDailyMetrics(
  filters: MetricsFilters,
): Promise<DailyMetricsRow[]> {
  // Build WHERE clauses inline. Prisma.sql template strings are SQL-injection-
  // safe via parameter binding.
  const conds: Prisma.Sql[] = [];
  conds.push(Prisma.sql`day >= ${startOfDayUtc(filters.startDate)}::date`);
  conds.push(Prisma.sql`day <= ${endOfDayUtc(filters.endDate)}::date`);
  if (filters.platformSlugs?.length) {
    conds.push(Prisma.sql`platform = ANY(${filters.platformSlugs})`);
  }
  if (filters.countries?.length) {
    conds.push(Prisma.sql`country = ANY(${filters.countries})`);
  }
  if (filters.productFamilies?.length) {
    conds.push(Prisma.sql`family = ANY(${filters.productFamilies})`);
  }
  // productExternalIds is intentionally NOT applied here. The MV is keyed on
  // family, not SKU; SKU-level filtering forces a path back to the base table.
  // Callers that need productExternalIds should still use the legacy
  // fetchOrders() path. In practice the dashboard uses families now.

  const where = Prisma.join(conds, ' AND ');
  const rows = await db.$queryRaw<RawDailyMetricsRow[]>(Prisma.sql`
    SELECT day, platform, family, country, product_type,
           total_count, approved_count, refunded_count, chargeback_count,
           gross, net, cpa
    FROM daily_metrics
    WHERE ${where}
    ORDER BY day ASC
  `);

  return rows.map((r) => ({
    day: r.day,
    platform: r.platform,
    family: r.family,
    country: r.country,
    product_type: r.product_type,
    total_count: toNum(r.total_count),
    approved_count: toNum(r.approved_count),
    refunded_count: toNum(r.refunded_count),
    chargeback_count: toNum(r.chargeback_count),
    gross: toDec(r.gross),
    net: toDec(r.net),
    cpa: toDec(r.cpa),
  }));
}

function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}
