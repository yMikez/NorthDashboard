// Aba Afiliados › Networks (contrato docs/integracoes/redes.md §7).
//
// Base: network_sales (a marca de cada venda de rede, com atribuição, CPA e
// comissão do NorthAffiliates) ligada ao Order JVZoo pelo transaction_id.
//   - Vendas = network_sales `attributed` (sem teste, salvo "incluir testes").
//   - Faturamento = receita líquida (gross das APPROVED, como o resto do dash:
//     estorno in-place da JVZoo tira a venda) dos pedidos do FUNIL de cada
//     venda (mesma sessão JVZoo: COALESCE(parentExternalId, externalId)).
//   - Situação: o estorno/chargeback vale o que vier primeiro — da leitura
//     do NorthAffiliates (state) ou do próprio pedido.
//   - CPA devido / repasse / margem: vendas approved, held ou já pagas.
//   - Checkouts: por dia × rede × integrante × produto vale o MAIOR entre os
//     eventos recebidos (network_checkouts) e a contagem lida
//     (network_checkout_daily). Com filtro de tráfego (utm/sub1), só os
//     eventos — a contagem lida não tem essa quebra.
//
// SQL exportado pra teste (PGlite). Agregação por (rede, integrante) num SQL
// só; KPIs e tabelas saem daí em JS (buildNetworkTables, puro).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { brtDay } from './networksCore';

export interface NetworkFilters {
  start: Date;
  end: Date;
  networkId?: string | null;
  memberId?: string | null;
  /** jvzoo_product_id — a chave comum a vendas e checkouts. */
  productId?: string | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
  sub1?: string | null;
  includeTests?: boolean;
}

export const RECENT_PAGE_SIZE = 50;
const PENDING_STALE_MS = 3_600_000;

const JVZOO_ID = Prisma.sql`(SELECT id FROM "Platform" WHERE slug = 'jvzoo')`;
const BRT_DAY = (col: Prisma.Sql) => Prisma.sql`((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date`;

function hasTrafficFilter(f: NetworkFilters): boolean {
  return Boolean(f.utmSource || f.utmCampaign || f.sub1);
}

/** WHERE das vendas (alias ns) — período, rede, integrante, produto, tráfego, testes. */
export function salesWhereSql(f: NetworkFilters, opts: { period?: boolean } = {}): Prisma.Sql {
  const c: Prisma.Sql[] = [];
  if (opts.period !== false) {
    c.push(Prisma.sql`COALESCE(ns.sold_at, ns.created_at) >= ${f.start}`, Prisma.sql`COALESCE(ns.sold_at, ns.created_at) <= ${f.end}`);
  }
  if (!f.includeTests) c.push(Prisma.sql`NOT ns.is_test`);
  if (f.networkId) c.push(Prisma.sql`ns.network_id = ${f.networkId}`);
  if (f.memberId) c.push(Prisma.sql`ns.member_id = ${f.memberId}`);
  if (f.productId) c.push(Prisma.sql`ns.jvzoo_product_id = ${f.productId}`);
  if (f.utmSource) c.push(Prisma.sql`ns.utm_source = ${f.utmSource}`);
  if (f.utmCampaign) c.push(Prisma.sql`ns.utm_campaign = ${f.utmCampaign}`);
  if (f.sub1) c.push(Prisma.sql`ns.sub1 = ${f.sub1}`);
  return c.length ? Prisma.join(c, ' AND ') : Prisma.sql`TRUE`;
}

