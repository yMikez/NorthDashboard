// Cobertura do dado por plataforma — alimenta o aviso de "leitura parcial"
// (DS1) nas abas que mostram reembolso.
//
//   GET /api/metrics/data-coverage
//
// Qualquer usuário logado: o aviso aparece em abas diferentes (Reembolsos,
// Visão geral, Lucro real), então não pode depender da permissão da aba
// Saúde. Só devolve contagens agregadas por plataforma.

import { NextResponse } from 'next/server';
import { requireAuth, denyPortfolio } from '@/lib/auth/guard';
import { getRefundCoverage } from '@/lib/services/refundCoverage';
import { respondCached } from '@/lib/shared/metricsResponse';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  // Visão da operação inteira: fora do alcance de quem tem carteira.
  const denied = denyPortfolio(auth.user);
  if (denied) return denied;
  try {
    return await respondCached('data-coverage', new URL(req.url).searchParams, () => getRefundCoverage());
  } catch (err) {
    logger.error({ err }, 'metrics/data-coverage failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
