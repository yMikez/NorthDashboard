// Aba Leads: a pessoa (e-mail normalizado) no centro, cruzando todas as
// fontes de compra — funil das plataformas, call center (Tauk/Logicall) e
// SalesBound. Lista, indicadores e quebra por origem leem a MV lead_summary
// (migração 20261009120000 — regras de dinheiro documentadas lá); a ficha de
// um lead lê os eventos AO VIVO, com as mesmas regras.
//
// Filtros de período/plataforma/família/país/afiliado valem pra ORIGEM do
// lead (a 1ª compra): "leads adquiridos no período por X, quanto valem hoje".
// A busca por e-mail/nome ignora os filtros — quem procura alguém quer achar.
//
// Telefone: guardado desde 2026-10-09 (Customer.phone, SalesboundTransaction
// .phone, CallCenterSale.phone) e mostrado na ficha/busca — ainda NÃO casa
// com os SMS (decisão do dono: por enquanto só guardar).
// Ainda fora: SMS, e-mail marketing (nada chega do Mautic) e o backfill de
// recuperação da BuyGoods (só hash do e-mail, sem tela por decisão do dono).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { clearResponseCache } from '../cache/responseCache';
import { normalizePhone } from '../shared/phone';

// ---------- Frescor da MV ----------

const STALE_MS = 10 * 60_000;
let refreshInFlight: Promise<void> | null = null;

export function refreshLeadSummary(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const t0 = Date.now();
    try {
      await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY lead_summary');
    } catch {
      await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW lead_summary');
    }
    clearResponseCache();
    logger.info({ ms: Date.now() - t0 }, 'lead_summary refreshed');
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/** Instante do último refresh (null = MV vazia). Velha → refresh em segundo plano. */
export async function ensureLeadSummaryFresh(): Promise<Date | null> {
  const [row] = await db.$queryRaw<Array<{ at: Date | null }>>`SELECT computed_at AS at FROM lead_summary LIMIT 1`;
  const at = row?.at ? new Date(row.at) : null;
  if (!at || Date.now() - at.getTime() > STALE_MS) {
    refreshLeadSummary().catch((err) => logger.error({ err }, 'lead_summary refresh failed'));
  }
  return at;
}

// ---------- Lista / KPIs / quebra ----------

export const LEAD_SORTS = ['ltv', 'recent', 'new', 'purchases', 'refunds'] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];
export const LEAD_SEGMENTS = ['all', 'repeat', 'multichannel', 'callcenter', 'salesbound', 'refunded', 'single'] as const;
export type LeadSegment = (typeof LEAD_SEGMENTS)[number];
export const LEAD_GROUPS = ['channel', 'platform', 'affiliate', 'family', 'country'] as const;
export type LeadGroup = (typeof LEAD_GROUPS)[number];

export const LEADS_PAGE_SIZE = 50;

export interface LeadFilters {
  startDate: Date;
  endDate: Date;
  platforms?: string[];
  families?: string[];
  countries?: string[];
  affiliateIds?: string[];
  segment?: LeadSegment;
  q?: string;
  sort?: LeadSort;
  page?: number;
  groupBy?: LeadGroup;
}

/** WHERE da MV. Com busca, só a busca vale (procura em todos os leads). */
export function leadWhereSql(f: LeadFilters): Prisma.Sql {
  const q = (f.q ?? '').trim().toLowerCase();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    // Busca que é só número (6+ dígitos) também procura no telefone, que é
    // guardado só com dígitos.
    const digits = q.replace(/\D/g, '');
    const byPhone = digits.length >= 6 && /^[\d\s()+.-]+$/.test(q)
      ? Prisma.sql` OR ls.phone LIKE ${`%${digits}%`}`
      : Prisma.empty;
    return Prisma.sql`WHERE (ls.email LIKE ${like} OR lower(COALESCE(ls.name, '')) LIKE ${like}${byPhone})`;
  }
  const conds: Prisma.Sql[] = [Prisma.sql`ls.first_at >= ${f.startDate}`, Prisma.sql`ls.first_at <= ${f.endDate}`];
  if (f.platforms?.length) conds.push(Prisma.sql`ls.origin_platform = ANY(${f.platforms})`);
  if (f.families?.length) conds.push(Prisma.sql`ls.origin_family = ANY(${f.families})`);
  if (f.countries?.length) conds.push(Prisma.sql`ls.country = ANY(${f.countries})`);
  if (f.affiliateIds?.length) conds.push(Prisma.sql`ls.origin_affiliate_id = ANY(${f.affiliateIds})`);
  switch (f.segment ?? 'all') {
    case 'repeat': conds.push(Prisma.sql`ls.purchase_days > 1`); break;
    case 'single': conds.push(Prisma.sql`ls.purchase_days = 1`); break;
    case 'multichannel': conds.push(Prisma.sql`cardinality(ls.channels) > 1`); break;
    case 'callcenter': conds.push(Prisma.sql`'callcenter' = ANY(ls.channels)`); break;
    case 'salesbound': conds.push(Prisma.sql`'salesbound' = ANY(ls.channels)`); break;
    case 'refunded': conds.push(Prisma.sql`ls.refunded_usd > 0`); break;
    default: break;
  }
  return Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;
}

