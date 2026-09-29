// Cobertura de estorno por plataforma nos últimos 30 dias — camada de banco.
// Regras em refundCoverageCore.ts.
//
// "Estorno registrado" = linha com refundedAt/chargebackAt dentro da janela.
// Vale para os dois modelos: in-place (a venda vira REFUNDED e ganha a data)
// e extra-row (Digistore: a linha nova de estorno carrega a data).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { detectRefundSilence, type RefundCoverageRow } from './refundCoverageCore';

const WINDOW_DAYS = 30;

export interface RefundCoverageResponse {
  windowDays: number;
  platforms: RefundCoverageRow[];
  generatedAt: string;
}

export async function getRefundCoverage(now = new Date()): Promise<RefundCoverageResponse> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const rows = await db.$queryRaw<Array<{ slug: string; display_name: string; sales: number; refund_events: number }>>(Prisma.sql`
    SELECT
      pl."slug" AS slug,
      pl."displayName" AS display_name,
      COUNT(*) FILTER (WHERE o."status" = 'APPROVED' AND o."orderedAt" >= ${since})::int AS sales,
      COUNT(*) FILTER (WHERE (o."refundedAt" >= ${since}) OR (o."chargebackAt" >= ${since}))::int AS refund_events
    FROM "Platform" pl
    LEFT JOIN "Order" o ON o."platformId" = pl.id
      AND (o."orderedAt" >= ${since} OR o."refundedAt" >= ${since} OR o."chargebackAt" >= ${since})
    GROUP BY pl."slug", pl."displayName"
    ORDER BY pl."displayName"
  `);
  return {
    windowDays: WINDOW_DAYS,
    platforms: detectRefundSilence(rows.map((r) => ({
      platform: r.slug, displayName: r.display_name, sales: r.sales, refundEvents: r.refund_events,
    }))),
    generatedAt: now.toISOString(),
  };
}
