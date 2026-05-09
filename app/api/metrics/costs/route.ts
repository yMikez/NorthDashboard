// Read-only endpoint for the Fulfillment (ex-Costs) page UI. Mirrors o
// que /api/admin/costs GET retorna, mas sem bearer — só read pra display.
// Edit continua passando por /api/admin/costs (token-gated).
//
// IMPORTANTE: a lista de famílias agora inclui TODAS que já apareceram
// em algum Product, mesmo as ainda não catalogadas em ProductFamilyCost.
// Famílias novas vêm com unitCostUsd = média dos catalogados (placeholder)
// + flag isCataloged=false pra UI sinalizar que precisa atualização
// manual.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireTab('costs');
  if (!auth.ok) return auth.response;
  try {
    const [families, rates, productFamilies] = await Promise.all([
      db.productFamilyCost.findMany({ orderBy: { family: 'asc' } }),
      db.fulfillmentRate.findMany({ orderBy: { bottlesMax: 'asc' } }),
      db.product.findMany({
        where: { family: { not: null } },
        distinct: ['family'],
        select: { family: true },
        orderBy: { family: 'asc' },
      }),
    ]);

    const cataloged = new Set(families.map((f) => f.family));
    const avgUnitCost = families.length > 0
      ? families.reduce((s, f) => s + Number(f.unitCostUsd), 0) / families.length
      : 0;

    const allFamilies: Array<{
      family: string;
      unitCostUsd: number;
      updatedAt: string;
      isCataloged: boolean;
    }> = families.map((f) => ({
      family: f.family,
      unitCostUsd: Number(f.unitCostUsd),
      updatedAt: f.updatedAt.toISOString(),
      isCataloged: true,
    }));
    for (const p of productFamilies) {
      if (!p.family || cataloged.has(p.family)) continue;
      allFamilies.push({
        family: p.family,
        unitCostUsd: Number(avgUnitCost.toFixed(2)),
        updatedAt: new Date(0).toISOString(),
        isCataloged: false,
      });
    }
    allFamilies.sort((a, b) => a.family.localeCompare(b.family));

    return NextResponse.json({
      families: allFamilies,
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
