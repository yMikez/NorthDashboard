// /api/network/me/contract.pdf
//   GET → download do PDF da versão atual do contrato do partner logado.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireNetworkPartner } from '@/lib/auth/guard';
import { readPdf } from '@/lib/services/contractTemplate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireNetworkPartner();
  if (!auth.ok) return auth.response;

  const contract = await db.networkContract.findFirst({
    where: { networkId: auth.user.networkId },
    orderBy: { version: 'desc' },
    select: { pdfPath: true, version: true },
  });
  if (!contract) {
    return NextResponse.json({ error: 'contrato não encontrado' }, { status: 404 });
  }

  const buf = readPdf(contract.pdfPath);
  if (!buf) {
    return NextResponse.json({ error: 'PDF físico não encontrado no disco' }, { status: 500 });
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
