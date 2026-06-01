// /api/admin/recovery-affiliates
//   GET  → lista afiliados marcados como recuperação.
//   POST → marca um afiliado (externalId + plataforma) como recuperação com %.
// Admin-only. commissionPct vem em PERCENTUAL (30) e é guardado como fração.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { listRecoveryAffiliates, upsertRecoveryAffiliate } from '@/lib/services/recovery';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ affiliates: await listRecoveryAffiliates() });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const affiliateExternalId = typeof body.affiliateExternalId === 'string' ? body.affiliateExternalId.trim() : '';
  const platformSlug = typeof body.platformSlug === 'string' ? body.platformSlug.trim() : '';
  const pctNum = typeof body.commissionPct === 'number' ? body.commissionPct : Number(body.commissionPct);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  if (!affiliateExternalId) return NextResponse.json({ error: 'affiliateExternalId obrigatório' }, { status: 400 });
  if (!platformSlug) return NextResponse.json({ error: 'platformSlug obrigatório' }, { status: 400 });
  if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
    return NextResponse.json({ error: 'commissionPct deve estar entre 0 e 100' }, { status: 400 });
  }

  const res = await upsertRecoveryAffiliate({
    affiliateExternalId,
    platformSlug,
    commissionPct: Math.round((pctNum / 100) * 10000) / 10000, // percent → fração
    note,
  });
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 });

  logger.info({ actorId: auth.user.id, affiliateExternalId, platformSlug, pct: pctNum }, 'admin.recovery-affiliates.upsert');
  return NextResponse.json({ ok: true });
}