const ORDER_BY: Record<LeadSort, Prisma.Sql> = {
  ltv: Prisma.sql`ls.ltv_usd DESC, ls.email`,
  recent: Prisma.sql`ls.last_at DESC, ls.email`,
  new: Prisma.sql`ls.first_at DESC, ls.email`,
  purchases: Prisma.sql`ls.purchases DESC, ls.ltv_usd DESC, ls.email`,
  refunds: Prisma.sql`ls.refunded_usd DESC, ls.email`,
};

export function leadListSql(f: LeadFilters): Prisma.Sql {
  const page = Math.max(1, Math.trunc(f.page ?? 1));
  return Prisma.sql`
    SELECT ls.email, ls.name, ls.country, ls.first_at AS "firstAt", ls.last_at AS "lastAt",
           ls.purchases, ls.purchase_days AS "purchaseDays",
           ls.gross_usd::float AS "grossUsd", ls.refunded_usd::float AS "refundedUsd", ls.ltv_usd::float AS "ltvUsd",
           ls.funnel_usd::float AS "funnelUsd", ls.callcenter_usd::float AS "callcenterUsd", ls.salesbound_usd::float AS "salesboundUsd",
           ls.origin_channel AS "originChannel", ls.origin_platform AS "originPlatform", ls.origin_family AS "originFamily",
           ls.origin_product AS "originProduct", ls.origin_affiliate_id AS "originAffiliateId",
           COALESCE(a.nickname, a."externalId") AS "originAffiliate",
           ls.channels, ls.families,
           COUNT(*) OVER()::int AS total
    FROM lead_summary ls
    LEFT JOIN "Affiliate" a ON a.id = ls.origin_affiliate_id
    ${leadWhereSql(f)}
    ORDER BY ${ORDER_BY[f.sort ?? 'ltv']}
    LIMIT ${LEADS_PAGE_SIZE} OFFSET ${(page - 1) * LEADS_PAGE_SIZE}`;
}

// Janelas de LTV: só entra quem já viveu a janela inteira (censura) — senão
// o lead de ontem puxaria a média de 90 dias pra baixo.
const windowAvg = (col: string, days: number) => Prisma.sql`
  AVG(ls.${Prisma.raw(col)}) FILTER (WHERE ls.first_at <= now() - make_interval(days => ${days}::int))::float AS ${Prisma.raw(`"${col}Avg"`)},
  COUNT(*) FILTER (WHERE ls.first_at <= now() - make_interval(days => ${days}::int))::int AS ${Prisma.raw(`"${col}Eligible"`)}`;

