// Lista de recompra / pesquisa de fim do tratamento (n8n ou sessão ADMIN).
// Auth: header X-Ingest-Secret (credencial "Autenticação Webhook" do n8n),
// Authorization: Bearer <INGEST_SECRET>, ou sessão ADMIN.
//
// POST /api/admin/surveys/invites
//   Gera os convites de quem está com o estoque acabando e devolve só os NOVOS
//   (a mesma pessoa não entra duas vezes pro mesmo estoque).
//   { "variant": "neurorecall" | "all" (padrão: todas as ativas),
//     "withinDays": 7, "limit": 500, "channel": "email" | "sms" | null, "dryRun": false }
//   channel marca como enviado agora; dryRun só conta.
//   Convite de teste (fora dos números da aba):
//   { "variant": "neurorecall", "test": { "email": "...", "firstName": "John", "bottles": 3, "arm": "B"? } }
//   (arm força a versão do teste A/B no ar; sem ele, sorteia na abertura)
//
// GET /api/admin/surveys/invites?variant=all&withinDays=7&unsent=1
//   Relê a lista atual sem criar nada (estoque acaba em até N dias, inclusive
//   quem já ficou sem produto). unsent=1 = só quem ainda não recebeu.

import { NextResponse } from 'next/server';
import { requireIngestOrAdmin } from '@/lib/auth/ingestOrAdmin';
import {
  activeSurveySlugs, createSurveyInvites, createSurveyTestInvite, listSurveyInvites, type SurveyInviteOut,
} from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await requireIngestOrAdmin(req);
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // corpo vazio = padrão
  }
  try {
    const variant = typeof body.variant === 'string' && body.variant ? body.variant : 'all';
    if (body.test && typeof body.test === 'object') {
      const t = body.test as Record<string, unknown>;
      if (typeof t.email !== 'string' || !t.email.includes('@') || variant === 'all') {
        return NextResponse.json({ error: 'test.email e variant obrigatórios' }, { status: 400 });
      }
      const inv = await createSurveyTestInvite({
        slug: variant, email: t.email, firstName: typeof t.firstName === 'string' ? t.firstName : null, bottles: Number(t.bottles),
        arm: typeof t.arm === 'string' ? t.arm : null,
      });
      return inv ? NextResponse.json(inv) : NextResponse.json({ error: 'variant not found' }, { status: 404 });
    }
    const slugs = await activeSurveySlugs(variant);
    const results = [];
    for (const slug of slugs) {
      const res = await createSurveyInvites({
        slug,
        withinDays: body.withinDays != null ? Number(body.withinDays) : undefined,
        limit: body.limit != null ? Number(body.limit) : undefined,
        dryRun: body.dryRun === true,
        channel: typeof body.channel === 'string' && body.channel ? body.channel : null,
      });
      if (res) results.push(res);
    }
    if (!results.length) return NextResponse.json({ error: 'nenhuma pesquisa ativa com esse nome' }, { status: 404 });
    const invites: SurveyInviteOut[] = results.flatMap((r) => r.invites);
    const summary = results.map(({ variant: v, eligible, created }) => ({ variant: v, eligible, created }));
    logger.info({ summary }, 'survey invites');
    return NextResponse.json({
      eligible: results.reduce((s, r) => s + r.eligible, 0),
      created: invites.length,
      variants: summary,
      invites,
    });
  } catch (err) {
    logger.error({ err }, 'survey invites failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const denied = await requireIngestOrAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  try {
    const invites = await listSurveyInvites({
      slug: url.searchParams.get('variant'),
      withinDays: url.searchParams.get('withinDays') ? Number(url.searchParams.get('withinDays')) : undefined,
      onlyUnsent: url.searchParams.get('unsent') === '1',
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    });
    return NextResponse.json({ count: invites.length, invites });
  } catch (err) {
    logger.error({ err }, 'survey invites list failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
