// POST /api/admin/verify-catalog  (Bearer INGEST_SECRET)
//   Body opcional: { "dryRun": true }  ← DEFAULT é dryRun (só relata)
//
// Migração do catálogo pro modelo VERIFICADO (2026-08-31):
//   a. SKU estruturado (formato ClickBank/NS) → verified 'auto-sku'.
//   b. Família gravada NÃO-canônica mas resolvível pelo classificador v2
//      ("TA - NeuroPulse Pro" → NeuroPulsePro) → corrige in-place
//      (família fantasma morre) + variant do prefixo.
//   c. Família canônica + classificador v2 REPRODUZ família e papel do que
//      está gravado → verified 'backfill' (o acervo são trava de uma vez).
//      JVZoo sem marcador numerado trava com funnelStep=null (sessão manda).
//   d. Resto fica verified=false → fila do catálogo em /costs.
//
// Idempotente. Rodar SEMPRE dryRun primeiro e revisar os diffs de família.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import {
  classifyProduct, hasNumberedRoleMarker, isStructuredSku, refineFamilyText, sameFamilyKey,
} from '@/lib/services/productClassification';
import { getDynamicFamilyEntries, invalidateFamilyDictionary } from '@/lib/services/familyDictionary';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let dryRun = true;
  try {
    const body = (await req.json()) as { dryRun?: boolean };
    if (body && body.dryRun === false) dryRun = false;
  } catch {
    // sem body → dryRun (seguro por default)
  }

  invalidateFamilyDictionary();
  const dynEntries = await getDynamicFamilyEntries();
  const products = await db.product.findMany({
    where: { verified: false },
    select: {
      id: true, externalId: true, name: true, family: true, variant: true,
      productType: true, funnelStep: true, bottles: true, bonusBottles: true,
      platform: { select: { slug: true } },
      _count: { select: { orders: true } },
    },
  });

  const verified: Array<{ externalId: string; name: string; by: string }> = [];
  const fixedPhantom: Array<{ externalId: string; name: string; from: string | null; to: string }> = [];
  const queue: Array<{ externalId: string; name: string; family: string | null; orders: number }> = [];

  for (const p of products) {
    const slug = p.platform?.slug ?? null;
    const c = classifyProduct(p.externalId, p.name, slug);

    // (a) SKU estruturado — vendor-controlado, zero ambiguidade.
    if (isStructuredSku(p.externalId) && c.family != null) {
      verified.push({ externalId: p.externalId, name: p.name, by: 'auto-sku' });
      if (!dryRun) {
        await db.product.update({
          where: { id: p.id },
          data: {
            family: c.family, variant: c.variant, bottles: c.bottles, bonusBottles: c.bonusBottles,
            productType: c.type, funnelStep: c.funnelStep,
            verified: true, verifiedAt: new Date(), verifiedBy: 'auto-sku', nameAtVerification: p.name,
          },
        });
      }
      continue;
    }

    // (b) Família fantasma corrigível ("TA - NeuroPulse Pro" → NeuroPulsePro).
    if (p.family != null) {
      const refined = refineFamilyText(p.family, dynEntries);
      if (refined.family != null && !sameFamilyKey(refined.family, p.family)) {
        fixedPhantom.push({ externalId: p.externalId, name: p.name, from: p.family, to: refined.family });
        if (!dryRun) {
          await db.product.update({
            where: { id: p.id },
            data: { family: refined.family, variant: p.variant ?? refined.variant },
          });
        }
        p.family = refined.family; // segue pro passo (c) já corrigida
      }
    }

    // (c) Classificador reproduz o que está gravado → trava.
    const famMatch = c.family != null && p.family != null && sameFamilyKey(c.family, p.family);
    const cartpanda = slug === 'cartpanda';
    const jvzooUnnumbered = slug === 'jvzoo' && !hasNumberedRoleMarker(p.name);
    const roleMatch = cartpanda
      ? true // papel do connector; o que está no Product foi o connector que pôs
      : c.roleMarked && c.type === p.productType;
    if (famMatch && (roleMatch || (slug === 'jvzoo' && !c.roleMarked && p.productType !== 'FRONTEND'))) {
      verified.push({ externalId: p.externalId, name: p.name, by: 'backfill' });
      if (!dryRun) {
        await db.product.update({
          where: { id: p.id },
          data: {
            verified: true, verifiedAt: new Date(), verifiedBy: 'backfill', nameAtVerification: p.name,
            funnelStep: cartpanda
              ? p.funnelStep
              : jvzooUnnumbered
                ? null // sessão decide a etapa
                : c.funnelStep ?? p.funnelStep,
            ...(c.comboComponents && c.comboComponents.length >= 2
              ? { comboComponents: c.comboComponents as unknown as object }
              : {}),
          },
        });
      }
      continue;
    }

    // (d) fila humana.
    queue.push({ externalId: p.externalId, name: p.name, family: p.family, orders: p._count.orders });
  }

  if (!dryRun) clearResponseCache();

  const summary = {
    ok: true,
    dryRun,
    scanned: products.length,
    verified: verified.length,
    fixedPhantom,
    queue: queue.sort((a, b) => b.orders - a.orders),
  };
  logger.info({ ...summary, queue: summary.queue.length }, 'verify-catalog done');
  return NextResponse.json(summary);
}
