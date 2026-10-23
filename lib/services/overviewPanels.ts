// Visão geral — painéis que não vêm da daily_metrics (reforma de 2026-10-23):
//
//   1. Receita por ESTÁGIO DE CAPTAÇÃO (decisão do usuário):
//        front      → funil das plataformas: front + upsells + downsells + bump
//        backend    → call center e cross-sell: Tauk, Logicall, SalesBound
//        recuperação→ afiliados de recuperação (MailX etc.) + SMS próprio
//      Mesma separação do modelo de lucro (profitSplit.ts): o que é de
//      recuperação/SMS NÃO conta no front. Call center e SalesBound não têm
//      plataforma/produto/afiliado: com filtro desses ativo, o backend some
//      (`backend.available = false`) em vez de mostrar um global.
//   2. Reembolso dos ÚLTIMOS 60 DIAS pela régua da aba Reembolsos
//      (refundCohorts.ts): vendas feitas nos últimos 60 dias × estornos
//      dessas vendas (cada estorno volta pro dia da venda). A conta antiga do
//      card (estornos que ACONTECERAM no período ÷ pedidos FEITOS no período)
//      misturava eixos e passava de 100% em período curto.
//   3. Séries diárias pro gráfico: reembolso (pela data do estorno), Net
//      after CPA (modelo da planilha CPA, a mesma conta do profitSplit.front)
//      e AOV por sessão (mesma base do card de AOV).
//
// Dia = dia de calendário em BRT, como a daily_metrics.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { SESSION_KEY_SQL, type MetricsFilters } from './metrics';
import { getProfitModelInputs } from './profitModel';
import { getRefundCohorts } from './refundCohorts';
import { EXTRA_ROW_REFUND_PLATFORMS } from './profitModel';
import { SMS_UTM_SOURCE } from '../connectors/sms/config';
import { affiliateSqlCond } from '../shared/affiliateFilter';

export const REFUND_WINDOW_DAYS = 60;

const BRT_DAY = (col: Prisma.Sql) =>
  Prisma.sql`to_char(((${col}) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`;

/** Filtros de ORDEM da barra (alias o / pl / pr). */
export function orderScopeSql(f: MetricsFilters): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];
  if (f.platformSlugs?.length) c.push(Prisma.sql`pl."slug" = ANY(${f.platformSlugs})`);
  if (f.countries?.length) c.push(Prisma.sql`o."country" = ANY(${f.countries})`);
  if (f.productFamilies?.length) c.push(Prisma.sql`pr."family" = ANY(${f.productFamilies})`);
  if (f.productExternalIds?.length) c.push(Prisma.sql`pr."externalId" = ANY(${f.productExternalIds})`);
  if (f.productTypes?.length) c.push(Prisma.sql`o."productType" = ANY(${f.productTypes}::"ProductType"[])`);
  if (f.mappedAffiliateIds?.length) c.push(Prisma.sql`o."mappedAffiliateId" = ANY(${f.mappedAffiliateIds})`);
  if (f.affiliateIds?.length) c.push(affiliateSqlCond(f.affiliateIds, 'o'));
  return c;
}

export function hasOrderScope(f: MetricsFilters): boolean {
  return orderScopeSql(f).length > 0;
}

const where = (f: MetricsFilters, extra: Prisma.Sql[]) =>
  Prisma.join([Prisma.sql`o."orderedAt" >= ${f.startDate}`, Prisma.sql`o."orderedAt" <= ${f.endDate}`, ...orderScopeSql(f), ...extra], ' AND ');

/**
 * Vendas aprovadas por dia × plataforma × etapa × canal. Canal: o afiliado
 * de recuperação vence o SMS (mesma venda não conta duas vezes); o resto é
 * front. `recoveryIds` = Affiliate.id das contas de recuperação ativas.
 */
