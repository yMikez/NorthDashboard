// Aba Recorrências → Lista de recompra (quem está com o estoque acabando).
//
//   GET  /api/metrics/recurrences/repurchase?variant=all&withinDays=14[&tests=1]
//   POST /api/metrics/recurrences/repurchase  { action: "generate", variant?: "all", withinDays: 14 }
//        gera os convites (link pessoal) de quem entrou na janela — não envia nada
//   POST /api/metrics/recurrences/repurchase  { action: "sent", ids: [...], channel: "sms" }
//        marca como enviado (só o primeiro envio conta)
//
// Quem tem a aba opera a lista (é quem dispara); nome, e-mail e telefone de
// cliente, então só quem o admin liberar.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { activeSurveySlugs, createSurveyInvites, getRepurchaseList, markSurveyInvitesSent } from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNELS = new Set(['sms', 'email', 'whatsapp', 'manual']);

export async function GET(req: Request) {
  const auth = await requireTab('recurrences');
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  try {
    return NextResponse.json(await getRepurchaseList({
      slug: url.searchParams.get('variant'),
      withinDays: Number(url.searchParams.get('withinDays') ?? 14) || 14,
      includeTests: url.searchParams.get('tests') === '1',
    }));
  } catch (err) {
    logger.error({ err }, 'metrics/recurrences/repurchase failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireTab('recurrences');
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  try {
    if (body.action === 'sent') {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
      const channel = typeof body.channel === 'string' ? body.channel : '';
      if (!ids.length || !CHANNELS.has(channel)) return NextResponse.json({ error: 'ids e canal (sms, email, whatsapp, manual) obrigatórios' }, { status: 400 });
      const marked = await markSurveyInvitesSent(ids, channel);
      logger.info({ marked, channel, by: auth.user.email }, 'repurchase marked sent');
      return NextResponse.json({ marked });
    }
    if (body.action === 'generate') {
      const variant = typeof body.variant === 'string' && body.variant ? body.variant : 'all';
      const withinDays = Number(body.withinDays ?? 14) || 14;
      const results = [];
      for (const slug of await activeSurveySlugs(variant)) {
        const res = await createSurveyInvites({ slug, withinDays, limit: 5000 });
        if (res) results.push({ variant: res.variant, eligible: res.eligible, created: res.created });
      }
      logger.info({ results, withinDays, by: auth.user.email }, 'repurchase generated');
      return NextResponse.json({ created: results.reduce((s, r) => s + r.created, 0), variants: results });
    }
    return NextResponse.json({ error: 'action: generate | sent' }, { status: 400 });
  } catch (err) {
    logger.error({ err }, 'metrics/recurrences/repurchase POST failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
