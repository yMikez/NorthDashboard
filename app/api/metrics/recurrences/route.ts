// Aba Recorrências — assinaturas de todas as plataformas.
//   GET /api/metrics/recurrences?start_date=&end_date=[&platform=jvzoo][&product=jvzoo:123]
// Período = renovações recebidas, novas e encerradas no intervalo; ativas,
// em atraso, receita mensal e previsão são o estado de agora.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getRecurrences } from '@/lib/services/recurrences';
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
    return NextResponse.json(await getRecurrences({
      start, end,
      platform: url.searchParams.get('platform'),
      product: url.searchParams.get('product'),
    }));
  } catch (err) {
    logger.error({ err }, 'metrics/recurrences failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