export function leadKpisSql(f: LeadFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::int AS leads,
           COALESCE(SUM(ls.ltv_usd), 0)::float AS "ltvUsd",
           COALESCE(AVG(ls.ltv_usd), 0)::float AS "ltvAvg",
           COALESCE(SUM(ls.gross_usd), 0)::float AS "grossUsd",
           COALESCE(SUM(ls.refunded_usd), 0)::float AS "refundedUsd",
           COALESCE(SUM(ls.funnel_usd), 0)::float AS "funnelUsd",
           COALESCE(SUM(ls.callcenter_usd), 0)::float AS "callcenterUsd",
           COALESCE(SUM(ls.salesbound_usd), 0)::float AS "salesboundUsd",
           COALESCE(AVG(ls.purchases), 0)::float AS "purchasesAvg",
           COUNT(*) FILTER (WHERE ls.purchase_days > 1)::int AS "repeatLeads",
           COUNT(*) FILTER (WHERE cardinality(ls.channels) > 1)::int AS "multichannelLeads",
           COUNT(*) FILTER (WHERE 'callcenter' = ANY(ls.channels))::int AS "callcenterLeads",
           COUNT(*) FILTER (WHERE 'salesbound' = ANY(ls.channels))::int AS "salesboundLeads",
           COUNT(*) FILTER (WHERE ls.refunded_usd > 0)::int AS "refundedLeads",
           COALESCE(AVG(ls.ltv_24h), 0)::float AS "ltv_24hAvg",
           ${windowAvg('ltv_30d', 30)},
           ${windowAvg('ltv_90d', 90)},
           ${windowAvg('ltv_180d', 180)}
    FROM lead_summary ls
    ${leadWhereSql(f)}`;
}

const GROUP_KEY: Record<LeadGroup, Prisma.Sql> = {
  channel: Prisma.sql`ls.origin_channel`,
  platform: Prisma.sql`ls.origin_platform`,
  affiliate: Prisma.sql`ls.origin_affiliate_id`,
  family: Prisma.sql`ls.origin_family`,
  country: Prisma.sql`ls.country`,
};

export function leadBreakdownSql(f: LeadFilters, groupBy: LeadGroup): Prisma.Sql {
  const key = GROUP_KEY[groupBy];
  const label = groupBy === 'affiliate'
    ? Prisma.sql`MAX(COALESCE(a.nickname, a."externalId") || ' · ' || ls.origin_platform)`
    : Prisma.sql`MAX(${key})`;
  return Prisma.sql`
    SELECT ${key} AS key, ${label} AS label,
           COUNT(*)::int AS leads,
           AVG(ls.ltv_usd)::float AS "ltvAvg",
           AVG(ls.ltv_24h)::float AS "ltv24hAvg",
           AVG(ls.ltv_90d) FILTER (WHERE ls.first_at <= now() - interval '90 days')::float AS "ltv90Avg",
           COUNT(*) FILTER (WHERE ls.first_at <= now() - interval '90 days')::int AS "ltv90Eligible",
           (COUNT(*) FILTER (WHERE ls.purchase_days > 1))::float / COUNT(*) AS "repeatRate",
           SUM(ls.gross_usd)::float AS "grossUsd",
           SUM(ls.refunded_usd)::float AS "refundedUsd",
           SUM(ls.ltv_usd)::float AS "ltvUsd",
           SUM(ls.callcenter_usd + ls.salesbound_usd)::float AS "postSaleUsd"
    FROM lead_summary ls
    LEFT JOIN "Affiliate" a ON a.id = ls.origin_affiliate_id
    ${leadWhereSql(f)}
    GROUP BY 1
    ORDER BY leads DESC, "ltvUsd" DESC
    LIMIT 25`;
}

export interface LeadRow {
  email: string;
  name: string | null;
  country: string | null;
  firstAt: string;
  lastAt: string;
  purchases: number;
  purchaseDays: number;
  grossUsd: number;
  refundedUsd: number;
  ltvUsd: number;
  funnelUsd: number;
  callcenterUsd: number;
  salesboundUsd: number;
  originChannel: string;
  originPlatform: string | null;
  originFamily: string | null;
  originProduct: string | null;
  originAffiliateId: string | null;
  originAffiliate: string | null;
  channels: string[];
  families: string[];
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10_000) / 10_000 : null);

export async function getLeads(f: LeadFilters) {
  const computedAt = await ensureLeadSummaryFresh();
  const groupBy = f.groupBy ?? 'channel';
  const [rows, [k], groups] = await Promise.all([
    db.$queryRaw<Array<LeadRow & { total: number }>>(leadListSql(f)),
    db.$queryRaw<Array<Record<string, number>>>(leadKpisSql(f)),
    db.$queryRaw<Array<Record<string, unknown>>>(leadBreakdownSql(f, groupBy)),
  ]);
  const total = rows[0]?.total ?? (f.page && f.page > 1 ? null : 0);
  const postSale = (k?.callcenterUsd ?? 0) + (k?.salesboundUsd ?? 0);
  return {
    computedAt: computedAt?.toISOString() ?? null,
    search: (f.q ?? '').trim() || null,
    kpis: k && {
      leads: k.leads,
      ltvUsd: r2(k.ltvUsd), ltvAvg: r2(k.ltvAvg),
      grossUsd: r2(k.grossUsd), refundedUsd: r2(k.refundedUsd), refundRate: ratio(k.refundedUsd, k.grossUsd),
      funnelUsd: r2(k.funnelUsd), callcenterUsd: r2(k.callcenterUsd), salesboundUsd: r2(k.salesboundUsd),
      postSaleUsd: r2(postSale), postSaleShare: ratio(postSale, k.ltvUsd),
      purchasesAvg: r2(k.purchasesAvg),
      repeatLeads: k.repeatLeads, repeatRate: ratio(k.repeatLeads, k.leads),
      multichannelLeads: k.multichannelLeads, callcenterLeads: k.callcenterLeads, salesboundLeads: k.salesboundLeads,
      refundedLeads: k.refundedLeads,
      ltv24hAvg: r2(k.ltv_24hAvg),
      ltv30Avg: r2(k.ltv_30dAvg), ltv30Eligible: k.ltv_30dEligible,
      ltv90Avg: r2(k.ltv_90dAvg), ltv90Eligible: k.ltv_90dEligible,
      ltv180Avg: r2(k.ltv_180dAvg), ltv180Eligible: k.ltv_180dEligible,
    },
    groupBy,
    groups: groups.map((g) => ({
      key: (g.key as string | null) ?? null,
      label: (g.label as string | null) ?? null,
      leads: g.leads as number,
      ltvAvg: r2(g.ltvAvg as number),
      ltv24hAvg: r2(g.ltv24hAvg as number),
      ltv90Avg: r2(g.ltv90Avg as number | null),
      ltv90Eligible: g.ltv90Eligible as number,
      repeatRate: g.repeatRate == null ? null : Math.round((g.repeatRate as number) * 10_000) / 10_000,
      grossUsd: r2(g.grossUsd as number),
      refundedUsd: r2(g.refundedUsd as number),
      refundRate: ratio(g.refundedUsd as number, g.grossUsd as number),
      ltvUsd: r2(g.ltvUsd as number),
      postSaleShare: ratio(g.postSaleUsd as number, g.ltvUsd as number),
    })),
    page: Math.max(1, Math.trunc(f.page ?? 1)),
    pageSize: LEADS_PAGE_SIZE,
    total,
    leads: rows.map(({ total: _t, ...r }) => ({ ...r, firstAt: iso(r.firstAt)!, lastAt: iso(r.lastAt)! })),
  };
}

// ---------- Ficha do lead ----------

export type LeadEventKind = 'venda' | 'estorno' | 'chargeback' | 'void' | 'pendente' | 'cancelado';

export interface LeadEvent {
  at: string;
  channel: 'funil' | 'callcenter' | 'salesbound';
  source: string;
  kind: LeadEventKind;
  status: string;
  stage: string | null;
  product: string | null;
  family: string | null;
  bottles: number | null;
  saleUsd: number;
  refundedUsd: number;
  /** false = não entra no LTV (pendente/cancelado). */
  counted: boolean;
  refundedAt: string | null;
  affiliate: string | null;
  agent: string | null;
  ref: string;
}

export function leadOrderEventsSql(email: string): Prisma.Sql {
  return Prisma.sql`
    SELECT o."externalId" AS ref, pl.slug AS platform, o.status::text AS status, o."productType"::text AS stage,
           pr.name AS product, pr.family, o."bottlesShipped" AS bottles, o."orderedAt" AS at,
           COALESCE(o."refundedAt", o."chargebackAt") AS "refundedAt",
           COALESCE(a.nickname, a."externalId") AS affiliate,
           NULLIF(trim(concat_ws(' ', c."firstName", c."lastName")), '') AS name, o.country, c.phone,
           (o.status IN ('APPROVED', 'REFUNDED', 'CHARGEBACK')) AS counted,
           (pl.slug = 'digistore24' AND o.status IN ('REFUNDED', 'CHARGEBACK')) AS "extraRow",
           (CASE WHEN pl.slug = 'digistore24' AND o.status IN ('REFUNDED', 'CHARGEBACK') THEN 0
                 ELSE COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd")) END)::float AS sale,
           (CASE WHEN o.status IN ('REFUNDED', 'CHARGEBACK') THEN
              CASE WHEN pl.slug = 'digistore24' THEN ABS(o."grossAmountUsd")
                   ELSE LEAST(ABS(o."grossAmountUsd"), ABS(COALESCE(o."originalGrossUsd", o."grossAmountUsd"))) END
            ELSE 0 END)::float AS refunded
    FROM "Order" o
    JOIN "Customer" c ON c.id = o."customerId"
    JOIN "Platform" pl ON pl.id = o."platformId"
    JOIN "Product" pr ON pr.id = o."productId"
    LEFT JOIN "Affiliate" a ON a.id = o."affiliateId"
    WHERE lower(trim(c.email)) = ${email}
    ORDER BY o."orderedAt", o."externalId"`;
}

export function leadCallCenterEventsSql(email: string): Prisma.Sql {
  return Prisma.sql`
    SELECT s."externalKey" AS ref, s.provider, s.status, s."productName" AS product, s.family, s.bottles,
           s."purchasedAt" AS at, s."refundedAt", s."agentName" AS agent,
           NULLIF(trim(concat_ws(' ', s."firstName", s."lastName")), '') AS name, s.country, s.phone,
           s."amountUsd"::float AS sale,
           (CASE WHEN s.status IN ('REFUNDED', 'CHARGEBACK') THEN COALESCE(s."refundedUsd", s."amountUsd")
                 ELSE COALESCE(s."refundedUsd", 0) END)::float AS refunded
    FROM "CallCenterSale" s
    WHERE lower(trim(s.email)) = ${email}
    ORDER BY s."purchasedAt"`;
}

export function leadSalesboundEventsSql(email: string): Prisma.Sql {
  return Prisma.sql`
    SELECT t."transactionId" AS ref, t."orderId", t.type, t."amountUsd"::float AS amount, t.items, t.family, t.bottles,
           t."txnAt" AS at, t."agentName" AS agent, t."sourcePlatform", t.phone
    FROM "SalesboundTransaction" t
    WHERE lower(trim(t.email)) = ${email} AND t.result = 'SUCCESS' AND t.type IN ('SALE', 'REFUND', 'VOID')
    ORDER BY t."txnAt"`;
}

interface OrderEv { ref: string; platform: string; status: string; stage: string | null; product: string | null; family: string | null; bottles: number | null; at: Date; refundedAt: Date | null; affiliate: string | null; name: string | null; country: string | null; phone?: string | null; counted: boolean; extraRow: boolean; sale: number; refunded: number }
interface CcEv { ref: string; provider: string; status: string; product: string | null; family: string | null; bottles: number | null; at: Date; refundedAt: Date | null; agent: string | null; name: string | null; country: string | null; phone?: string | null; sale: number; refunded: number }
interface SbEv { ref: string; orderId: string; type: string; amount: number; items: unknown; family: string | null; bottles: number | null; at: Date; agent: string | null; sourcePlatform: string | null; phone?: string | null }

function sbProduct(items: unknown): string | null {
  if (!Array.isArray(items) || !items.length) return null;
  const names = items.map((i) => (i && typeof i === 'object' ? (i as { name?: unknown }).name : null)).filter((n): n is string => typeof n === 'string' && !!n);
  return names.length ? names.join(' + ') : null;
}

/** Monta a ficha a partir dos eventos crus (puro — testável sem banco). */
export function buildLeadDetail(email: string, orders: OrderEv[], cc: CcEv[], sb: SbEv[]) {
  const events: LeadEvent[] = [];
  for (const o of orders) {
    const kind: LeadEventKind = o.extraRow
      ? (o.status === 'CHARGEBACK' ? 'chargeback' : 'estorno')
      : o.status === 'PENDING' ? 'pendente'
      : o.status === 'CANCELED' ? 'cancelado'
      : 'venda';
    events.push({
      at: o.at.toISOString(), channel: 'funil', source: o.platform, kind, status: o.status, stage: o.stage,
      product: o.product, family: o.family, bottles: o.bottles,
      saleUsd: o.sale, refundedUsd: o.counted ? o.refunded : 0, counted: o.counted,
      refundedAt: o.refundedAt ? o.refundedAt.toISOString() : null,
      affiliate: o.affiliate, agent: null, ref: o.ref,
    });
  }
  for (const s of cc) {
    events.push({
      at: s.at.toISOString(), channel: 'callcenter', source: s.provider, kind: 'venda', status: s.status, stage: null,
      product: s.product, family: s.family, bottles: s.bottles, saleUsd: s.sale, refundedUsd: s.refunded, counted: true,
      refundedAt: s.refundedAt ? s.refundedAt.toISOString() : null, affiliate: null, agent: s.agent, ref: s.ref,
    });
  }
  // Reembolso/void da SalesBound vem sem item: herda o produto da venda do
  // mesmo pedido do CRM.
  const sbSaleProduct = new Map<string, string>();
  for (const t of sb) {
    const name = sbProduct(t.items);
    if (t.type === 'SALE' && name && !sbSaleProduct.has(t.orderId)) sbSaleProduct.set(t.orderId, name);
  }
  for (const t of sb) {
    const kind: LeadEventKind = t.type === 'SALE' ? 'venda' : t.type === 'VOID' ? 'void' : 'estorno';
    events.push({
      at: t.at.toISOString(), channel: 'salesbound', source: 'salesbound', kind, status: t.type, stage: null,
      product: sbProduct(t.items) ?? sbSaleProduct.get(t.orderId) ?? null, family: t.family, bottles: t.type === 'SALE' ? t.bottles : null,
      saleUsd: t.type === 'SALE' ? t.amount : 0, refundedUsd: t.type === 'SALE' ? 0 : t.amount, counted: true,
      refundedAt: null, affiliate: null, agent: t.agent, ref: t.ref,
    });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : b.saleUsd - a.saleUsd));

  const sales = events.filter((e) => e.counted && e.saleUsd > 0);
  const sum = (xs: LeadEvent[], k: 'saleUsd' | 'refundedUsd') => r2(xs.reduce((a, e) => a + e[k], 0))!;
  const counted = events.filter((e) => e.counted);
  const gross = sum(counted, 'saleUsd');
  const refunded = sum(counted, 'refundedUsd');
  const byChannel = (ch: LeadEvent['channel']) => {
    const xs = counted.filter((e) => e.channel === ch);
    return r2(sum(xs, 'saleUsd') - sum(xs, 'refundedUsd'))!;
  };
  const brtDay = (isoAt: string) => new Date(new Date(isoAt).getTime() - 3 * 3600_000).toISOString().slice(0, 10);

  // Produtos comprados: agrupa por nome (o mesmo pote em canais diferentes
  // fica em linhas diferentes só se o nome diferir).
  const products = new Map<string, { product: string; family: string | null; channels: Set<string>; times: number; bottles: number; grossUsd: number; refundedUsd: number; lastAt: string }>();
  for (const e of counted) {
    if (e.saleUsd <= 0 && e.refundedUsd <= 0) continue;
    const name = e.product ?? '(sem nome)';
    const p = products.get(name) ?? { product: name, family: e.family, channels: new Set<string>(), times: 0, bottles: 0, grossUsd: 0, refundedUsd: 0, lastAt: e.at };
    p.channels.add(e.channel);
    if (e.saleUsd > 0) { p.times++; p.bottles += e.bottles ?? 0; p.lastAt = e.at > p.lastAt ? e.at : p.lastAt; }
    p.grossUsd = r2(p.grossUsd + e.saleUsd)!;
    p.refundedUsd = r2(p.refundedUsd + e.refundedUsd)!;
    products.set(name, p);
  }

  const name = [...orders, ...cc].map((x) => x.name).filter(Boolean).pop() ?? null;
  const country = [...orders, ...cc].map((x) => x.country).filter(Boolean)[0] ?? null;
  // Telefones de todas as fontes, o mais recente primeiro. O call center
  // guarda cru: normaliza aqui com a mesma regra (lib/shared/phone.ts).
  const phones = [...new Set(
    [...orders.map((o) => ({ at: o.at, p: o.phone })), ...cc.map((s) => ({ at: s.at, p: s.phone })), ...sb.map((t) => ({ at: t.at, p: t.phone }))]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map((x) => normalizePhone(x.p))
      .filter((p): p is string => !!p),
  )];
  return {
    email,
    name,
    country,
    phones,
    found: events.length > 0,
    summary: {
      firstAt: sales[0]?.at ?? null,
      lastAt: sales.length ? sales[sales.length - 1].at : null,
      purchases: sales.length,
      purchaseDays: new Set(sales.map((e) => brtDay(e.at))).size,
      grossUsd: gross,
      refundedUsd: refunded,
      ltvUsd: r2(gross - refunded)!,
      funnelUsd: byChannel('funil'),
      callcenterUsd: byChannel('callcenter'),
      salesboundUsd: byChannel('salesbound'),
      channels: [...new Set(sales.map((e) => e.channel))],
      platforms: [...new Set(sales.map((e) => e.source))],
      origin: sales[0] ? { channel: sales[0].channel, source: sales[0].source, product: sales[0].product, affiliate: sales[0].affiliate } : null,
    },
    products: [...products.values()]
      .map((p) => ({ ...p, channels: [...p.channels] }))
      .sort((a, b) => b.grossUsd - a.grossUsd),
    events,
  };
}

export function normalizeLeadEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(e) && e.length <= 320 ? e : null;
}

export async function getLeadDetail(rawEmail: string) {
  const email = normalizeLeadEmail(rawEmail);
  if (!email) return null;
  const [orders, cc, sb] = await Promise.all([
    db.$queryRaw<OrderEv[]>(leadOrderEventsSql(email)),
    db.$queryRaw<CcEv[]>(leadCallCenterEventsSql(email)),
    db.$queryRaw<SbEv[]>(leadSalesboundEventsSql(email)),
  ]);
  return buildLeadDetail(email, orders, cc, sb);
}

// ---------- ClickBank: cliente pelos avisos guardados ----------

/**
 * Pedidos ClickBank nunca ganharam Customer (o conector mandava
 * customerExternalId null). Recria a partir dos IPNs em IngestLog: chave =
 * e-mail normalizado, igual ao conector corrigido. Idempotente.
 */
export function clickbankBackfillSql(): { count: Prisma.Sql; insert: Prisma.Sql; link: Prisma.Sql } {
  const src = Prisma.sql`
    WITH src AS (
      SELECT DISTINCT ON (l."externalId") l."externalId" AS ext,
             lower(trim(COALESCE(NULLIF(l.payload#>>'{customer,billing,email}', ''), l.payload#>>'{customer,shipping,email}'))) AS email,
             NULLIF(l.payload#>>'{customer,billing,firstName}', '') AS first_name,
             NULLIF(l.payload#>>'{customer,billing,lastName}', '') AS last_name,
             lower(NULLIF(l.payload->>'orderLanguage', '')) AS lang
      FROM "IngestLog" l
      WHERE l."platformSlug" = 'clickbank' AND l."externalId" IS NOT NULL
      ORDER BY l."externalId", l."receivedAt"
    ),
    tgt AS (
      SELECT o.id AS order_id, o."platformId" AS platform_id, o."orderedAt" AS at, o.country, src.*
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId" AND pl.slug = 'clickbank'
      JOIN src ON src.ext = o."externalId"
      WHERE o."customerId" IS NULL AND src.email LIKE '%@%'
    )`;
  return {
    count: Prisma.sql`${src} SELECT COUNT(*)::int AS orders, COUNT(DISTINCT email)::int AS customers FROM tgt`,
    // Mesma chave do conector corrigido (e-mail normalizado). Se o cliente
    // já existe (pedido novo chegou depois da correção), só vincula.
    insert: Prisma.sql`
      ${src}
      INSERT INTO "Customer" (id, "platformId", "externalId", email, "firstName", "lastName", language, country, "firstSeenAt", "lastOrderAt")
      SELECT 'cbk_' || md5(platform_id || ':' || email), platform_id, email, email,
             (array_agg(first_name ORDER BY at) FILTER (WHERE first_name IS NOT NULL))[1],
             (array_agg(last_name ORDER BY at) FILTER (WHERE last_name IS NOT NULL))[1],
             (array_agg(lang ORDER BY at) FILTER (WHERE lang IS NOT NULL))[1],
             (array_agg(country ORDER BY at) FILTER (WHERE country IS NOT NULL))[1],
             MIN(at), MAX(at)
      FROM tgt GROUP BY platform_id, email
      ON CONFLICT ("platformId", "externalId") DO NOTHING`,
    link: Prisma.sql`
      ${src}
      UPDATE "Order" o SET "customerId" = c.id
      FROM tgt JOIN "Customer" c ON c."platformId" = tgt.platform_id AND c."externalId" = tgt.email
      WHERE o.id = tgt.order_id AND o."customerId" IS NULL`,
  };
}

export async function backfillClickbankCustomers(dryRun: boolean) {
  const q = clickbankBackfillSql();
  const [before] = await db.$queryRaw<Array<{ orders: number; customers: number }>>(q.count);
  if (dryRun || !before?.orders) return { dryRun, ordersToLink: before?.orders ?? 0, customers: before?.customers ?? 0, created: 0, linked: 0 };
  const [created, linked] = await db.$transaction([db.$executeRaw(q.insert), db.$executeRaw(q.link)]);
  return { dryRun, ordersToLink: before.orders, customers: before.customers, created, linked };
}
