// POST /api/admin/surveys/invites   (Bearer INGEST_SECRET — n8n — ou sessão ADMIN)
//
// Gera os convites de quem está com o estoque acabando e devolve os links pro
// n8n disparar (e-mail no Mautic, SMS no Twilio).
//   { "variant": "neuromind-pro", "withinDays": 7, "limit": 500,
//     "channel": "email" | "sms" | null, "dryRun": false }
// dryRun = só conta quantos são elegíveis. channel marca como enviado agora.
//
// Convite de teste (fora dos números da aba):
//   { "variant": "neuromind-pro", "test": { "email": "...", "firstName": "John", "bottles": 3 } }

import { NextResponse } from 'next/server';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { requireAdmin } from '@/lib/auth/guard';
import { createSurveyInvites, createSurveyTestInvite } from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(bearer)) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // corpo vazio = padrão
  }
  try {
    const slug = String(body.variant ?? 'neuromind-pro');
    if (body.test && typeof body.test === 'object') {
      const t = body.test as Record<string, unknown>;
      if (typeof t.email !== 'string' || !t.email.includes('@')) {
        return NextResponse.json({ error: 'test.email required' }, { status: 400 });
      }
      const inv = await createSurveyTestInvite({
        slug, email: t.email, firstName: typeof t.firstName === 'string' ? t.firstName : null, bottles: Number(t.bottles),
      });
      return inv ? NextResponse.json(inv) : NextResponse.json({ error: 'variant not found' }, { status: 404 });
    }
    const res = await createSurveyInvites({
      slug,
      withinDays: body.withinDays != null ? Number(body.withinDays) : undefined,
      limit: body.limit != null ? Number(body.limit) : undefined,
      dryRun: body.dryRun === true,
      channel: typeof body.channel === 'string' && body.channel ? body.channel : null,
    });
    if (!res) return NextResponse.json({ error: 'variant not found or inactive' }, { status: 404 });
    logger.info({ variant: res.variant, eligible: res.eligible, created: res.created }, 'survey invites');
    return NextResponse.json(res);
  } catch (err) {
    logger.error({ err }, 'survey invites failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
