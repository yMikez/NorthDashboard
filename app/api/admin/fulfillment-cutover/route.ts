// POST /api/admin/fulfillment-cutover — troca de fornecedor de fulfillment
// em massa (Bearer INGEST_SECRET). Criado pro cutover ShipOffers→RedRock
// (ShipOffers pausada, 2026-07-30), mas genérico/reversível.
//
//   Body: { from: 'shipoffers', to: 'redrock', sinceDays?: 5 }
//
// Faz, nesta ordem:
//   1. ProductFamilyCost.fulfillmentSupplier: from → to (default das famílias)
//   2. Product.fulfillmentSupplier (override por SKU): from → to
//   3. backfillCogs(sinceDays) — recomputa custo/frete SÓ da janela
//      (histórico antigo mantém o snapshot do fornecedor da época)
//   4. Reporta famílias movidas que NÃO têm tarifa no fornecedor destino
//      (nem _default) — frete ficaria $0, cadastrar na aba Fulfillment.
// Ingest novo já usa a config nova na hora (cache de 5min invalidado).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { backfillCogs } from '@/lib/services/backfillCogs';
import { invalidateCogsCache } from '@/lib/services/cogs';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SUPPLIERS = new Set(['redrock', 'shipoffers', 'fullstack']);

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const from = String(body.from ?? '').toLowerCase();
  const to = String(body.to ?? '').toLowerCase();
  if (!VALID_SUPPLIERS.has(from) || !VALID_SUPPLIERS.has(to) || from === to) {
    return NextResponse.json({ error: 'from/to inválidos' }, { status: 400 });
  }
  const sinceDays = body.sinceDays != null ? Number(body.sinceDays) : undefined;
  if (sinceDays != null && (!Number.isFinite(sinceDays) || sinceDays <= 0 || sinceDays > 365)) {
    return NextResponse.json({ error: 'sinceDays inválido' }, { status: 400 });
  }

  try {
    const familiesMoved = await db.productFamilyCost.updateMany({
      where: { fulfillmentSupplier: from },
      data: { fulfillmentSupplier: to },
    });
    const skusMoved = await db.product.updateMany({
      where: { fulfillmentSupplier: from },
      data: { fulfillmentSupplier: to },
    });
    invalidateCogsCache();

    const backfill = sinceDays != null ? await backfillCogs(sinceDays) : null;

    // Famílias agora no destino SEM tarifa lá (nem _default) → frete $0.
    const [destFamilies, destRates] = await Promise.all([
      db.productFamilyCost.findMany({ where: { fulfillmentSupplier: to }, select: { family: true } }),
      db.fulfillmentRate.findMany({ where: { supplier: to }, select: { family: true } }),
    ]);
    const rated = new Set(destRates.map((r) => r.family));
    const hasDefault = rated.has('_default');
    const missingRates = hasDefault ? [] : destFamilies.map((f) => f.family).filter((f) => !rated.has(f));

    clearResponseCache();
    logger.info({ from, to, familiesMoved: familiesMoved.count, skusMoved: skusMoved.count, sinceDays }, 'fulfillment cutover done');
    return NextResponse.json({
      ok: true,
      from,
      to,
      familiesMoved: familiesMoved.count,
      skusMoved: skusMoved.count,
      backfill,
      destinationHasDefaultRate: hasDefault,
      familiesWithoutRateAtDestination: missingRates,
    });
  } catch (err) {
    logger.error({ err }, 'admin/fulfillment-cutover failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
