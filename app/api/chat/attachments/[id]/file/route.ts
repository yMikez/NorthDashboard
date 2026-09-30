// GET /api/chat/attachments/[id]/file — bytes ORIGINAIS do anexo, só pro dono.
//
// Sempre como download (Content-Disposition: attachment), nunca renderizado
// na origem do dashboard: um HTML/SVG anexado aberto inline rodaria com a
// sessão do usuário. nosniff + CSP sandbox cobrem navegador que insista.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';
import { getOwnedAttachmentFile } from '@/lib/rag/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** filename (ASCII, fallback) + filename* (UTF-8) — RFC 6266. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'arquivo';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const file = await getOwnedAttachmentFile(auth.user.id, id);
  if (file.status === 'not_found') {
    return NextResponse.json({ error: 'not_found', message: 'Anexo não encontrado.' }, { status: 404 });
  }
  if (file.status === 'expired') {
    return NextResponse.json({ error: 'expired', message: 'O arquivo deste anexo foi removido ou expirou.' }, { status: 410 });
  }
  return new Response(new Uint8Array(file.data), {
    status: 200,
    headers: {
      'Content-Type': file.mimeType || 'application/octet-stream',
      'Content-Length': String(file.data.length),
      'Content-Disposition': contentDisposition(file.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