export function approvedByChannelSql(f: MetricsFilters, recoveryIds: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT ${BRT_DAY(Prisma.sql`o."orderedAt"`)} AS day,
           pl."slug" AS platform,
           o."productType"::text AS ptype,
           CASE WHEN o."affiliateId" = ANY(${recoveryIds}::text[]) THEN 'rec:' || o."affiliateId"
                WHEN lower(COALESCE(o."trafficSource", '')) = ${SMS_UTM_SOURCE.toLowerCase()} OR o."productType" = 'SMS_RECOVERY' THEN 'sms'
                ELSE 'front' END AS channel,
           COALESCE(SUM(o."grossAmountUsd"), 0)::float8 AS gross,
           COALESCE(SUM(o."cpaPaidUsd"), 0)::float8 AS cpa,
           COUNT(*)::int AS orders
    FROM "Order" o
    JOIN "Platform" pl ON pl.id = o."platformId"
    JOIN "Product" pr ON pr.id = o."productId"
    WHERE ${where(f, [Prisma.sql`o."status" = 'APPROVED'`])}
    GROUP BY 1, 2, 3, 4`;
}

/** Estornos por dia DO ESTORNO (série "Reembolso" do gráfico). Chargeback tem card próprio. */
export function refundsByDaySql(f: MetricsFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT ${BRT_DAY(Prisma.sql`o."refundedAt"`)} AS day,
           COUNT(*)::int AS n,
           COALESCE(SUM(ABS(o."grossAmountUsd")), 0)::float8 AS usd
    FROM "Order" o
    JOIN "Platform" pl ON pl.id = o."platformId"
    JOIN "Product" pr ON pr.id = o."productId"
    WHERE o."status" = 'REFUNDED' AND o."refundedAt" >= ${f.startDate} AND o."refundedAt" <= ${f.endDate}
      ${orderScopeSql(f).length ? Prisma.sql`AND ${Prisma.join(orderScopeSql(f), ' AND ')}` : Prisma.empty}
    GROUP BY 1`;
}

/**
 * Sessões de funil por dia (a do 1º FE aprovado) e a receita aprovada da
 * sessão inteira — mesma base do card de AOV (feSessionStats em metrics.ts),
 * só que quebrada por dia. Σ dos dias = o do card.
 */
export function feSessionsByDaySql(f: MetricsFilters): Prisma.Sql {
  const base: Prisma.Sql[] = [Prisma.sql`o."orderedAt" >= ${f.startDate}`, Prisma.sql`o."orderedAt" <= ${f.endDate}`];
  if (f.platformSlugs?.length) base.push(Prisma.sql`pl."slug" = ANY(${f.platformSlugs})`);
  if (f.countries?.length) base.push(Prisma.sql`o."country" = ANY(${f.countries})`);
  const fe: Prisma.Sql[] = [Prisma.sql`b."productType" = 'FRONTEND'`, Prisma.sql`b."status" = 'APPROVED'`];
  if (f.productFamilies?.length) fe.push(Prisma.sql`b."family" = ANY(${f.productFamilies})`);
  if (f.mappedAffiliateIds?.length) fe.push(Prisma.sql`b."mappedAffiliateId" = ANY(${f.mappedAffiliateIds})`);
  if (f.affiliateIds?.length) fe.push(affiliateSqlCond(f.affiliateIds, 'b'));
  return Prisma.sql`
    WITH base AS (
      SELECT o."productType", o."status", o."orderedAt", o."grossAmountUsd", o."mappedAffiliateId", o."affiliateId",
             pr."family" AS family, ${SESSION_KEY_SQL} AS skey
      FROM "Order" o
      JOIN "Platform" pl ON o."platformId" = pl.id
      JOIN "Product" pr ON o."productId" = pr.id
      WHERE ${Prisma.join(base, ' AND ')}
    ),
    fe AS (
      SELECT skey, MIN("orderedAt") AS fe_at FROM base b WHERE ${Prisma.join(fe, ' AND ')} GROUP BY skey
    ),
    s AS (
      SELECT fe.fe_at, COALESCE(SUM(b."grossAmountUsd") FILTER (WHERE b."status" = 'APPROVED'), 0) AS rev
      FROM fe JOIN base b ON b.skey = fe.skey
      GROUP BY fe.skey, fe.fe_at
    )
    SELECT ${BRT_DAY(Prisma.sql`s.fe_at`)} AS day, COUNT(*)::int AS sessions, COALESCE(SUM(s.rev), 0)::float8 AS revenue
    FROM s GROUP BY 1`;
}

