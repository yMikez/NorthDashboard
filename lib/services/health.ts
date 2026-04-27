// Data quality + ingestion health metrics. Powers the "Saúde do dado" page,
// the topbar "last synced" indicator, and (eventually) the alerting cron.
//
// All queries are last-24h windowed except where explicitly noted; the page
// is meant for *operational* monitoring, not historical analytics.

import { Prisma } from '@prisma/client';
import { db } from '../db';

export interface HealthResponse {
  ingestion: {
    perPlatform: Array<{
      platform: string;
      displayName: string;
      lastReceivedAt: string | null;
      secondsAgo: number | null;
      receivedCount24h: number;
      failedCount24h: number;
      successRate24h: number;
    }>;
    totalReceived24h: number;
    totalFailures24h: number;
  };
  health: {
    approvalRate24h: number;
    refundRate24h: number;
    chargebackRate24h: number;
    refundRateBaseline30d: number;
  };
  catalog: {
    totalProducts: number;
    productsWithFamily: number;
    productsWithoutFamily: number;
    unknownSKUs: Array<{ platform: string; externalId: string; name: string }>;
  };
  metricsView: {
    rowCount: number;
  };
  generatedAt: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

export async function getHealth(): Promise<HealthResponse> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - ONE_DAY_MS);
  const monthAgo = new Date(now.getTime() - THIRTY_DAYS_MS);

  // --- Ingestion: latest IPN per platform + 24h counts ---
  const platforms = await db.platform.findMany({
    select: { slug: true, displayName: true },
    orderBy: { displayName: 'asc' },
  });
  const perPlatform = await Promise.all(
    platforms.map(async (p) => {
      const [latest, recvCount, failCount] = await Promise.all([
        db.ingestLog.findFirst({
          where: { platformSlug: p.slug },
          orderBy: { receivedAt: 'desc' },
          select: { receivedAt: true },
        }),
        db.ingestLog.count({
          where: { platformSlug: p.slug, receivedAt: { gte: dayAgo } },
        }),
        db.ingestLog.count({
          where: {
            platformSlug: p.slug,
            receivedAt: { gte: dayAgo },
            processedOk: false,
          },
        }),
      ]);
      const secondsAgo = latest
        ? Math.floor((now.getTime() - latest.receivedAt.getTime()) / 1000)
        : null;
      return {
        platform: p.slug,
        displayName: p.displayName,
        lastReceivedAt: latest?.receivedAt.toISOString() ?? null,
        secondsAgo,
        receivedCount24h: recvCount,
        failedCount24h: failCount,
        successRate24h: recvCount ? round4((recvCount - failCount) / recvCount) : 1,
      };
    }),
  );
  const totalReceived24h = perPlatform.reduce((s, p) => s + p.receivedCount24h, 0);
  const totalFailures24h = perPlatform.reduce((s, p) => s + p.failedCount24h, 0);

  // --- Health: rates over last 24h vs 30d baseline ---
  const [counts24h, counts30d] = await Promise.all([
    db.order.groupBy({
      by: ['status'],
      where: { orderedAt: { gte: dayAgo } },
      _count: { _all: true },
    }),
    db.order.groupBy({
      by: ['status'],
      where: { orderedAt: { gte: monthAgo } },
      _count: { _all: true },
    }),
  ]);
  const total24 = counts24h.reduce((s, r) => s + r._count._all, 0);
  const total30 = counts30d.reduce((s, r) => s + r._count._all, 0);
  const get = (rows: typeof counts24h, status: string) =>
    rows.find((r) => r.status === status)?._count._all ?? 0;
  const approval24 = total24 ? get(counts24h, 'APPROVED') / total24 : 0;
  const refund24 = total24 ? get(counts24h, 'REFUNDED') / total24 : 0;
  const cb24 = total24 ? get(counts24h, 'CHARGEBACK') / total24 : 0;
  const refundBaseline = total30 ? get(counts30d, 'REFUNDED') / total30 : 0;

  // --- Catalog: classification coverage ---
  const [totalProducts, withFamily, unknownList] = await Promise.all([
    db.product.count(),
    db.product.count({ where: { family: { not: null } } }),
    db.product.findMany({
      where: { family: null },
      select: {
        externalId: true,
        name: true,
        platform: { select: { slug: true } },
      },
      take: 25,
    }),
  ]);

  // --- MV row count (rough freshness signal) ---
  const mvRows = await db.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM daily_metrics`,
  );

  return {
    ingestion: { perPlatform, totalReceived24h, totalFailures24h },
    health: {
      approvalRate24h: round4(approval24),
      refundRate24h: round4(refund24),
      chargebackRate24h: round4(cb24),
      refundRateBaseline30d: round4(refundBaseline),
    },
    catalog: {
      totalProducts,
      productsWithFamily: withFamily,
      productsWithoutFamily: totalProducts - withFamily,
      unknownSKUs: unknownList.map((p) => ({
        platform: p.platform.slug,
        externalId: p.externalId,
        name: p.name,
      })),
    },
    metricsView: {
      rowCount: Number(mvRows[0]?.count ?? 0n),
    },
    generatedAt: now.toISOString(),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
