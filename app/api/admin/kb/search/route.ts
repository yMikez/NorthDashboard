// POST /api/admin/kb/search {query, scope?} → { passages (com ranks), lowConfidence, debug }
//
// "Testar busca" da aba de conhecimento: roda EXATAMENTE a busca do
// search_knowledge (sinônimos, FTS, trigram, denso, RRF, rerank) e devolve a
// posição em cada ranqueador — é assim que se depura por que um documento
// não aparece. Não conta uso (hitCount) e não enxerga anexos de ninguém.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { isSearchScope, MAX_RESULTS, searchKnowledge } from '@/lib/rag/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body: { query?: unknown; scope?: unknown; max_results?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return NextResponse.json({ error: 'query obrigatória' }, { status: 400 });
  const scope = body.scope == null ? 'knowledge' : body.scope;
  if (!isSearchScope(scope)) return NextResponse.json({ error: 'scope deve ser all | knowledge | attachments' }, { status: 400 });
  const maxResults = typeof body.max_results === 'number' ? Math.min(Math.max(Math.trunc(body.max_results), 1), MAX_RESULTS) : MAX_RESULTS;
  try {
    const res = await searchKnowledge({ queries: [query], scope, maxResults, debug: true, trackHits: false });
    return NextResponse.json(res);
  } catch (err) {
    logger.error({ err }, '[kb] teste de busca falhou');
    return NextResponse.json({ error: 'busca falhou', message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
