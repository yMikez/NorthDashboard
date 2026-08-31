// Catálogo de SKUs — a fila de confirmação do catálogo VERIFICADO.
//
// GET   → lista Products com o estado gravado + a SUGESTÃO do classificador
//          sobre o nome atual + flags (drift/conflito/sem-família/sem-potes/
//          pendências de custo). Filtros: platform, verified=0|1,
//          onlyIssues=1, search. Ordenado por nº de pedidos desc.
// PATCH → bulk: confirma/edita/reabre SKUs e ensina aliases.
//          { updates: [{ productId, family?, productType?, funnelStep?,
//            bottles?, bonusBottles?, comboComponents?, verified?,
//            acceptRename?, alias? }] }
//          - verified:true grava verifiedAt/By + nameAtVerification=name;
//          - acceptRename:true só re-snapshota o nome (limpa drift);
//          - alias: { from } grava FamilyAlias normalizado → family enviada
//            (ou a família atual) — correção vira aprendizado.
//
// Auth: Bearer INGEST_SECRET (mesmo padrão dos outros endpoints admin).

import { NextResponse } from 'next/server';
import type { ProductType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { invalidateCogsCache } from '@/lib/services/cogs';
import { invalidateFamilyDictionary } from '@/lib/services/familyDictionary';
import { classifyProduct, normalizeKey, sameFamilyKey } from '@/lib/services/productClassification';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authed(req: Request): boolean {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  return checkIngestSecret(token);
}

const VALID_TYPES: readonly ProductType[] = ['FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP', 'SMS_RECOVERY'];

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const platformSlug = searchParams.get('platform') || undefined;
  const verifiedParam = searchParams.get('verified');
  const onlyIssues = searchParams.get('onlyIssues') === '1';
  const search = searchParams.get('search')?.trim() || undefined;

  const [products, costFamilies, pendingByProduct] = await Promise.all([
    db.product.findMany({
      where: {
        ...(platformSlug ? { platform: { slug: platformSlug } } : {}),
        ...(verifiedParam === '0' ? { verified: false } : verifiedParam === '1' ? { verified: true } : {}),
        ...(search
          ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { externalId: { contains: search, mode: 'insensitive' } },
              { family: { contains: search, mode: 'insensitive' } },
            ],
          }
          : {}),
      },
      select: {
        id: true, externalId: true, name: true, family: true, variant: true,
        productType: true, funnelStep: true, bottles: true, bonusBottles: true,
        comboComponents: true, verified: true, verifiedAt: true, verifiedBy: true,
        nameAtVerification: true,
        platform: { select: { slug: true, displayName: true } },
        _count: { select: { orders: true } },
      },
      take: 800,
    }),
    db.productFamilyCost.findMany({ select: { family: true } }),
    db.order.groupBy({
      by: ['productId'],
      where: { classificationPending: true },
      _count: { _all: true },
      _sum: { grossAmountUsd: true },
    }),
  ]);

  const costSet = new Set(costFamilies.map((f) => normalizeKey(f.family)));
  const pendingMap = new Map(pendingByProduct.map((p) => [
    p.productId,
    { orders: p._count._all, gross: Number(p._sum.grossAmountUsd ?? 0) },
  ]));

  const rows = products.map((p) => {
    const c = classifyProduct(p.externalId, p.name, p.platform.slug);
    const pending = pendingMap.get(p.id) ?? { orders: 0, gross: 0 };
    const famHasCost = p.family != null && (
      costSet.has(normalizeKey(p.family))
      || (Array.isArray(p.comboComponents) && (p.comboComponents as Array<{ family?: string }>)
        .every((x) => x.family && costSet.has(normalizeKey(x.family))))
    );
    const drift = p.verified && p.nameAtVerification != null && p.name !== p.nameAtVerification;
    const conflict = c.family != null && p.family != null && !sameFamilyKey(c.family, p.family);
    return {
      productId: p.id,
      platformSlug: p.platform.slug,
      platformName: p.platform.displayName,
      externalId: p.externalId,
      name: p.name,
      nameAtVerification: p.nameAtVerification,
      verified: p.verified,
      verifiedAt: p.verifiedAt,
      verifiedBy: p.verifiedBy,
      family: p.family,
      variant: p.variant,
      productType: p.productType,
      funnelStep: p.funnelStep,
      bottles: p.bottles,
      bonusBottles: p.bonusBottles,
      comboComponents: p.comboComponents,
      orderCount: p._count.orders,
      pendingOrders: pending.orders,
      pendingGross: pending.gross,
      suggestion: {
        family: c.family,
        type: c.type,
        funnelStep: c.funnelStep,
        bottles: c.bottles,
        bonusBottles: c.bonusBottles,
        comboComponents: c.comboComponents,
        roleMarked: c.roleMarked,
        confidence: c.confidence,
      },
      flags: {
        drift,
        conflict,
        noFamily: p.family == null,
        noBottles: p.bottles == null && !Array.isArray(p.comboComponents),
        noCost: p.family != null && !famHasCost,
      },
    };
  });

  const filtered = onlyIssues
    ? rows.filter((r) => !r.verified || r.flags.drift || r.flags.conflict || r.flags.noFamily || r.flags.noCost || r.pendingOrders > 0)
    : rows;
  filtered.sort((a, b) => b.pendingGross - a.pendingGross || b.orderCount - a.orderCount);

  const summary = {
    total: rows.length,
    unverified: rows.filter((r) => !r.verified).length,
    attention: rows.filter((r) => r.flags.drift || r.flags.conflict || r.flags.noFamily || r.flags.noCost).length,
    pendingOrders: rows.reduce((s, r) => s + r.pendingOrders, 0),
    pendingGross: Math.round(rows.reduce((s, r) => s + r.pendingGross, 0)),
  };
  return NextResponse.json({ summary, products: filtered });
}

