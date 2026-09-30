// GET /api/admin/kb/stats → { pinnedChars, pinnedMaxChars, documents, chunks, lastSeedAt, trigram, dense, seed, pendingMemories }
//
// Medidor da aba de conhecimento: quanto das entradas fixas cabe no prompt,
// tamanho da base, último seed de docs/kb e quais ranqueadores estão ativos
// neste servidor (trigram depende do pg_trgm; denso da VOYAGE_API_KEY).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { isDenseEnabled } from '@/lib/rag/embed';
import { hasTrigram } from '@/lib/rag/search';
import { getSeedStatus } from '@/lib/rag/seed';
import { getPinnedUsage } from '@/lib/services/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const [usage, documents, chunks, trigram, pendingMemories] = await Promise.all([
    getPinnedUsage(),
    db.kbDocument.count({ where: { scope: 'GLOBAL' } }),
    db.kbChunk.count({ where: { scope: 'GLOBAL' } }),
    hasTrigram(),
    db.knowledgeEntry.count({ where: { source: 'auto', status: 'pending' } }),
  ]);
  const seed = getSeedStatus();
  return NextResponse.json({
    pinnedChars: usage.pinnedChars,
    pinnedMaxChars: usage.pinnedMaxChars,
    pinnedOverflow: usage.overflowIds.length,
    documents,
    chunks,
    lastSeedAt: seed.lastSeedAt,
    trigram,
    dense: isDenseEnabled(),
    pendingMemories,
    seed: { running: seed.running, lastError: seed.lastError, results: seed.lastResults },
  });
}