/** Venda + situação efetiva + sessão do pedido (CTE `s`). */
function salesCte(f: NetworkFilters): Prisma.Sql {
  return Prisma.sql`
    s AS (
      SELECT ns.transaction_id, ns.network_id, ns.member_id, ns.attribution_status, ns.attribution_reason,
             ns.network_cpa, ns.member_amount, ns.network_margin, ns.commission_status,
             ${BRT_DAY(Prisma.sql`COALESCE(ns.sold_at, ns.created_at)`)} AS day,
             COALESCE(ns.sold_at, ns.created_at) AS sold_at,
             CASE WHEN ns.state IN ('refunded', 'chargeback') THEN ns.state
                  WHEN o.status = 'REFUNDED' THEN 'refunded'
                  WHEN o.status = 'CHARGEBACK' THEN 'chargeback'
                  ELSE COALESCE(ns.state, 'approved') END AS st,
             o."platformId" AS platform_id,
             COALESCE(o."parentExternalId", o."externalId") AS session_key
      FROM network_sales ns
      LEFT JOIN "Order" o ON o."platformId" = ${JVZOO_ID} AND o."externalId" = ns.transaction_id
      WHERE ${salesWhereSql(f)}
    ),
    a AS (SELECT * FROM s WHERE attribution_status = 'attributed')`;
}

/** Checkouts por dia × rede × integrante × produto (CTE `ck`). */
function checkoutsCte(f: NetworkFilters): Prisma.Sql {
  const ev: Prisma.Sql[] = [Prisma.sql`c.at >= ${f.start}`, Prisma.sql`c.at <= ${f.end}`];
  const rd: Prisma.Sql[] = [Prisma.sql`d.day >= ${brtDay(f.start)}::date`, Prisma.sql`d.day <= ${brtDay(f.end)}::date`];
  if (f.networkId) { ev.push(Prisma.sql`c.network_id = ${f.networkId}`); rd.push(Prisma.sql`d.network_id = ${f.networkId}`); }
  if (f.memberId) { ev.push(Prisma.sql`c.member_id = ${f.memberId}`); rd.push(Prisma.sql`d.member_key = ${f.memberId}`); }
  if (f.productId) { ev.push(Prisma.sql`c.jvzoo_product_id = ${f.productId}`); rd.push(Prisma.sql`d.product_key = ${f.productId}`); }
  if (f.utmSource) ev.push(Prisma.sql`c.utm_source = ${f.utmSource}`);
  if (f.utmCampaign) ev.push(Prisma.sql`c.utm_campaign = ${f.utmCampaign}`);
  if (f.sub1) ev.push(Prisma.sql`c.sub1 = ${f.sub1}`);
  // Com filtro de tráfego a leitura não entra (não tem utm/sub1).
  if (hasTrafficFilter(f)) rd.push(Prisma.sql`FALSE`);
  return Prisma.sql`
    ev AS (
      SELECT ${BRT_DAY(Prisma.sql`c.at`)} AS day, c.network_id, COALESCE(c.member_id, '') AS mk,
             COALESCE(c.jvzoo_product_id, '') AS pk, COUNT(*)::int AS n
      FROM network_checkouts c
      WHERE ${Prisma.join(ev, ' AND ')}
      GROUP BY 1, 2, 3, 4
    ),
    rd AS (
      SELECT d.day, d.network_id, d.member_key AS mk, d.product_key AS pk, d.checkouts AS n
      FROM network_checkout_daily d
      WHERE ${Prisma.join(rd, ' AND ')}
    ),
    ck AS (
      SELECT COALESCE(ev.day, rd.day) AS day, COALESCE(ev.network_id, rd.network_id) AS network_id,
             COALESCE(ev.mk, rd.mk) AS mk, COALESCE(ev.pk, rd.pk) AS pk,
             GREATEST(COALESCE(ev.n, 0), COALESCE(rd.n, 0)) AS n
      FROM ev FULL OUTER JOIN rd
        ON ev.day = rd.day AND ev.network_id = rd.network_id AND ev.mk = rd.mk AND ev.pk = rd.pk
    )`;
}

