// aggregate_orders: GROUP BY em SQL no lugar de paginar get_orders e somar
// página a página (29 mil pedidos não cabem no contexto; somar de cabeça
// erra). A SQL é montada SÓ com fragmentos da whitelist abaixo — nome de
// dimensão/métrica nunca vira texto de SQL; todo valor vai como parâmetro.
//
// Semântica (mesma das abas):
//   - eixo 'sale' filtra por orderedAt; 'refund_event' conta o estorno pela
//     data em que ACONTECEU (REFUNDED→refundedAt, CHARGEBACK→chargebackAt),
//     igual aos cards de reembolso da Visão Geral e à aba Transações;
//   - baldes de tempo em dia/hora BRT (mesmo idioma da MV daily_metrics);
//   - gross_approved/net = APPROVED; gross_original, cpa, cogs, fulfillment
//     = todas as linhas (mesmas somas da MV → bate com get_overview);
//   - real_orders desconta as linhas sintéticas de estorno da Digistore
//     (realOrderCount); refunded_usd segue reversedAmount (ordersDump.ts);
//   - fe_sessions/aov_session = AOV canônico (feSessionStats: sessão pela
//     SESSION_KEY_SQL, BuyGoods por sessid2), agrupado pela linha do FE.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { SESSION_KEY_SQL } from '../services/metrics';
import { EXTRA_ROW_REFUND_PLATFORMS } from '../services/profitModel';
import { cleanFloat } from './calc';

export const ORDER_DIMENSIONS = [
  'day', 'week', 'month', 'hour', 'dow', 'platform', 'family', 'product', 'product_type', 'country', 'status',
  'affiliate', 'mapped_affiliate', 'payment_method', 'traffic_source', 'funnel_step',
] as const;
export type OrderDimension = (typeof ORDER_DIMENSIONS)[number];

export const ORDER_METRICS = [
  'rows', 'real_orders', 'approved', 'refunds', 'chargebacks', 'fe_sessions', 'gross_approved', 'gross_original',
  'net', 'cpa', 'cogs', 'fulfillment', 'refunded_usd', 'aov_session', 'approval_rate', 'refund_rate',
] as const;
export type OrderMetric = (typeof ORDER_METRICS)[number];

export const ORDER_STATUSES = ['APPROVED', 'REFUNDED', 'CHARGEBACK', 'PENDING', 'CANCELED'] as const;
export const PRODUCT_TYPES = ['FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP', 'SMS_RECOVERY'] as const;

export const METRIC_UNITS: Record<OrderMetric | 'sales_real_orders', 'count' | 'usd' | 'fraction'> = {
  rows: 'count', real_orders: 'count', approved: 'count', refunds: 'count', chargebacks: 'count', fe_sessions: 'count',
  gross_approved: 'usd', gross_original: 'usd', net: 'usd', cpa: 'usd', cogs: 'usd', fulfillment: 'usd', refunded_usd: 'usd',
  aov_session: 'usd', approval_rate: 'fraction', refund_rate: 'fraction', sales_real_orders: 'count',
};

export const ORDER_AGG_MAX_LIMIT = 1000;
export const ORDER_AGG_DEFAULT_LIMIT = 200;
/** Teto de grupos lidos do banco (o sort/limit é feito depois do merge). */
export const ORDER_AGG_GROUP_CAP = 20_000;

export interface OrderAggSpec {
  startAt: Date;
  endAt: Date;
  axis: 'sale' | 'refund_event';
  platforms?: string[];
  families?: string[];
  products?: string[];
  stages?: Array<(typeof PRODUCT_TYPES)[number]>;
  countries?: string[];
  affiliateIds?: string[];
  statuses?: Array<(typeof ORDER_STATUSES)[number]>;
  groupBy: OrderDimension[];
  metrics: OrderMetric[];
  orderBy?: string;
  dir: 'asc' | 'desc';
  limit: number;
}

export class OrderAggInputError extends Error {}

// ── Fragmentos (whitelist) ───────────────────────────────────────────────

const BRT = (col: Prisma.Sql) => Prisma.sql`((${col}) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'`;
const REFUND_EVENT_AT = Prisma.sql`CASE WHEN o."status" = 'REFUNDED' THEN o."refundedAt" ELSE o."chargebackAt" END`;

