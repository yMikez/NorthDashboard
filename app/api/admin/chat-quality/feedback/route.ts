// GET /api/admin/chat-quality/feedback?rating=-1|1&status=open|triaged|golden|fixed|wontfix|all&limit=50
//   → { items: [{ id, messageId, rating, reasons, comment, expected, status,
//        adminNote, createdAt, updatedAt, question, questionContext, answer,
//        answerBlocks, answerText, citations, trace }] }
//
// Só votos com shared=true: é o consentimento explícito de quem votou pra o
// admin ler pergunta + resposta (exceção única ao "nem admin lê chat
// alheio"). Defaults: 👎 em aberto, mais recentes primeiro.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { FEEDBACK_STATUSES, listSharedFeedback, type FeedbackStatus } from '@/lib/services/chatTelemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const q = new URL(req.url).searchParams;
  const ratingRaw = q.get('rating') ?? '-1';
  if (!['1', '-1', 'all'].includes(ratingRaw)) return NextResponse.json({ error: 'rating: 1, -1 ou all' }, { status: 400 });
  const statusRaw = q.get('status') ?? 'open';
  if (statusRaw !== 'all' && !(FEEDBACK_STATUSES as readonly string[]).includes(statusRaw)) {
    return NextResponse.json({ error: `status: all ou ${FEEDBACK_STATUSES.join(', ')}` }, { status: 400 });
  }
  const limit = Math.min(Math.max(Math.trunc(Number(q.get('limit')) || 50), 1), 100);

  try {
    const items = await listSharedFeedback({
      rating: ratingRaw === 'all' ? undefined : (Number(ratingRaw) as 1 | -1),
      status: statusRaw === 'all' ? undefined : (statusRaw as FeedbackStatus),
      limit,
    });
    return NextResponse.json({ items });
  } catch (err) {
    logger.error({ err }, '[chat-quality] listagem de feedback falhou');
    return NextResponse.json({ error: 'falha ao listar o feedback' }, { status: 500 });
  }
}
