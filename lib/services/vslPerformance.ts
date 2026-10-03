// Desempenho das VSLs (aba VSLs → Desempenho e Testes A/B). SQL aqui, regra
// em lib/vsl/performanceCore.ts (pura) e estatística em lib/vsl/stats.ts.
//
// Etapa → pedido: UPxx = productType UPSELL, DOWNxx = DOWNSELL, com
// funnelStep = xx + 1 (teto 4 — mesma regra do funil: compra além do slot 3
// dobra no 3). Família da venda real = família do FE da sessão (mesma regra
// da aba Funil); upsell órfão cai na própria família.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import {
  brtDay, reducePerformance, finishMetrics, LINKABLE_PLATFORMS,
  type ChangeRow, type LinkedRow, type RealRow, type VisitAggRow,
} from '../vsl/performanceCore';
import { abStats, type AbResult } from '../vsl/stats';

export interface VslPerformanceFilters {
  start: Date;
  end: Date;
  platforms?: string[];
  families?: string[];
  stage?: string | null;
  pageId?: string | null;
}

const DAY_SQL = (col: Prisma.Sql) => Prisma.sql`to_char((${col} - interval '3 hours')::date, 'YYYY-MM-DD')`;

function pageWhere(f: VslPerformanceFilters, alias = 'p'): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`);
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.platforms?.length) parts.push(Prisma.sql`${a}.platform = ANY(${f.platforms}::text[])`);
  if (f.families?.length) parts.push(Prisma.sql`${a}.family = ANY(${f.families}::text[])`);
  if (f.stage) parts.push(Prisma.sql`${a}.stage = ${f.stage}`);
  if (f.pageId) parts.push(Prisma.sql`${a}.id = ${f.pageId}`);
  return Prisma.join(parts, ' AND ');
}

const STAGE_PT = (p: string) => Prisma.raw(`CASE WHEN "${p}".stage LIKE 'UP%' THEN 'UPSELL' ELSE 'DOWNSELL' END`);
const STAGE_STEP = (p: string) => Prisma.raw(`LEAST(CAST(RIGHT("${p}".stage, 2) AS int) + 1, 4)`);
const ORDER_STEP = Prisma.raw(`LEAST(GREATEST(COALESCE(o."funnelStep", 2), 2), 4)`);
const SESSION_KEY = Prisma.raw(
  `CASE WHEN pl.slug = 'buygoods' THEN COALESCE(o."funnelSessionId", o."parentExternalId", o."externalId") ELSE COALESCE(o."parentExternalId", o."externalId") END`,
);

interface RawVisit {
  pageId: string; vslId: string | null; testId: string | null; armId: string | null; day: string;
  visits: number; plays: number; pitch: number; accepts: number; accepts_pitch: number; declines: number; watch: number;
}

export function visitRowsSql(f: VslPerformanceFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT v."pageId", v."vslId", v."testId", v."armId", ${DAY_SQL(Prisma.sql`v."firstAt"`)} AS day,
           COUNT(*)::int AS visits, COUNT(v."playAt")::int AS plays, COUNT(v."pitchAt")::int AS pitch,
           COUNT(v."acceptAt")::int AS accepts,
           COUNT(*) FILTER (WHERE v."acceptAt" IS NOT NULL AND v."pitchAt" IS NOT NULL)::int AS accepts_pitch,
           COUNT(v."declineAt")::int AS declines,
           COALESCE(SUM(v."maxSecond") FILTER (WHERE v."playAt" IS NOT NULL), 0)::float8 AS watch
    FROM "VslVisit" v
    JOIN "VslPage" p ON p.id = v."pageId"
    WHERE v."discardedAt" IS NULL AND v."firstAt" >= ${f.start} AND v."firstAt" <= ${f.end} AND ${pageWhere(f)}
    GROUP BY 1, 2, 3, 4, 5`;
}

async function visitRows(f: VslPerformanceFilters): Promise<VisitAggRow[]> {
  const rows = await db.$queryRaw<RawVisit[]>(visitRowsSql(f));
  return rows.map((r) => ({ ...r, acceptsAfterPitch: r.accepts_pitch, watchSum: Number(r.watch) }));
}

interface RawLinked {
  pageId: string; vslId: string | null; testId: string | null; armId: string | null; day: string; linked: number; sold: number; revenue: number;
}