/** Agregado por (rede, integrante): vendas, situação, dinheiro e faturamento do funil. */
export function networkAggSql(f: NetworkFilters): Prisma.Sql {
  return Prisma.sql`
    WITH ${salesCte(f)},
    fo AS (
      -- Pedidos do funil de cada venda: o raiz e os filhos (dois joins por
      -- índice — um OR no join vira varredura da tabela por venda).
      SELECT a.network_id, a.member_id, a.sold_at, o2.id, o2.status, o2."grossAmountUsd" AS gross
      FROM a JOIN "Order" o2 ON o2."platformId" = a.platform_id AND o2."externalId" = a.session_key
      UNION ALL
      SELECT a.network_id, a.member_id, a.sold_at, o2.id, o2.status, o2."grossAmountUsd"
      FROM a JOIN "Order" o2 ON o2."platformId" = a.platform_id AND o2."parentExternalId" = a.session_key
    ),
    so AS (
      -- Um pedido conta uma vez só (a venda mais antiga da sessão).
      SELECT DISTINCT ON (id) network_id, member_id, status, gross FROM fo ORDER BY id, sold_at
    ),
    rev AS (
      SELECT network_id, member_id,
             COALESCE(SUM(gross) FILTER (WHERE status = 'APPROVED'), 0)::float8 AS revenue
      FROM so GROUP BY 1, 2
    ),
    agg AS (
      SELECT network_id, member_id,
             COUNT(*)::int AS sales,
             COUNT(*) FILTER (WHERE st = 'refunded')::int AS refunds,
             COUNT(*) FILTER (WHERE st = 'chargeback')::int AS chargebacks,
             COUNT(*) FILTER (WHERE st = 'held')::int AS held,
             COALESCE(SUM(network_cpa) FILTER (WHERE st = 'held'), 0)::float8 AS held_cpa,
             COALESCE(SUM(network_cpa) FILTER (WHERE due), 0)::float8 AS cpa_due,
             COALESCE(SUM(member_amount) FILTER (WHERE due), 0)::float8 AS member_due,
             COALESCE(SUM(member_amount) FILTER (WHERE commission_status = 'paid'), 0)::float8 AS member_paid,
             COALESCE(SUM(network_margin) FILTER (WHERE due), 0)::float8 AS margin
      FROM (SELECT a.*, (st IN ('approved', 'held') OR commission_status = 'paid') AS due FROM a) x
      GROUP BY 1, 2
    )
    SELECT agg.*, COALESCE(rev.revenue, 0)::float8 AS revenue
    FROM agg
    LEFT JOIN rev ON rev.network_id = agg.network_id AND rev.member_id IS NOT DISTINCT FROM agg.member_id`;
}

export function checkoutAggSql(f: NetworkFilters): Prisma.Sql {
  return Prisma.sql`
    WITH ${checkoutsCte(f)}
    SELECT network_id, NULLIF(mk, '') AS member_id, SUM(n)::int AS checkouts
    FROM ck GROUP BY 1, 2`;
}

export function networkDailySql(f: NetworkFilters): Prisma.Sql {
  return Prisma.sql`
    WITH ${salesCte(f)}, ${checkoutsCte(f)}
    SELECT to_char(day, 'YYYY-MM-DD') AS day, network_id, SUM(sales)::int AS sales, SUM(checkouts)::int AS checkouts
    FROM (
      SELECT day, network_id, COUNT(*) AS sales, 0 AS checkouts FROM a GROUP BY 1, 2
      UNION ALL
      SELECT day, network_id, 0, SUM(n) FROM ck GROUP BY 1, 2
    ) u
    GROUP BY 1, 2
    ORDER BY 1, 2`;
}

