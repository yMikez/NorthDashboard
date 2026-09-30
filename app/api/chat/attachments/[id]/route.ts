// GET    /api/chat/attachments/[id] — estado/metadados do anexo (o composer
//        consulta enquanto PROCESSING). { attachment: AttachmentDTO }
// DELETE /api/chat/attachments/[id] — rascunho some de vez; anexo já enviado
//        vira "removido" (o histórico passa a dizer que ele saiu). 204.
//
// Só o DONO (nem admin lê anexo alheio): outro usuário recebe 404 — nem a
// existência do id vaza.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';
import { getOwnedAttachment, removeAttachment } from '@/lib/rag/attachments';
import { toAttachmentDTO } from '@/lib/chat/attachmentDto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'not_found', message: 'Anexo não encontrado.' }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const row = await getOwnedAttachment(auth.user.id, id);
  if (!row) return notFound();
  return NextResponse.json({ attachment: toAttachmentDTO(row) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const result = await removeAttachment(auth.user.id, id);
  if (result === 'not_found') return notFound();
  return new Response(null, { status: 204 });
}
