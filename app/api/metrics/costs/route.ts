// Read-only endpoint for the Costs page UI. Mirrors what /api/admin/costs
// GET returns, but without the bearer requirement — just read access for
// display. Editing still goes through /api/admin/costs (token-gated).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [families, rates] = await Promise.all([
      db.productFamilyCost.findMany({ orderBy: { family: 'asc' } }),
      db.fulfillmentRate.findMany({ orderBy: { bottlesMax: 'asc' } }),
    ]);
    return NextResponse.json({
      families: families.map((f) => ({
        family: f.family,
        unitCostUsd: Number(f.unitCostUsd),
        updatedAt: f.updatedAt.toISOString(),
      })),
      fulfillment: rates.map((r) => ({
        bottlesMax: r.bottlesMax,
        priceUsd: Number(r.priceUsd),
        label: r.label,
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, 'metrics/costs GET failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