function dateCol(axis: OrderAggSpec['axis']): Prisma.Sql {
  return axis === 'refund_event' ? REFUND_EVENT_AT : Prisma.sql`o."orderedAt"`;
}

function dimensionSql(d: OrderDimension, axis: OrderAggSpec['axis']): Prisma.Sql {
  const t = BRT(dateCol(axis));
  switch (d) {
    case 'day': return Prisma.sql`to_char(${t}, 'YYYY-MM-DD')`;
    case 'week': return Prisma.sql`to_char(date_trunc('week', ${t}), 'YYYY-MM-DD')`;
    case 'month': return Prisma.sql`to_char(${t}, 'YYYY-MM')`;
    case 'hour': return Prisma.sql`EXTRACT(HOUR FROM ${t})::int`;
    case 'dow': return Prisma.sql`EXTRACT(ISODOW FROM ${t})::int`;
    case 'platform': return Prisma.sql`pl."slug"`;
    case 'family': return Prisma.sql`pr."family"`;
    case 'product': return Prisma.sql`pr."externalId"`;
    case 'product_type': return Prisma.sql`o."productType"::text`;
    case 'country': return Prisma.sql`o."country"`;
    case 'status': return Prisma.sql`o."status"::text`;
    case 'affiliate': return Prisma.sql`CASE WHEN a."id" IS NULL THEN NULL ELSE pl."slug" || ':' || a."externalId" END`;
    case 'mapped_affiliate': return Prisma.sql`o."mappedAffiliateId"`;
    case 'payment_method': return Prisma.sql`o."paymentMethod"`;
    case 'traffic_source': return Prisma.sql`o."trafficSource"`;
    case 'funnel_step': return Prisma.sql`o."funnelStep"`;
  }
}

/** Rótulo legível que acompanha a dimensão (a chave é o valor do filtro). */
function labelSql(d: OrderDimension): { name: string; sql: Prisma.Sql } | null {
  switch (d) {
    case 'product': return { name: 'product_name', sql: Prisma.sql`MIN(pr."name")` };
    case 'affiliate': return { name: 'affiliate_nickname', sql: Prisma.sql`MIN(a."nickname")` };
    case 'mapped_affiliate': return { name: 'mapped_affiliate_name', sql: Prisma.sql`MIN(ms."name")` };
    default: return null;
  }
}

function joins(groupBy: OrderDimension[]): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`JOIN "Platform" pl ON pl."id" = o."platformId"`,
    Prisma.sql`JOIN "Product" pr ON pr."id" = o."productId"`,
  ];
  if (groupBy.includes('affiliate')) parts.push(Prisma.sql`LEFT JOIN "Affiliate" a ON a."id" = o."affiliateId"`);
  if (groupBy.includes('mapped_affiliate')) parts.push(Prisma.sql`LEFT JOIN "affiliate_mapping_state" ms ON ms."affiliate_id" = o."mappedAffiliateId"`);
  return Prisma.join(parts, '\n');
}

function extraRow(): string[] {
  return [...EXTRA_ROW_REFUND_PLATFORMS];
}

function baseAggregates(): Prisma.Sql {
  const extra = extraRow();
  return Prisma.sql`COUNT(*)::int AS "rows",
  COUNT(*) FILTER (WHERE NOT (pl."slug" = ANY(${extra}) AND o."status" IN ('REFUNDED', 'CHARGEBACK')))::int AS "real_orders",
  COUNT(*) FILTER (WHERE o."status" = 'APPROVED')::int AS "approved",
  COUNT(*) FILTER (WHERE o."status" = 'REFUNDED')::int AS "refunds",
  COUNT(*) FILTER (WHERE o."status" = 'CHARGEBACK')::int AS "chargebacks",
  COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."status" = 'APPROVED'), 0)::float8 AS "gross_approved",
  COALESCE(SUM(COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd"))), 0)::float8 AS "gross_original",
  COALESCE(SUM(o."netAmountUsd") FILTER (WHERE o."status" = 'APPROVED'), 0)::float8 AS "net",
  COALESCE(SUM(o."cpaPaidUsd"), 0)::float8 AS "cpa",
  COALESCE(SUM(o."cogsUsd"), 0)::float8 AS "cogs",
  COALESCE(SUM(o."fulfillmentUsd"), 0)::float8 AS "fulfillment",
  COALESCE(SUM(CASE WHEN o."status" IN ('REFUNDED', 'CHARGEBACK') THEN
    CASE WHEN pl."slug" = ANY(${extra}) THEN ABS(o."grossAmountUsd")
         ELSE LEAST(ABS(o."grossAmountUsd"), ABS(COALESCE(o."originalGrossUsd", o."grossAmountUsd"))) END
  END), 0)::float8 AS "refunded_usd"`;
}

