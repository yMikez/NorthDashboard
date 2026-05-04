// /api/network/me/contract/sign
//   POST → registra aceite do partner na versão atual do contrato.
//          Grava signedAt + signedByUserId + signatureIp.
//
// Idempotência: se já assinado, retorna 200 OK sem refazer.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireNetworkPartner } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireNetworkPartner();
  if (!auth.ok) return auth.response;

  const networkId = auth.user.networkId;

  const contract = await db.networkContract.findFirst({
    where: { networkId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, signedAt: true },
  });
  if (!contract) {
    return NextResponse.json({ error: 'contrato não encontrado' }, { status: 404 });
  }

  if (contract.signedAt) {
    return NextResponse.json({ ok: true, alreadySigned: true, signedAt: contract.signedAt.toISOString() });
  }

  // Best-effort capture do IP — pode estar vazio em local dev sem proxy.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || null;

  const signedAt = new Date();
  await db.networkContract.update({
    where: { id: contract.id },
    data: {
      signedAt,
      signedByUserId: auth.user.id,
      signatureIp: ip,
    },
  });

  await audit({
    actorUserId: auth.user.id,
    entityType: 'NETWORK_CONTRACT',
    entityId: contract.id,
    action: 'sign',
    after: { version: contract.version, signedAt: signedAt.toISOString(), ip },
  });

  logger.info(
    { actorId: auth.user.id, networkId, contractId: contract.id, version: contract.version },
    'network.me.contract.sign',
  );

  return NextResponse.json({ ok: true, signedAt: signedAt.toISOString() });
}
