// /api/admin/networks/[id]/affiliates/[affiliateId]
//   DELETE → desvincula afiliado da network. NÃO afeta comissões já
//            contabilizadas. Vendas FUTURAS desse afiliado deixam de
//            gerar comissão até ser re-vinculado a alguma network.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; affiliateId: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: networkId, affiliateId } = await params;

  const link = await db.networkAffiliate.findUnique({
    where: { networkId_affiliateId: { networkId, affiliateId } },
    select: { id: true },
  });
  if (!link) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await db.networkAffiliate.delete({ where: { id: link.id } });

  await audit({
    actorUserId: auth.user.id,
    entityType: 'NETWORK_AFFILIATE',
    entityId: networkId,
    action: 'detach',
    before: { affiliateId },
  });

  logger.info({ actorId: auth.user.id, networkId, affiliateId }, 'admin.networks.detach');
  return NextResponse.json({ ok: true });
}
