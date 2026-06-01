// Seção "Recuperação": vendas trazidas por afiliados de recuperação (SMS/email
// re-engajando carrinho abandonado) + comissão devida. A "recuperação" aqui é
// uma FONTE (o afiliado), não um estágio de funil nem um produto.
//
// Comissão = gross da venda × commissionPct do afiliado. Computado on-the-fly
// (não vira payout — é só visibilidade). Sem split SMS/email ainda (falta sinal
// no dado; quando houver, entra como dimensão extra).

import { Prisma } from '@prisma/client';
import { db } from '../db';

export interface RecoveryFilters {
  startDate: Date;
  endDate: Date;
}

// Uma venda aprovada de um afiliado de recuperação, com a % dele.
export interface RecoveryOrderRow {
  affiliateId: string;
  externalId: string;
  nickname: string | null;
  commissionPct: number; // fração (0.30)
  grossUsd: number;
  orderedAt: string; // ISO
}

export interface RecoveryResponse {
  range: { start: string; end: string };
  kpis: {
    sales: number;
    grossUsd: number;
    commissionUsd: number;
    netUsd: number; // gross − comissão (residual da recuperação, pré outros custos)
  };
  byAffiliate: Array<{
    affiliateExternalId: string;
    nickname: string | null;
    commissionPct: number;
    sales: number;
    grossUsd: number;
    commissionUsd: number;
  }>;
  daily: Array<{ date: string; sales: number; grossUsd: number; commissionUsd: number }>;
}

const BRT_SHIFT_MS = 3 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Comissão de uma venda = gross × pct (fração). */
export function recoveryCommission(grossUsd: number, pct: number): number {
  return round2(grossUsd * pct);
}

/** Agrega as vendas em KPIs + por-afiliado + série diária BRT. Puro. */
export function reduceRecovery(
  rows: RecoveryOrderRow[],
  startDate: Date,
  endDate: Date,
): RecoveryResponse {
  let gross = 0;
  let commission = 0;
  const byAff = new Map<string, {
    externalId: string; nickname: string | null; pct: number;
    sales: number; gross: number; commission: number;
  }>();
  const byDay = new Map<string, { sales: number; gross: number; commission: number }>();

  for (const r of rows) {
    const c = recoveryCommission(r.grossUsd, r.commissionPct);
    gross += r.grossUsd;
    commission += c;

    let a = byAff.get(r.affiliateId);
    if (!a) {
      a = { externalId: r.externalId, nickname: r.nickname, pct: r.commissionPct, sales: 0, gross: 0, commission: 0 };
      byAff.set(r.affiliateId, a);
    }
    a.sales++; a.gross += r.grossUsd; a.commission += c;

    const day = new Date(new Date(r.orderedAt).getTime() - BRT_SHIFT_MS).toISOString().slice(0, 10);
    let d = byDay.get(day);
    if (!d) { d = { sales: 0, gross: 0, commission: 0 }; byDay.set(day, d); }
    d.sales++; d.gross += r.grossUsd; d.commission += c;
  }

  const byAffiliate = Array.from(byAff.values())
    .map((a) => ({
      affiliateExternalId: a.externalId,
      nickname: a.nickname,
      commissionPct: a.pct,
      sales: a.sales,
      grossUsd: round2(a.gross),
      commissionUsd: round2(a.commission),
    }))
    .sort((x, y) => y.grossUsd - x.grossUsd);

  const daily = Array.from(byDay.entries())
    .map(([date, d]) => ({ date, sales: d.sales, grossUsd: round2(d.gross), commissionUsd: round2(d.commission) }))
    .sort((x, y) => x.date.localeCompare(y.date));

  return {
    range: { start: startDate.toISOString(), end: endDate.toISOString() },
    kpis: {
      sales: rows.length,
      grossUsd: round2(gross),
      commissionUsd: round2(commission),
      netUsd: round2(gross - commission),
    },
    byAffiliate,
    daily,
  };
}

export async function getRecovery(filters: RecoveryFilters): Promise<RecoveryResponse> {
  const recAffs = await db.recoveryAffiliate.findMany({
    where: { enabled: true },
    select: {
      affiliateId: true,
      commissionPct: true,
      affiliate: { select: { externalId: true, nickname: true } },
    },
  });
  if (recAffs.length === 0) {
    return reduceRecovery([], filters.startDate, filters.endDate);
  }
  const pctById = new Map(recAffs.map((r) => [r.affiliateId, {
    pct: Number(r.commissionPct), externalId: r.affiliate.externalId, nickname: r.affiliate.nickname,
  }]));

  const orders = await db.order.findMany({
    where: {
      affiliateId: { in: recAffs.map((r) => r.affiliateId) },
      status: 'APPROVED',
      orderedAt: { gte: filters.startDate, lte: filters.endDate },
    },
    select: { affiliateId: true, grossAmountUsd: true, orderedAt: true },
  });

  const rows: RecoveryOrderRow[] = orders.map((o) => {
    const info = pctById.get(o.affiliateId!)!;
    return {
      affiliateId: o.affiliateId!,
      externalId: info.externalId,
      nickname: info.nickname,
      commissionPct: info.pct,
      grossUsd: Number(o.grossAmountUsd),
      orderedAt: o.orderedAt.toISOString(),
    };
  });

  return reduceRecovery(rows, filters.startDate, filters.endDate);
}

// ---------- Admin: gerenciar afiliados de recuperação ----------

export interface RecoveryAffiliateRow {
  id: string;
  affiliateId: string;
  affiliateExternalId: string;
  nickname: string | null;
  platformSlug: string;
  commissionPct: number;
  enabled: boolean;
  note: string | null;
}

export async function listRecoveryAffiliates(): Promise<RecoveryAffiliateRow[]> {
  const rows = await db.recoveryAffiliate.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, affiliateId: true, commissionPct: true, enabled: true, note: true,
      affiliate: { select: { externalId: true, nickname: true, platform: { select: { slug: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    affiliateId: r.affiliateId,
    affiliateExternalId: r.affiliate.externalId,
    nickname: r.affiliate.nickname,
    platformSlug: r.affiliate.platform.slug,
    commissionPct: Number(r.commissionPct),
    enabled: r.enabled,
    note: r.note,
  }));
}

/**
 * Marca um afiliado (por externalId + plataforma) como recovery com a % dada.
 * Upsert: re-marcar atualiza pct/enabled. Lança se o afiliado não existe.
 */
export async function upsertRecoveryAffiliate(input: {
  affiliateExternalId: string;
  platformSlug: string;
  commissionPct: number;
  note?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const aff = await db.affiliate.findFirst({
    where: { externalId: input.affiliateExternalId, platform: { slug: input.platformSlug } },
    select: { id: true },
  });
  if (!aff) return { error: 'afiliado não encontrado nessa plataforma' };

  await db.recoveryAffiliate.upsert({
    where: { affiliateId: aff.id },
    create: {
      affiliateId: aff.id,
      commissionPct: new Prisma.Decimal(input.commissionPct),
      note: input.note ?? null,
    },
    update: {
      commissionPct: new Prisma.Decimal(input.commissionPct),
      note: input.note ?? undefined,
      enabled: true,
    },
  });
  return { ok: true };
}
