// Seção "Recuperação": vendas trazidas por afiliados de recuperação (SMS/email
// re-engajando carrinho abandonado) + comissão devida. A "recuperação" aqui é
// uma FONTE (o afiliado), não um estágio de funil nem um produto.
//
// Comissão = gross da venda × taxa VIGENTE NO MOMENTO DA VENDA (orderedAt),
// resolvida via RecoveryRatePeriod — mudar a % de um afiliado fecha o período
// aberto e abre um novo; vendas antigas ficam registradas com a taxa antiga e
// a resposta traz um contador por período. Computado on-the-fly (não vira
// payout — é só visibilidade).

import { Prisma } from '@prisma/client';
import { db } from '../db';

export interface RecoveryFilters {
  startDate: Date;
  endDate: Date;
}

// Período de taxa (já normalizado pra número/ISO).
export interface RatePeriod {
  commissionPct: number; // fração (0.30)
  effectiveFrom: string; // ISO
  effectiveTo: string | null; // null = vigente
}

// Uma venda aprovada de um afiliado de recuperação, com a taxa do PERÍODO
// que estava vigente quando ela aconteceu + a taxa atual do afiliado.
export interface RecoveryOrderRow {
  affiliateId: string;
  externalId: string;
  nickname: string | null;
  commissionPct: number;    // taxa aplicada NESTA venda (do período dela)
  currentPct: number;       // taxa vigente do afiliado (pro cabeçalho da UI)
  periodFrom: string | null; // ISO do início do período (null = período inicial/epoch)
  periodTo: string | null;   // ISO do fim (null = vigente)
  grossUsd: number;
  orderedAt: string; // ISO
}

export interface RecoveryPeriodCounter {
  commissionPct: number;
  effectiveFrom: string | null; // null = desde sempre (período inicial)
  effectiveTo: string | null;   // null = vigente
  sales: number;
  grossUsd: number;
  commissionUsd: number;
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
    commissionPct: number; // taxa VIGENTE do afiliado
    sales: number;
    grossUsd: number;
    commissionUsd: number;
    // Contadores por período de taxa presentes no recorte. 1 entry quando a
    // % nunca mudou; N entries (mais recente primeiro) quando mudou no meio
    // do período filtrado — vendas antigas ficam no contador da taxa antiga.
    periods: RecoveryPeriodCounter[];
  }>;
  daily: Array<{ date: string; sales: number; grossUsd: number; commissionUsd: number }>;
}

const BRT_SHIFT_MS = 3 * 60 * 60 * 1000;
// Período inicial é backfilled com effectiveFrom na epoch; pra UI isso
// significa "desde sempre" — normalizamos pra null.
const EPOCH_MS = new Date('1971-01-01T00:00:00.000Z').getTime();
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Comissão de uma venda = gross × pct (fração). */
export function recoveryCommission(grossUsd: number, pct: number): number {
  return round2(grossUsd * pct);
}

/**
 * Taxa vigente num instante: último período com effectiveFrom <= t e
 * (effectiveTo null ou t < effectiveTo). `periods` deve vir ordenado por
 * effectiveFrom ASC. Fallback: taxa do último período (vendas fora de
 * qualquer janela não deveriam existir — período inicial começa na epoch).
 */
export function ratePeriodAt(periods: RatePeriod[], at: Date): RatePeriod | null {
  if (!periods.length) return null;
  const t = at.getTime();
  let match: RatePeriod | null = null;
  for (const p of periods) {
    const from = new Date(p.effectiveFrom).getTime();
    const to = p.effectiveTo ? new Date(p.effectiveTo).getTime() : Infinity;
    if (t >= from && t < to) match = p;
  }
  return match ?? periods[periods.length - 1];
}

