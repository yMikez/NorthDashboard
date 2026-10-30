// Seção "Recuperação": vendas trazidas por afiliados de recuperação (SMS/email
// re-engajando carrinho abandonado) + comissão devida. A "recuperação" aqui é
// uma FONTE (o afiliado), não um estágio de funil nem um produto.
//
// Comissão = gross da venda × taxa VIGENTE NO MOMENTO DA VENDA (orderedAt),
// resolvida via RecoveryRatePeriod — mudar a % de um afiliado fecha o período
// aberto e abre um novo; vendas antigas ficam registradas com a taxa antiga e
// a resposta traz um contador por período. Computado on-the-fly (não vira
// payout — é só visibilidade).
//
// Reforma de 2026-10-26 (aba no molde da Visão geral):
//   - COMPRA = sessão do funil (front + upsells, mesma chave da Visão geral);
//     AOV do parceiro = receita ÷ compras.
//   - Reembolso das vendas do período (régua da aba Reembolsos: Digistore é
//     linha extra; in-place só com approvedAt).
//   - SMS próprio (trafficSource smsbrdcst / SMS_RECOVERY) entra como
//     parceiro "SMS próprio", sem comissão — o total bate com o estágio
//     Recuperação da Visão geral.
//   - Série diária com TODOS os dias e por empresa; período anterior.

import { Prisma } from '@prisma/client';
import { db, dbRead } from '../db';
import { isStorelessBuyGoodsKey, parseBuyGoodsAffiliateRef } from '../connectors/buygoods/affiliateKey';
import { SMS_UTM_SOURCE } from '../connectors/sms/config';
import { vupimAffiliateKey } from '../connectors/vupim/ingest';
import { EXTRA_ROW_REFUND_PLATFORMS } from './profitModel';

export interface RecoveryFilters {
  startDate: Date;
  endDate: Date;
  /** Filtro "Afiliado" da barra: só as contas de recuperação escolhidas. */
  affiliateIds?: string[];
}

// Período de taxa (já normalizado pra número/ISO).
export interface RatePeriod {
  commissionPct: number; // fração (0.30)
  effectiveFrom: string; // ISO
  effectiveTo: string | null; // null = vigente
}

// Uma linha de pedido de um parceiro de recuperação, com a taxa do PERÍODO
// que estava vigente quando a venda aconteceu + a taxa atual do afiliado.
//   kind 'sale'   → venda APROVADA (entra em receita, comissão, compras).
//   kind 'refund' → estorno/chargeback de venda do período; `inBase` diz se
//                   a linha também é a VENDA (in-place: a linha estornada é a
//                   venda) ou só o evento (Digistore: linha extra, a venda
//                   segue APPROVED e já está na base).
export interface RecoveryOrderRow {
  affiliateId: string;
  externalId: string;
  nickname: string | null;
  /** Empresa dona da conta (RecoveryAffiliate.note). Uma empresa pode ter
   *  várias contas — MailX é skill99 na Digistore e 364622 na BuyGoods. */
  company?: string | null;
  platformSlug?: string | null;
  commissionPct: number;    // taxa aplicada NESTA venda (do período dela)
  currentPct: number;       // taxa vigente do afiliado (pro cabeçalho da UI)
  periodFrom: string | null; // ISO do início do período (null = período inicial/epoch)
  periodTo: string | null;   // ISO do fim (null = vigente)
  grossUsd: number;
  orderedAt: string; // ISO
  /** Compra (sessão do funil: front + upsells). Sem ela, cada pedido é uma compra. */
  sessionKey?: string | null;
  /**
   * sale = venda aprovada; refund = estorno ligado à venda (inBase: a linha
   * in-place É a venda, conta na base do %); base = venda estornada in-place
   * sem data do estorno — entra só na base, não como estorno.
   */
  kind?: 'sale' | 'refund' | 'base';
  inBase?: boolean;
}

export interface RecoveryPeriodCounter {
  commissionPct: number;
  effectiveFrom: string | null; // null = desde sempre (período inicial)
  effectiveTo: string | null;   // null = vigente
  sales: number;
  grossUsd: number;
  commissionUsd: number;
}

