// /api/admin/callcenter-watches — watchlist do monitor de call center.
//   GET  → lista watches (incl. desabilitados).
//   POST → adiciona { platformSlug, family|null (null = toda a plataforma), note? }.
// Admin-only (sessão). Remoção em [id]/route.ts. Produto integrado com o
// call center = REMOVER o watch (o alerta some da aba Produtos).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { normalizeFamilyKey } from '@/lib/services/callCenter';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PLATFORMS = new Set(['clickbank', 'digistore24', 'buygoods', 'cartpanda', 'jvzoo']);

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const watches = await db.callCenterWatch.findMany({ orderBy: [{ platformSlug: 'asc' }, { family: 'asc' }] });
  return NextResponse.json({ watches });
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

  const platformSlug = String(body.platformSlug ?? '').trim().toLowerCase();
  if (!VALID_PLATFORMS.has(platformSlug)) {
    return NextResponse.json({ error: 'invalid platformSlug' }, { status: 400 });
  }
  const familyRaw = typeof body.family === 'string' ? body.family.trim() : '';
  const family = familyRaw === '' ? null : familyRaw;
  const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;

  try {
    // Dedup pela chave NORMALIZADA (mesma régua do match do serviço):
    // "Retra Burn" e "RetraBurn" são o MESMO watch. find+create em vez de
    // upsert porque o unique composto não serve quando family é NULL.
    const all = await db.callCenterWatch.findMany({ where: { platformSlug } });
    const existing = all.find((w) =>
      (w.family === null) === (family === null)
      && (family === null || normalizeFamilyKey(w.family as string) === normalizeFamilyKey(family)));
    const watch = existing
      ? await db.callCenterWatch.update({
          where: { id: existing.id },
          // note só muda quando o body traz — re-adicionar não apaga anotação.
          data: { enabled: true, ...(note !== null ? { note } : {}) },
        })
      : await db.callCenterWatch.create({ data: { platformSlug, family, note } });
    clearResponseCache();
    logger.info({ platformSlug, family }, 'callcenter watch added');
    return NextResponse.json({ watch });
  } catch (err) {
    logger.error({ err }, 'admin/callcenter-watches POST failed');
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
