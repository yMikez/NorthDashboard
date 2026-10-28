// Rotas que o n8n e o admin usam igual: segredo de ingestão (header
// X-Ingest-Secret — o que a credencial "Autenticação Webhook" do n8n manda —
// ou Authorization: Bearer) ou sessão ADMIN.

import type { NextResponse } from 'next/server';
import { checkIngestSecret } from '../ingest/auth';
import { requireAdmin } from './guard';

/** null = liberado; senão a resposta de erro pronta. */
export async function requireIngestOrAdmin(req: Request): Promise<NextResponse | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (checkIngestSecret(req.headers.get('x-ingest-secret')) || checkIngestSecret(bearer)) return null;
  const auth = await requireAdmin();
  return auth.ok ? null : auth.response;
}
