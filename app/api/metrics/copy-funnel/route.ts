// GET /api/metrics/copy-funnel — observabilidade do Copy Optimizer (Painel C).
// Agrega CopyView × Order por stage/afiliado/layer + série diária. Admin-only
// (toda a área copy-optimizer é admin no dash). Cache em memória de 60s por
// combinação de filtros — janelas de horas não mudam a cada request.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { getCopyFunnel, type CopyFunnelPeriod } from '@/lib/services/copyFunnel';
import { getAutotuneConfig } from '@/lib/copy-optimizer/autotuneRunner';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERIODS: CopyFunnelPeriod[] = ['1h', '24h', '7d', '30d'];

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const periodRaw = searchParams.get('period') ?? '24h';
  const period = (PERIODS as string[]).includes(periodRaw) ? (periodRaw as CopyFunnelPeriod) : '24h';
  const stage = searchParams.get('stage') || null;
  const family = searchParams.get('family') || null;
  const affiliate = searchParams.get('affiliate') || null;
  // Target: usa o param explícito se vier; senão o globalTargetAov SALVO na
  // config (Painel D) — não o default fixo. Era o bug do "GAP vs $220".
  const targetRaw = Number(searchParams.get('target'));
  const target = Number.isFinite(targetRaw) && targetRaw > 0
    ? targetRaw
    : (await getAutotuneConfig()).globalTargetAov;

  const key = JSON.stringify({ period, stage, family, affiliate, target });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data);
  }

  try {
    const data = await getCopyFunnel({ period, stage, family, affiliate, target });
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    logger.error({ err }, 'metrics/copy-funnel failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
