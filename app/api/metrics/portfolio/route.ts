// Carteira de afiliados (aba Carteira).
//
//   GET  /api/metrics/portfolio
//        → equipe visível, desempenho por captador, afiliados da carteira,
//          fila sem dono, pedidos e histórico (lib/portfolio/service.ts)
//   POST /api/metrics/portfolio  { action, ... }
//        claim   { key: partner:<id>|aff:<id>, note? }   ← quem tem função pede
//        cancel  { claimId }
//        approve { claimId, note? } / reject { claimId, note? }  ← líder de quem pediu ou operação
//        assign  { key, ownerUserId, note? }   ← SL/Gerente (pra si ou pra equipe abaixo) ou operação
//        release { key, note? }
//
// Sem cache de resposta: cada um vê a própria equipe e a resposta muda a
// cada ação.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { getPortfolio, portfolioAction, PortfolioError, type PortfolioActionInput } from '@/lib/portfolio/service';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireTab('portfolio');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getPortfolio(auth.user));
  } catch (err) {
    logger.error({ err }, 'metrics/portfolio failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function parseAction(b: Record<string, unknown>): PortfolioActionInput | null {
  const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null;
  switch (b.action) {
    case 'claim': { const key = str(b.key); return key ? { action: 'claim', key, note } : null; }
    case 'cancel': { const claimId = str(b.claimId); return claimId ? { action: 'cancel', claimId } : null; }
    case 'approve':
    case 'reject': { const claimId = str(b.claimId); return claimId ? { action: b.action, claimId, note } : null; }
    case 'assign': {
      const key = str(b.key); const ownerUserId = str(b.ownerUserId);
      return key && ownerUserId ? { action: 'assign', key, ownerUserId, note } : null;
    }
    case 'release': { const key = str(b.key); return key ? { action: 'release', key, note } : null; }
    default: return null;
  }
}

export async function POST(req: Request) {
  const auth = await requireTab('portfolio');
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const input = parseAction(body);
  if (!input) return NextResponse.json({ error: 'ação ou parâmetros inválidos' }, { status: 400 });
  try {
    const res = await portfolioAction(auth.user, input);
    logger.info({ actorId: auth.user.id, action: input.action }, 'portfolio.action');
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof PortfolioError) return NextResponse.json({ error: err.message }, { status: err.status });
    logger.error({ err, action: input.action }, 'portfolio action failed');
    return NextResponse.json({ error: 'falhou' }, { status: 500 });
  }
}
