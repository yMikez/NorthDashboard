// Aba Recorrências: todas as assinaturas, de qualquer plataforma.
//
// De onde vem cada coisa (sempre do public — é onde chegam os avisos de
// renovação, cancelamento e falha; o dado oficial não marca recorrência):
//   cobranças  → Order de produto recorrente (JVZoo, ClickBank, BuyGoods,
//                Digistore). Produto recorrente = já teve renovação (BILL,
//                rebill, pay_sequence_no > 1) ou aviso de cancelamento/falha
//                de recorrência. Pedido estornado/cancelado depois conta como
//                cobrança se um dia foi aprovado (approvedAt fica gravado).
//   avisos     → IngestLog dos eventos de cancelamento/falha/reativação, que
//                não viram venda (CANCEL-REBILL, INSF, canceledfromrebill,
//                rebill_cancelled, payment_missed…). Liga pela mesma chave:
//                plataforma + e-mail + produto.
//   Vupim      → Subscription/SubscriptionEvent (webhook de assinatura).
// O resto (status, ciclo, retenção, previsão) é lib/recurrences/core.ts.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { parseJvzooIngest } from '../connectors/jvzoo/ingest';
import { parseClickBankIngest } from '../connectors/clickbank/ingest';
import { parseBuyGoodsIngest } from '../connectors/buygoods/ingest';
import { parseDigistoreIngest } from '../connectors/digistore24/ingest';
import type { NormalizedOrder } from '../shared/types';
import { SURVEY_TRACKING_PREFIX } from '../surveys/fimTratamento';
import { DAYS_PER_BOTTLE } from '../subscriptions/core';
import { analyze, buildSubs, type RecCharge, type RecDashboard, type RecEvent, type RecEventKind, type RecSubInput } from '../recurrences/core';

/** eventType (minúsculo) de renovação nos pedidos. */
export const REBILL_EVENT_TYPES = ['bill', 'rebill', 'uncancel-rebill', 'rebill_resumed', 'on_rebill_resumed'];

/** Avisos de recorrência que chegam no IngestLog (eventType minúsculo). */
export const RECURRENCE_EVENTS: Record<string, RecEventKind> = {
  'cancel-rebill': 'cancel',
  canceledfromrebill: 'cancel',
  rebill_cancelled: 'cancel',
  on_rebill_cancelled: 'cancel',
  last_paid_day: 'cancel',
  on_last_paid_day: 'cancel',
  insf: 'failed',
  failedrebill: 'failed',
  payment_missed: 'failed',
  on_payment_missed: 'failed',
  payment_denial: 'failed',
  on_payment_denial: 'failed',
  'uncancel-rebill': 'resume',
  rebill_resumed: 'resume',
  on_rebill_resumed: 'resume',
};

const EVENT_PARSERS: Record<string, (p: never) => NormalizedOrder> = {
  jvzoo: parseJvzooIngest,
  clickbank: parseClickBankIngest,
  buygoods: parseBuyGoodsIngest,
  digistore24: parseDigistoreIngest,
};

const subKey = (platform: string, email: string | null, product: string, fallback: string) =>
  `${platform}|${email || `ext:${fallback}`}|${product}`;

