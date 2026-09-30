// POST /api/admin/chat-quality/replay — re-executa UMA tool de um turno
// registrado e compara com o que o modelo viu.
//   Body: { turnLogId?: string, messageId?: string, toolId: string }
//   → { tool, input, defaults, ms, error, bytesBefore, bytesAfter, hashBefore,
//       hashAfter, changed, changes: [{path, before, after, deltaPct}], after }
//
// Leitura da resposta: changed=false → o dado é o mesmo (o erro foi de
// leitura/cálculo do modelo); changed=true → o dado mudou desde o turno
// (estorno tardio, IPN atrasado) ou a tool mudou. O período default é o da
// tela naquele turno (bloco "intervalo" do contexto do turno).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { replayTurnTool } from '@/lib/services/chatTelemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_-]{4,80}$/;

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: { turnLogId?: unknown; messageId?: unknown; toolId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const turnLogId = typeof body.turnLogId === 'string' && ID_RE.test(body.turnLogId) ? body.turnLogId : undefined;
  const messageId = typeof body.messageId === 'string' && ID_RE.test(body.messageId) ? body.messageId : undefined;
  const toolId = typeof body.toolId === 'string' && ID_RE.test(body.toolId) ? body.toolId : undefined;
  if (!toolId || (!turnLogId && !messageId)) {
    return NextResponse.json({ error: 'toolId e (turnLogId ou messageId) obrigatórios' }, { status: 400 });
  }

  try {
    const out = await replayTurnTool({
      turnLogId,
      messageId,
      toolId,
      user: { id: auth.user.id, role: auth.user.role, allowedTabs: auth.user.allowedTabs as string[] },
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    const { ok: _ok, ...rest } = out;
    return NextResponse.json(rest);
  } catch (err) {
    logger.error({ err, turnLogId, messageId, toolId }, '[chat-quality] replay falhou');
    return NextResponse.json({ error: 'falha ao re-executar a tool' }, { status: 500 });
  }
}
