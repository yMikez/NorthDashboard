// /api/admin/networks/[id]/payouts/[payoutId]
//   PATCH → marca payout como PAID. Body: { paymentMethod?, notes? }.
//           Audit log inclui actor + valores. Comissões do payout
//           recebem paidAt = now.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { markPayoutAsPaid } from '@/lib/services/payoutCalc';
import { sendPayoutPaid } from '@/lib/services/emails/payoutPaid';
import { logger } from '@/lib/logger';

function fmtUsd(n: string | number): string {
  const v = typeof n === 'number' ? n : Number(n);
  return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/\.(\d{2})$/, ',$1');
}
function fmtDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

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

  // Email pro partner. Recipient: billingEmail da network, fallback pro
  // primeiro user partner. Se nenhum, skip + log.
  try {
    const network = await db.network.findUniqueOrThrow({
      where: { id: networkId },
      select: { name: true, billingEmail: true, partnerUsers: { select: { email: true }, take: 1 } },
    });
    const fullPayout = await db.networkPayout.findUniqueOrThrow({
      where: { id: payoutId },
      select: { totalUsd: true, commissionsCount: true, periodStart: true, periodEnd: true },
    });
    const recipient = network.billingEmail || network.partnerUsers[0]?.email || null;
    if (recipient) {
      sendPayoutPaid({
        to: recipient,
        networkName: network.name,
        totalUsd: fmtUsd(fullPayout.totalUsd.toString()),
        commissionsCount: fullPayout.commissionsCount,
        periodStart: fmtDate(fullPayout.periodStart),
        periodEnd: fmtDate(fullPayout.periodEnd),
        paymentMethod,
        notes,
      }).catch((err) => logger.error({ err }, '[payouts.mark_paid] email failed'));
    } else {
      logger.warn({ networkId, payoutId }, '[payouts.mark_paid] no recipient — skipping email');
    }
  } catch (err) {
    logger.error({ err }, '[payouts.mark_paid] failed to dispatch email');
  }

  return NextResponse.json({ ok: true });
}
