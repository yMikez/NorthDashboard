// /api/admin/networks/[id]
//   GET    → detalhe completo da network (KPIs, afiliados, commissões
//            recentes, payouts, contrato atual + AOV agregado)
//   PATCH  → atualiza termos. Se mudou termos comerciais, gera nova versão
//            do contrato e invalida assinatura anterior.
//   DELETE → remove network (cascade pra affiliates/commissions/payouts/contracts).

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { generateContractVersion, commercialTermsChanged } from '@/lib/services/contractTemplate';
import { estimateNextPayout } from '@/lib/services/payoutCalc';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const network = await db.network.findUnique({
    where: { id },
    include: {
      contracts: { orderBy: { version: 'desc' }, take: 5 },
      affiliates: {
        include: {
          affiliate: {
            include: {
              platform: { select: { slug: true, displayName: true } },
              _count: { select: { orders: true } },
            },
          },
        },
        orderBy: { attachedAt: 'desc' },
      },
    },
  });
  if (!network) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Preview de comissões/payouts (últimos 10). Lista completa paginada via
  // /api/admin/networks/[id]/commissions e /payouts.
  const PREVIEW_TAKE = 10;
  const [commissions, commissionsTotal, payouts, payoutsTotal] = await Promise.all([
    db.networkCommission.findMany({
      where: { networkId: id },
      orderBy: { createdAt: 'desc' },
      take: PREVIEW_TAKE,
      include: {
        order: { select: { externalId: true, grossAmountUsd: true, orderedAt: true, country: true } },
        affiliate: { select: { externalId: true, nickname: true } },
      },
    }),
    db.networkCommission.count({ where: { networkId: id } }),
    db.networkPayout.findMany({
      where: { networkId: id },
      orderBy: { createdAt: 'desc' },
      take: PREVIEW_TAKE,
      include: {
        paidBy: { select: { id: true, name: true, email: true } },
        _count: { select: { commissions: true } },
      },
    }),
    db.networkPayout.count({ where: { networkId: id } }),
  ]);

  const next = await estimateNextPayout(network);

  // AOV agregado: média ponderada do AOV dos afiliados vinculados.
  // AOV de um afiliado = revenue total / orders count nos últimos 30d.
  // Network AOV = soma das revenues / soma das orders. Simples e honesto.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const affiliateIds = network.affiliates.map((a) => a.affiliateId);
  let networkAovUsd = '0';
  if (affiliateIds.length > 0) {
    const agg = await db.order.aggregate({
      where: {
        affiliateId: { in: affiliateIds },
        productType: 'FRONTEND',
        status: 'APPROVED',
        orderedAt: { gte: since },
      },
      _sum: { grossAmountUsd: true },
      _count: { id: true },
    });
    const totalRev = Number(agg._sum.grossAmountUsd ?? 0);
    const totalOrders = agg._count.id;
    networkAovUsd = totalOrders > 0 ? (totalRev / totalOrders).toFixed(2) : '0';
  }

  const lastContract = network.contracts[0];

  return NextResponse.json({
    network: {
      id: network.id,
      name: network.name,
      slug: network.slug,
      status: network.status,
      commissionType: network.commissionType,
      commissionValue: network.commissionValue.toString(),
      paymentPeriodValue: network.paymentPeriodValue,
      paymentPeriodUnit: network.paymentPeriodUnit,
      contractStart: network.contractStart.toISOString(),
      billingEmail: network.billingEmail,
      notes: network.notes,
      createdAt: network.createdAt.toISOString(),
      updatedAt: network.updatedAt.toISOString(),
      networkAovUsd,
      currentContract: lastContract ? {
        id: lastContract.id,
        version: lastContract.version,
        signedAt: lastContract.signedAt?.toISOString() ?? null,
        signedByUserId: lastContract.signedByUserId,
      } : null,
      nextPayout: {
        at: next.nextPayoutAt.toISOString(),
        accruedUsd: next.accruedTotalUsd,
        accruedCount: next.accruedCommissionsCount,
        lastPayoutAt: next.lastPayoutAt?.toISOString() ?? null,
      },
    },
    commissionsTotal,
    payoutsTotal,
    affiliates: network.affiliates.map((a) => ({
      id: a.id,
      attachedAt: a.attachedAt.toISOString(),
      affiliateId: a.affiliate.id,
      externalId: a.affiliate.externalId,
      nickname: a.affiliate.nickname,
      platformSlug: a.affiliate.platform.slug,
      platformName: a.affiliate.platform.displayName,
      ordersCount: a.affiliate._count.orders,
      lastOrderAt: a.affiliate.lastOrderAt?.toISOString() ?? null,
    })),
    commissions: commissions.map((c) => ({
      id: c.id,
      amountUsd: c.amountUsd.toString(),
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      paidAt: c.paidAt?.toISOString() ?? null,
      payoutId: c.payoutId,
      orderExternalId: c.order.externalId,
      orderGrossUsd: c.order.grossAmountUsd.toString(),
      orderedAt: c.order.orderedAt.toISOString(),
      country: c.order.country,
      affiliateExternalId: c.affiliate.externalId,
      affiliateNickname: c.affiliate.nickname,
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      totalUsd: p.totalUsd.toString(),
      commissionsCount: p.commissionsCount,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
      paidByName: p.paidBy?.name ?? p.paidBy?.email ?? null,
      paymentMethod: p.paymentMethod,
      notes: p.notes,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}

interface PatchBody {
  name?: unknown;
  status?: unknown;
  commissionType?: unknown;
  commissionValue?: unknown;
  paymentPeriodValue?: unknown;
  paymentPeriodUnit?: unknown;
  billingEmail?: unknown;
  notes?: unknown;
  contractStart?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: PatchBody;
  try { body = (await req.json()) as PatchBody; }
  catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }

  const before = await db.network.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const data: Prisma.NetworkUpdateInput = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (body.status === 'ACTIVE' || body.status === 'PAUSED') data.status = body.status;
  if (body.commissionType === 'FIXED' || body.commissionType === 'PERCENT') {
    data.commissionType = body.commissionType;
  }
  if (body.commissionValue !== undefined) {
    const v = Number(body.commissionValue);
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json({ error: 'commissionValue inválido' }, { status: 400 });
    }
    data.commissionValue = new Prisma.Decimal(v);
  }
  if (body.paymentPeriodValue !== undefined) {
    const v = Math.floor(Number(body.paymentPeriodValue));
    if (!Number.isFinite(v) || v < 1) {
      return NextResponse.json({ error: 'paymentPeriodValue inválido' }, { status: 400 });
    }
    data.paymentPeriodValue = v;
  }
  if (body.paymentPeriodUnit === 'DAYS' || body.paymentPeriodUnit === 'WEEKS' || body.paymentPeriodUnit === 'MONTHS') {
    data.paymentPeriodUnit = body.paymentPeriodUnit;
  }
  if ('billingEmail' in body) {
    data.billingEmail = typeof body.billingEmail === 'string' && body.billingEmail.trim()
      ? body.billingEmail.trim().toLowerCase() : null;
  }
  if ('notes' in body) {
    data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  }
  if (body.contractStart !== undefined) {
    const d = new Date(body.contractStart as string);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'contractStart inválido' }, { status: 400 });
    }
    data.contractStart = d;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nada pra atualizar' }, { status: 400 });
  }

  const updated = await db.network.update({ where: { id }, data });

  // Se mudou termos, gera nova versão do contrato (que invalida assinatura
  // anterior — o partner vê o aceite "expirado" e precisa re-aceitar).
  let newContractVersion: number | null = null;
  if (commercialTermsChanged(before, updated)) {
    const contract = await generateContractVersion(id);
    newContractVersion = contract.version;
    logger.info({ networkId: id, version: contract.version }, 'admin.networks.patch newContractVersion');
  }

  await audit({
    actorUserId: auth.user.id,
    entityType: 'NETWORK',
    entityId: id,
    action: 'update',
    before: {
      name: before.name, commissionType: before.commissionType,
      commissionValue: before.commissionValue.toString(),
      paymentPeriodValue: before.paymentPeriodValue,
      paymentPeriodUnit: before.paymentPeriodUnit,
      billingEmail: before.billingEmail, status: before.status,
      contractStart: before.contractStart.toISOString(),
    },
    after: {
      name: updated.name, commissionType: updated.commissionType,
      commissionValue: updated.commissionValue.toString(),
      paymentPeriodValue: updated.paymentPeriodValue,
      paymentPeriodUnit: updated.paymentPeriodUnit,
      billingEmail: updated.billingEmail, status: updated.status,
      contractStart: updated.contractStart.toISOString(),
      newContractVersion,
    },
  });

  return NextResponse.json({ ok: true, newContractVersion });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const network = await db.network.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!network) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Cascade: NetworkAffiliate, NetworkCommission, NetworkPayout, NetworkContract
  // todos têm onDelete: Cascade. Users com networkId apontando aqui ficam com
  // networkId=null (onDelete: SetNull) — admin precisa re-atribuir.
  await db.network.delete({ where: { id } });

  await audit({
    actorUserId: auth.user.id,
    entityType: 'NETWORK',
    entityId: id,
    action: 'delete',
    before: { name: network.name },
  });

  logger.info({ actorId: auth.user.id, networkId: id }, 'admin.networks.delete');
  return NextResponse.json({ ok: true });
}