interface OrderRow {
  externalId: string;
  previousTransactionId: string | null;
  eventType: string;
  status: string;
  originalGrossUsd: Prisma.Decimal | null;
  grossAmountUsd: Prisma.Decimal;
  orderedAt: Date;
  approvedAt: Date | null;
  refundedAt: Date | null;
  chargebackAt: Date | null;
  trackingId: string | null;
  platform: string;
  productExternalId: string;
  productName: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

interface EndEvent { platform: string; email: string | null; product: string | null; event: RecEvent }

/** Avisos de cancelamento/falha/reativação, já com a chave (e-mail + produto). */
async function loadEvents(): Promise<EndEvent[]> {
  const types = Object.keys(RECURRENCE_EVENTS);
  const logs = await db.ingestLog.findMany({
    where: { platformSlug: { in: Object.keys(EVENT_PARSERS) }, eventType: { in: [...types, ...types.map((t) => t.toUpperCase())] } },
    select: { platformSlug: true, eventType: true, payload: true, receivedAt: true },
  });
  const out: EndEvent[] = [];
  for (const l of logs) {
    const kind = RECURRENCE_EVENTS[l.eventType.toLowerCase()];
    const parse = EVENT_PARSERS[l.platformSlug];
    if (!kind || !parse) continue;
    let n: NormalizedOrder;
    try {
      n = parse(l.payload as never);
    } catch {
      continue;
    }
    out.push({
      platform: l.platformSlug,
      email: n.customerEmail?.trim().toLowerCase() || null,
      product: n.productExternalId || null,
      event: { kind, at: l.receivedAt, reason: l.eventType.toLowerCase() },
    });
  }
  return out;
}

/** Produtos que já renovaram (BILL, rebill, pay_sequence_no > 1). */
export const rebilledProductsSql = () => Prisma.sql`
  SELECT DISTINCT o."productId" FROM "Order" o
  WHERE lower(o."eventType") IN (${Prisma.join(REBILL_EVENT_TYPES)}) OR o."paySequenceNo" > 1`;

/** Todos os pedidos desses produtos, do mais antigo pro mais novo (a Vupim vem da Subscription). */
export const recurringOrdersSql = (productIds: string[]) => Prisma.sql`
  SELECT o."externalId", o."previousTransactionId", o."eventType", o.status::text AS status,
         o."originalGrossUsd", o."grossAmountUsd", o."orderedAt", o."approvedAt", o."refundedAt", o."chargebackAt", o."trackingId",
         pl.slug AS platform, pr."externalId" AS "productExternalId", pr.name AS "productName",
         c.email, c."firstName", c."lastName", c.phone
  FROM "Order" o
  JOIN "Platform" pl ON pl.id = o."platformId"
  JOIN "Product" pr ON pr.id = o."productId"
  LEFT JOIN "Customer" c ON c.id = o."customerId"
  WHERE o."productId" IN (${Prisma.join(productIds)})
    AND pl.slug <> 'vupim'
    AND lower(o."eventType") NOT LIKE 'test%'
  ORDER BY o."orderedAt", o."externalId"`;

async function loadOrderSubs(events: EndEvent[]): Promise<RecSubInput[]> {
  // Produtos recorrentes: já renovaram ou já tiveram aviso de recorrência.
  const rebilled = await db.$queryRaw<Array<{ productId: string }>>(rebilledProductsSql());
  const ids = new Set(rebilled.map((r) => r.productId));
  const byPlatform = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.product) continue;
    byPlatform.set(e.platform, (byPlatform.get(e.platform) ?? new Set()).add(e.product));
  }
  if (byPlatform.size) {
    const prods = await db.product.findMany({
      where: { OR: [...byPlatform].map(([slug, ext]) => ({ platform: { slug }, externalId: { in: [...ext] } })) },
      select: { id: true },
    });
    for (const p of prods) ids.add(p.id);
  }
  if (!ids.size) return [];

  const rows = await db.$queryRaw<OrderRow[]>(recurringOrdersSql([...ids]));

  const subs = new Map<string, RecSubInput>();
  const byRef = new Map<string, RecCharge>();
  const extraRefunds: OrderRow[] = [];
  const refundAt = (o: OrderRow) => (o.status === 'REFUNDED' ? o.refundedAt ?? o.orderedAt
    : o.status === 'CHARGEBACK' ? o.chargebackAt ?? o.refundedAt ?? o.orderedAt : null);
  for (const o of rows) {
    const usd = Number(o.originalGrossUsd ?? o.grossAmountUsd);
    const refundedAt = refundAt(o);
    // Estorno em LINHA EXTRA (Digistore): valor negativo apontando pra cobrança estornada.
    if (refundedAt && !(usd > 0) && o.previousTransactionId) { extraRefunds.push(o); continue; }
    // Cobrança = foi aprovada um dia (o estorno/cancelamento depois só muda o status).
    const wasPaid = o.status === 'APPROVED' || o.approvedAt != null || o.status === 'REFUNDED' || o.status === 'CHARGEBACK';
    if (!wasPaid || !(usd > 0)) continue;
    const email = o.email?.trim().toLowerCase() || null;
    const key = subKey(o.platform, email, o.productExternalId, o.externalId);
    const charge: RecCharge = { at: o.orderedAt, usd, refundedAt, ref: o.externalId };
    byRef.set(`${o.platform}|${o.externalId}`, charge);
    const s = subs.get(key);
    if (s) {
      s.charges.push(charge);
      s.name ??= [o.firstName, o.lastName].filter(Boolean).join(' ') || null;
      s.phone ??= o.phone;
      continue;
    }
    subs.set(key, {
      key, platform: o.platform, productKey: `${o.platform}:${o.productExternalId}`, product: o.productName,
      email, name: [o.firstName, o.lastName].filter(Boolean).join(' ') || null, phone: o.phone,
      charges: [charge], events: [], externalId: o.externalId,
      fromSurvey: Boolean(o.trackingId?.startsWith(SURVEY_TRACKING_PREFIX)),
    });
  }

  for (const o of extraRefunds) {
    const hit = byRef.get(`${o.platform}|${o.previousTransactionId}`);
    if (hit) hit.refundedAt ??= refundAt(o);
  }

  // Avisos → assinatura pela chave; sem produto no aviso, só se o cliente tem
  // uma assinatura só naquela plataforma.
  const byCustomer = new Map<string, RecSubInput[]>();
  for (const s of subs.values()) {
    if (!s.email) continue;
    const k = `${s.platform}|${s.email}`;
    byCustomer.set(k, [...(byCustomer.get(k) ?? []), s]);
  }
  for (const e of events) {
    if (!e.email) continue;
    const exact = e.product ? subs.get(subKey(e.platform, e.email, e.product, '')) : undefined;
    const only = byCustomer.get(`${e.platform}|${e.email}`);
    const target = exact ?? (only?.length === 1 ? only[0] : undefined);
    target?.events.push(e.event);
  }
  return [...subs.values()];
}

