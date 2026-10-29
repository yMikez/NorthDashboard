// GET   /api/metrics/surveys?variant=&start_date=&end_date=   aba Pesquisas
//       (período = quando cada coisa aconteceu: gerado, enviado, aberto, respondido,
//       comprado; &tests=1 inclui os convites de teste)
// PATCH /api/metrics/surveys  { id, status: aberto|ligado|resolvido, note? }  fila do CS

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getSurveyDashboard, setSurveyCsStatus } from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireTab('surveys');
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const start = new Date(url.searchParams.get('start_date') ?? '');
  const end = new Date(url.searchParams.get('end_date') ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: 'start_date and end_date are required (ISO 8601)' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getSurveyDashboard({
      slug: url.searchParams.get('variant'), start, end, includeTests: url.searchParams.get('tests') === '1',
    }));
  } catch (err) {
    logger.error({ err }, 'metrics/surveys failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireTab('surveys');
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const ok = await setSurveyCsStatus(
    String(body.id ?? ''), String(body.status ?? ''),
    body.note === undefined ? undefined : (body.note == null ? null : String(body.note)),
  );
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not found or invalid status' }, { status: 400 });
}