/** Vendas recentes (todas as situações de atribuição) — paginado. */
export function networkRecentSql(f: NetworkFilters, page: number): Prisma.Sql {
  const offset = (Math.max(1, page) - 1) * RECENT_PAGE_SIZE;
  return Prisma.sql`
    SELECT ns.transaction_id, COALESCE(ns.sold_at, ns.created_at) AS sold_at, ns.network_id, n.name AS network_name,
           ns.member_id, m.public_id AS member_public_id, m.name AS member_name,
           ns.jvzoo_product_id, ns.product_name, ns.amount_usd::float8 AS amount_usd, ns.is_test,
           CASE WHEN ns.state IN ('refunded', 'chargeback') THEN ns.state
                WHEN o.status = 'REFUNDED' THEN 'refunded'
                WHEN o.status = 'CHARGEBACK' THEN 'chargeback'
                ELSE ns.state END AS state,
           ns.attribution_status, ns.attribution_reason,
           ns.network_cpa::float8 AS network_cpa, ns.member_amount::float8 AS member_amount,
           ns.commission_status, ns.commission_available_at, ns.commission_paid_at,
           ns.utm_source, ns.utm_campaign, ns.sub1, ns.tid,
           o."externalId" AS order_external_id,
           COUNT(*) OVER ()::int AS total
    FROM network_sales ns
    LEFT JOIN affiliate_networks n ON n.network_id = ns.network_id
    LEFT JOIN affiliate_network_members m ON m.member_id = ns.member_id
    LEFT JOIN "Order" o ON o."platformId" = ${JVZOO_ID} AND o."externalId" = ns.transaction_id
    WHERE ${salesWhereSql(f)}
    ORDER BY COALESCE(ns.sold_at, ns.created_at) DESC, ns.transaction_id
    LIMIT ${RECENT_PAGE_SIZE} OFFSET ${offset}`;
}

/** Diagnóstico: sem atribuição por motivo (no período) e pendentes há mais de 1 h (qualquer data). */
export function networkDiagnosticsSql(f: NetworkFilters, now: Date): { unattributed: Prisma.Sql; pending: Prisma.Sql } {
  return {
    unattributed: Prisma.sql`
      SELECT COALESCE(ns.attribution_reason, 'sem_motivo') AS reason, COUNT(*)::int AS sales,
             COALESCE(SUM(ns.amount_usd), 0)::float8 AS amount
      FROM network_sales ns
      WHERE ${salesWhereSql(f)} AND ns.attribution_status = 'unattributed'
      GROUP BY 1 ORDER BY 2 DESC`,
    pending: Prisma.sql`
      SELECT ns.transaction_id, ns.network_id, n.name AS network_name, ns.product_name,
             COALESCE(ns.sold_at, ns.created_at) AS sold_at, ns.updated_at, ns.attribution_reason,
             (o.id IS NOT NULL) AS has_order
      FROM network_sales ns
      LEFT JOIN affiliate_networks n ON n.network_id = ns.network_id
      LEFT JOIN "Order" o ON o."platformId" = ${JVZOO_ID} AND o."externalId" = ns.transaction_id
      WHERE ${salesWhereSql({ ...f, utmSource: null, utmCampaign: null, sub1: null }, { period: false })}
        AND ns.attribution_status = 'pending'
        AND COALESCE(ns.sold_at, ns.created_at) < ${new Date(now.getTime() - PENDING_STALE_MS)}
      ORDER BY COALESCE(ns.sold_at, ns.created_at) DESC
      LIMIT 50`,
  };
}

// ---------- Montagem (pura) ----------

export interface AggRow {
  network_id: string; member_id: string | null;
  sales: number; refunds: number; chargebacks: number; held: number; held_cpa: number;
  cpa_due: number; member_due: number; member_paid: number; margin: number; revenue: number;
}
export interface CheckoutRow { network_id: string; member_id: string | null; checkouts: number }