/** Filtros de dimensão (valem pro pedido; na query de sessão, pro FE). */
function scopeConds(spec: OrderAggSpec, opts: { products: boolean; stages: boolean; families: boolean; affiliates: boolean }): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];
  if (spec.platforms?.length) c.push(Prisma.sql`pl."slug" = ANY(${spec.platforms})`);
  if (spec.countries?.length) c.push(Prisma.sql`o."country" = ANY(${spec.countries})`);
  if (opts.families && spec.families?.length) c.push(Prisma.sql`pr."family" = ANY(${spec.families})`);
  if (opts.products && spec.products?.length) c.push(Prisma.sql`pr."externalId" = ANY(${spec.products})`);
  if (opts.stages && spec.stages?.length) c.push(Prisma.sql`o."productType" = ANY(${spec.stages}::"ProductType"[])`);
  if (opts.affiliates && spec.affiliateIds?.length) c.push(Prisma.sql`o."mappedAffiliateId" = ANY(${spec.affiliateIds})`);
  return c;
}

function periodCond(spec: OrderAggSpec, axis: OrderAggSpec['axis']): Prisma.Sql {
  if (axis === 'refund_event') {
    return Prisma.sql`((o."status" = 'REFUNDED' AND o."refundedAt" >= ${spec.startAt} AND o."refundedAt" <= ${spec.endAt})
    OR (o."status" = 'CHARGEBACK' AND o."chargebackAt" >= ${spec.startAt} AND o."chargebackAt" <= ${spec.endAt}))`;
  }
  return Prisma.sql`o."orderedAt" >= ${spec.startAt} AND o."orderedAt" <= ${spec.endAt}`;
}

function groupColumns(groupBy: OrderDimension[], axis: OrderAggSpec['axis'], withLabels: boolean): Prisma.Sql[] {
  const cols: Prisma.Sql[] = groupBy.map((d, i) => Prisma.sql`${dimensionSql(d, axis)} AS ${Prisma.raw(`"g${i}"`)}`);
  if (withLabels) {
    for (const d of groupBy) {
      const l = labelSql(d);
      if (l) cols.push(Prisma.sql`${l.sql} AS ${Prisma.raw(`"${l.name}"`)}`);
    }
  }
  return cols;
}

function groupByClause(n: number): Prisma.Sql {
  return n ? Prisma.sql`GROUP BY ${Prisma.raw(Array.from({ length: n }, (_, i) => String(i + 1)).join(', '))}` : Prisma.empty;
}

/**
 * Agregados por pedido no eixo pedido. `axis` pode diferir do spec: o
 * denominador da taxa de reembolso no eixo do estorno (card da tela) é
 * lido no eixo da venda, com os mesmos filtros e grupos.
 */
export function buildMainSql(spec: OrderAggSpec, axis: OrderAggSpec['axis'] = spec.axis): Prisma.Sql {
  const conds = [periodCond(spec, axis), ...scopeConds(spec, { products: true, stages: true, families: true, affiliates: true })];
  // Status só vale no eixo do próprio spec (no denominador, todas as linhas).
  if (axis === spec.axis && spec.statuses?.length) conds.push(Prisma.sql`o."status" = ANY(${spec.statuses}::"OrderStatus"[])`);
  const cols = [...groupColumns(spec.groupBy, axis, true), baseAggregates()];
  return Prisma.sql`SELECT ${Prisma.join(cols, ',\n  ')}
FROM "Order" o
${joins(spec.groupBy)}
WHERE ${Prisma.join(conds, '\n  AND ')}
${groupByClause(spec.groupBy.length)}
${spec.groupBy.length ? Prisma.sql`LIMIT ${ORDER_AGG_GROUP_CAP + 1}` : Prisma.empty}`;
}

/**
 * Sessões com FE aprovado (AOV canônico). Recorte como feSessionStats:
 * período/plataforma/país filtram TODOS os pedidos da sessão; família,
 * afiliado e SKU filtram pelo FE (a sessão entra inteira). O grupo da
 * sessão = valores da linha do FE (o mais antigo, se houver dois).
 */