interface PatchUpdate {
  productId: string;
  family?: string | null;
  productType?: ProductType;
  funnelStep?: number | null;
  bottles?: number | null;
  bonusBottles?: number | null;
  comboComponents?: Array<{ family: string; bottles: number }> | null;
  verified?: boolean;
  acceptRename?: boolean;
  alias?: { from: string } | null;
}

export async function PATCH(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { updates?: PatchUpdate[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (updates.length === 0) return NextResponse.json({ error: 'updates[] required' }, { status: 400 });
  for (const u of updates) {
    if (!u.productId || typeof u.productId !== 'string') {
      return NextResponse.json({ error: 'invalid productId' }, { status: 400 });
    }
    if (u.productType !== undefined && !VALID_TYPES.includes(u.productType)) {
      return NextResponse.json({ error: `invalid productType "${u.productType}"` }, { status: 400 });
    }
    if (u.funnelStep !== undefined && u.funnelStep !== null
      && (!Number.isInteger(u.funnelStep) || u.funnelStep < 1 || u.funnelStep > 4)) {
      return NextResponse.json({ error: 'funnelStep deve ser 1..4 ou null' }, { status: 400 });
    }
  }

  try {
    let updated = 0;
    let aliases = 0;
    await db.$transaction(async (tx) => {
      for (const u of updates) {
        const current = await tx.product.findUnique({
          where: { id: u.productId },
          select: { name: true, family: true },
        });
        if (!current) continue;
        const family = u.family !== undefined ? u.family : current.family;
        await tx.product.update({
          where: { id: u.productId },
          data: {
            ...(u.family !== undefined ? { family: u.family } : {}),
            ...(u.productType !== undefined ? { productType: u.productType } : {}),
            ...(u.funnelStep !== undefined ? { funnelStep: u.funnelStep } : {}),
            ...(u.bottles !== undefined ? { bottles: u.bottles } : {}),
            ...(u.bonusBottles !== undefined ? { bonusBottles: u.bonusBottles } : {}),
            ...(u.comboComponents !== undefined
              ? {
                comboComponents: u.comboComponents === null
                  ? Prisma.JsonNull
                  : (u.comboComponents as unknown as Prisma.InputJsonValue),
              }
              : {}),
            ...(u.verified === true
              ? { verified: true, verifiedAt: new Date(), verifiedBy: 'admin', nameAtVerification: current.name }
              : u.verified === false
                ? { verified: false, verifiedAt: null, verifiedBy: null, nameAtVerification: null }
                : {}),
            ...(u.acceptRename ? { nameAtVerification: current.name } : {}),
          },
        });
        updated++;
        if (u.alias?.from && family) {
          const key = normalizeKey(u.alias.from);
          if (key.length >= 4) {
            await tx.familyAlias.upsert({
              where: { alias: key },
              create: { alias: key, family, createdBy: 'admin' },
              update: { family },
            });
            aliases++;
          }
        }
      }
    });
    invalidateCogsCache();
    invalidateFamilyDictionary();
    clearResponseCache();
    return NextResponse.json({ updated, aliases });
  } catch (err) {
    logger.error({ err }, 'admin/catalog PATCH failed');
    return NextResponse.json(
      { error: 'update failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