/** Call center (Tauk/Logicall) por dia: venda aprovada menos estorno parcial. */
export function callCenterByDaySql(f: MetricsFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT ${BRT_DAY(Prisma.sql`c."purchasedAt"`)} AS day, c."provider" AS provider,
           COALESCE(SUM(GREATEST(0, c."amountUsd" - COALESCE(c."refundedUsd", 0))), 0)::float8 AS usd
    FROM "CallCenterSale" c
    WHERE c."status" = 'APPROVED' AND c."purchasedAt" >= ${f.startDate} AND c."purchasedAt" <= ${f.endDate}
    GROUP BY 1, 2`;
}

/** SalesBound por dia: vendas menos anulações (mesma conta do measureSalesbound). */
export function salesboundByDaySql(f: MetricsFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT day, COALESCE(SUM(usd), 0)::float8 AS usd FROM (
      SELECT ${BRT_DAY(Prisma.sql`t."txnAt"`)} AS day, t."amountUsd" AS usd
      FROM "SalesboundTransaction" t
      WHERE t."result" = 'SUCCESS' AND t."type" = 'SALE' AND t."txnAt" >= ${f.startDate} AND t."txnAt" <= ${f.endDate}
      UNION ALL
      SELECT ${BRT_DAY(Prisma.sql`t."saleAt"`)}, -t."amountUsd"
      FROM "SalesboundTransaction" t
      WHERE t."result" = 'SUCCESS' AND t."type" = 'VOID' AND t."saleAt" >= ${f.startDate} AND t."saleAt" <= ${f.endDate}
    ) x GROUP BY 1`;
}

// ---------- Montagem (pura) ----------

export interface ChannelRow { day: string; platform: string; ptype: string; channel: string; gross: number; cpa: number; orders: number }
export interface PlatformModel { feePct: number; refundCbPct: number }

export interface Part { key: string; label: string; usd: number }
export interface OverviewPanelsDay {
  date: string;
  /** Receita bruta aprovada de todos os canais de pedido (= receita da daily_metrics). */
  gross: number;
  orders: number;
  refundUsd: number;
  refundCount: number;
  netAfterCpa: number;
  feSessions: number;
  feRevenue: number;
  front: number;
  backend: number;
  recovery: number;
}