/** Números de um recorte (total, empresa ou conta). */
export interface RecoveryMetrics {
  sales: number;          // pedidos aprovados (front + upsell)
  purchases: number;      // compras (sessões com venda aprovada)
  grossUsd: number;
  commissionUsd: number;
  netUsd: number;         // gross − comissão
  aovUsd: number | null;  // gross ÷ compras
  refunds: number;        // vendas do período que foram estornadas
  refundUsd: number;
  refundPct: number | null; // refunds ÷ vendas do período (fração)
}

export interface RecoveryDay {
  date: string;
  sales: number;
  purchases: number;
  grossUsd: number;
  commissionUsd: number;
  netUsd: number;
  /** Por empresa (rótulo de byCompany): o gráfico "por parceiro". */
  byCompany: Record<string, { grossUsd: number; purchases: number; commissionUsd: number }>;
}

export interface RecoveryResponse {
  range: { start: string; end: string };
  kpis: RecoveryMetrics;
  /** Visão principal da aba: uma linha por EMPRESA, com as contas dentro.
   *  O ID da conta é detalhe de plataforma, não identidade do parceiro. */
  byCompany: Array<RecoveryMetrics & {
    company: string;
    /** Taxa efetiva (comissão ÷ bruto) — contas com % diferente não viram média falsa. */
    effectivePct: number;
    /** Fatia da receita de recuperação do período (fração). */
    sharePct: number;
    accounts: Array<RecoveryMetrics & {
      affiliateExternalId: string;
      nickname: string | null;
      platformSlug: string | null;
      commissionPct: number;
    }>;
  }>;
  byAffiliate: Array<RecoveryMetrics & {
    affiliateExternalId: string;
    nickname: string | null;
    platformSlug?: string | null;
    company?: string | null;
    commissionPct: number; // taxa VIGENTE do afiliado
    // Contadores por período de taxa presentes no recorte. 1 entry quando a
    // % nunca mudou; N entries (mais recente primeiro) quando mudou no meio
    // do período filtrado — vendas antigas ficam no contador da taxa antiga.
    periods: RecoveryPeriodCounter[];
  }>;
  /** Todos os dias do período (BRT), inclusive os sem venda. */
  daily: RecoveryDay[];
  /** Mesmo recorte no período imediatamente anterior, de mesma duração (dia i ↔ dia i). */
  previous?: { range: { start: string; end: string }; kpis: RecoveryMetrics; daily: RecoveryDay[] } | null;
}

/** Pseudo-parceiro do SMS próprio (Mautic/Twilio): sem comissão, sem conta. */
export const SMS_PARTNER = { affiliateId: 'sms', externalId: 'SMS', company: 'SMS próprio' } as const;

const BRT_SHIFT_MS = 3 * 60 * 60 * 1000;
// Período inicial é backfilled com effectiveFrom na epoch; pra UI isso
// significa "desde sempre" — normalizamos pra null.
const EPOCH_MS = new Date('1971-01-01T00:00:00.000Z').getTime();
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

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

const brtDay = (iso: string | Date) => new Date(new Date(iso).getTime() - BRT_SHIFT_MS).toISOString().slice(0, 10);