export interface NetworkTotals {
  sales: number; revenue: number; checkouts: number; conversion: number | null;
  cpaDue: number; memberDue: number; memberPaid: number; margin: number;
  refunds: number; chargebacks: number; refundPct: number | null; chargebackPct: number | null;
  profit: number; held: number; heldCpa: number; netSales: number;
  /** Faturamento ÷ vendas líquidas (as que seguem de pé): quanto cada venda da rede/integrante rende no funil. */
  aov: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function emptyTotals(): NetworkTotals {
  return {
    sales: 0, revenue: 0, checkouts: 0, conversion: null, cpaDue: 0, memberDue: 0, memberPaid: 0, margin: 0,
    refunds: 0, chargebacks: 0, refundPct: null, chargebackPct: null, profit: 0, held: 0, heldCpa: 0, netSales: 0, aov: null,
  };
}
function addAgg(t: NetworkTotals, r: AggRow): void {
  t.sales += r.sales; t.revenue += r.revenue; t.refunds += r.refunds; t.chargebacks += r.chargebacks;
  t.held += r.held; t.heldCpa += r.held_cpa; t.cpaDue += r.cpa_due; t.memberDue += r.member_due;
  t.memberPaid += r.member_paid; t.margin += r.margin;
}
function finish(t: NetworkTotals): NetworkTotals {
  // O faturamento já vem sem as vendas estornadas (só APPROVED): o divisor
  // são as vendas que seguiram de pé, senão o estorno derruba o AOV duas vezes.
  const netSales = t.sales - t.refunds - t.chargebacks;
  return {
    ...t,
    aov: netSales > 0 ? r2(t.revenue / netSales) : null,
    revenue: r2(t.revenue), cpaDue: r2(t.cpaDue), memberDue: r2(t.memberDue), memberPaid: r2(t.memberPaid),
    margin: r2(t.margin), heldCpa: r2(t.heldCpa),
    conversion: t.checkouts > 0 ? t.sales / t.checkouts : null,
    refundPct: t.sales > 0 ? t.refunds / t.sales : null,
    chargebackPct: t.sales > 0 ? t.chargebacks / t.sales : null,
    profit: r2(t.revenue - t.cpaDue),
    netSales: t.sales - t.refunds - t.chargebacks,
  };
}

export interface NetworkRef { id: string; name: string; status: string }
export interface MemberInfo { id: string; networkId: string; publicId: string | null; name: string; status: string }

export interface NetworkTables {
  totals: NetworkTotals;
  byNetwork: Array<NetworkTotals & { networkId: string; name: string; status: string | null; membersWithSales: number; membersActive: number }>;
  byMember: Array<NetworkTotals & { memberId: string | null; networkId: string; networkName: string; publicId: string | null; name: string; status: string | null }>;
}

/** KPIs + tabela por rede + tabela por integrante (ranking por vendas líquidas). */
export function buildNetworkTables(
  agg: AggRow[], checkouts: CheckoutRow[], networks: NetworkRef[], members: MemberInfo[],
): NetworkTables {
  const netName = new Map(networks.map((n) => [n.id, n]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const totals = emptyTotals();
  const byNet = new Map<string, NetworkTotals & { members: Set<string> }>();
  const byMem = new Map<string, NetworkTotals & { networkId: string; memberId: string | null }>();
  const netOf = (id: string) => {
    let t = byNet.get(id);
    if (!t) { t = { ...emptyTotals(), members: new Set() }; byNet.set(id, t); }
    return t;
  };
  const memOf = (networkId: string, memberId: string | null) => {
    const key = `${networkId}|${memberId ?? ''}`;
    let t = byMem.get(key);
    if (!t) { t = { ...emptyTotals(), networkId, memberId }; byMem.set(key, t); }
    return t;
  };
  for (const r of agg) {
    addAgg(totals, r);
    const n = netOf(r.network_id);
    addAgg(n, r);
    if (r.member_id && r.sales > 0) n.members.add(r.member_id);
    addAgg(memOf(r.network_id, r.member_id), r);
  }
  for (const c of checkouts) {
    totals.checkouts += c.checkouts;
    netOf(c.network_id).checkouts += c.checkouts;
    memOf(c.network_id, c.member_id).checkouts += c.checkouts;
  }
  const byNetwork = [...byNet.entries()].map(([networkId, t]) => {
    const { members: set, ...rest } = t;
    const ref = netName.get(networkId);
    return {
      ...finish(rest), networkId, name: ref?.name ?? networkId, status: ref?.status ?? null,
      membersWithSales: set.size,
      membersActive: members.filter((m) => m.networkId === networkId && m.status === 'active').length,
    };
  }).sort((a, b) => b.netSales - a.netSales || b.revenue - a.revenue);
  const byMember = [...byMem.values()].map((t) => {
    const m = t.memberId ? memberById.get(t.memberId) : undefined;
    const { networkId, memberId, ...rest } = t;
    return {
      ...finish(rest), memberId, networkId, networkName: netName.get(networkId)?.name ?? networkId,
      publicId: m?.publicId ?? null, name: m?.name ?? (memberId ? memberId : 'Sem integrante'), status: m?.status ?? null,
    };
  }).sort((a, b) => b.netSales - a.netSales || b.revenue - a.revenue || b.checkouts - a.checkouts);
  return { totals: finish(totals), byNetwork, byMember };
}

// ---------- Leitura ----------

export async function getNetworkFilterOptions() {
  const [networks, members, products, traffic] = await Promise.all([
    db.affiliateNetwork.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: 'asc' } }),
    db.affiliateNetworkMember.findMany({ select: { id: true, networkId: true, publicId: true, name: true, status: true }, orderBy: { name: 'asc' } }),
    db.$queryRaw<Array<{ id: string; name: string | null }>>(Prisma.sql`
      SELECT jvzoo_product_id AS id, MAX(product_name) AS name FROM network_sales
      WHERE jvzoo_product_id IS NOT NULL GROUP BY 1 ORDER BY 2`),
    db.$queryRaw<Array<{ kind: string; value: string }>>(Prisma.sql`
      SELECT kind, value FROM (
        SELECT 'utm_source' AS kind, utm_source AS value, COUNT(*) AS n FROM network_sales WHERE utm_source IS NOT NULL GROUP BY 2
        UNION ALL SELECT 'utm_campaign', utm_campaign, COUNT(*) FROM network_sales WHERE utm_campaign IS NOT NULL GROUP BY 2
        UNION ALL SELECT 'sub1', sub1, COUNT(*) FROM network_sales WHERE sub1 IS NOT NULL GROUP BY 2
      ) t ORDER BY kind, n DESC, value LIMIT 600`),
  ]);
  const pick = (k: string) => traffic.filter((t) => t.kind === k).slice(0, 200).map((t) => t.value);
  return {
    networks,
    members,
    products: products.map((p) => ({ id: p.id, name: p.name ?? p.id })),
    utmSources: pick('utm_source'),
    utmCampaigns: pick('utm_campaign'),
    sub1s: pick('sub1'),
  };
}