export function buildSessionSql(spec: OrderAggSpec): Prisma.Sql {
  const baseConds = [periodCond(spec, 'sale'), ...scopeConds(spec, { products: false, stages: false, families: false, affiliates: false })];
  const feConds: Prisma.Sql[] = [Prisma.sql`b."productType" = 'FRONTEND'`, Prisma.sql`b."status" = 'APPROVED'`];
  if (spec.families?.length) feConds.push(Prisma.sql`b."fam" = ANY(${spec.families})`);
  if (spec.affiliateIds?.length) feConds.push(Prisma.sql`b."maff" = ANY(${spec.affiliateIds})`);
  if (spec.products?.length) feConds.push(Prisma.sql`b."sku" = ANY(${spec.products})`);
  const g = spec.groupBy.map((_, i) => Prisma.raw(`"g${i}"`));
  const gFe = spec.groupBy.map((_, i) => Prisma.raw(`fe."g${i}" AS "g${i}"`));
  return Prisma.sql`WITH base AS (
  SELECT o."status", o."productType", o."orderedAt", o."grossAmountUsd",
         pr."family" AS "fam", pr."externalId" AS "sku", o."mappedAffiliateId" AS "maff",
         ${SESSION_KEY_SQL} AS "skey"${spec.groupBy.length ? Prisma.sql`,\n         ${Prisma.join(groupColumns(spec.groupBy, 'sale', false), ', ')}` : Prisma.empty}
  FROM "Order" o
  ${joins(spec.groupBy)}
  WHERE ${Prisma.join(baseConds, ' AND ')}
),
fe AS (
  SELECT DISTINCT ON (b."skey") b."skey"${g.length ? Prisma.sql`, ${Prisma.join(g.map((x) => Prisma.sql`b.${x}`), ', ')}` : Prisma.empty}
  FROM base b
  WHERE ${Prisma.join(feConds, ' AND ')}
  ORDER BY b."skey", b."orderedAt"
)
SELECT ${gFe.length ? Prisma.sql`${Prisma.join(gFe, ', ')}, ` : Prisma.empty}COUNT(DISTINCT fe."skey")::int AS "fe_sessions",
  COALESCE(SUM(b."grossAmountUsd") FILTER (WHERE b."status" = 'APPROVED'), 0)::float8 AS "session_revenue"
FROM fe
JOIN base b ON b."skey" = fe."skey"
${groupByClause(spec.groupBy.length)}`;
}

// ── Validação do input da tool ───────────────────────────────────────────

function list(raw: unknown, name: string, allowed?: readonly string[]): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new OrderAggInputError(`${name} deve ser uma lista`);
  const out = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  if (allowed) {
    const bad = out.filter((x) => !allowed.includes(x));
    if (bad.length) throw new OrderAggInputError(`${name} inválido: ${bad.join(', ')} — valid: ${allowed.join(', ')}`);
  }
  return out.length ? out : undefined;
}

const TIME_DIMS = new Set<OrderDimension>(['day', 'week', 'month', 'hour', 'dow']);
const SESSION_METRICS = new Set<OrderMetric>(['fe_sessions', 'aov_session']);

