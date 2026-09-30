// POST /api/chat/attachments — upload de UM anexo do chat (multipart).
//   Campos: file (obrigatório), conversationId (opcional — sem ele o anexo
//   nasce rascunho e é ligado à conversa quando a mensagem é enviada).
//   201 { attachment: AttachmentDTO }
//     ≤ 5 MB: extraído aqui mesmo → status READY (ou erro direto);
//     maior: status PROCESSING, termina em segundo plano — o cliente
//     acompanha por GET /api/chat/attachments/[id].
//   Erros: { error: código, message: PT-BR } — 400 envio inválido, 404
//   conversa, 409 limite da conversa, 413 tamanho, 415 tipo, 422 ilegível
//   (PDF com senha, corrompido, zip-bomb), 429 rascunhos demais.
//
// Aberto a qualquer usuário logado (decisão do dono); o anexo só é lido pelo
// dono. O tipo é decidido pelos bytes, nunca pela extensão/MIME do browser.

import { NextResponse, after } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';
import {
  ATTACHMENT_LIMITS,
  acceptUpload,
  getOwnedAttachment,
  processStoredAttachment,
  scheduleAttachmentCleanup,
} from '@/lib/rag/attachments';
import { toAttachmentDTO } from '@/lib/chat/attachmentDto';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Folga do envelope multipart (boundary, cabeçalhos das partes).
const MULTIPART_SLACK = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

const tooLarge = () => fail(413, 'too_large', `Arquivo maior que ${Math.round(ATTACHMENT_LIMITS.maxFileBytes / (1024 * 1024))} MB.`);

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  // Recusa antes de ler o corpo quando o próprio cabeçalho já passa do teto.
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > ATTACHMENT_LIMITS.maxFileBytes + MULTIPART_SLACK) return tooLarge();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'invalid_body', 'Envio inválido: use multipart/form-data com o campo "file".');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return fail(400, 'missing_file', 'Nenhum arquivo recebido (campo "file").');
  if (file.size > ATTACHMENT_LIMITS.maxFileBytes) return tooLarge();

  const rawConversation = form.get('conversationId');
  const conversationId = typeof rawConversation === 'string' && rawConversation.trim() ? rawConversation.trim() : null;
  if (conversationId && !ID_RE.test(conversationId)) return fail(400, 'invalid_conversation', 'conversationId inválido.');

  const bytes = Buffer.from(await file.arrayBuffer());
  // Corpo cortado no caminho (proxy, conexão) daria planilha com linhas a
  // menos e soma errada SEM erro — confere o tamanho que o cliente declarou.
  if (bytes.length !== file.size) return fail(400, 'incomplete_upload', 'Upload incompleto — tente enviar de novo.');

  scheduleAttachmentCleanup();
  const outcome = await acceptUpload({
    userId: auth.user.id,
    conversationId,
    fileName: file.name,
    bytes,
    declaredMime: file.type || undefined,
  });
  if (!outcome.ok) return fail(outcome.status, outcome.code, outcome.message);

  if (outcome.background) {
    const { documentId } = outcome;
    after(() =>
      processStoredAttachment(documentId).catch((err) =>
        logger.error({ err, documentId }, '[attachments] processamento em segundo plano não concluiu'),
      ),
    );
  }

  const row = await getOwnedAttachment(auth.user.id, outcome.documentId);
  if (!row) return fail(500, 'not_persisted', 'O anexo não foi gravado — tente de novo.');
  return NextResponse.json({ attachment: toAttachmentDTO(row) }, { status: 201 });
}
