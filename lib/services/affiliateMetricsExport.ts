// Métricas agregadas por affiliate_id pro ranking do NorthScale Afiliados
// (GET /api/integrations/affiliates/metrics — contrato §7).
//
// A régua é a mesma das abas (ver aggregateAffiliateMetrics no core):
// faturado por data da venda, estornos por data do estorno, pedidos reais
// (linha sintética da Digistore fora), taxa em % 0–100. Uma query
// agregada por (affiliate_id, plataforma) — cabe folgado nos 10 s do
// timeout deles graças ao índice (mappedAffiliateId, orderedAt).
//
// Cache curto (5 min) por período — a API deles chama 7d/30d/mtd a cada
// 15 min e custom sob demanda; invalidado quando o mapeamento muda
// (reprocesso reatribui pedidos) — o próximo pull já vê o dado novo.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { aggregateAffiliateMetrics, type AffiliateAggRow, type AffiliateMetricsOut } from './affiliateMappingCore';
import { onAffiliateMappingChanged } from './affiliateMapping';

export const METRICS_CACHE_TTL_MS = 5 * 60_000;

export interface MetricsCache {
  get(key: string): { body: AffiliateMetricsOut[]; at: number } | undefined;
  set(key: string, body: AffiliateMetricsOut[]): void;
  clear(): void;
}

export function createMetricsCache(ttlMs = METRICS_CACHE_TTL_MS, maxEntries = 64): MetricsCache {
  const map = new Map<string, { body: AffiliateMetricsOut[]; at: number }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) { map.delete(key); return undefined; }
      return hit;
    },
    set(key, body) {
      if (map.size >= maxEntries) map.clear();
      map.set(key, { body, at: Date.now() });
    },
    clear() { map.clear(); },
  };
}

export const affiliateMetricsCache = createMetricsCache();
onAffiliateMappingChanged(() => affiliateMetricsCache.clear());

export function clearAffiliateMetricsCache(): void {
  affiliateMetricsCache.clear();
}

export async function computeAffiliateMetrics(start: Date, end: Date): Promise<AffiliateMetricsOut[]> {
  const rows = await db.$queryRaw<Array<{
    affiliate_id: string;
    platform_slug: string;
    approved_gross: Prisma.Decimal;
    approved_count: bigint;
    refunded_rows: bigint;
    chargeback_rows: bigint;
    refunded_rows_orig: Prisma.Decimal;
    chargeback_rows_orig: Prisma.Decimal;
    refund_events_usd: Prisma.Decimal;
    refund_events_count: bigint;
    cb_events_usd: Prisma.Decimal;
    cb_events_count: bigint;
  }>>(Prisma.sql`
    SELECT
      o."mappedAffiliateId" AS affiliate_id,
      pl."slug" AS platform_slug,
      COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED' AND o."orderedAt" >= ${start} AND o."orderedAt" <= ${end}), 0) AS approved_gross,
      COUNT(*) FILTER (WHERE o."status" = 'APPROVED' AND o."orderedAt" >= ${start} AND o."orderedAt" <= ${end})::bigint AS approved_count,
      -- Vendas depois estornadas (in-place): a linha É a venda; valor original.
      COUNT(*) FILTER (WHERE o."status" = 'REFUNDED' AND o."orderedAt" >= ${start} AND o."orderedAt" <= ${end}
                         AND COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd")) > 0)::bigint AS refunded_rows,
      COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK' AND o."orderedAt" >= ${start} AND o."orderedAt" <= ${end}
                         AND COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd")) > 0)::bigint AS chargeback_rows,
      COALESCE(SUM(GREATEST(COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd")), 0)) FILTER (WHERE o."status" = 'REFUNDED' AND o."orderedAt" >= ${start} AND o."orderedAt" <= ${end}), 0) AS refunded_rows_orig,
      COALESCE(SUM(GREATEST(COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd")), 0)) FILTER (WHERE o."status" = 'CHARGEBACK' AND o."orderedAt" >= ${start} AND o."orderedAt" <= ${end}), 0) AS chargeback_rows_orig,
      -- Estornos pelo eixo de EVENTO (quando o dinheiro voltou).
      COALESCE(SUM(ABS(o."grossAmountUsd")) FILTER (WHERE o."status" = 'REFUNDED' AND o."refundedAt" >= ${start} AND o."refundedAt" <= ${end}), 0) AS refund_events_usd,
      COUNT(*) FILTER (WHERE o."status" = 'REFUNDED' AND o."refundedAt" >= ${start} AND o."refundedAt" <= ${end})::bigint AS refund_events_count,
      COALESCE(SUM(ABS(o."grossAmountUsd")) FILTER (WHERE o."status" = 'CHARGEBACK' AND o."chargebackAt" >= ${start} AND o."chargebackAt" <= ${end}), 0) AS cb_events_usd,
      COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK' AND o."chargebackAt" >= ${start} AND o."chargebackAt" <= ${end})::bigint AS cb_events_count
    FROM "Order" o
    JOIN "Platform" pl ON o."platformId" = pl.id
    WHERE o."mappedAffiliateId" IS NOT NULL
      AND (
        (o."orderedAt" >= ${start} AND o."orderedAt" <= ${end})
        OR (o."refundedAt" >= ${start} AND o."refundedAt" <= ${end})
        OR (o."chargebackAt" >= ${start} AND o."chargebackAt" <= ${end})
      )
    GROUP BY 1, 2
  `);
  const agg: AffiliateAggRow[] = rows.map((r) => ({
    affiliateId: r.affiliate_id,
    platformSlug: r.platform_slug,
    approvedGross: Number(r.approved_gross),
    approvedCount: Number(r.approved_count),
    refundedRowsCount: Number(r.refunded_rows),
    chargebackRowsCount: Number(r.chargeback_rows),
    refundedRowsOriginalGross: Number(r.refunded_rows_orig),
    chargebackRowsOriginalGross: Number(r.chargeback_rows_orig),
    refundEventsUsd: Number(r.refund_events_usd),
    refundEventsCount: Number(r.refund_events_count),
    chargebackEventsUsd: Number(r.cb_events_usd),
    chargebackEventsCount: Number(r.cb_events_count),
  }));
  return aggregateAffiliateMetrics(agg);
}
