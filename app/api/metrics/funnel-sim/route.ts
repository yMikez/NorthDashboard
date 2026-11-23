// GET /api/metrics/funnel-sim — base do Simulador de Funil: somas diárias por
// plataforma × família do FE × dia do FE × etapa (FE, Bump, OTO1–3, DS1–3).
// A tela filtra período, plataforma e produto e faz a conta no navegador.
// Regras: docs/kb/simulador-funil.md. Permissão: aba funnel-sim.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { respondCached } from '@/lib/shared/metricsResponse';
import { getFunnelSimulatorBase } from '@/lib/services/funnelSimulator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('funnel-sim');
  if (!auth.ok) return auth.response;
  try {
    return await respondCached('funnel-sim', new URL(req.url).searchParams, () => getFunnelSimulatorBase());
  } catch (err) {
    logger.error({ err }, 'metrics/funnel-sim failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
