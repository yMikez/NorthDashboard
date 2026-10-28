// POST /api/admin/surveys/invites/sent   (n8n: X-Ingest-Secret; ou sessão ADMIN)
//
// Quem dispara (e-mail, SMS…) marca os convites enviados — é o que separa
// "na lista" de "recebeu" na aba Pesquisas e tira a pessoa do GET ?unsent=1.
//   { "ids": ["<SurveyInvite.id>", …], "channel": "email" }

import { NextResponse } from 'next/server';
import { markSurveyInvitesSent } from '@/lib/services/surveys';
import { requireIngestOrAdmin } from '@/lib/auth/ingestOrAdmin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await requireIngestOrAdmin(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
  const channel = typeof body.channel === 'string' ? body.channel.trim() : '';
  if (!ids.length || !channel) return NextResponse.json({ error: 'ids e channel obrigatórios' }, { status: 400 });
  const marked = await markSurveyInvitesSent(ids, channel);
  logger.info({ marked, channel }, 'survey invites sent');
  return NextResponse.json({ marked });
}
