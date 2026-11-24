// Briefing da IA no topo da Visão geral (lib/briefing/service.ts).
//
//   GET  /api/metrics/briefing   → números da semana na hora; texto da IA
//        quando pronto (status: ready | generating | error — a tela pede de
//        novo enquanto gera).
//   POST /api/metrics/briefing   → gera o texto de novo (admin).
//
// Sem cache de resposta: o status muda enquanto a IA escreve e o texto já
// fica guardado no banco, 1 por dia por recorte.

import { NextResponse } from 'next/server';
import { requireAdmin, requireTab } from '@/lib/auth/guard';
import { getBriefing } from '@/lib/briefing/service';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireTab('overview');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getBriefing(auth.user));
  } catch (err) {
    logger.error({ err }, 'metrics/briefing failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getBriefing(auth.user, { regenerate: true }));
  } catch (err) {
    logger.error({ err }, 'metrics/briefing regenerate failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