/** Dias BRT de start a end (inclusive). */
function brtDays(start: Date, end: Date): string[] {
  const out: string[] = [];
  const last = brtDay(end);
  let cur = brtDay(start);
  while (cur <= last && out.length < 1000) {
    out.push(cur);
    cur = new Date(Date.parse(`${cur}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return out;
}

// Acumulador de um recorte.
class Acc {
  sales = 0; gross = 0; commission = 0; base = 0; refunds = 0; refundUsd = 0;
  sessions = new Set<string>();
  addSale(r: RecoveryOrderRow, c: number, key: string) {
    this.sales++; this.gross += r.grossUsd; this.commission += c; this.base++; this.sessions.add(key);
  }
  addRefund(r: RecoveryOrderRow) {
    this.refunds++; this.refundUsd += Math.abs(r.grossUsd); if (r.inBase) this.base++;
  }
  addBase() { this.base++; }
  metrics(): RecoveryMetrics {
    const purchases = this.sessions.size;
    return {
      sales: this.sales,
      purchases,
      grossUsd: round2(this.gross),
      commissionUsd: round2(this.commission),
      netUsd: round2(this.gross - this.commission),
      aovUsd: purchases > 0 ? round2(this.gross / purchases) : null,
      refunds: this.refunds,
      refundUsd: round2(this.refundUsd),
      refundPct: this.base > 0 ? round4(this.refunds / this.base) : null,
    };
  }
}

const companyLabel = (company: string | null | undefined, nickname: string | null, externalId: string) =>
  (company ?? '').trim() || nickname || externalId;

/** Agrega as linhas em KPIs + por empresa/conta (com períodos) + série diária BRT. Puro. */
export function reduceRecovery(
  rows: RecoveryOrderRow[],
  startDate: Date,
  endDate: Date,
): RecoveryResponse {
  const total = new Acc();
  interface PeriodAgg { pct: number; from: string | null; to: string | null; sales: number; gross: number; commission: number }
  const byAff = new Map<string, {
    externalId: string; nickname: string | null; currentPct: number;
    company: string | null; platformSlug: string | null;
    acc: Acc; periods: Map<string, PeriodAgg>;
  }>();
  const byCo = new Map<string, Acc>();
  interface DayAgg { acc: Acc; byCompany: Map<string, Acc> }
  const byDay = new Map<string, DayAgg>(brtDays(startDate, endDate).map((d) => [d, { acc: new Acc(), byCompany: new Map() }]));

  rows.forEach((r, i) => {
    let a = byAff.get(r.affiliateId);
    if (!a) {
      a = {
        externalId: r.externalId, nickname: r.nickname, currentPct: r.currentPct,
        company: r.company ?? null, platformSlug: r.platformSlug ?? null,
        acc: new Acc(), periods: new Map(),
      };
      byAff.set(r.affiliateId, a);
    }
    const label = companyLabel(r.company, r.nickname, r.externalId);
    let co = byCo.get(label);
    if (!co) { co = new Acc(); byCo.set(label, co); }
    const dayKey = brtDay(r.orderedAt);
    let day = byDay.get(dayKey);
    if (!day) { day = { acc: new Acc(), byCompany: new Map() }; byDay.set(dayKey, day); }
    let dayCo = day.byCompany.get(label);
    if (!dayCo) { dayCo = new Acc(); day.byCompany.set(label, dayCo); }

    if (r.kind === 'refund') {
      for (const x of [total, a.acc, co, day.acc, dayCo]) x.addRefund(r);
      return;
    }
    if (r.kind === 'base') {
      for (const x of [total, a.acc, co, day.acc, dayCo]) x.addBase();
      return;
    }
    const c = recoveryCommission(r.grossUsd, r.commissionPct);
    const key = r.sessionKey || `${r.affiliateId}#${i}`;
    for (const x of [total, a.acc, co, day.acc, dayCo]) x.addSale(r, c, key);

    // Período inicial (epoch) vira from=null ("desde sempre").
    const from = r.periodFrom && new Date(r.periodFrom).getTime() > EPOCH_MS ? r.periodFrom : null;
    const pKey = `${r.commissionPct}|${from ?? ''}`;
    let p = a.periods.get(pKey);
    if (!p) {
      p = { pct: r.commissionPct, from, to: r.periodTo, sales: 0, gross: 0, commission: 0 };
      a.periods.set(pKey, p);
    }
    p.sales++; p.gross += r.grossUsd; p.commission += c;
  });

  const kpis = total.metrics();
  const byAffiliate = Array.from(byAff.values())
    .map((a) => ({
      affiliateExternalId: a.externalId,
      nickname: a.nickname,
      platformSlug: a.platformSlug,
      company: a.company,
      commissionPct: a.currentPct,
      ...a.acc.metrics(),
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

  // Empresa: rótulo cadastrado (note) e, sem ele, o nome/ID da própria conta
  // — assim ninguém some da tela por falta de cadastro.
  const accountsByCo = new Map<string, typeof byAffiliate>();
  for (const a of byAffiliate) {
    const label = companyLabel(a.company, a.nickname, a.affiliateExternalId);
    const list = accountsByCo.get(label) ?? [];
    list.push(a);
    accountsByCo.set(label, list);
  }
  const byCompany = Array.from(byCo.entries())
    .map(([company, acc]) => {
      const m = acc.metrics();
      return {
        company,
        ...m,
        effectivePct: m.grossUsd > 0 ? round4(m.commissionUsd / m.grossUsd) : 0,
        sharePct: kpis.grossUsd > 0 ? round4(m.grossUsd / kpis.grossUsd) : 0,
        accounts: (accountsByCo.get(company) ?? [])
          .map(({ periods: _p, company: _c, ...a }) => ({ ...a, platformSlug: a.platformSlug ?? null }))
          .sort((x, y) => y.grossUsd - x.grossUsd),
      };
    })
    // Empate de faturamento: vem antes a empresa com a maior conta.
    .sort((x, y) => y.grossUsd - x.grossUsd || (y.accounts[0]?.grossUsd ?? 0) - (x.accounts[0]?.grossUsd ?? 0));

  const daily: RecoveryDay[] = Array.from(byDay.entries())
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([date, d]) => {
      const m = d.acc.metrics();
      return {
        date,
        sales: m.sales,
        purchases: m.purchases,
        grossUsd: m.grossUsd,
        commissionUsd: m.commissionUsd,
        netUsd: m.netUsd,
        byCompany: Object.fromEntries(Array.from(d.byCompany.entries()).map(([co, acc]) => {
          const cm = acc.metrics();
          return [co, { grossUsd: cm.grossUsd, purchases: cm.purchases, commissionUsd: cm.commissionUsd }];
        })),
      };
    });

  return {
    range: { start: startDate.toISOString(), end: endDate.toISOString() },
    kpis,
    byCompany,
    byAffiliate,
    daily,
  };
}

/** Chave da compra (sessão do funil), igual à da Visão geral (SESSION_KEY_SQL). */
export function recoverySessionKey(o: { platformSlug: string; externalId: string; parentExternalId: string | null; funnelSessionId: string | null }): string {
  const base = o.platformSlug === 'buygoods'
    ? (o.funnelSessionId ?? o.parentExternalId ?? o.externalId)
    : (o.parentExternalId ?? o.externalId);
  return `${o.platformSlug}:${base}`;
}

/** Período imediatamente anterior, mesma duração: [início − L, início − 1 ms]. */
export function recoveryPreviousWindow(start: Date, end: Date): { start: Date; end: Date } {
  const span = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  return { start: new Date(prevEnd.getTime() - span), end: prevEnd };
}

type RecAff = {
  affiliateId: string;
  commissionPct: unknown;
  note: string | null;
  affiliate: { externalId: string; nickname: string | null; platform: { slug: string } };
  ratePeriods: Array<{ commissionPct: unknown; effectiveFrom: Date; effectiveTo: Date | null }>;
};

const ORDER_SELECT = {
  id: true, affiliateId: true, grossAmountUsd: true, orderedAt: true, status: true, approvedAt: true,
  refundedAt: true, chargebackAt: true,
  externalId: true, parentExternalId: true, funnelSessionId: true,
  platform: { select: { slug: true } },
} as const;

type OrderPick = {
  id: string; affiliateId: string | null; grossAmountUsd: unknown; orderedAt: Date; status: string; approvedAt: Date | null;
  refundedAt: Date | null; chargebackAt: Date | null;
  externalId: string; parentExternalId: string | null; funnelSessionId: string | null; platform: { slug: string };
};

/** Dos pedidos dados, os estornos reconciliados por CSV sem a venda original casada. */
export function unmatchedCsvRefundsSql(ids: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT o.id FROM "Order" o
    WHERE o.id = ANY(${ids})
      AND o."rawMetadata"->>'_source' = 'csv-reconcile'
      AND o."rawMetadata"->>'matched_original_sale' = 'false'`;
}

/** Linhas do recorte [start, end] (afiliados de recuperação + SMS próprio). */
async function loadRecoveryRows(recAffs: RecAff[], start: Date, end: Date, includeSms: boolean): Promise<RecoveryOrderRow[]> {
  const infoById = new Map(recAffs.map((r) => [r.affiliateId, {
    currentPct: Number(r.commissionPct),
    externalId: r.affiliate.externalId,
    nickname: r.affiliate.nickname,
    company: r.note,
    platformSlug: r.affiliate.platform.slug,
    periods: r.ratePeriods.map((p): RatePeriod => ({
      commissionPct: Number(p.commissionPct),
      effectiveFrom: p.effectiveFrom.toISOString(),
      effectiveTo: p.effectiveTo?.toISOString() ?? null,
    })),
  }]));
  const recIds = recAffs.map((r) => r.affiliateId);
  const statusIn = { in: ['APPROVED', 'REFUNDED', 'CHARGEBACK'] as Array<'APPROVED' | 'REFUNDED' | 'CHARGEBACK'> };

  const [orders, smsOrders] = await Promise.all([
    recIds.length
      ? dbRead.order.findMany({
          where: { affiliateId: { in: recIds }, status: statusIn, orderedAt: { gte: start, lte: end } },
          select: ORDER_SELECT,
        }) as Promise<OrderPick[]>
      : Promise.resolve([] as OrderPick[]),
    includeSms
      ? dbRead.order.findMany({
          where: {
            status: statusIn,
            orderedAt: { gte: start, lte: end },
            OR: [{ trafficSource: { equals: SMS_UTM_SOURCE, mode: 'insensitive' } }, { productType: 'SMS_RECOVERY' }],
            // Venda de afiliado de recuperação que veio por SMS conta pro afiliado (a Visão geral faz igual).
            ...(recIds.length ? { AND: [{ OR: [{ affiliateId: null }, { affiliateId: { notIn: recIds } }] }] } : {}),
          },
          select: ORDER_SELECT,
        }) as Promise<OrderPick[]>
      : Promise.resolve([] as OrderPick[]),
  ]);

  // Linha de estorno reconciliada por CSV SEM venda original casada: o
  // orderedAt dela é a data do ESTORNO, não da venda — fica fora (mesma
  // exclusão da aba Reembolsos). Consulta só sobre as poucas linhas de estorno.
  const refundIds = [...orders, ...smsOrders].filter((o) => o.status !== 'APPROVED').map((o) => o.id);
  const unmatched = new Set(refundIds.length
    ? (await dbRead.$queryRaw<Array<{ id: string }>>(unmatchedCsvRefundsSql(refundIds))).map((r) => r.id)
    : []);

  // Estorno: a linha só conta se dá pra ligar à venda — Digistore (linha
  // extra, a venda segue APPROVED) ou in-place com approvedAt (a linha É a
  // venda) — e tem a data do estorno. Mesma régua da aba Reembolsos.
  const toRow = (o: OrderPick, base: Omit<RecoveryOrderRow, 'grossUsd' | 'orderedAt' | 'sessionKey' | 'kind' | 'inBase'>): RecoveryOrderRow | null => {
    const common = {
      ...base,
      grossUsd: Number(o.grossAmountUsd),
      orderedAt: o.orderedAt.toISOString(),
      sessionKey: recoverySessionKey({ platformSlug: o.platform.slug, externalId: o.externalId, parentExternalId: o.parentExternalId, funnelSessionId: o.funnelSessionId }),
    };
    if (o.status === 'APPROVED') return { ...common, kind: 'sale' };
    const extraRow = EXTRA_ROW_REFUND_PLATFORMS.has(o.platform.slug);
    if (!extraRow && !o.approvedAt) return null;
    if (unmatched.has(o.id)) return null;
    // Sem data do estorno não vira evento (régua da aba Reembolsos); a linha
    // in-place com approvedAt segue sendo uma venda da base.
    if (!(o.refundedAt ?? o.chargebackAt)) return extraRow ? null : { ...common, kind: 'base' };
    return { ...common, kind: 'refund', inBase: !extraRow };
  };

  const rows: RecoveryOrderRow[] = [];
  for (const o of orders) {
    const info = infoById.get(o.affiliateId!)!;
    const period = ratePeriodAt(info.periods, o.orderedAt);
    const row = toRow(o, {
      affiliateId: o.affiliateId!,
      externalId: info.externalId,
      nickname: info.nickname,
      company: info.company,
      platformSlug: info.platformSlug,
      commissionPct: period?.commissionPct ?? info.currentPct,
      currentPct: info.currentPct,
      periodFrom: period?.effectiveFrom ?? null,
      periodTo: period?.effectiveTo ?? null,
    });
    if (row) rows.push(row);
  }
  for (const o of smsOrders) {
    const row = toRow(o, {
      affiliateId: SMS_PARTNER.affiliateId,
      externalId: SMS_PARTNER.externalId,
      nickname: SMS_PARTNER.company,
      company: SMS_PARTNER.company,
      platformSlug: null,
      commissionPct: 0,
      currentPct: 0,
      periodFrom: null,
      periodTo: null,
    });
    if (row) rows.push(row);
  }
  return rows;
}

export async function getRecovery(filters: RecoveryFilters): Promise<RecoveryResponse> {
  const recAffs = await dbRead.recoveryAffiliate.findMany({
    where: { enabled: true, ...(filters.affiliateIds?.length ? { affiliateId: { in: filters.affiliateIds } } : {}) },
    select: {
      affiliateId: true,
      commissionPct: true,
      note: true,
      affiliate: { select: { externalId: true, nickname: true, platform: { select: { slug: true } } } },
      ratePeriods: {
        orderBy: { effectiveFrom: 'asc' },
        select: { commissionPct: true, effectiveFrom: true, effectiveTo: true },
      },
    },
  });
  // SMS próprio não tem conta: com o filtro de afiliado ativo, fica de fora.
  const includeSms = !filters.affiliateIds?.length;
  const prevWin = recoveryPreviousWindow(filters.startDate, filters.endDate);
  const [rows, prevRows] = await Promise.all([
    loadRecoveryRows(recAffs, filters.startDate, filters.endDate, includeSms),
    loadRecoveryRows(recAffs, prevWin.start, prevWin.end, includeSms),
  ]);
  const cur = reduceRecovery(rows, filters.startDate, filters.endDate);
  const prev = reduceRecovery(prevRows, prevWin.start, prevWin.end);
  return {
    ...cur,
    previous: { range: prev.range, kpis: prev.kpis, daily: prev.daily.map((d) => ({ ...d, byCompany: {} })) },
  };
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
  /** Conta BuyGoods antiga, sem loja: nunca mais recebe venda (o aff_id é por loja). */
  storeless: boolean;
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
    storeless: r.affiliate.platform.slug === 'buygoods' && isStorelessBuyGoodsKey(r.affiliate.externalId),
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
 *
 * BuyGoods: o aff_id é numerado POR LOJA, então a conta é `aff_id@loja`. Aceita
 * o link do checkout do parceiro (traz aff_id e account_id) ou `ID@loja`; o ID
 * sozinho é recusado — marcar o "62" sem loja creditava o Nicolas (12595) à
 * MailX (13457).
 */
export async function upsertRecoveryAffiliate(input: {
  affiliateExternalId: string;
  platformSlug: string;
  commissionPct: number;
  note?: string | null;
  /** Nome do parceiro. Preenche o nickname só quando a plataforma não mandou um. */
  nickname?: string | null;
  /**
   * Cria a conta de afiliado se ela ainda não existir. Serve pra marcar um
   * parceiro de recuperação ANTES da primeira venda (acordo fechado, tráfego
   * ainda não começou) — sem isso o cadastro só é possível depois da primeira
   * venda, e a primeira leva de vendas entra classificada como front.
   * Quando a venda chegar, upsertOrder casa pela mesma chave
   * (platformId, externalId) e só atualiza a linha: a marca sobrevive.
   */
  createIfMissing?: boolean;
}): Promise<{ ok: true; created?: boolean; affiliateExternalId: string } | { error: string; status?: number }> {
  let externalId = input.affiliateExternalId.trim();
  if (input.platformSlug === 'buygoods') {
    const ref = parseBuyGoodsAffiliateRef(externalId);
    if (!ref.ok) return { error: ref.error, status: 400 };
    externalId = ref.key;
  }
  // Vupim: o ID copiado do painel vem com "VP" na frente; a venda chega sem.
  if (input.platformSlug === 'vupim') externalId = vupimAffiliateKey(externalId);
  let aff = await db.affiliate.findFirst({
    where: { externalId, platform: { slug: input.platformSlug } },
    select: { id: true, nickname: true },
  });
  let createdAccount = false;
  if (!aff) {
    if (!input.createIfMissing) return { error: 'afiliado não encontrado nessa plataforma' };
    const platform = await db.platform.findUnique({ where: { slug: input.platformSlug }, select: { id: true } });
    if (!platform) return { error: `plataforma desconhecida: ${input.platformSlug}` };
    aff = await db.affiliate.create({
      data: {
        platformId: platform.id,
        externalId,
        nickname: input.nickname?.trim() || null,
        firstSeenAt: new Date(),
      },
      select: { id: true, nickname: true },
    });
    createdAccount = true;
  } else if (!aff.nickname && input.nickname?.trim()) {
    // A plataforma não manda nome pra essa conta — usa o que o operador deu.
    // Se já existe nickname, a plataforma continua sendo a fonte.
    await db.affiliate.update({ where: { id: aff.id }, data: { nickname: input.nickname.trim() } });
  }

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
  return { ok: true, created: createdAccount, affiliateExternalId: externalId };
}