/**
 * Visita → sessão da plataforma (base da compra confirmada):
 *   - BuyGoods: sessid2 (URL/cookie); sem ele, o order_id do FE na URL → sessão do pedido.
 *   - JVZoo: a URL do upsell não traz id que o IPN devolva. Casa pelo afiliado
 *     lido na página (aid; sem aid = FE sem afiliado) + família da página + FE
 *     comprado até 30 min antes da visita (2 min depois, folga de relógio), o
 *     mais próximo. Aproximado: dois compradores do MESMO afiliado no mesmo
 *     minuto podem trocar de par (em 03/10/2026 casou 18 de 18).
 * `where` usa os apelidos v (VslVisit) e p (VslPage).
 */
export function visitSessionSql(where: Prisma.Sql, opts: { includeDiscarded?: boolean } = {}): Prisma.Sql {
  return Prisma.sql`
    SELECT v.id AS visit_id, v."pageId", v."vslId", v."testId", v."armId", v."firstAt",
           p.platform, ${STAGE_PT('p')} AS pt, ${STAGE_STEP('p')} AS step,
      CASE
        WHEN p.platform = 'buygoods' AND v."sessionKey" LIKE 'sessid2:%' THEN substring(v."sessionKey" from 9)
        WHEN p.platform = 'buygoods' AND v."sessionKey" LIKE 'order:%' THEN (
          SELECT COALESCE(o."funnelSessionId", o."parentExternalId", o."externalId")
          FROM "Order" o JOIN "Platform" pl ON pl.id = o."platformId" AND pl.slug = 'buygoods'
          WHERE o."externalId" = substring(v."sessionKey" from 7) LIMIT 1)
        WHEN p.platform = 'jvzoo' THEN (
          SELECT COALESCE(o."parentExternalId", o."externalId")
          FROM "Order" o
          JOIN "Platform" pl ON pl.id = o."platformId" AND pl.slug = 'jvzoo'
          JOIN "Product" pr ON pr.id = o."productId" AND pr.family = p.family
          LEFT JOIN "Affiliate" a ON a.id = o."affiliateId"
          WHERE o."productType" = 'FRONTEND'
            AND o."orderedAt" BETWEEN v."firstAt" - interval '30 minutes' AND v."firstAt" + interval '2 minutes'
            AND CASE WHEN v."affiliateKey" IS NOT NULL THEN a."externalId" = v."affiliateKey"
                     ELSE (a.id IS NULL OR a."externalId" = '0') END
          ORDER BY abs(EXTRACT(EPOCH FROM v."firstAt" - o."orderedAt")) LIMIT 1)
      END AS session
    FROM "VslVisit" v
    JOIN "VslPage" p ON p.id = v."pageId"
    WHERE ${opts.includeDiscarded ? Prisma.sql`TRUE` : Prisma.sql`v."discardedAt" IS NULL`} AND ${where}`;
}

/** Venda aprovada da etapa da página na sessão casada (lateral sobre `f`). */
const SESSION_SALE = Prisma.sql`
  SELECT SUM(o."grossAmountUsd")::float8 AS gross
  FROM "Order" o JOIN "Platform" pl ON pl.id = o."platformId" AND pl.slug = f.platform
  WHERE ${SESSION_KEY} = f.session
    AND o.status = 'APPROVED'
    AND o."productType"::text = f.pt
    AND ${ORDER_STEP} = f.step
    AND o."orderedAt" >= f."firstAt" - interval '2 hours'
    AND o."orderedAt" <= f."firstAt" + interval '2 days'`;