async function loadVupimSubs(): Promise<RecSubInput[]> {
  const subs = await db.subscription.findMany({ include: { events: true } });
  return subs.map((s) => {
    const charges = new Map<string, RecCharge>();
    const events: RecEvent[] = [];
    const sorted = [...s.events].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const e of sorted) {
      const ref = e.transactionId ?? e.eventId;
      if (e.kind === 'charge' || e.kind === 'renewed') {
        if (!charges.has(ref)) charges.set(ref, { at: e.at, usd: Number(e.amountUsd ?? 0), refundedAt: null, ref });
      } else if (e.kind === 'refunded' || e.kind === 'chargeback') {
        const hit = (e.transactionId && charges.get(e.transactionId)) || [...charges.values()].filter((c) => c.at <= e.at).pop();
        if (hit) hit.refundedAt ??= e.at;
      } else if (e.kind === 'canceled') {
        events.push({ kind: 'cancel', at: e.at, reason: e.reason });
      } else if (e.kind === 'failed') {
        events.push({ kind: 'failed', at: e.at, reason: e.reason });
      }
    }
    const offer = s.offerName ?? s.productName ?? 'Assinatura Vupim';
    return {
      key: `vupim|${s.externalId}`, platform: 'vupim', productKey: `vupim:${s.offerId ?? offer}`, product: offer,
      email: s.email, name: s.name, phone: s.phone, externalId: s.externalId,
      charges: [...charges.values()], events,
      cycleHintDays: s.bottles ? s.bottles * DAYS_PER_BOTTLE : null,
      periodEnd: s.periodEnd,
      fromSurvey: Boolean(s.src?.startsWith(SURVEY_TRACKING_PREFIX)),
    };
  });
}

// A leitura é pesada (varre pedidos e avisos); a conta em cima é barata.
const CACHE_MS = 120_000;
let cache: { at: number; inputs: Promise<RecSubInput[]> } | null = null;

function loadInputs(): Promise<RecSubInput[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.inputs;
  const inputs = (async () => {
    const events = await loadEvents();
    const [orders, vupim] = await Promise.all([loadOrderSubs(events), loadVupimSubs()]);
    return [...orders, ...vupim];
  })();
  cache = { at: Date.now(), inputs };
  inputs.catch(() => { cache = null; });
  return inputs;
}

export interface RecurrencesResponse extends RecDashboard {
  platforms: { id: string; count: number }[];
  products: { key: string; label: string; platform: string; count: number }[];
  filters: { platform: string | null; product: string | null };
}

export async function getRecurrences(opts: {
  start: Date; end: Date; platform?: string | null; product?: string | null; now?: Date;
}): Promise<RecurrencesResponse> {
  const now = opts.now ?? new Date();
  // Ciclo e valor de renovação usam o produto inteiro: monta tudo, filtra depois.
  const all = buildSubs(await loadInputs(), now);
  const platforms = new Map<string, number>();
  const products = new Map<string, { key: string; label: string; platform: string; count: number }>();
  for (const s of all) {
    platforms.set(s.platform, (platforms.get(s.platform) ?? 0) + 1);
    const p = products.get(s.productKey) ?? { key: s.productKey, label: s.product, platform: s.platform, count: 0 };
    p.count++;
    products.set(s.productKey, p);
  }
  const platform = opts.platform || null;
  const product = opts.product || null;
  const subs = all.filter((s) => (!platform || s.platform === platform) && (!product || s.productKey === product));
  return {
    ...analyze(subs, { start: opts.start, end: opts.end, now }),
    platforms: [...platforms].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
    products: [...products.values()].sort((a, b) => b.count - a.count),
    filters: { platform, product },
  };
}
