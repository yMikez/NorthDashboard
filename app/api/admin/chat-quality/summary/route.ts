// GET /api/admin/chat-quality/summary?days=7|30 — painel "Qualidade da IA".
//   → { turns, thumbsUp, thumbsDown, latencyP50, latencyP95, ttftP50, costUsd,
//       cacheHitRatio, cacheHitRatioFirstRound, truncatedPct, outputTruncatedPct,
//       forcedFinalPct, toolErrorRate, ungroundedPct,
//       byTool: [{name, calls, errors, avgBytes, avgMs}],
//       byDay: [{day, turns, costUsd, thumbsUp, thumbsDown}],
//       byPromptVersion: [{promptVersion, turns, costUsd, thumbsDown, firstSeen}] }
//
// Unidades: *Pct = pontos percentuais (12.3 = 12,3%); *Ratio/*Rate = fração.
// Latências em ms. Dia = dia civil BRT. Turnos do eval ficam fora.
// Só agregados — nenhum texto de conversa sai daqui.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { getQualitySummary } from '@/lib/services/chatTelemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const raw = new URL(req.url).searchParams.get('days');
  const days = raw === null ? 7 : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return NextResponse.json({ error: 'days: inteiro de 1 a 90 (7 ou 30 no painel)' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getQualitySummary(days));
  } catch (err) {
    logger.error({ err }, '[chat-quality] summary falhou');
    return NextResponse.json({ error: 'falha ao calcular o resumo' }, { status: 500 });
  }
}
