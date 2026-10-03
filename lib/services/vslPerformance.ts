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
  brtDay, reducePerformance, finishMetrics,
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
    WHERE v."firstAt" >= ${f.start} AND v."firstAt" <= ${f.end} AND ${pageWhere(f)}
    GROUP BY 1, 2, 3, 4, 5`;
}

async function visitRows(f: VslPerformanceFilters): Promise<VisitAggRow[]> {
  const rows = await db.$queryRaw<RawVisit[]>(visitRowsSql(f));
  return rows.map((r) => ({ ...r, acceptsAfterPitch: r.accepts_pitch, watchSum: Number(r.watch) }));
}

interface RawLinked {
  pageId: string; vslId: string | null; testId: string | null; armId: string | null; day: string; sold: number; revenue: number;
}

/** BuyGoods: visita com sessid2 que virou venda APROVADA da etapa (até 2 dias). */
export function linkedRowsSql(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT v."pageId", v."vslId", v."testId", v."armId", ${DAY_SQL(Prisma.sql`v."firstAt"`)} AS day,
           COUNT(*)::int AS sold, COALESCE(SUM(x.gross), 0)::float8 AS revenue
    FROM (
      SELECT DISTINCT ON (v."pageId", v."sessionKey") v.*
      FROM "VslVisit" v
      JOIN "VslPage" p ON p.id = v."pageId" AND p.platform = 'buygoods'
      WHERE v."sessionKey" LIKE 'sessid2:%' AND ${where}
      ORDER BY v."pageId", v."sessionKey", v."firstAt"
    ) v
    JOIN "VslPage" p ON p.id = v."pageId" AND p.platform = 'buygoods'
    JOIN LATERAL (
      SELECT SUM(o."grossAmountUsd")::float8 AS gross
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId" AND pl.slug = 'buygoods'
      WHERE o."funnelSessionId" = substring(v."sessionKey" from 9)
        AND o.status = 'APPROVED'
        AND o."productType"::text = ${STAGE_PT('p')}
        AND ${ORDER_STEP} = ${STAGE_STEP('p')}
        AND o."orderedAt" >= v."firstAt" - interval '2 hours'
        AND o."orderedAt" <= v."firstAt" + interval '2 days'
    ) x ON x.gross IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5`;
}

async function linkedRows(where: Prisma.Sql): Promise<LinkedRow[]> {
  const rows = await db.$queryRaw<RawLinked[]>(linkedRowsSql(where));
  return rows.map((r) => ({ pageId: r.pageId, vslId: r.vslId, testId: r.testId, armId: r.armId, day: r.day, soldVisits: r.sold, revenue: Number(r.revenue) }));
}

interface RawReal { pageId: string; day: string; fe: number; sales: number; revenue: number }

/** Venda real por página e dia BRT: sessões com FE da família e vendas da etapa. */
export function realRowsSql(f: VslPerformanceFilters): Prisma.Sql {
  // FE até 2 dias antes do início: o upsell do primeiro dia precisa achar a
  // família do FE da sessão.
  const feStart = new Date(f.start.getTime() - 2 * 86_400_000);
  return Prisma.sql`
    WITH pg AS (
      SELECT p.id, p.family, p.platform, ${STAGE_PT('p')} AS pt, ${STAGE_STEP('p')} AS step,
             COALESCE(p."feBottles", ARRAY[]::int[]) AS fe_bottles
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
      SELECT pl.slug AS platform, ${SESSION_KEY} AS sk, o."productType"::text AS pt, ${ORDER_STEP} AS step,
             o."grossAmountUsd" AS gross, o."orderedAt" AS at, pr.family AS own_family
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId"
      JOIN "Product" pr ON pr.id = o."productId"
      WHERE o.status = 'APPROVED' AND o."productType" IN ('UPSELL', 'DOWNSELL')
        AND o."orderedAt" >= ${f.start} AND o."orderedAt" <= ${f.end}
        AND pl.slug IN (SELECT DISTINCT platform FROM pg)
    ),
    sales AS (
      SELECT pg.id AS page_id, ${DAY_SQL(Prisma.sql`bk.at`)} AS day,
             COUNT(DISTINCT bk.sk)::int AS sales, COALESCE(SUM(bk.gross), 0)::float8 AS revenue
      FROM bk
      LEFT JOIN fe ON fe.platform = bk.platform AND fe.sk = bk.sk
      JOIN pg ON pg.platform = bk.platform AND pg.family = COALESCE(fe.family, bk.own_family)
             AND pg.pt = bk.pt AND pg.step = bk.step
             -- variante por potes do FE: só a sessão cujo front bate (sem FE conhecido, fica fora)
             AND (cardinality(pg.fe_bottles) = 0 OR fe.bottles = ANY(pg.fe_bottles))
      GROUP BY 1, 2
    ),
    fes AS (
      SELECT pg.id AS page_id, ${DAY_SQL(Prisma.sql`fe.at`)} AS day, COUNT(*)::int AS fe
      FROM fe JOIN pg ON pg.platform = fe.platform AND pg.family = fe.family
             AND (cardinality(pg.fe_bottles) = 0 OR fe.bottles = ANY(pg.fe_bottles))
      WHERE fe.at >= ${f.start}
      GROUP BY 1, 2
    )
    SELECT COALESCE(s.page_id, x.page_id) AS "pageId", COALESCE(s.day, x.day) AS day,
           COALESCE(x.fe, 0)::int AS fe, COALESCE(s.sales, 0)::int AS sales, COALESCE(s.revenue, 0)::float8 AS revenue
    FROM sales s FULL OUTER JOIN fes x ON x.page_id = s.page_id AND x.day = s.day`;
}

