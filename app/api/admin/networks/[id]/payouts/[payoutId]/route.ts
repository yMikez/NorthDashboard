// /api/admin/networks/[id]/payouts/[payoutId]
//   PATCH → marca payout como PAID. Body: { paymentMethod?, notes? }.
//           Audit log inclui actor + valores. Comissões do payout
//           recebem paidAt = now.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { markPayoutAsPaid } from '@/lib/services/payoutCalc';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchBody {
  action?: unknown;          // 'mark_paid'
  paymentMethod?: unknown;
  notes?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; payoutId: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: networkId, payoutId } = await params;

  let body: PatchBody;
  try { body = (await req.json()) as PatchBody; }
  catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }

  if (body.action !== 'mark_paid') {
    return NextResponse.json({ error: 'action inválida (use mark_paid)' }, { status: 400 });
  }

  const payout = await db.networkPayout.findUnique({
    where: { id: payoutId },
    select: { id: true, networkId: true, status: true, totalUsd: true },
  });
  if (!payout || payout.networkId !== networkId) {
    return NextResponse.json({ error: 'payout not found' }, { status: 404 });
  }

  const paymentMethod = typeof body.paymentMethod === 'string' && body.paymentMethod.trim()
    ? body.paymentMethod.trim() : null;
  const notes = typeof body.notes === 'string' && body.notes.trim()
    ? body.notes.trim() : null;

  const result = await markPayoutAsPaid(payoutId, auth.user.id, paymentMethod, notes);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  await audit({
    actorUserId: auth.user.id,
    entityType: 'NETWORK_PAYOUT',
    entityId: payoutId,
    action: 'mark_paid',
    before: { status: payout.status },
    after: {
      status: 'PAID',
      paymentMethod,
      notes,
      totalUsd: payout.totalUsd.toString(),
    },
  });

  logger.info(
    { actorId: auth.user.id, networkId, payoutId, paymentMethod },
    'admin.networks.payouts.mark_paid',
  );

  return NextResponse.json({ ok: true });
}