export function linkedRowsSql(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH vs AS (${visitSessionSql(where)}),
    f AS (
      -- uma visita por sessão e página (a primeira): recarga não conta 2x
      SELECT DISTINCT ON ("pageId", session) * FROM vs
      WHERE session IS NOT NULL
      ORDER BY "pageId", session, "firstAt"
    )
    SELECT f."pageId", f."vslId", f."testId", f."armId", ${DAY_SQL(Prisma.sql`f."firstAt"`)} AS day,
           COUNT(*)::int AS linked, COUNT(x.gross)::int AS sold, COALESCE(SUM(x.gross), 0)::float8 AS revenue
    FROM f
    LEFT JOIN LATERAL (${SESSION_SALE}) x ON true
    GROUP BY 1, 2, 3, 4, 5`;
}

async function linkedRows(where: Prisma.Sql): Promise<LinkedRow[]> {
  const rows = await db.$queryRaw<RawLinked[]>(linkedRowsSql(where));
  return rows.map((r) => ({
    pageId: r.pageId, vslId: r.vslId, testId: r.testId, armId: r.armId, day: r.day,
    linkedVisits: r.linked, soldVisits: r.sold, revenue: Number(r.revenue),
  }));
}

export interface PageVisitRow {
  id: string;
  firstAt: string;
  vslId: string | null;
  affiliateKey: string | null;
  play: boolean;
  pitch: boolean;
  accept: boolean;
  decline: boolean;
  maxSecond: number;
  discarded: boolean;
  /** casou com uma sessão da plataforma (BuyGoods/JVZoo) */
  linked: boolean;
  /** comprou a etapa da página nessa sessão */
  bought: boolean;
}

/** Últimas visitas de uma página (inclui descartadas) — gaveta da página, pra achar e descartar teste. */
export async function listPageVisits(pageId: string, limit = 80): Promise<PageVisitRow[]> {
  const rows = await db.$queryRaw<Array<{
    id: string; firstAt: Date; vslId: string | null; affiliateKey: string | null; play: boolean; pitch: boolean;
    accept: boolean; decline: boolean; maxSecond: number; discarded: boolean; linked: boolean; bought: boolean;
  }>>`
    WITH f AS (${visitSessionSql(Prisma.sql`v."pageId" = ${pageId} AND v."firstAt" > now() - interval '30 days'`, { includeDiscarded: true })})
    SELECT v.id, v."firstAt", v."vslId", v."affiliateKey",
           v."playAt" IS NOT NULL AS play, v."pitchAt" IS NOT NULL AS pitch,
           v."acceptAt" IS NOT NULL AS accept, v."declineAt" IS NOT NULL AS decline,
           v."maxSecond", v."discardedAt" IS NOT NULL AS discarded,
           f.session IS NOT NULL AS linked, x.gross IS NOT NULL AS bought
    FROM f JOIN "VslVisit" v ON v.id = f.visit_id
    LEFT JOIN LATERAL (${SESSION_SALE}) x ON f.session IS NOT NULL
    ORDER BY v."firstAt" DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, firstAt: r.firstAt.toISOString() }));
}

interface RawReal { pageId: string; day: string; fe: number; sales: number; revenue: number; fe_live: number; sales_live: number; revenue_live: number }

// Variante por potes do FE: página com filtro conta só o front que bate;
// página sem filtro conta os DEMAIS (tira os potes de variante irmã). FE
// desconhecido (upsell órfão) fica só na página sem filtro.
const feBottlesMatch = (bottles: Prisma.Sql) => Prisma.sql`(CASE WHEN cardinality(pg.fe_bottles) = 0
  THEN (${bottles} IS NULL OR NOT (${bottles} = ANY(pg.claimed)))
  ELSE ${bottles} = ANY(pg.fe_bottles) END)`;

