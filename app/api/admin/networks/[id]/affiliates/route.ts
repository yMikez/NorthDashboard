// /api/admin/networks/[id]/affiliates
//   POST → vincula 1+ afiliados à network. Body: { affiliateIds: string[] }
//
// Idempotência: tenta criar todas as rows; falhas P2002 (já vinculado a
// outra network) viram skipped com explicação. NetworkAffiliate.affiliateId
// é unique global, então afiliado não pode estar em 2 networks ao mesmo tempo.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AttachBody {
  affiliateIds?: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: networkId } = await params;

  let body: AttachBody;
  try { body = (await req.json()) as AttachBody; }
  catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }

  const ids = Array.isArray(body.affiliateIds)
    ? body.affiliateIds.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'affiliateIds vazio' }, { status: 400 });
  }

  const network = await db.network.findUnique({ where: { id: networkId }, select: { id: true } });
  if (!network) return NextResponse.json({ error: 'network not found' }, { status: 404 });

  const attached: string[] = [];
  const conflicts: Array<{ affiliateId: string; reason: string }> = [];

  for (const affiliateId of ids) {
    try {
      await db.networkAffiliate.create({
        data: { networkId, affiliateId, attachedByUserId: auth.user.id },
      });
      attached.push(affiliateId);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          conflicts.push({ affiliateId, reason: 'já vinculado a uma network' });
        } else if (err.code === 'P2003') {
          conflicts.push({ affiliateId, reason: 'affiliate não existe' });
        } else {
          conflicts.push({ affiliateId, reason: `db error: ${err.code}` });
        }
      } else {
        throw err;
      }
    }
  }

  if (attached.length > 0) {
    await audit({
      actorUserId: auth.user.id,
      entityType: 'NETWORK_AFFILIATE',
      entityId: networkId,
      action: 'attach',
      after: { attached, conflicts },
    });
    logger.info({ actorId: auth.user.id, networkId, attachedCount: attached.length }, 'admin.networks.attach');
  }

  return NextResponse.json({ attached, conflicts });
}