/** Agrega as vendas em KPIs + por-afiliado (com períodos) + série diária BRT. Puro. */
export function reduceRecovery(
  rows: RecoveryOrderRow[],
  startDate: Date,
  endDate: Date,
): RecoveryResponse {
  let gross = 0;
  let commission = 0;
  interface PeriodAgg { pct: number; from: string | null; to: string | null; sales: number; gross: number; commission: number }
  const byAff = new Map<string, {
    externalId: string; nickname: string | null; currentPct: number;
    sales: number; gross: number; commission: number;
    periods: Map<string, PeriodAgg>;
  }>();
  const byDay = new Map<string, { sales: number; gross: number; commission: number }>();

  for (const r of rows) {
    const c = recoveryCommission(r.grossUsd, r.commissionPct);
    gross += r.grossUsd;
    commission += c;

    let a = byAff.get(r.affiliateId);
    if (!a) {
      a = {
        externalId: r.externalId, nickname: r.nickname, currentPct: r.currentPct,
        sales: 0, gross: 0, commission: 0, periods: new Map(),
      };
      byAff.set(r.affiliateId, a);
    }
    a.sales++; a.gross += r.grossUsd; a.commission += c;

    // Período inicial (epoch) vira from=null ("desde sempre").
    const from = r.periodFrom && new Date(r.periodFrom).getTime() > EPOCH_MS ? r.periodFrom : null;
    const pKey = `${r.commissionPct}|${from ?? ''}`;
    let p = a.periods.get(pKey);
    if (!p) {
      p = { pct: r.commissionPct, from, to: r.periodTo, sales: 0, gross: 0, commission: 0 };
      a.periods.set(pKey, p);
    }
    p.sales++; p.gross += r.grossUsd; p.commission += c;

    const day = new Date(new Date(r.orderedAt).getTime() - BRT_SHIFT_MS).toISOString().slice(0, 10);
    let d = byDay.get(day);
    if (!d) { d = { sales: 0, gross: 0, commission: 0 }; byDay.set(day, d); }
    d.sales++; d.gross += r.grossUsd; d.commission += c;
  }

  const byAffiliate = Array.from(byAff.values())
    .map((a) => ({
      affiliateExternalId: a.externalId,
      nickname: a.nickname,
      commissionPct: a.currentPct,
      sales: a.sales,
      grossUsd: round2(a.gross),
      commissionUsd: round2(a.commission),
      periods: Array.from(a.periods.values())
        // mais recente primeiro (vigente no topo); período inicial (from null) por último
        .sort((x, y) => (y.from ?? '').localeCompare(x.from ?? ''))
        .map((p) => ({
          commissionPct: p.pct,
          effectiveFrom: p.from,
          effectiveTo: p.to,
          sales: p.sales,
          grossUsd: round2(p.gross),
          commissionUsd: round2(p.commission),
        })),
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
      ratePeriods: {
        orderBy: { effectiveFrom: 'asc' },
        select: { commissionPct: true, effectiveFrom: true, effectiveTo: true },
      },
    },
  });
  if (recAffs.length === 0) {
    return reduceRecovery([], filters.startDate, filters.endDate);
  }
  const infoById = new Map(recAffs.map((r) => [r.affiliateId, {
    currentPct: Number(r.commissionPct),
    externalId: r.affiliate.externalId,
    nickname: r.affiliate.nickname,
    periods: r.ratePeriods.map((p): RatePeriod => ({
      commissionPct: Number(p.commissionPct),
      effectiveFrom: p.effectiveFrom.toISOString(),
      effectiveTo: p.effectiveTo?.toISOString() ?? null,
    })),
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
    const info = infoById.get(o.affiliateId!)!;
    const period = ratePeriodAt(info.periods, o.orderedAt);
    return {
      affiliateId: o.affiliateId!,
      externalId: info.externalId,
      nickname: info.nickname,
      commissionPct: period?.commissionPct ?? info.currentPct,
      currentPct: info.currentPct,
      periodFrom: period?.effectiveFrom ?? null,
      periodTo: period?.effectiveTo ?? null,
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
  // Histórico de taxas (mais recente primeiro) pro painel de gerência.
  ratePeriods: RatePeriod[];
}

export async function listRecoveryAffiliates(): Promise<RecoveryAffiliateRow[]> {
  const rows = await db.recoveryAffiliate.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, affiliateId: true, commissionPct: true, enabled: true, note: true,
      affiliate: { select: { externalId: true, nickname: true, platform: { select: { slug: true } } } },
      ratePeriods: {
        orderBy: { effectiveFrom: 'desc' },
        select: { commissionPct: true, effectiveFrom: true, effectiveTo: true },
      },
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
    ratePeriods: r.ratePeriods.map((p) => ({
      commissionPct: Number(p.commissionPct),
      effectiveFrom: p.effectiveFrom.toISOString(),
      effectiveTo: p.effectiveTo?.toISOString() ?? null,
    })),
  }));
}

// Início do período inicial: epoch — cobre vendas anteriores à marcação,
// preservando a semântica que o cálculo on-the-fly sempre teve.
const INITIAL_PERIOD_START = new Date(0);

/**
 * Marca um afiliado (por externalId + plataforma) como recovery com a % dada.
 * Upsert: re-marcar com a MESMA % só atualiza note/enabled; % DIFERENTE fecha
 * o período de taxa vigente (effectiveTo = agora) e abre um novo — vendas
 * antigas continuam comissionadas pela taxa antiga. Lança se o afiliado não
 * existe.
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

  const newPct = new Prisma.Decimal(input.commissionPct);

  await db.$transaction(async (tx) => {
    const existing = await tx.recoveryAffiliate.findUnique({
      where: { affiliateId: aff.id },
      select: { id: true, commissionPct: true },
    });

    if (!existing) {
      await tx.recoveryAffiliate.create({
        data: {
          affiliateId: aff.id,
          commissionPct: newPct,
          note: input.note ?? null,
          ratePeriods: {
            create: { commissionPct: newPct, effectiveFrom: INITIAL_PERIOD_START },
          },
        },
      });
      return;
    }

    const pctChanged = Number(existing.commissionPct) !== input.commissionPct;
    await tx.recoveryAffiliate.update({
      where: { id: existing.id },
      data: {
        commissionPct: newPct,
        note: input.note ?? undefined,
        enabled: true,
      },
    });

    if (pctChanged) {
      const now = new Date();
      const closed = await tx.recoveryRatePeriod.updateMany({
        where: { recoveryAffiliateId: existing.id, effectiveTo: null },
        data: { effectiveTo: now },
      });
      await tx.recoveryRatePeriod.create({
        data: {
          recoveryAffiliateId: existing.id,
          commissionPct: newPct,
          // Sem período aberto (estado legado sem backfill) → novo período
          // cobre desde a epoch, igual ao inicial.
          effectiveFrom: closed.count > 0 ? now : INITIAL_PERIOD_START,
        },
      });
    } else {
      // Garantia defensiva: afiliado sem nenhum período (estado pré-migration
      // que não deveria existir) ganha o período inicial.
      const count = await tx.recoveryRatePeriod.count({
        where: { recoveryAffiliateId: existing.id },
      });
      if (count === 0) {
        await tx.recoveryRatePeriod.create({
          data: {
            recoveryAffiliateId: existing.id,
            commissionPct: newPct,
            effectiveFrom: INITIAL_PERIOD_START,
          },
        });
      }
    }
  });
  return { ok: true };
}