export function parseOrderAggSpec(raw: Record<string, unknown>, period: { startAt: Date; endAt: Date }): OrderAggSpec {
  const axis = raw.date_axis === undefined ? 'sale' : String(raw.date_axis);
  if (axis !== 'sale' && axis !== 'refund_event') throw new OrderAggInputError('date_axis inválido — valid: sale, refund_event');
  const groupBy = (list(raw.group_by, 'group_by', ORDER_DIMENSIONS) ?? []) as OrderDimension[];
  if (groupBy.length > 3) throw new OrderAggInputError('group_by aceita no máximo 3 dimensões');
  // Default por eixo: no eixo do estorno só existem linhas REFUNDED/CHARGEBACK
  // — approved/gross_approved davam 0 em todo grupo (a skill de reembolso
  // chama aggregate_orders(date_axis=refund_event, group_by) sem metrics).
  const metrics = (list(raw.metrics, 'metrics', ORDER_METRICS)
    ?? (axis === 'refund_event' ? ['refunds', 'chargebacks', 'refunded_usd'] : ['approved', 'gross_approved'])) as OrderMetric[];
  if (axis === 'refund_event') {
    // approved/gross_approved são 0 por construção e real_orders vira "estornos
    // fora da Digistore" — denominador falso se dividido à mão (a taxa é refund_rate).
    const bad = metrics.filter((m) => SESSION_METRICS.has(m) || m === 'approval_rate' || m === 'approved' || m === 'gross_approved' || m === 'real_orders');
    if (bad.length) throw new OrderAggInputError(`${bad.join(', ')} só existe no eixo da venda (date_axis=sale)`);
  }
  const statuses = list(raw.status, 'status', ORDER_STATUSES) as OrderAggSpec['statuses'];
  if (axis === 'refund_event' && statuses?.some((s) => s !== 'REFUNDED' && s !== 'CHARGEBACK')) {
    throw new OrderAggInputError('no eixo refund_event o status só pode ser REFUNDED e/ou CHARGEBACK');
  }
  const orderBy = raw.order_by === undefined ? undefined : String(raw.order_by);
  if (orderBy && !(ORDER_METRICS as readonly string[]).includes(orderBy) && !groupBy.includes(orderBy as OrderDimension)) {
    throw new OrderAggInputError(`order_by deve ser uma das métricas pedidas ou dimensão do group_by (${[...metrics, ...groupBy].join(', ')})`);
  }
  if (orderBy && (ORDER_METRICS as readonly string[]).includes(orderBy) && !metrics.includes(orderBy as OrderMetric)) {
    throw new OrderAggInputError(`order_by "${orderBy}" precisa estar em metrics`);
  }
  const limitRaw = raw.limit === undefined ? ORDER_AGG_DEFAULT_LIMIT : Math.trunc(Number(raw.limit));
  if (!Number.isFinite(limitRaw) || limitRaw < 1) throw new OrderAggInputError('limit deve ser inteiro ≥ 1');
  return {
    startAt: period.startAt,
    endAt: period.endAt,
    axis,
    platforms: list(raw.platforms, 'platforms'),
    families: list(raw.families, 'families'),
    products: list(raw.products, 'products'),
    stages: list(raw.stages, 'stages', PRODUCT_TYPES) as OrderAggSpec['stages'],
    countries: list(raw.countries, 'countries'),
    affiliateIds: list(raw.affiliate_ids, 'affiliate_ids'),
    statuses,
    groupBy,
    metrics,
    orderBy,
    dir: raw.dir === 'asc' ? 'asc' : 'desc',
    limit: Math.min(limitRaw, ORDER_AGG_MAX_LIMIT),
  };
}

// ── Execução + merge ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v == null) return 0;
  return Number(v);
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (n: number, d: number): number | null => (d > 0 ? cleanFloat(Math.round((n / d) * 1e6) / 1e6) : null);

const DOW_LABEL = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const SUM_FIELDS = ['rows', 'real_orders', 'approved', 'refunds', 'chargebacks', 'gross_approved', 'gross_original', 'net', 'cpa', 'cogs', 'fulfillment', 'refunded_usd'] as const;

interface Acc { key: unknown[]; labels: Row; sums: Record<string, number>; sessions: number; sessionRevenue: number; salesRealOrders: number }

function keyOf(row: Row, n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => {
    const v = row[`g${i}`];
    return typeof v === 'bigint' ? Number(v) : v ?? null;
  });
}

export interface OrderAggResult {
  rows: Row[];
  totals: Row;
  groups: number;
}

