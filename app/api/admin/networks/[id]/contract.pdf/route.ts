// /api/admin/networks/[id]/contract.pdf
//   GET → download do PDF da versão atual do contrato.
//
// Admin pode baixar contrato de qualquer network. Partner usa o endpoint
// /api/network/me/contract.pdf que escopa pela própria networkId.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { readPdfWithRegen } from '@/lib/services/contractTemplate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: networkId } = await params;

  const contract = await db.networkContract.findFirst({
    where: { networkId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });
  if (!contract) {
    return NextResponse.json({ error: 'contrato não encontrado' }, { status: 404 });
  }

  const buf = await readPdfWithRegen(contract.id);
  if (!buf) {
    return NextResponse.json({ error: 'falha ao gerar PDF' }, { status: 500 });
  }

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="contrato-v${contract.version}.pdf"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
