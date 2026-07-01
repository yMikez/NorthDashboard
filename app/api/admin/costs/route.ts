// Admin endpoint to read + edit the cost tables (ProductFamilyCost +
// FulfillmentRate). Gated by INGEST_SECRET.
//
// GET  → returns current tables (anyone reading just to display can use
//        the read-only /api/metrics/costs once we add it; this admin route
//        also returns edit metadata).
// POST → accepts a partial update payload:
//        {
//          families?: [{ family, unitCostUsd }],
//          fulfillment?: [{ bottlesMax, priceUsd, label? }],
//        }
//        Each row upserts. After applying, invalidates the in-memory
//        cogs cache so subsequent ingests use new prices. Does NOT
//        rewrite historical Order.cogsUsd snapshots — call
//        /api/admin/backfill-cogs separately for that.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { invalidateCogsCache } from '@/lib/services/cogs';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const [families, rates] = await Promise.all([
    db.productFamilyCost.findMany({ orderBy: { family: 'asc' } }),
    db.fulfillmentRate.findMany({
      orderBy: [{ supplier: 'asc' }, { family: 'asc' }, { bottlesMax: 'asc' }],
    }),
  ]);
  return NextResponse.json({
    families: families.map((f) => ({
      family: f.family,
      unitCostUsd: Number(f.unitCostUsd),
      fulfillmentSupplier: f.fulfillmentSupplier,
      updatedAt: f.updatedAt.toISOString(),
    })),
    fulfillment: rates.map((r) => ({
      supplier: r.supplier,
      family: r.family,
      bottlesMax: r.bottlesMax,
      priceUsd: Number(r.priceUsd),
      label: r.label,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

interface CostsPatch {
  families?: Array<{ family: string; unitCostUsd: number; fulfillmentSupplier?: string }>;
  fulfillment?: Array<{
    supplier: string;
    family: string;
    bottlesMax: number;
    priceUsd: number;
    label?: string;
  }>;
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: CostsPatch;
  try {
    body = (await req.json()) as CostsPatch;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const updated = { families: 0, fulfillment: 0 };
  try {
    const VALID_SUPPLIERS = new Set(['redrock', 'shipoffers', 'fullstack']);
    for (const f of body.families ?? []) {
      if (!f.family || !Number.isFinite(f.unitCostUsd) || f.unitCostUsd < 0) continue;
      const supplier = f.fulfillmentSupplier && VALID_SUPPLIERS.has(f.fulfillmentSupplier)
        ? f.fulfillmentSupplier
        : undefined;
      await db.productFamilyCost.upsert({
        where: { family: f.family },
        create: {
          family: f.family,
          unitCostUsd: new Prisma.Decimal(f.unitCostUsd),
          ...(supplier ? { fulfillmentSupplier: supplier } : {}),
        },
        update: {
          unitCostUsd: new Prisma.Decimal(f.unitCostUsd),
          ...(supplier ? { fulfillmentSupplier: supplier } : {}),
        },
      });
      updated.families++;
    }
    for (const r of body.fulfillment ?? []) {
      if (
        !r.supplier || !VALID_SUPPLIERS.has(r.supplier) || !r.family ||
        !Number.isInteger(r.bottlesMax) || r.bottlesMax <= 0 ||
        !Number.isFinite(r.priceUsd) || r.priceUsd < 0
      ) continue;
      await db.fulfillmentRate.upsert({
        where: {
          supplier_family_bottlesMax: {
            supplier: r.supplier,
            family: r.family,
            bottlesMax: r.bottlesMax,
          },
        },
        create: {
          supplier: r.supplier,
          family: r.family,
          bottlesMax: r.bottlesMax,
          priceUsd: new Prisma.Decimal(r.priceUsd),
          label: r.label ?? `${r.bottlesMax} potes`,
        },
        update: {
          priceUsd: new Prisma.Decimal(r.priceUsd),
          ...(r.label !== undefined ? { label: r.label } : {}),
        },
      });
      updated.fulfillment++;
    }
    invalidateCogsCache();
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    logger.error({ err }, 'admin/costs POST failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