/** Venda real por página e dia BRT: sessões com FE da família e vendas da etapa. */
export function realRowsSql(f: VslPerformanceFilters): Prisma.Sql {
  // FE até 2 dias antes do início: o upsell do primeiro dia precisa achar a
  // família do FE da sessão.
  const feStart = new Date(f.start.getTime() - 2 * 86_400_000);
  return Prisma.sql`
    WITH pg AS (
      SELECT p.id, p.family, p.platform, ${STAGE_PT('p')} AS pt, ${STAGE_STEP('p')} AS step,
             COALESCE(p."feBottles", ARRAY[]::int[]) AS fe_bottles,
             -- página sem filtro de potes = "os demais": tira os potes que uma
             -- variante irmã (mesma família/etapa/plataforma) já cobre.
             COALESCE((SELECT array_agg(DISTINCT b) FROM "VslPage" s CROSS JOIN LATERAL unnest(s."feBottles") b
                       WHERE s.family = p.family AND s.stage = p.stage AND s.platform = p.platform AND s.id <> p.id),
                      ARRAY[]::int[]) AS claimed,
             p."installedAt" AS installed_at
      FROM "VslPage" p WHERE ${pageWhere(f)}
    ),
    fe AS (
      SELECT pl.slug AS platform, ${SESSION_KEY} AS sk, MIN(o."orderedAt") AS at,
             (ARRAY_AGG(pr.family ORDER BY o."orderedAt"))[1] AS family,
             (ARRAY_AGG(pr.bottles ORDER BY o."orderedAt"))[1] AS bottles
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId"
      JOIN "Product" pr ON pr.id = o."productId"
      WHERE o."productType" = 'FRONTEND' AND o.status = 'APPROVED'
        AND o."orderedAt" >= ${feStart} AND o."orderedAt" <= ${f.end}
        AND pl.slug IN (SELECT DISTINCT platform FROM pg)
      GROUP BY 1, 2
    ),
    bk AS (
      -- só upsell/downsell das etapas que têm página (UP01 → UPSELL step 2…)
      SELECT o."platformId" AS platform_id, pl.slug AS platform, ${SESSION_KEY} AS sk, o."productType"::text AS pt,
             ${ORDER_STEP} AS step, o."grossAmountUsd" AS gross, o."orderedAt" AS at, pr.family AS own_family
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId"
      JOIN "Product" pr ON pr.id = o."productId"
      WHERE o.status = 'APPROVED' AND o."productType" IN ('UPSELL', 'DOWNSELL')
        AND o."orderedAt" >= ${f.start} AND o."orderedAt" <= ${f.end}
        AND pl.slug IN (SELECT DISTINCT platform FROM pg)
        AND (o."productType"::text, ${ORDER_STEP}) IN (SELECT pt, step FROM pg)
    ),
    bkfe AS (
      -- FE da sessão de cada upsell, por índice: a mesma "primeira FE aprovada
      -- da sessão desde 2 dias antes" do CTE fe, sem cruzar CTE × CTE (o planner
      -- errava a estimativa e fazia laço aninhado de milhões de linhas).
      SELECT bk.*, fx.family AS fe_family, fx.bottles AS fe_bottles, fx.at AS fe_at
      FROM bk
      LEFT JOIN LATERAL (
        SELECT pr2.family, pr2.bottles, f2."orderedAt" AS at
        FROM "Order" f2 JOIN "Product" pr2 ON pr2.id = f2."productId"
        WHERE f2."platformId" = bk.platform_id
          AND (f2."funnelSessionId" = bk.sk OR f2."parentExternalId" = bk.sk OR f2."externalId" = bk.sk)
          AND (CASE WHEN bk.platform = 'buygoods' THEN COALESCE(f2."funnelSessionId", f2."parentExternalId", f2."externalId")
                    ELSE COALESCE(f2."parentExternalId", f2."externalId") END) = bk.sk
          AND f2."productType" = 'FRONTEND' AND f2.status = 'APPROVED'
          AND f2."orderedAt" >= ${feStart} AND f2."orderedAt" <= ${f.end}
        ORDER BY f2."orderedAt"
        LIMIT 1
      ) fx ON true
    ),
    sales AS (
      SELECT pg.id AS page_id, ${DAY_SQL(Prisma.sql`b.at`)} AS day,
             COUNT(DISTINCT b.sk)::int AS sales, COALESCE(SUM(b.gross), 0)::float8 AS revenue,
             COUNT(DISTINCT b.sk) FILTER (WHERE COALESCE(b.fe_at, b.at) >= pg.installed_at)::int AS sales_live,
             COALESCE(SUM(b.gross) FILTER (WHERE COALESCE(b.fe_at, b.at) >= pg.installed_at), 0)::float8 AS revenue_live
      FROM bkfe b
      JOIN pg ON pg.platform = b.platform AND pg.family = COALESCE(b.fe_family, b.own_family)
             AND pg.pt = b.pt AND pg.step = b.step
             AND ${feBottlesMatch(Prisma.sql`b.fe_bottles`)}
      GROUP BY 1, 2
    ),
    fes AS (
      SELECT pg.id AS page_id, ${DAY_SQL(Prisma.sql`fe.at`)} AS day, COUNT(*)::int AS fe,
             COUNT(*) FILTER (WHERE fe.at >= pg.installed_at)::int AS fe_live
      FROM fe JOIN pg ON pg.platform = fe.platform AND pg.family = fe.family
             AND ${feBottlesMatch(Prisma.sql`fe.bottles`)}
      WHERE fe.at >= ${f.start}
      GROUP BY 1, 2
    )
    SELECT COALESCE(s.page_id, x.page_id) AS "pageId", COALESCE(s.day, x.day) AS day,
           COALESCE(x.fe, 0)::int AS fe, COALESCE(s.sales, 0)::int AS sales, COALESCE(s.revenue, 0)::float8 AS revenue,
           COALESCE(x.fe_live, 0)::int AS fe_live, COALESCE(s.sales_live, 0)::int AS sales_live,
           COALESCE(s.revenue_live, 0)::float8 AS revenue_live
    FROM sales s FULL OUTER JOIN fes x ON x.page_id = s.page_id AND x.day = s.day`;
}

