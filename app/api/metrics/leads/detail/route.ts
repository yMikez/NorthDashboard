// GET /api/metrics/leads/detail?email= — ficha de UM lead: todos os eventos
// (funil, call center, SalesBound), produtos comprados e LTV, lidos ao vivo.
// Tab-gated (leads).

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getLeadDetail } from '@/lib/services/leads';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('leads');
  if (!auth.ok) return auth.response;
  const email = new URL(req.url).searchParams.get('email') ?? '';
  try {
    const detail = await getLeadDetail(email);
    if (!detail) return NextResponse.json({ error: 'e-mail inválido' }, { status: 400 });
    return NextResponse.json(detail);
  } catch (err) {
    logger.error({ err }, 'metrics/leads/detail failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