/**
 * Perfil da entidade selecionada (integrante ou rede): primeira e última
 * venda atribuída (de sempre), vendas de sempre, e os produtos e origens de
 * tráfego que mais venderam NO PERÍODO (mesmos filtros da aba).
 */
export function entityProfileSql(f: NetworkFilters, kind: 'member' | 'network'): { lifetime: Prisma.Sql; products: Prisma.Sql; sources: Prisma.Sql } {
  const col = kind === 'member' ? Prisma.sql`ns.member_id` : Prisma.sql`ns.network_id`;
  const id = kind === 'member' ? f.memberId : f.networkId;
  const attributed = Prisma.sql`ns.attribution_status = 'attributed'`;
  return {
    lifetime: Prisma.sql`
      SELECT MIN(COALESCE(ns.sold_at, ns.created_at)) AS first_sale_at,
             MAX(COALESCE(ns.sold_at, ns.created_at)) AS last_sale_at,
             COUNT(*)::int AS lifetime_sales,
             COALESCE(SUM(ns.member_amount) FILTER (WHERE ns.commission_status = 'paid'), 0)::float8 AS lifetime_member_paid
      FROM network_sales ns
      WHERE ${col} = ${id} AND ${attributed} AND NOT ns.is_test`,
    products: Prisma.sql`
      SELECT COALESCE(ns.product_name, ns.jvzoo_product_id, '—') AS label, COUNT(*)::int AS sales
      FROM network_sales ns
      WHERE ${salesWhereSql(f)} AND ${attributed}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`,
    sources: Prisma.sql`
      SELECT COALESCE(ns.utm_source, '(sem utm)') AS label, COUNT(*)::int AS sales
      FROM network_sales ns
      WHERE ${salesWhereSql(f)} AND ${attributed}
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`,
  };
}