async function realRows(f: VslPerformanceFilters): Promise<RealRow[]> {
  const rows = await db.$queryRaw<RawReal[]>(realRowsSql(f));
  return rows.map((r) => ({ pageId: r.pageId, day: r.day, feSessions: r.fe, sales: r.sales, revenue: Number(r.revenue) }));
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
      WHERE v."testId" = ANY(${ids}::text[]) AND v."armId" IS NOT NULL
        AND (t."endedAt" IS NULL OR v."firstAt" <= t."endedAt")
      GROUP BY 1, 2`,
    linkedRows(Prisma.sql`v."testId" = ANY(${ids}::text[]) AND v."armId" IS NOT NULL
      AND (SELECT t."endedAt" IS NULL OR v."firstAt" <= t."endedAt" FROM "VslTest" t WHERE t.id = v."testId")`),
  ]);
  const armKey = (t: string, a: string) => `${t}|${a}`;
  const agg = new Map(arms.map((r) => [armKey(r.testId, r.armId), r]));
  const sold = new Map<string, { sold: number; revenue: number }>();
  for (const l of linked) {
    if (!l.testId || !l.armId) continue;
    const k = armKey(l.testId, l.armId);
    const s = sold.get(k) ?? { sold: 0, revenue: 0 };
    s.sold += l.soldVisits;
    s.revenue += l.revenue;
    sold.set(k, s);
  }
  return tests.map((t) => {
    const linkable = t.page.platform === 'buygoods';
    const ordered = [...t.arms].sort((a, b) => a.label.localeCompare(b.label));
    const armOut = ordered.map((a) => {
      const r = agg.get(armKey(t.id, a.id));
      const s = sold.get(armKey(t.id, a.id));
      const m = finishMetrics({
        visits: r?.visits ?? 0, plays: r?.plays ?? 0, pitch: r?.pitch ?? 0, accepts: r?.accepts ?? 0,
        acceptsAfterPitch: r?.accepts_pitch ?? 0, declines: r?.declines ?? 0,
        watchSum: Number(r?.watch ?? 0), sold: s?.sold ?? 0, revenue: s?.revenue ?? 0, linkable,
        linkableVisits: linkable ? r?.visits ?? 0 : 0,
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
        ? abStats(armOut.map((a) => ({ id: a.id, label: a.label, visits: a.visits, conversions: a.sales ?? 0, active: a.weight > 0 })), { minConversions: 15 })
        : null,
    };
  });
}

export async function getVslPerformance(f: VslPerformanceFilters) {
  const [visits, linked, real, pages, changes, tests] = await Promise.all([
    visitRows(f),
    linkedRows(Prisma.sql`v."firstAt" >= ${f.start} AND v."firstAt" <= ${f.end} AND ${pageWhere(f)}`),
    realRows(f),
    db.vslPage.findMany({ select: { id: true, platform: true, fallbackVslId: true, installedAt: true } }),
    db.vslChange.findMany({ where: { pageId: { not: null } }, select: { pageId: true, kind: true, toVslId: true, createdAt: true } }),
    testResults(),
  ]);
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
    tests,
  };
}