/** Junta as três leituras (pedidos, sessões, denominador) e calcula as taxas. Puro. */
export function mergeAggregates(spec: OrderAggSpec, main: Row[], sessions: Row[] | null, denominators: Row[] | null): OrderAggResult {
  const n = spec.groupBy.length;
  const acc = new Map<string, Acc>();
  const get = (key: unknown[]): Acc => {
    const k = JSON.stringify(key);
    let a = acc.get(k);
    if (!a) {
      a = { key, labels: {}, sums: Object.fromEntries(SUM_FIELDS.map((f) => [f, 0])), sessions: 0, sessionRevenue: 0, salesRealOrders: 0 };
      acc.set(k, a);
    }
    return a;
  };
  for (const r of main) {
    const a = get(keyOf(r, n));
    for (const f of SUM_FIELDS) a.sums[f] += toNum(r[f]);
    for (const l of ['product_name', 'affiliate_nickname', 'mapped_affiliate_name']) if (r[l] != null) a.labels[l] = r[l];
  }
  for (const r of sessions ?? []) {
    const a = get(keyOf(r, n));
    a.sessions += toNum(r.fe_sessions);
    a.sessionRevenue += toNum(r.session_revenue);
  }
  for (const r of denominators ?? []) get(keyOf(r, n)).salesRealOrders += toNum(r.real_orders);

  const finish = (a: Acc): Row => {
    const row: Row = {};
    spec.groupBy.forEach((d, i) => {
      row[d] = a.key[i];
      if (d === 'dow' && typeof a.key[i] === 'number') row.dow_label = DOW_LABEL[a.key[i] as number];
    });
    Object.assign(row, a.labels);
    for (const m of spec.metrics) {
      switch (m) {
        case 'fe_sessions': row[m] = a.sessions; break;
        case 'aov_session': row[m] = a.sessions > 0 ? r2(a.sessionRevenue / a.sessions) : null; break;
        case 'approval_rate': row[m] = ratio(a.sums.approved, a.sums.real_orders); break;
        case 'refund_rate':
          row[m] = spec.axis === 'refund_event' ? ratio(a.sums.refunds, a.salesRealOrders) : ratio(a.sums.refunds, a.sums.real_orders);
          break;
        default: {
          const v = a.sums[m];
          row[m] = METRIC_UNITS[m] === 'usd' ? r2(v) : v;
        }
      }
    }
    if (spec.axis === 'refund_event' && spec.metrics.includes('refund_rate')) row.sales_real_orders = a.salesRealOrders;
    return row;
  };

  const rows = [...acc.values()].map(finish);
  // Totais exatos: somas de TODOS os grupos (antes do limit) — sessões
  // particionam pela linha do FE, então somar grupos dá o total.
  const total: Acc = { key: [], labels: {}, sums: Object.fromEntries(SUM_FIELDS.map((f) => [f, 0])), sessions: 0, sessionRevenue: 0, salesRealOrders: 0 };
  for (const a of acc.values()) {
    for (const f of SUM_FIELDS) total.sums[f] += a.sums[f];
    total.sessions += a.sessions;
    total.sessionRevenue += a.sessionRevenue;
    total.salesRealOrders += a.salesRealOrders;
  }
  const totals = finish({ ...total, key: [] });
  for (const d of spec.groupBy) delete totals[d];
  delete totals.dow_label;

  const by = spec.orderBy ?? (n && TIME_DIMS.has(spec.groupBy[0]) ? spec.groupBy[0] : spec.metrics[0]);
  const timeDefault = !spec.orderBy && n > 0 && TIME_DIMS.has(spec.groupBy[0]);
  const sign = timeDefault ? 1 : spec.dir === 'asc' ? 1 : -1;
  rows.sort((x, y) => {
    const a = x[by]; const b = y[by];
    if (a == null || b == null) return a == null && b == null ? 0 : a == null ? 1 : -1;
    if (typeof a === 'number' && typeof b === 'number') return sign * (a - b);
    return sign * String(a).localeCompare(String(b));
  });
  return { rows: n ? rows.slice(0, spec.limit) : [totals], totals, groups: n ? rows.length : 1 };
}

export async function runOrderAggregate(spec: OrderAggSpec): Promise<OrderAggResult> {
  const needSessions = spec.metrics.some((m) => SESSION_METRICS.has(m));
  const needDenominator = spec.axis === 'refund_event' && spec.metrics.includes('refund_rate');
  const [main, sessions, denominators] = await db.$transaction(async (tx) => {
    // Teto por consulta: agregação sobre o histórico inteiro não pode segurar
    // o turno (o timeout da tool é maior; este vira erro legível antes).
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '60s'`);
    const m = await tx.$queryRaw<Row[]>(buildMainSql(spec));
    const s = needSessions ? await tx.$queryRaw<Row[]>(buildSessionSql(spec)) : null;
    const d = needDenominator ? await tx.$queryRaw<Row[]>(buildMainSql(spec, 'sale')) : null;
    return [m, s, d] as const;
  }, { timeout: 75_000, maxWait: 10_000 });
  if (spec.groupBy.length && main.length > ORDER_AGG_GROUP_CAP) {
    throw new OrderAggInputError(`o agrupamento passa de ${ORDER_AGG_GROUP_CAP} grupos — estreite o período, os filtros ou use menos dimensões`);
  }
  return mergeAggregates(spec, main, sessions, denominators);
}