export interface EntityProfile {
  kind: 'member' | 'network';
  id: string;
  firstSaleAt: string | null;
  lastSaleAt: string | null;
  lifetimeSales: number;
  lifetimeMemberPaid: number;
  topProducts: Array<{ label: string; sales: number }>;
  topSources: Array<{ label: string; sales: number }>;
  /** Só rede: modo de operação e contas JVZoo. */
  network?: { operationMode: string | null; jvzooAffiliateIds: string[] } | null;
}

async function getEntityProfile(f: NetworkFilters): Promise<EntityProfile | null> {
  const kind = f.memberId ? 'member' : f.networkId ? 'network' : null;
  if (!kind) return null;
  const q = entityProfileSql(f, kind);
  const [lifetime, products, sources, net] = await Promise.all([
    db.$queryRaw<Array<{ first_sale_at: Date | null; last_sale_at: Date | null; lifetime_sales: number; lifetime_member_paid: number }>>(q.lifetime),
    db.$queryRaw<Array<{ label: string; sales: number }>>(q.products),
    db.$queryRaw<Array<{ label: string; sales: number }>>(q.sources),
    kind === 'network'
      ? db.affiliateNetwork.findUnique({ where: { id: f.networkId! }, select: { operationMode: true, jvzooAffiliateIds: true } })
      : Promise.resolve(null),
  ]);
  const l = lifetime[0];
  return {
    kind,
    id: (kind === 'member' ? f.memberId : f.networkId)!,
    firstSaleAt: l?.first_sale_at ? new Date(l.first_sale_at).toISOString() : null,
    lastSaleAt: l?.last_sale_at ? new Date(l.last_sale_at).toISOString() : null,
    lifetimeSales: l?.lifetime_sales ?? 0,
    lifetimeMemberPaid: Math.round((l?.lifetime_member_paid ?? 0) * 100) / 100,
    topProducts: products,
    topSources: sources,
    network: kind === 'network' ? (net ? { operationMode: net.operationMode, jvzooAffiliateIds: net.jvzooAffiliateIds } : null) : undefined,
  };
}

export async function getNetworksDashboard(f: NetworkFilters, opts: { page?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const diag = networkDiagnosticsSql(f, now);
  const [options, agg, checkouts, daily, recent, unattributed, pending, selected] = await Promise.all([
    getNetworkFilterOptions(),
    db.$queryRaw<AggRow[]>(networkAggSql(f)),
    db.$queryRaw<CheckoutRow[]>(checkoutAggSql(f)),
    db.$queryRaw<Array<{ day: string; network_id: string; sales: number; checkouts: number }>>(networkDailySql(f)),
    db.$queryRaw<Array<Record<string, unknown> & { total: number }>>(networkRecentSql(f, opts.page ?? 1)),
    db.$queryRaw<Array<{ reason: string; sales: number; amount: number }>>(diag.unattributed),
    db.$queryRaw<Array<Record<string, unknown>>>(diag.pending),
    getEntityProfile(f),
  ]);
  const tables = buildNetworkTables(agg, checkouts, options.networks, options.members);
  return {
    ...tables,
    daily,
    recent: { page: opts.page ?? 1, pageSize: RECENT_PAGE_SIZE, total: recent[0]?.total ?? 0, rows: recent.map(({ total: _t, ...r }) => r) },
    diagnostics: { unattributed, pending },
    options,
    // Rede ou integrante escolhido no filtro: o perfil dele (o AOV e os números
    // do recorte estão em `totals`).
    selected,
    checkoutsSource: hasTrafficFilter(f) ? 'events' : 'max(events, read)',
  };
}
