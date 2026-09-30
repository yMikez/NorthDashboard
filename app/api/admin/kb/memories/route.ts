// GET /api/admin/kb/memories?status=pending|active|rejected → { memories }
//
// Fila de memórias sugeridas pela IA (e as já revisadas). Cada uma traz a
// evidência literal do usuário, a confiança do extrator e as entradas
// parecidas — o admin decide se é nova, duplicata ou atualização.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { listMemories, type MemoryStatus } from '@/lib/services/chatMemory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: MemoryStatus[] = ['pending', 'active', 'rejected'];

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const raw = new URL(req.url).searchParams.get('status') ?? 'pending';
  if (!(STATUSES as string[]).includes(raw)) return NextResponse.json({ error: 'status deve ser pending | active | rejected' }, { status: 400 });
  return NextResponse.json({ memories: await listMemories(raw as MemoryStatus) });
}
