// POST /api/admin/kb/seed → 202 { started, status }
// GET  /api/admin/kb/seed → { status }
//
// Re-sincroniza docs/kb com a base GLOBAL sem esperar o próximo boot
// (idempotente por sha256: o que não mudou não reindexa). Roda em segundo
// plano — acompanhe pelo GET ou pelo /stats. Auth: sessão ADMIN ou bearer
// INGEST_SECRET (mesmo padrão do seed-glossary, pra rodar por linha de
// comando depois de um deploy).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { getSeedStatus, seedKnowledgeBase } from '@/lib/rag/seed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorized(req: Request): Promise<NextResponse | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return null;
  const auth = await requireAdmin();
  return auth.ok ? null : auth.response;
}

export async function GET(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  return NextResponse.json({ status: getSeedStatus() });
}

export async function POST(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  const alreadyRunning = getSeedStatus().running;
  // Erro do seed vai pro log e pro status (lastError); a resposta não espera.
  void seedKnowledgeBase().catch(() => undefined);
  return NextResponse.json({ started: !alreadyRunning, status: getSeedStatus() }, { status: 202 });
}
