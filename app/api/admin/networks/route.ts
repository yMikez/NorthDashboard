// /api/admin/networks
//   GET  → lista todas as networks com KPIs agregadas (active count,
//          accrued balance, sales mensal estimado).
//   POST → cria network + contrato v1 (gera PDF).

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { generateContractVersion } from '@/lib/services/contractTemplate';
import { estimateNextPayout } from '@/lib/services/payoutCalc';
import { parsePagination, paginatedResponse } from '@/lib/pagination';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'network';
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const pagination = parsePagination(url, { defaultPageSize: 25 });
  const q = (url.searchParams.get('q') ?? '').trim();
  const where: Prisma.NetworkWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {};

  const [networks, total] = await Promise.all([
    db.network.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        _count: { select: { affiliates: true } },
        contracts: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true, signedAt: true, signedByUserId: true },
        },
      },
    }),
    db.network.count({ where }),
  ]);

  // Agregados por-network: accrued total + sales count last 30d.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const accrued = await db.networkCommission.groupBy({
    by: ['networkId', 'status'],
    _sum: { amountUsd: true },
    _count: { id: true },
  });
  const last30Sales = await db.networkCommission.groupBy({
    by: ['networkId'],
    where: { createdAt: { gte: since } },
    _sum: { amountUsd: true },
    _count: { id: true },
  });

  const accruedByNet = new Map<string, { accruedUsd: string; accruedCount: number; paidCount: number }>();
  for (const row of accrued) {
    const e = accruedByNet.get(row.networkId) ?? { accruedUsd: '0', accruedCount: 0, paidCount: 0 };
    if (row.status === 'ACCRUED') {
      e.accruedUsd = (row._sum.amountUsd ?? 0).toString();
      e.accruedCount = row._count.id;
    } else if (row.status === 'PAID') {
      e.paidCount = row._count.id;
    }
    accruedByNet.set(row.networkId, e);
  }
  const last30ByNet = new Map<string, { totalUsd: string; count: number }>();
  for (const row of last30Sales) {
    last30ByNet.set(row.networkId, {
      totalUsd: (row._sum.amountUsd ?? 0).toString(),
      count: row._count.id,
    });
  }

  const items = networks.map((n) => {
    const acc = accruedByNet.get(n.id) ?? { accruedUsd: '0', accruedCount: 0, paidCount: 0 };
    const last30 = last30ByNet.get(n.id) ?? { totalUsd: '0', count: 0 };
    const lastContract = n.contracts[0];
    return {
      id: n.id,
      name: n.name,
      slug: n.slug,
      status: n.status,
      commissionType: n.commissionType,
      commissionValue: n.commissionValue.toString(),
      paymentPeriodValue: n.paymentPeriodValue,
      paymentPeriodUnit: n.paymentPeriodUnit,
      contractStart: n.contractStart.toISOString(),
      billingEmail: n.billingEmail,
      notes: n.notes,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      affiliatesCount: n._count.affiliates,
      accruedUsd: acc.accruedUsd,
      accruedCount: acc.accruedCount,
      last30SalesUsd: last30.totalUsd,
      last30SalesCount: last30.count,
      contractVersion: lastContract?.version ?? null,
      contractSigned: !!lastContract?.signedAt,
      contractSignedAt: lastContract?.signedAt?.toISOString() ?? null,
    };
  });

  // Backward-compat: top-level `networks` mantido pra clients antigos.
  // `pagination` é o novo envelope.
  const paged = paginatedResponse(items, total, pagination);
  return NextResponse.json({
    networks: paged.items,
    pagination: { page: paged.page, pageSize: paged.pageSize, total: paged.total, hasMore: paged.hasMore },
  });
}

interface CreateBody {
  name?: unknown;
  commissionType?: unknown;        // 'FIXED' | 'PERCENT'
  commissionValue?: unknown;       // number (FIXED=USD, PERCENT=fraction)
  paymentPeriodValue?: unknown;    // int >= 1
  paymentPeriodUnit?: unknown;     // 'DAYS' | 'WEEKS' | 'MONTHS'
  billingEmail?: unknown;
  notes?: unknown;
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try { body = (await req.json()) as CreateBody; }
  catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const commissionType = body.commissionType === 'PERCENT' ? 'PERCENT' : 'FIXED';
  const commissionValueNum = typeof body.commissionValue === 'number'
    ? body.commissionValue : Number(body.commissionValue);
  const paymentPeriodValue = typeof body.paymentPeriodValue === 'number'
    ? Math.floor(body.paymentPeriodValue) : Number.parseInt(String(body.paymentPeriodValue), 10);
  const paymentPeriodUnit =
    body.paymentPeriodUnit === 'WEEKS' ? 'WEEKS'
    : body.paymentPeriodUnit === 'MONTHS' ? 'MONTHS'
    : 'DAYS';
  const billingEmail = typeof body.billingEmail === 'string' && body.billingEmail.trim()
    ? body.billingEmail.trim().toLowerCase() : null;
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  if (!name) return NextResponse.json({ error: 'nome obrigatório' }, { status: 400 });
  if (!Number.isFinite(commissionValueNum) || commissionValueNum <= 0) {
    return NextResponse.json({ error: 'commissionValue inválido' }, { status: 400 });
  }
  if (commissionType === 'PERCENT' && commissionValueNum > 1) {
    return NextResponse.json({ error: 'PERCENT espera fração (0.05 = 5%)' }, { status: 400 });
  }
  if (!Number.isFinite(paymentPeriodValue) || paymentPeriodValue < 1) {
    return NextResponse.json({ error: 'paymentPeriodValue inválido' }, { status: 400 });
  }

  // Slug colision-safe: appende -2, -3, etc. se já existir.
  const baseSlug = slugify(name);
  let slug = baseSlug;
  for (let i = 2; i < 100; i++) {
    const exists = await db.network.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) break;
    slug = `${baseSlug}-${i}`;
  }

  try {
    const created = await db.network.create({
      data: {
        name,
        slug,
        commissionType,
        commissionValue: new Prisma.Decimal(commissionValueNum),
        paymentPeriodValue,
        paymentPeriodUnit,
        billingEmail,
        notes,
      },
    });

    // Gerar contrato v1 imediatamente — o partner vai precisar assinar.
    const contract = await generateContractVersion(created.id);

    await audit({
      actorUserId: auth.user.id,
      entityType: 'NETWORK',
      entityId: created.id,
      action: 'create',
      after: {
        name, slug, commissionType, commissionValue: commissionValueNum,
        paymentPeriodValue, paymentPeriodUnit, billingEmail,
      },
    });

    logger.info({ actorId: auth.user.id, networkId: created.id, slug }, 'admin.networks.create');

    return NextResponse.json({
      network: {
        id: created.id,
        name: created.name,
        slug: created.slug,
        status: created.status,
        commissionType: created.commissionType,
        commissionValue: created.commissionValue.toString(),
        paymentPeriodValue: created.paymentPeriodValue,
        paymentPeriodUnit: created.paymentPeriodUnit,
        contractStart: created.contractStart.toISOString(),
        billingEmail: created.billingEmail,
        notes: created.notes,
        contractVersion: contract.version,
        contractSigned: false,
      },
    }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'admin.networks.create failed');
    return NextResponse.json({ error: 'create failed' }, { status: 500 });
  }
}