async function realRows(f: VslPerformanceFilters): Promise<RealRow[]> {
  const rows = await db.$queryRaw<RawReal[]>(realRowsSql(f));
  return rows.map((r) => ({
    pageId: r.pageId, day: r.day, feSessions: r.fe, sales: r.sales, revenue: Number(r.revenue),
    feLive: r.fe_live, salesLive: r.sales_live, revenueLive: Number(r.revenue_live),
  }));
}

interface RawArm {
  testId: string; armId: string; visits: number; plays: number; pitch: number; accepts: number; accepts_pitch: number; declines: number; watch: number;
}

export interface TestResult {
  id: string;
  pageId: string;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  winnerVslId: string | null;
  linkable: boolean;
  arms: Array<{ id: string; label: string; vslId: string; weight: number } & ReturnType<typeof finishMetrics>>;
  /** decisão por aceite (clique em comprar) — sempre disponível */
  byAccept: AbResult;
  /** decisão por venda confirmada — só onde dá pra casar visita e venda */
  bySale: AbResult | null;
}

async function testResults(): Promise<TestResult[]> {
  const tests = await db.vslTest.findMany({ include: { arms: true, page: true }, orderBy: { startedAt: 'desc' }, take: 100 });
  if (!tests.length) return [];
  const ids = tests.map((t) => t.id);
  const [arms, linked] = await Promise.all([
    db.$queryRaw<RawArm[]>`
      SELECT v."testId", v."armId", COUNT(*)::int AS visits, COUNT(v."playAt")::int AS plays,
             COUNT(v."pitchAt")::int AS pitch, COUNT(v."acceptAt")::int AS accepts,
             COUNT(*) FILTER (WHERE v."acceptAt" IS NOT NULL AND v."pitchAt" IS NOT NULL)::int AS accepts_pitch,
             COUNT(v."declineAt")::int AS declines,
             COALESCE(SUM(v."maxSecond") FILTER (WHERE v."playAt" IS NOT NULL), 0)::float8 AS watch
      FROM "VslVisit" v JOIN "VslTest" t ON t.id = v."testId"
      WHERE v."testId" = ANY(${ids}::text[]) AND v."armId" IS NOT NULL AND v."discardedAt" IS NULL
        AND (t."endedAt" IS NULL OR v."firstAt" <= t."endedAt")
      GROUP BY 1, 2`,
    linkedRows(Prisma.sql`v."testId" = ANY(${ids}::text[]) AND v."armId" IS NOT NULL
      AND (SELECT t."endedAt" IS NULL OR v."firstAt" <= t."endedAt" FROM "VslTest" t WHERE t.id = v."testId")`),
  ]);
  const armKey = (t: string, a: string) => `${t}|${a}`;
  const agg = new Map(arms.map((r) => [armKey(r.testId, r.armId), r]));
  const sold = new Map<string, { linked: number; sold: number; revenue: number }>();
  for (const l of linked) {
    if (!l.testId || !l.armId) continue;
    const k = armKey(l.testId, l.armId);
    const s = sold.get(k) ?? { linked: 0, sold: 0, revenue: 0 };
    s.linked += l.linkedVisits;
    s.sold += l.soldVisits;
    s.revenue += l.revenue;
    sold.set(k, s);
  }
  return tests.map((t) => {
    const linkable = LINKABLE_PLATFORMS.has(t.page.platform);
    const ordered = [...t.arms].sort((a, b) => a.label.localeCompare(b.label));
    const armOut = ordered.map((a) => {
      const r = agg.get(armKey(t.id, a.id));
      const s = sold.get(armKey(t.id, a.id));
      const m = finishMetrics({
        visits: r?.visits ?? 0, plays: r?.plays ?? 0, pitch: r?.pitch ?? 0, accepts: r?.accepts ?? 0,
        acceptsAfterPitch: r?.accepts_pitch ?? 0, declines: r?.declines ?? 0,
        watchSum: Number(r?.watch ?? 0), sold: s?.sold ?? 0, revenue: s?.revenue ?? 0, linkable,
        linkableVisits: linkable ? s?.linked ?? 0 : 0,
      });
      return { id: a.id, label: a.label, vslId: a.vslId, weight: a.weight, ...m };
    });
    return {
      id: t.id,
      pageId: t.pageId,
      name: t.name,
      status: t.status,
      startedAt: t.startedAt.toISOString(),
      endedAt: t.endedAt?.toISOString() ?? null,
      winnerVslId: t.winnerVslId,
      linkable,
      arms: armOut,
      byAccept: abStats(armOut.map((a) => ({ id: a.id, label: a.label, visits: a.visits, conversions: a.accepts, active: a.weight > 0 }))),
      bySale: linkable
        ? abStats(armOut.map((a) => ({ id: a.id, label: a.label, visits: a.linkableVisits, conversions: a.sales ?? 0, active: a.weight > 0 })), { minConversions: 15 })
        : null,
    };
  });
}