export interface OverviewPanels {
  range: { start: string; end: string };
  daily: OverviewPanelsDay[];
  /** Mesma série no período imediatamente anterior, de mesma duração (dia i ↔ dia i). */
  previous: { start: string; end: string; daily: OverviewPanelsDay[] } | null;
  netAfterCpa: { usd: number; frontGrossUsd: number; frontCpaUsd: number; opexPct: number };
  stages: {
    totalUsd: number;
    front: { usd: number; parts: Part[] };
    backend: { usd: number; parts: Part[]; available: boolean };
    recovery: { usd: number; parts: Part[] };
  };
  refunds60d: {
    windowDays: number;
    start: string;
    baseCount: number;
    baseUsd: number;
    refundCount: number;
    refundUsd: number;
    pctCount: number | null;
    pctUsd: number | null;
    projectedPctCount: number | null;
    projectedPctUsd: number | null;
    tailIncomplete: boolean;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const FRONT_LABEL: Record<string, string> = { FRONTEND: 'Front', UPSELL: 'Upsells', DOWNSELL: 'Downsells', BUMP: 'Order bump' };

/** Dias BRT de start a end (inclusive). */
export function brtDays(start: Date, end: Date): string[] {
  const day = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const out: string[] = [];
  const last = day(end);
  let cur = day(start);
  while (cur <= last && out.length < 1000) {
    out.push(cur);
    cur = new Date(Date.parse(`${cur}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return out;
}

export function assembleOverviewPanels(input: {
  start: Date;
  end: Date;
  channels: ChannelRow[];
  refunds: Array<{ day: string; n: number; usd: number }>;
  sessions: Array<{ day: string; sessions: number; revenue: number }>;
  callCenter: Array<{ day: string; provider: string; usd: number }> | null;
  salesbound: Array<{ day: string; usd: number }> | null;
  models: Map<string, PlatformModel>;
  opexPct: number;
  recoveryLabels: Map<string, string>;
}): Omit<OverviewPanels, 'refunds60d' | 'previous'> {
  const days = brtDays(input.start, input.end);
  const empty = (d: string): OverviewPanelsDay => ({
    date: d, gross: 0, orders: 0, refundUsd: 0, refundCount: 0, netAfterCpa: 0, feSessions: 0, feRevenue: 0, front: 0, backend: 0, recovery: 0,
  });
  const byDay = new Map<string, OverviewPanelsDay>(days.map((d) => [d, empty(d)]));
  const dayOf = (d: string) => {
    let row = byDay.get(d);
    if (!row) { row = empty(d); byDay.set(d, row); }
    return row;
  };

  const frontParts = new Map<string, number>();
  const recoveryParts = new Map<string, number>();
  const backendParts = new Map<string, number>();
  let frontGross = 0;
  let frontCpa = 0;
  let netAfterCpa = 0;
  for (const r of input.channels) {
    const day = dayOf(r.day);
    day.gross += r.gross;
    day.orders += r.orders;
    if (r.channel === 'front') {
      // Modelo da planilha CPA por plataforma (= profitSplit.front.profitUsd).
      const m = input.models.get(r.platform) ?? { feePct: 0, refundCbPct: 0 };
      const net = r.gross * (1 - (m.refundCbPct + m.feePct + input.opexPct) / 100) - r.cpa;
      day.front += r.gross;
      day.netAfterCpa += net;
      netAfterCpa += net;
      frontGross += r.gross;
      frontCpa += r.cpa;
      const key = FRONT_LABEL[r.ptype] ? r.ptype : 'OTHER';
      frontParts.set(key, (frontParts.get(key) ?? 0) + r.gross);
    } else {
      day.recovery += r.gross;
      const label = r.channel === 'sms' ? 'SMS' : input.recoveryLabels.get(r.channel.slice(4)) ?? 'Afiliado de recuperação';
      recoveryParts.set(label, (recoveryParts.get(label) ?? 0) + r.gross);
    }
  }
  for (const r of input.refunds) {
    const day = dayOf(r.day);
    day.refundUsd += r.usd;
    day.refundCount += r.n;
  }
  for (const r of input.sessions) {
    const day = dayOf(r.day);
    day.feSessions += r.sessions;
    day.feRevenue += r.revenue;
  }
  for (const r of input.callCenter ?? []) {
    dayOf(r.day).backend += r.usd;
    const label = r.provider === 'tauk' ? 'Tauk' : r.provider === 'logicall' ? 'Logicall' : r.provider;
    backendParts.set(label, (backendParts.get(label) ?? 0) + r.usd);
  }
  for (const r of input.salesbound ?? []) {
    dayOf(r.day).backend += r.usd;
    backendParts.set('SalesBound', (backendParts.get('SalesBound') ?? 0) + r.usd);
  }

  const parts = (m: Map<string, number>, label?: (k: string) => string): Part[] =>
    [...m.entries()].filter(([, v]) => Math.abs(v) >= 0.005)
      .map(([key, usd]) => ({ key, label: label ? label(key) : key, usd: r2(usd) }))
      .sort((a, b) => b.usd - a.usd);
  const sum = (p: Part[]) => r2(p.reduce((s, x) => s + x.usd, 0));

  const front = parts(frontParts, (k) => FRONT_LABEL[k] ?? 'Outros');
  const backend = parts(backendParts);
  const recovery = parts(recoveryParts);
  const daily = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({
    ...d,
    gross: r2(d.gross), refundUsd: r2(d.refundUsd), netAfterCpa: r2(d.netAfterCpa), feRevenue: r2(d.feRevenue),
    front: r2(d.front), backend: r2(d.backend), recovery: r2(d.recovery),
  }));

  return {
    range: { start: input.start.toISOString(), end: input.end.toISOString() },
    daily,
    netAfterCpa: { usd: r2(netAfterCpa), frontGrossUsd: r2(frontGross), frontCpaUsd: r2(frontCpa), opexPct: input.opexPct },
    stages: {
      totalUsd: r2(sum(front) + sum(backend) + sum(recovery)),
      front: { usd: sum(front), parts: front },
      backend: { usd: sum(backend), parts: backend, available: input.callCenter != null },
      recovery: { usd: sum(recovery), parts: recovery },
    },
  };
}

/** Período imediatamente anterior, mesma duração: [início − L, início − 1 ms]. */
export function previousWindow(start: Date, end: Date): { start: Date; end: Date } {
  const span = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  return { start: new Date(prevEnd.getTime() - span), end: prevEnd };
}

/** Janela dos últimos 60 dias de VENDA (BRT): começa à 00:00 BRT de hoje − 59. */
export function refundWindow(now: Date): { start: Date; end: Date } {
  const todayBrt = new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const startDay = new Date(Date.parse(`${todayBrt}T00:00:00Z`) - (REFUND_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return { start: new Date(`${startDay}T03:00:00Z`), end: now };
}

// ---------- Leitura ----------

export async function getOverviewPanels(f: MetricsFilters, now = new Date()): Promise<OverviewPanels> {
  const scoped = hasOrderScope(f);
  const [pm, recAffs] = await Promise.all([
    getProfitModelInputs(),
    db.recoveryAffiliate.findMany({
      where: { enabled: true },
      select: { affiliateId: true, note: true, affiliate: { select: { nickname: true, externalId: true } } },
    }),
  ]);
  const recoveryIds = recAffs.map((r) => r.affiliateId);
  const recoveryLabels = new Map(recAffs.map((r) => [r.affiliateId, r.note?.trim() || r.affiliate.nickname || r.affiliate.externalId]));
  const win = refundWindow(now);
  const prevWin = previousWindow(f.startDate, f.endDate);
  const pf: MetricsFilters = { ...f, startDate: prevWin.start, endDate: prevWin.end };

  const [channels, refunds, sessions, callCenter, salesbound, cohorts, prevChannels, prevRefunds, prevSessions] = await Promise.all([
    db.$queryRaw<ChannelRow[]>(approvedByChannelSql(f, recoveryIds)),
    db.$queryRaw<Array<{ day: string; n: number; usd: number }>>(refundsByDaySql(f)),
    db.$queryRaw<Array<{ day: string; sessions: number; revenue: number }>>(feSessionsByDaySql(f)),
    scoped ? Promise.resolve(null) : db.$queryRaw<Array<{ day: string; provider: string; usd: number }>>(callCenterByDaySql(f)),
    scoped ? Promise.resolve(null) : db.$queryRaw<Array<{ day: string; usd: number }>>(salesboundByDaySql(f)),
    getRefundCohorts({
      startDate: win.start,
      endDate: win.end,
      platformSlugs: f.platformSlugs,
      productFamilies: f.productFamilies,
      productExternalIds: f.productExternalIds,
      productTypes: f.productTypes,
      countries: f.countries,
      mappedAffiliateIds: f.mappedAffiliateIds,
      affiliateIds: f.affiliateIds,
    }, REFUND_WINDOW_DAYS),
    // Período anterior: só o que o gráfico do topo compara (sem back-end).
    db.$queryRaw<ChannelRow[]>(approvedByChannelSql(pf, recoveryIds)),
    db.$queryRaw<Array<{ day: string; n: number; usd: number }>>(refundsByDaySql(pf)),
    db.$queryRaw<Array<{ day: string; sessions: number; revenue: number }>>(feSessionsByDaySql(pf)),
  ]);

  const panels = assembleOverviewPanels({
    start: f.startDate,
    end: f.endDate,
    channels,
    refunds,
    sessions,
    callCenter,
    salesbound,
    models: pm.byPlatform,
    opexPct: pm.opexPct,
    recoveryLabels,
  });
  const prevPanels = assembleOverviewPanels({
    start: pf.startDate,
    end: pf.endDate,
    channels: prevChannels,
    refunds: prevRefunds,
    sessions: prevSessions,
    callCenter: null,
    salesbound: null,
    models: pm.byPlatform,
    opexPct: pm.opexPct,
    recoveryLabels,
  });
  const t = cohorts.totals;
  return {
    ...panels,
    previous: { start: pf.startDate.toISOString(), end: pf.endDate.toISOString(), daily: prevPanels.daily },
    refunds60d: {
      windowDays: REFUND_WINDOW_DAYS,
      start: win.start.toISOString(),
      baseCount: t.baseCount,
      baseUsd: t.baseUsd,
      refundCount: t.refundCount,
      refundUsd: t.refundUsd,
      pctCount: t.baseCount > 0 ? Math.round((t.refundCount / t.baseCount) * 10000) / 10000 : null,
      pctUsd: t.baseUsd > 0 ? Math.round((t.refundUsd / t.baseUsd) * 10000) / 10000 : null,
      projectedPctCount: cohorts.projection.periodPctCount,
      projectedPctUsd: cohorts.projection.periodPctUsd,
      tailIncomplete: cohorts.projection.tailIncomplete,
    },
  };
}

// ---------- Reembolso de 60 dias por afiliado (Top 5 da Visão geral) ----------

/**
 * Coorte dos últimos 60 dias por conta de afiliado, na régua da aba
 * Reembolsos (getRefundCohorts): base = vendas reais do período (APPROVED +
 * linha estornada in-place com approvedAt); estorno = linha REFUNDED/CB com
 * data de evento (sintética na Digistore). `keys` = "plataforma:externalId".
 */
export function affiliateRefundsSql(keys: string[], start: Date, end: Date): Prisma.Sql {
  const extraRow = [...EXTRA_ROW_REFUND_PLATFORMS];
  return Prisma.sql`
    WITH k AS (
      SELECT split_part(x, ':', 1) AS slug, substr(x, length(split_part(x, ':', 1)) + 2) AS ext
      FROM unnest(${keys}::text[]) AS x
    ),
    acc AS (
      SELECT a.id, pl."slug", a."externalId"
      FROM "Affiliate" a JOIN "Platform" pl ON pl.id = a."platformId"
      JOIN k ON k.slug = pl."slug" AND k.ext = a."externalId"
    )
    SELECT acc."slug" || ':' || acc."externalId" AS key,
      COUNT(*) FILTER (WHERE o."status" = 'APPROVED'
        OR (NOT (acc."slug" = ANY(${extraRow})) AND o."approvedAt" IS NOT NULL AND o."status" IN ('REFUNDED', 'CHARGEBACK')))::int AS "baseCount",
      COALESCE(SUM(COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd"))) FILTER (WHERE o."status" = 'APPROVED'
        OR (NOT (acc."slug" = ANY(${extraRow})) AND o."approvedAt" IS NOT NULL AND o."status" IN ('REFUNDED', 'CHARGEBACK'))), 0)::float8 AS "baseUsd",
      COUNT(*) FILTER (WHERE o."status" IN ('REFUNDED', 'CHARGEBACK')
        AND COALESCE(o."refundedAt", o."chargebackAt") IS NOT NULL
        AND (acc."slug" = ANY(${extraRow}) OR o."approvedAt" IS NOT NULL)
        AND NOT COALESCE(o."rawMetadata"->>'_source' = 'csv-reconcile' AND o."rawMetadata"->>'matched_original_sale' = 'false', false))::int AS "refundCount",
      COALESCE(SUM(ABS(o."grossAmountUsd")) FILTER (WHERE o."status" IN ('REFUNDED', 'CHARGEBACK')
        AND COALESCE(o."refundedAt", o."chargebackAt") IS NOT NULL
        AND (acc."slug" = ANY(${extraRow}) OR o."approvedAt" IS NOT NULL)
        AND NOT COALESCE(o."rawMetadata"->>'_source' = 'csv-reconcile' AND o."rawMetadata"->>'matched_original_sale' = 'false', false)), 0)::float8 AS "refundUsd"
    FROM "Order" o JOIN acc ON o."affiliateId" = acc.id
    WHERE o."orderedAt" >= ${start} AND o."orderedAt" <= ${end}
    GROUP BY 1`;
}

export interface AffiliateRefund60d {
  key: string;
  baseCount: number;
  baseUsd: number;
  refundCount: number;
  refundUsd: number;
  pctCount: number | null;
  pctUsd: number | null;
}

export async function getAffiliateRefunds60d(keys: string[], now = new Date()): Promise<{ windowDays: number; start: string; affiliates: AffiliateRefund60d[] }> {
  const win = refundWindow(now);
  const clean = [...new Set(keys.map((k) => k.trim()).filter((k) => /^[a-z0-9]+:.+/.test(k)))].slice(0, 50);
  const rows = clean.length
    ? await db.$queryRaw<Array<Omit<AffiliateRefund60d, 'pctCount' | 'pctUsd'>>>(affiliateRefundsSql(clean, win.start, win.end))
    : [];
  return {
    windowDays: REFUND_WINDOW_DAYS,
    start: win.start.toISOString(),
    affiliates: rows.map((r) => ({
      ...r,
      pctCount: r.baseCount > 0 ? Math.round((r.refundCount / r.baseCount) * 10000) / 10000 : null,
      pctUsd: r.baseUsd > 0 ? Math.round((r.refundUsd / r.baseUsd) * 10000) / 10000 : null,
    })),
  };
}
