// POST /api/admin/classify-ai — usa o Claude pra classificar produtos que
// o regex classifier não conseguiu (family=null OU bottles=null), depois
// reescreve os snapshots de COGS+frete em todas as orders afetadas.
//
// Gated por INGEST_SECRET (Bearer) igual aos outros /api/admin/* de custo.
//
// Body opcional: { dryRun?: boolean } — quando true, retorna as propostas
// SEM gravar (pra revisão antes de aplicar).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { aiClassifyProducts } from '@/lib/services/aiClassify';
import { backfillCogs } from '@/lib/services/backfillCogs';
import { refreshDailyMetricsNow } from '@/lib/services/dailyMetrics';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Limite de produtos por chamada — controla custo/tempo da chamada Claude.
const MAX_PRODUCTS = 200;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    /* sem body = aplica */
  }

  try {
    // Produtos "gap": sem família OU sem contagem de potes. São os que
    // produzem COGS/frete = 0 e furam a precisão do custo.
    const pending = await db.product.findMany({
      where: { OR: [{ family: null }, { bottles: null }] },
      select: { id: true, externalId: true, name: true },
      take: MAX_PRODUCTS,
    });

    if (pending.length === 0) {
      return NextResponse.json({
        ok: true,
        pending: 0,
        classified: 0,
        applied: 0,
        message: 'Nenhum produto pendente — tudo já classificado.',
        proposals: [],
      });
    }

    const results = await aiClassifyProducts(
      pending.map((p) => ({ id: p.id, externalId: p.externalId, name: p.name })),
    );

    // Só aplicamos quando a IA deu pelo menos família OU potes com
    // confiança não-low. Low/sem-dado fica de fora pra não poluir.
    const byId = new Map(pending.map((p) => [p.id, p]));
    const proposals = results
      .filter((r) => r.confidence !== 'low' && (r.family || r.bottles))
      .map((r) => ({
        id: r.id,
        name: byId.get(r.id)?.name ?? '',
        externalId: byId.get(r.id)?.externalId ?? '',
        family: r.family,
        bottles: r.bottles,
        bonusBottles: r.bonusBottles,
        type: r.type,
        confidence: r.confidence,
      }));

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        pending: pending.length,
        classified: proposals.length,
        applied: 0,
        dryRun: true,
        proposals,
      });
    }

    let applied = 0;
    for (const p of proposals) {
      await db.product.update({
        where: { id: p.id },
        data: {
          ...(p.family ? { family: p.family } : {}),
          ...(p.bottles != null ? { bottles: p.bottles } : {}),
          ...(p.bonusBottles != null ? { bonusBottles: p.bonusBottles } : {}),
          ...(p.type ? { productType: p.type } : {}),
        },
      });
      applied++;
    }

    // Reescreve snapshots de COGS+frete nas orders afetadas + refresh MV.
    const cogsStats = applied > 0 ? await backfillCogs() : null;
    if (applied > 0) await refreshDailyMetricsNow();

    return NextResponse.json({
      ok: true,
      pending: pending.length,
      classified: proposals.length,
      applied,
      cogsStats,
      proposals,
    });
  } catch (err) {
    logger.error({ err }, 'admin/classify-ai failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
