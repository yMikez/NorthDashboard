// Admin endpoints pro cadastro de fulfillment supplier por SKU.
//
// GET   → lista Products com supplier resolvido (override por SKU, ou
//          default da família). Pode filtrar por plataforma/família/busca.
// PATCH → bulk update Product.fulfillmentSupplier. Body:
//          { updates: [{ productId, supplier: 'redrock' | 'shipoffers' | null }] }
//          Aplica em transação e invalida o cache de cogs.
//
// Auth: Bearer INGEST_SECRET (mesmo padrão dos outros endpoints admin).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { invalidateCogsCache } from '@/lib/services/cogs';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchUpdate {
  productId: string;
  supplier: 'redrock' | 'shipoffers' | null;
}

function authed(req: Request): boolean {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  return checkIngestSecret(token);
}

export async function GET(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const platformSlug = searchParams.get('platform') || undefined;
  const family = searchParams.get('family') || undefined;
  const search = searchParams.get('search')?.trim() || undefined;

  const products = await db.product.findMany({
    where: {
      ...(platformSlug ? { platform: { slug: platformSlug } } : {}),
      ...(family ? { family } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { externalId: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      isActive: true,
    },
    select: {
      id: true,
      externalId: true,
      name: true,
      family: true,
      bottles: true,
      productType: true,
      fulfillmentSupplier: true,
      platform: { select: { slug: true, displayName: true } },
      _count: { select: { orders: true } },
    },
    orderBy: [
      { platform: { slug: 'asc' } },
      { family: 'asc' },
      { name: 'asc' },
    ],
    take: 500,
  });

  // Default da família pra computar supplier efetivo.
  const familyDefaults = await db.productFamilyCost.findMany({
    select: { family: true, fulfillmentSupplier: true },
  });
  const defaultMap = new Map<string, string>();
  for (const f of familyDefaults) defaultMap.set(f.family, f.fulfillmentSupplier);

  const rows = products.map((p) => {
    const familyDefault = p.family ? defaultMap.get(p.family) ?? null : null;
    const effective = p.fulfillmentSupplier ?? familyDefault ?? 'shipoffers';
    return {
      id: p.id,
      externalId: p.externalId,
      name: p.name,
      family: p.family,
      bottles: p.bottles,
      productType: p.productType,
      platformSlug: p.platform.slug,
      platformName: p.platform.displayName,
      orderCount: p._count.orders,
      // Cadeia: override por SKU → default da família → 'shipoffers'.
      // override é o que está em Product.fulfillmentSupplier; null = herda.
      override: p.fulfillmentSupplier,
      familyDefault,
      effectiveSupplier: effective,
    };
  });

  return NextResponse.json({ products: rows });
}

export async function PATCH(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { updates?: PatchUpdate[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (updates.length === 0) {
    return NextResponse.json({ error: 'updates[] required' }, { status: 400 });
  }
  // Valida supplier; null é permitido (herda da família).
  for (const u of updates) {
    if (!u.productId || typeof u.productId !== 'string') {
      return NextResponse.json({ error: 'invalid productId' }, { status: 400 });
    }
    if (u.supplier !== null && u.supplier !== 'redrock' && u.supplier !== 'shipoffers') {
      return NextResponse.json(
        { error: `invalid supplier "${u.supplier}" (use redrock | shipoffers | null)` },
        { status: 400 },
      );
    }
  }

  try {
    const result = await db.$transaction(
      updates.map((u) =>
        db.product.update({
          where: { id: u.productId },
          data: { fulfillmentSupplier: u.supplier },
          select: { id: true },
        }),
      ),
    );
    invalidateCogsCache();
    return NextResponse.json({ updated: result.length });
  } catch (err) {
    logger.error({ err }, 'admin/product-suppliers PATCH failed');
    return NextResponse.json(
      { error: 'update failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
