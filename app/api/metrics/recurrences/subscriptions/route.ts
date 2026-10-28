// Aba Recorrências → Assinaturas.
//   GET /api/metrics/recurrences/subscriptions?start_date=&end_date=
// Período = novas, renovações, falhas e cancelamentos no intervalo; ativas,
// em atraso e receita mensal são o estado de agora.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getSubscriptionsDashboard } from '@/lib/services/subscriptions';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('recurrences');
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const start = new Date(url.searchParams.get('start_date') ?? '');
  const end = new Date(url.searchParams.get('end_date') ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: 'start_date and end_date are required (ISO 8601)' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getSubscriptionsDashboard({ start, end }));
  } catch (err) {
    logger.error({ err }, 'metrics/recurrences/subscriptions failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