interface RawAffRow { pageId: string; affiliateKey: string; name: string | null; visits: number; pitch: number; accepts: number }

/** Visitas por afiliado lido na página (JVZoo aid / BuyGoods memória), por página. */
export function affiliateRowsSql(f: VslPerformanceFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT v."pageId", v."affiliateKey", MAX(a.nickname) AS name,
           COUNT(*)::int AS visits, COUNT(v."pitchAt")::int AS pitch, COUNT(v."acceptAt")::int AS accepts
    FROM "VslVisit" v
    JOIN "VslPage" p ON p.id = v."pageId"
    LEFT JOIN "Platform" pl ON pl.slug = p.platform
    LEFT JOIN "Affiliate" a ON a."platformId" = pl.id AND a."externalId" = v."affiliateKey"
    WHERE v."affiliateKey" IS NOT NULL AND v."discardedAt" IS NULL AND v."firstAt" >= ${f.start} AND v."firstAt" <= ${f.end} AND ${pageWhere(f)}
    GROUP BY 1, 2`;
}

export async function getVslPerformance(f: VslPerformanceFilters) {
  const [visits, linked, real, pages, changes, tests, affRows] = await Promise.all([
    visitRows(f),
    linkedRows(Prisma.sql`v."firstAt" >= ${f.start} AND v."firstAt" <= ${f.end} AND ${pageWhere(f)}`),
    realRows(f),
    db.vslPage.findMany({ select: { id: true, platform: true, fallbackVslId: true, installedAt: true } }),
    db.vslChange.findMany({ where: { pageId: { not: null } }, select: { pageId: true, kind: true, toVslId: true, ruleId: true, createdAt: true } }),
    testResults(),
    db.$queryRaw<RawAffRow[]>(affiliateRowsSql(f)),
  ]);
  // Top 30 afiliados por página (o resto entra só no total da página).
  const byPageAffiliate = [...affRows]
    .sort((a, b) => b.visits - a.visits)
    .reduce<Record<string, Array<{ affiliateKey: string; name: string | null; visits: number; pitchRate: number | null; acceptRate: number | null; accepts: number }>>>((acc, r) => {
      const list = (acc[r.pageId] ??= []);
      if (list.length < 30) {
        list.push({
          affiliateKey: r.affiliateKey, name: r.name, visits: r.visits, accepts: r.accepts,
          pitchRate: r.visits ? Math.round((r.pitch / r.visits) * 10000) / 10000 : null,
          acceptRate: r.visits ? Math.round((r.accepts / r.visits) * 10000) / 10000 : null,
        });
      }
      return acc;
    }, {});
  const installDayByPage = new Map<string, string>();
  for (const p of pages) if (p.installedAt) installDayByPage.set(p.id, brtDay(p.installedAt));

  const reduced = reducePerformance({
    visits, linked, real,
    changes: changes as ChangeRow[],
    pages: pages.map((p) => ({ id: p.id, platform: p.platform, fallbackVslId: p.fallbackVslId })),
    installDayByPage,
  });
  return {
    range: { start: f.start.toISOString(), end: f.end.toISOString() },
    ...reduced,
    byPageAffiliate,
    tests,
  };
}
