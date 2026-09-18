// Lucro real (aba admin-only) — camada de banco: mede os INPUTS do período
// (uma vez, cache 60s), guarda os parâmetros vigentes e as projeções
// salvas, e monta a lista "o que o admin ainda precisa informar".
//
// Fontes (todas já existentes no dashboard):
//   FRONT        Order APPROVED por orderedAt, por plataforma × etapa, SEM
//                as fontes de back (afiliados de recuperação e SMS próprio —
//                mesmas exclusões do profitSplit); CPA = cpaPaidUsd; custo
//                real = cogsUsd + fulfillmentUsd (snapshots do ingest);
//                estornos = |gross| REFUNDED/CHARGEBACK por refundedAt/
//                chargebackAt (lente de evento dos cards do overview).
//   CALL CENTERS CallCenterSale (tauk/logicall) APPROVED por purchasedAt;
//                estornos = totais por refundedAt + parciais (refundedUsd).
//   RECUPERAÇÃO  vendas dos RecoveryAffiliate (comissão pela taxa vigente
//                na venda, RecoveryRatePeriod) + SMS próprio (smsbrdcst).
//   SALESBOUND   razão importado do export do CRM (salesboundLedger) —
//                sem import, cai no manual dos parâmetros.
//   AFILIADOS    contas de front por etapa + estornos por evento.
//   PRODUTOS     vendas de front por família × plataforma × etapa.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { SMS_UTM_SOURCE } from '../connectors/sms/config';
import { getProviderCommission, getLogicallApiKey } from './integrationSettings';
import { getProfitModelInputs } from './profitModel';
import { ratePeriodAt, recoveryCommission, type RatePeriod } from './recovery';
import { mappedIdentityMap } from './affiliateMapping';
import { measureSalesbound } from './salesboundLedger';
import {
  FRONT_STAGES, STAGE_LABELS, computeNetProfit, defaultParams, diffParams, normalizeParams, emptyStage, emptyStages,
  type AffiliateInput, type FrontStage, type NetProfitInputs, type NetProfitParams, type NetProfitResult,
  type PlatformFrontInput, type ProductInput, type RecoveryAffiliateInput, type StageAgg,
} from './netProfitCore';

const num = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const isStage = (t: string): t is FrontStage => (FRONT_STAGES as string[]).includes(t);

// ---------------------------------------------------------------------
// Inputs (cache curto por período — o recálculo "em tempo real" da UI só
// troca parâmetros; os números medidos não mudam a cada tecla).
// ---------------------------------------------------------------------
const INPUTS_TTL_MS = 60_000;
const inputsCache = new Map<string, { at: number; promise: Promise<NetProfitInputs> }>();

export function clearNetProfitInputsCache(): void {
  inputsCache.clear();
}

// lite = sem afiliados e produtos (visão por dia: só os totais por canal).
export async function loadNetProfitInputs(start: Date, end: Date, opts: { lite?: boolean } = {}): Promise<NetProfitInputs> {
  const lite = Boolean(opts.lite);
  const key = `${start.toISOString()}|${end.toISOString()}|${lite ? 'lite' : 'full'}`;
  const hit = inputsCache.get(key);
  if (hit && Date.now() - hit.at < INPUTS_TTL_MS) return hit.promise;
  const promise = measureInputs(start, end, lite);
  inputsCache.set(key, { at: Date.now(), promise });
  promise.catch(() => inputsCache.delete(key));
  if (inputsCache.size > 80) {
    const oldest = [...inputsCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) inputsCache.delete(oldest[0]);
  }
  return promise;
}

async function measureInputs(start: Date, end: Date, lite: boolean): Promise<NetProfitInputs> {
  const range = { gte: start, lte: end };
  const [recAffs, platforms, pm, taukComm, logicallComm, logicallKey] = await Promise.all([
    db.recoveryAffiliate.findMany({
      where: { enabled: true },
      select: {
        affiliateId: true, commissionPct: true,
        affiliate: { select: { externalId: true, nickname: true, platform: { select: { slug: true } } } },
        ratePeriods: { orderBy: { effectiveFrom: 'asc' }, select: { commissionPct: true, effectiveFrom: true, effectiveTo: true } },
      },
    }),
    db.platform.findMany({ select: { id: true, slug: true, displayName: true, feeRatePct: true, allowancePct: true } }),
    getProfitModelInputs(),
    getProviderCommission('tauk'),
    getProviderCommission('logicall'),
    getLogicallApiKey(),
  ]);
  const recoveryIds = recAffs.map((r) => r.affiliateId);
  const smsCond = { trafficSource: { equals: SMS_UTM_SOURCE, mode: 'insensitive' as const } };
  // NOT em campo nullable exige tratar NULL explicitamente (lógica de 3
  // valores) — mesma armadilha documentada em profitSplit.
  const notSms = { OR: [{ trafficSource: null }, { NOT: { trafficSource: { equals: SMS_UTM_SOURCE, mode: 'insensitive' as const } } }] };
  const notRecovery = recoveryIds.length ? { OR: [{ affiliateId: null }, { affiliateId: { notIn: recoveryIds } }] } : {};
  const frontScope = { AND: [notSms, notRecovery, { NOT: { productType: 'SMS_RECOVERY' as const } }] };
  const recoveryScope = recoveryIds.length ? { affiliateId: { in: recoveryIds } } : { affiliateId: { in: ['__none__'] } };
  const smsScope = { AND: [smsCond, notRecovery] };
  // Produto SMS_RECOVERY (etapa de recuperação do próprio funil) fica no
  // front como etapa — o toggle de dedupe cuida só das FONTES de back.
  const frontScopeWithStage = { AND: [notSms, notRecovery] };

  const [frontRows, recRows, smsRows, refundFront, cbFront, refundRec, cbRec, refundSms, cbSms,
    ccApproved, ccRefunds, ccPartial, recOrders, recRefund, recCb, affRows, affRefund, affCb, sbMeasured, productRows, productRefunds] = await Promise.all([
    db.order.groupBy({ by: ['platformId', 'productType'], where: { status: 'APPROVED', orderedAt: range, ...frontScopeWithStage }, _sum: { grossAmountUsd: true, cpaPaidUsd: true, cogsUsd: true, fulfillmentUsd: true }, _count: { _all: true } }),
    db.order.groupBy({ by: ['platformId', 'productType'], where: { status: 'APPROVED', orderedAt: range, ...recoveryScope }, _sum: { grossAmountUsd: true, cpaPaidUsd: true, cogsUsd: true, fulfillmentUsd: true }, _count: { _all: true } }),
    db.order.groupBy({ by: ['platformId', 'productType'], where: { status: 'APPROVED', orderedAt: range, ...smsScope }, _sum: { grossAmountUsd: true, cpaPaidUsd: true, cogsUsd: true, fulfillmentUsd: true }, _count: { _all: true } }),
    db.order.groupBy({ by: ['platformId'], where: { status: 'REFUNDED', refundedAt: range, ...frontScopeWithStage }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['platformId'], where: { status: 'CHARGEBACK', chargebackAt: range, ...frontScopeWithStage }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['platformId'], where: { status: 'REFUNDED', refundedAt: range, ...recoveryScope }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['platformId'], where: { status: 'CHARGEBACK', chargebackAt: range, ...recoveryScope }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['platformId'], where: { status: 'REFUNDED', refundedAt: range, ...smsScope }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['platformId'], where: { status: 'CHARGEBACK', chargebackAt: range, ...smsScope }, _sum: { grossAmountUsd: true } }),
    db.callCenterSale.groupBy({ by: ['provider'], where: { status: 'APPROVED', purchasedAt: range }, _sum: { amountUsd: true }, _count: { _all: true } }),
    db.$queryRaw<Array<{ provider: string; usd: Prisma.Decimal }>>(Prisma.sql`
      SELECT "provider", COALESCE(SUM(COALESCE("refundedUsd", "amountUsd")), 0) AS usd
      FROM "CallCenterSale"
      WHERE "status" IN ('REFUNDED', 'CHARGEBACK') AND "refundedAt" >= ${start} AND "refundedAt" <= ${end}
      GROUP BY "provider"`),
    db.callCenterSale.groupBy({ by: ['provider'], where: { status: 'APPROVED', purchasedAt: range, refundedUsd: { not: null } }, _sum: { refundedUsd: true } }),
    recoveryIds.length
      ? db.order.findMany({ where: { status: 'APPROVED', orderedAt: range, affiliateId: { in: recoveryIds } }, select: { affiliateId: true, grossAmountUsd: true, orderedAt: true, cogsUsd: true, fulfillmentUsd: true, productType: true } })
      : Promise.resolve([] as Array<{ affiliateId: string | null; grossAmountUsd: Prisma.Decimal; orderedAt: Date; cogsUsd: Prisma.Decimal | null; fulfillmentUsd: Prisma.Decimal | null; productType: string }>),
    db.order.groupBy({ by: ['affiliateId'], where: { status: 'REFUNDED', refundedAt: range, ...recoveryScope }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['affiliateId'], where: { status: 'CHARGEBACK', chargebackAt: range, ...recoveryScope }, _sum: { grossAmountUsd: true } }),
    lite ? Promise.resolve([] as AffiliateRow[]) : db.order.groupBy({ by: ['affiliateId', 'productType'], where: { status: 'APPROVED', orderedAt: range, affiliateId: { not: null }, ...frontScope }, _sum: { grossAmountUsd: true, cpaPaidUsd: true, cogsUsd: true, fulfillmentUsd: true }, _count: { _all: true } }),
    lite ? Promise.resolve([] as RefundByAffiliateRow[]) : db.order.groupBy({ by: ['affiliateId'], where: { status: 'REFUNDED', refundedAt: range, affiliateId: { not: null }, ...frontScope }, _sum: { grossAmountUsd: true } }),
    lite ? Promise.resolve([] as RefundByAffiliateRow[]) : db.order.groupBy({ by: ['affiliateId'], where: { status: 'CHARGEBACK', chargebackAt: range, affiliateId: { not: null }, ...frontScope }, _sum: { grossAmountUsd: true } }),
    measureSalesbound(start, end),
    lite ? Promise.resolve([] as ProductRow[]) : db.$queryRaw<ProductRow[]>(Prisma.sql`
      SELECT COALESCE(NULLIF(BTRIM(p."family"), ''), '—') AS family, o."platformId" AS "platformId", o."productType"::text AS "productType",
             COALESCE(SUM(o."grossAmountUsd"), 0) AS gross, COALESCE(SUM(o."cpaPaidUsd"), 0) AS cpa, COUNT(*)::int AS orders,
             COALESCE(SUM(o."cogsUsd"), 0) AS cogs, COALESCE(SUM(o."fulfillmentUsd"), 0) AS fulfillment
      FROM "Order" o JOIN "Product" p ON p."id" = o."productId"
      WHERE o."status" = 'APPROVED' AND o."orderedAt" >= ${start} AND o."orderedAt" <= ${end}
        AND ${productScopeSql(recoveryIds)}
      GROUP BY 1, 2, 3`),
    lite ? Promise.resolve([] as ProductRefundRow[]) : db.$queryRaw<ProductRefundRow[]>(Prisma.sql`
      SELECT COALESCE(NULLIF(BTRIM(p."family"), ''), '—') AS family, o."platformId" AS "platformId", COALESCE(SUM(ABS(o."grossAmountUsd")), 0) AS usd
      FROM "Order" o JOIN "Product" p ON p."id" = o."productId"
      WHERE ((o."status" = 'REFUNDED' AND o."refundedAt" >= ${start} AND o."refundedAt" <= ${end})
          OR (o."status" = 'CHARGEBACK' AND o."chargebackAt" >= ${start} AND o."chargebackAt" <= ${end}))
        AND ${productScopeSql(recoveryIds)}
      GROUP BY 1, 2`),
  ]);

  // ── plataformas ──
  const byPlat = new Map<string, PlatformFrontInput>();
  for (const p of platforms) {
    byPlat.set(p.id, {
      slug: p.slug, displayName: p.displayName,
      feePct: p.feeRatePct != null ? Number(p.feeRatePct) : null,
      allowancePct: p.allowancePct != null ? Number(p.allowancePct) : null,
      refundCbPctModel: pm.byPlatform.get(p.slug)?.refundCbPct ?? 0,
      byStage: emptyStages(), recovery: emptyStage(), sms: emptyStage(),
      refundsObserved: { front: 0, recovery: 0, sms: 0 },
    });
  }
  const agg = (row: { _sum: { grossAmountUsd?: Prisma.Decimal | null; cpaPaidUsd?: Prisma.Decimal | null; cogsUsd?: Prisma.Decimal | null; fulfillmentUsd?: Prisma.Decimal | null }; _count?: { _all: number } }): StageAgg => ({
    gross: num(row._sum.grossAmountUsd), cpa: num(row._sum.cpaPaidUsd), orders: row._count?._all ?? 0, cogs: num(row._sum.cogsUsd), fulfillment: num(row._sum.fulfillmentUsd),
  });
  for (const r of frontRows) {
    const p = byPlat.get(r.platformId); if (!p) continue;
    const stage: FrontStage = isStage(r.productType) ? r.productType : 'FRONTEND';
    const a = agg(r); const cur = p.byStage[stage];
    p.byStage[stage] = { gross: cur.gross + a.gross, cpa: cur.cpa + a.cpa, orders: cur.orders + a.orders, cogs: cur.cogs + a.cogs, fulfillment: cur.fulfillment + a.fulfillment };
  }
  // recuperação/SMS por plataforma (etapas somadas) + FEs
  const addBack = (rows: typeof recRows, k: 'recovery' | 'sms') => {
    for (const r of rows) {
      const p = byPlat.get(r.platformId); if (!p) continue;
      const a = agg(r); const cur = p[k];
      p[k] = { ...addStageAgg(cur, a), feOrders: (cur.feOrders ?? 0) + (r.productType === 'FRONTEND' ? a.orders : 0) };
    }
  };
  addBack(recRows, 'recovery'); addBack(smsRows, 'sms');
  const addRefund = (rows: Array<{ platformId: string; _sum: { grossAmountUsd: Prisma.Decimal | null } }>, k: 'front' | 'recovery' | 'sms') => {
    for (const r of rows) { const p = byPlat.get(r.platformId); if (p) p.refundsObserved[k] += Math.abs(num(r._sum.grossAmountUsd)); }
  };
  addRefund(refundFront, 'front'); addRefund(cbFront, 'front');
  addRefund(refundRec, 'recovery'); addRefund(cbRec, 'recovery');
  addRefund(refundSms, 'sms'); addRefund(cbSms, 'sms');
  for (const p of byPlat.values()) for (const k of ['front', 'recovery', 'sms'] as const) p.refundsObserved[k] = r2(p.refundsObserved[k]);

  // ── call centers ──
  const ccAppBy = new Map(ccApproved.map((r) => [r.provider, r]));
  const ccRefBy = new Map(ccRefunds.map((r) => [r.provider, num(r.usd)]));
  const ccPartBy = new Map(ccPartial.map((r) => [r.provider, num(r._sum.refundedUsd)]));
  const callcenters: NetProfitInputs['callcenters'] = [
    { provider: 'tauk' as const, label: 'Tauk', configured: true, comm: taukComm },
    { provider: 'logicall' as const, label: 'Logicall', configured: Boolean(logicallKey), comm: logicallComm },
  ].map((c) => ({
    provider: c.provider, label: c.label, configured: c.configured,
    gross: r2(num(ccAppBy.get(c.provider)?._sum.amountUsd)),
    sales: ccAppBy.get(c.provider)?._count._all ?? 0,
    refundsObserved: r2((ccRefBy.get(c.provider) ?? 0) + (ccPartBy.get(c.provider) ?? 0)),
    refundsReported: c.provider === 'logicall',   // Tauk só manda venda aprovada
    commissionPct: r2(c.comm.pct * 100),
    commissionAssumed: c.comm.assumed,
  }));

  // ── recuperação (parceiros) ──
  const recInfo = new Map(recAffs.map((r) => [r.affiliateId, {
    externalId: r.affiliate.externalId, nickname: r.affiliate.nickname, platformSlug: r.affiliate.platform.slug,
    currentPct: Number(r.commissionPct) * 100,
    periods: r.ratePeriods.map((p): RatePeriod => ({ commissionPct: Number(p.commissionPct), effectiveFrom: p.effectiveFrom.toISOString(), effectiveTo: p.effectiveTo?.toISOString() ?? null })),
  }]));
  const recAgg = new Map<string, RecoveryAffiliateInput>();
  for (const [id, info] of recInfo) {
    recAgg.set(id, { affiliateId: id, externalId: info.externalId, nickname: info.nickname, platformSlug: info.platformSlug, gross: 0, orders: 0, feOrders: 0, cogs: 0, fulfillment: 0, commissionUsd: 0, currentPct: r2(info.currentPct), refundsObserved: 0 });
  }
  for (const o of recOrders) {
    if (!o.affiliateId) continue;
    const a = recAgg.get(o.affiliateId); const info = recInfo.get(o.affiliateId); if (!a || !info) continue;
    const gross = num(o.grossAmountUsd);
    const period = ratePeriodAt(info.periods, o.orderedAt);
    a.gross += gross; a.orders++; if (o.productType === 'FRONTEND') a.feOrders++; a.cogs += num(o.cogsUsd); a.fulfillment += num(o.fulfillmentUsd);
    a.commissionUsd += recoveryCommission(gross, period?.commissionPct ?? info.currentPct / 100);
  }
  for (const rows of [recRefund, recCb]) for (const r of rows) { if (r.affiliateId) { const a = recAgg.get(r.affiliateId); if (a) a.refundsObserved += Math.abs(num(r._sum.grossAmountUsd)); } }
  const recoveryAffiliates = [...recAgg.values()].map((a) => ({ ...a, gross: r2(a.gross), cogs: r2(a.cogs), fulfillment: r2(a.fulfillment), commissionUsd: r2(a.commissionUsd), refundsObserved: r2(a.refundsObserved) }));

  // ── SMS próprio ──
  const sms = { gross: 0, orders: 0, feOrders: 0, cogs: 0, fulfillment: 0, refundsObserved: 0 };
  for (const p of byPlat.values()) { sms.gross += p.sms.gross; sms.orders += p.sms.orders; sms.feOrders += p.sms.feOrders ?? 0; sms.cogs += p.sms.cogs; sms.fulfillment += p.sms.fulfillment; sms.refundsObserved += p.refundsObserved.sms; }
  for (const k of ['gross', 'cogs', 'fulfillment', 'refundsObserved'] as const) sms[k] = r2(sms[k]);

  // ── afiliados de front ──
  const affIds = [...new Set(affRows.map((r) => r.affiliateId).filter((x): x is string => !!x))];
  const affMeta = affIds.length
    ? await db.affiliate.findMany({ where: { id: { in: affIds } }, select: { id: true, externalId: true, nickname: true, mappedAffiliateId: true, platform: { select: { slug: true } } } })
    : [];
  const mappedIds = [...new Set(affMeta.map((a) => a.mappedAffiliateId).filter((x): x is string => !!x))];
  const mappedNames = mappedIds.length ? await mappedIdentityMap(mappedIds) : new Map<string, { name: string; status: string }>();
  const affById = new Map<string, AffiliateInput>();
  for (const m of affMeta) {
    affById.set(m.id, {
      affiliateId: m.id, externalId: m.externalId, nickname: m.nickname, platformSlug: m.platform.slug,
      mappedName: m.mappedAffiliateId ? (mappedNames.get(m.mappedAffiliateId)?.name ?? null) : null,
      byStage: emptyStages(), refundsObserved: 0,
    });
  }
  for (const r of affRows) {
    if (!r.affiliateId) continue;
    const a = affById.get(r.affiliateId); if (!a) continue;
    const stage: FrontStage = isStage(r.productType) ? r.productType : 'FRONTEND';
    const x = agg(r); const cur = a.byStage[stage];
    a.byStage[stage] = { gross: cur.gross + x.gross, cpa: cur.cpa + x.cpa, orders: cur.orders + x.orders, cogs: cur.cogs + x.cogs, fulfillment: cur.fulfillment + x.fulfillment };
  }
  for (const rows of [affRefund, affCb]) for (const r of rows) { if (r.affiliateId) { const a = affById.get(r.affiliateId); if (a) a.refundsObserved += Math.abs(num(r._sum.grossAmountUsd)); } }
  const affiliates = [...affById.values()].map((a) => ({ ...a, refundsObserved: r2(a.refundsObserved) }));

  // ── produtos (família × plataforma × etapa) ──
  const slugById = new Map(platforms.map((p) => [p.id, p.slug]));
  const prodMap = new Map<string, Map<string, { slug: string; byStage: Record<FrontStage, StageAgg>; refundsObserved: number }>>();
  const prodPart = (family: string, platformId: string) => {
    const slug = slugById.get(platformId); if (!slug) return null;
    let fam = prodMap.get(family); if (!fam) { fam = new Map(); prodMap.set(family, fam); }
    let part = fam.get(slug); if (!part) { part = { slug, byStage: emptyStages(), refundsObserved: 0 }; fam.set(slug, part); }
    return part;
  };
  for (const r of productRows) {
    const part = prodPart(r.family, r.platformId); if (!part) continue;
    const stage: FrontStage = isStage(r.productType) ? r.productType : 'FRONTEND';
    part.byStage[stage] = addStageAgg(part.byStage[stage], { gross: num(r.gross), cpa: num(r.cpa), orders: Number(r.orders), cogs: num(r.cogs), fulfillment: num(r.fulfillment) });
  }
  for (const r of productRefunds) { const part = prodPart(r.family, r.platformId); if (part) part.refundsObserved = r2(part.refundsObserved + num(r.usd)); }
  const products: ProductInput[] = [...prodMap.entries()].map(([family, parts]) => ({ family, byPlatform: [...parts.values()] }));

  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    platforms: [...byPlat.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    callcenters,
    recoveryAffiliates,
    sms,
    affiliates,
    products,
    salesbound: { measured: sbMeasured },
  };
}

type AffiliateRow = { affiliateId: string | null; productType: string; _sum: { grossAmountUsd: Prisma.Decimal | null; cpaPaidUsd: Prisma.Decimal | null; cogsUsd: Prisma.Decimal | null; fulfillmentUsd: Prisma.Decimal | null }; _count: { _all: number } };
type RefundByAffiliateRow = { affiliateId: string | null; _sum: { grossAmountUsd: Prisma.Decimal | null } };
interface ProductRow { family: string; platformId: string; productType: string; gross: Prisma.Decimal; cpa: Prisma.Decimal; orders: number; cogs: Prisma.Decimal; fulfillment: Prisma.Decimal }
interface ProductRefundRow { family: string; platformId: string; usd: Prisma.Decimal }

const addStageAgg = (a: StageAgg, b: StageAgg): StageAgg => ({ gross: a.gross + b.gross, cpa: a.cpa + b.cpa, orders: a.orders + b.orders, cogs: a.cogs + b.cogs, fulfillment: a.fulfillment + b.fulfillment });

// Mesmo escopo do canal front (sem SMS próprio e sem afiliados de
// recuperação), em SQL cru pro JOIN com Product.family.
function productScopeSql(recoveryIds: string[]): Prisma.Sql {
  const notSms = Prisma.sql`(o."trafficSource" IS NULL OR LOWER(o."trafficSource") <> LOWER(${SMS_UTM_SOURCE}))`;
  if (!recoveryIds.length) return notSms;
  return Prisma.sql`${notSms} AND (o."affiliateId" IS NULL OR NOT (o."affiliateId" = ANY(${recoveryIds})))`;
}

// ---------------------------------------------------------------------
// Parâmetros vigentes
// ---------------------------------------------------------------------
export async function getNetProfitParams(): Promise<{ params: NetProfitParams; updatedAt: string | null }> {
  const row = await db.netProfitParams.findUnique({ where: { id: 'default' } });
  return { params: row ? normalizeParams(row.params) : defaultParams(), updatedAt: row?.updatedAt.toISOString() ?? null };
}

export async function saveNetProfitParams(raw: unknown, userId: string | null): Promise<NetProfitParams> {
  const params = normalizeParams(raw);
  const prev = await db.netProfitParams.findUnique({ where: { id: 'default' } });
  const changes = diffParams(prev ? normalizeParams(prev.params) : null, params);
  await db.$transaction([
    db.netProfitParams.upsert({
      where: { id: 'default' },
      create: { id: 'default', params: params as unknown as Prisma.InputJsonValue, updatedById: userId },
      update: { params: params as unknown as Prisma.InputJsonValue, updatedById: userId },
    }),
    // §10.5: taxa não muda sem registro de data.
    ...(changes.length ? [db.netProfitParamsLog.create({ data: { params: params as unknown as Prisma.InputJsonValue, changes: changes as unknown as Prisma.InputJsonValue, createdById: userId } })] : []),
  ]);
  logger.info({ userId, changes: changes.length }, '[netProfit] parâmetros salvos');
  return params;
}

export interface ParamsHistoryEntry { id: string; createdAt: string; createdBy: string | null; initial: boolean; changes: Array<{ path: string; from: unknown; to: unknown }> }

export async function getNetProfitParamsHistory(limit = 30): Promise<ParamsHistoryEntry[]> {
  const rows = await db.netProfitParamsLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  return rows.map((r) => ({
    id: r.id, createdAt: r.createdAt.toISOString(),
    createdBy: r.createdById ? (nameOf.get(r.createdById) ?? null) : null,
    initial: r.id.startsWith('initial-'),
    changes: Array.isArray(r.changes) ? (r.changes as ParamsHistoryEntry['changes']) : [],
  }));
}

// ---------------------------------------------------------------------
// Projeções salvas
// ---------------------------------------------------------------------
export interface ScenarioSummary { revenue: number; costs: number; profit: number; marginPct: number; channels: Array<{ key: string; gross: number; profit: number }> }

export function summarize(result: NetProfitResult): ScenarioSummary {
  return { ...result.kpis, channels: result.channels.map((c) => ({ key: c.key, gross: c.gross, profit: c.profit })) };
}

export async function listNetProfitScenarios(limit = 100) {
  const rows = await db.netProfitScenario.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map((r) => ({
    id: r.id, name: r.name, note: r.note, params: normalizeParams(r.params),
    periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString(),
    summary: r.summary as unknown as ScenarioSummary, createdAt: r.createdAt.toISOString(), createdById: r.createdById,
  }));
}

export async function saveNetProfitScenario(input: { name: string; note: string | null; params: NetProfitParams; start: Date; end: Date; result: NetProfitResult; userId: string | null }) {
  const row = await db.netProfitScenario.create({
    data: {
      name: input.name, note: input.note, params: input.params as unknown as Prisma.InputJsonValue,
      periodStart: input.start, periodEnd: input.end, summary: summarize(input.result) as unknown as Prisma.InputJsonValue, createdById: input.userId,
    },
    select: { id: true },
  });
  return row.id;
}

export async function deleteNetProfitScenario(id: string): Promise<boolean> {
  const res = await db.netProfitScenario.deleteMany({ where: { id } });
  return res.count > 0;
}

// ---------------------------------------------------------------------
// "O que o admin precisa informar" — derivado dos inputs + parâmetros
// ---------------------------------------------------------------------
export interface Need {
  key: string;
  severity: 'required' | 'suggested';
  title: string;
  detail: string;
  format: string; // exatamente o que digitar e onde
}

export async function computeNeeds(inputs: NetProfitInputs, params: NetProfitParams, result: NetProfitResult): Promise<Need[]> {
  const needs: Need[] = [];
  // SalesBound: razão vem do export do CRM deles (o postback ainda não
  // disparou evento real). Sem import → manual; import velho → reimportar.
  const sb = inputs.salesbound.measured;
  const importFormat = 'Parâmetros → SalesBound → "Importar export (CSV)". No CRM deles: Reports → Transaction Details → campanha "Salesbound - Phone Sales Team" → Export CSV (período que cubra as datas).';
  if (!sb) {
    needs.push({
      key: 'salesbound.revenue', severity: params.salesbound.grossUsd > 0 ? 'suggested' : 'required',
      title: 'SalesBound: importar o export de transações',
      detail: 'Sem export importado o canal usa o faturamento digitado à mão (número fixo, não acompanha o período).',
      format: importFormat,
    });
  } else if (Date.parse(inputs.period.end) > Date.parse(sb.coverage?.lastAt ?? inputs.period.end) + 36 * 3600_000) {
    needs.push({
      key: 'salesbound.stale', severity: 'suggested',
      title: `SalesBound: o razão vai só até ${(sb.coverage?.lastAt ?? '').slice(0, 10)}`,
      detail: 'Os dias do período depois disso aparecem sem venda SalesBound.',
      format: importFormat,
    });
  } else if ((sb.coverage?.webhookCount ?? 0) > 0 && sb.coverage?.csvLastAt && Date.parse(inputs.period.end) > Date.parse(sb.coverage.csvLastAt) + 36 * 3600_000) {
    // O webhook deles manda só venda (sem tipo de evento): reembolso, void e
    // recusa continuam vindo do export.
    needs.push({
      key: 'salesbound.refunds-stale', severity: 'suggested',
      title: `SalesBound: estornos só até ${sb.coverage.csvLastAt.slice(0, 10)}`,
      detail: 'As vendas chegam ao vivo pelo webhook, mas o webhook deles não marca reembolso/void — isso só vem do export. Depois dessa data o canal está sem estorno, ou seja, otimista.',
      format: importFormat,
    });
  }
  if (params.commissionPct.salesbound == null && (sb || params.salesbound.grossUsd > 0)) needs.push({ key: 'salesbound.commission', severity: 'required', title: 'SalesBound: parcela do parceiro', detail: 'Percentual do bruto que fica com a SalesBound (a NorthScale fica com o resto).', format: 'Parâmetros → Parcela dos parceiros → SalesBound: % (acordo atual: 65).' });
  // Custo de produto: um % único (vendas de plataforma); sem ele, cada linha
  // usa o real observado dos snapshots. Backend não tem custo (parcela líquida).
  const obs = result.observedProductCostPct;
  if (params.productCostDefaultPct == null) {
    const missing = [
      ...FRONT_STAGES.filter((s) => params.productCostPct.front[s] == null && inputs.platforms.some((p) => p.byStage[s].gross > 0)).map((s) => STAGE_LABELS[s]),
      ...((inputs.recoveryAffiliates.some((a) => a.gross > 0) || inputs.sms.gross > 0) && params.productCostPct.recovery == null ? ['recuperação'] : []),
    ];
    if (missing.length) {
      needs.push({
        key: 'cost.default', severity: obs.front.FRONTEND == null ? 'required' : 'suggested',
        title: 'Custo de produto (% único)',
        detail: obs.front.FRONTEND == null
          ? 'Não há COGS/frete nos pedidos do período — o cálculo está usando 0% em: ' + missing.join(', ') + '.'
          : `Usando o real observado dos snapshots (front-end ${obs.front.FRONTEND}%${obs.front.UPSELL != null ? `, upsell ${obs.front.UPSELL}%` : ''}). Informe um % se o custo mudou.`,
        format: 'Parâmetros → Custo de produto: % do faturamento (ex.: 12).',
      });
    }
  }
  // Comissões.
  const lc = inputs.callcenters.find((c) => c.provider === 'logicall');
  if (lc && lc.commissionAssumed && params.commissionPct.logicall == null) {
    needs.push({ key: 'commission.logicall', severity: 'required', title: 'Comissão da Logicall', detail: 'Nunca foi informada — o cálculo assume 35% (mesmo acordo da Tauk).', format: 'Parâmetros → Comissões → Logicall: % (ex.: 35). Ou aba Call Center → painel Logicall.' });
  }
  // Recuperação: Skill99 precisa estar marcado como afiliado de recuperação.
  const skill = await db.affiliate.findFirst({
    where: { OR: [{ externalId: { equals: 'skill99', mode: 'insensitive' } }, { nickname: { equals: 'skill99', mode: 'insensitive' } }] },
    select: { id: true, externalId: true, platform: { select: { slug: true } }, recovery: { select: { enabled: true, commissionPct: true } } },
  });
  if (!skill) {
    needs.push({ key: 'recovery.skill99', severity: 'suggested', title: 'Skill99 não encontrado nas contas de afiliado', detail: 'Nenhuma conta com ID/nick "skill99". Se o parceiro de recuperação usa outro ID, marque-o na aba Recuperação.', format: 'Aba Recuperação → "marcar afiliado" → ID da conta + comissão %.' });
  } else if (!skill.recovery?.enabled) {
    needs.push({ key: 'recovery.skill99', severity: 'required', title: `Skill99 (${skill.platform.slug} · ${skill.externalId}) não está marcado como afiliado de recuperação`, detail: 'Sem isso as vendas dele contam como front-end (com CPA) em vez de Recuperação (com comissão %).', format: `Aba Recuperação → marcar ${skill.externalId} (${skill.platform.slug}) com a comissão % combinada (ex.: 30).` });
  }
  if (inputs.recoveryAffiliates.length === 0) {
    needs.push({ key: 'recovery.none', severity: 'suggested', title: 'Nenhum afiliado de recuperação ativo', detail: 'O canal Recuperação só mostra SMS próprio. Parceiros de e-mail/SMS (Skill99…) precisam estar marcados.', format: 'Aba Recuperação → marcar afiliado + comissão %.' });
  }
  // Plataformas sem taxa/allowance.
  for (const p of inputs.platforms) {
    const gross = FRONT_STAGES.reduce((t, s) => t + p.byStage[s].gross, 0);
    if (gross <= 0) continue;
    if (p.feePct == null && params.feePctOverride[p.slug] == null) needs.push({ key: `fee.${p.slug}`, severity: 'required', title: `${p.displayName}: taxa da plataforma não cadastrada`, detail: 'A linha "Taxa da plataforma" está em 0 nessa plataforma.', format: `Aba Plataformas → ${p.displayName} → Editar → "Taxa de transação %" (ex.: 8.37). Ou override aqui em Parâmetros → Taxas.` });
    if (params.includeAllowance && p.allowancePct == null && params.allowancePctOverride[p.slug] == null) needs.push({ key: `allowance.${p.slug}`, severity: 'suggested', title: `${p.displayName}: allowance não cadastrado`, detail: 'Se a plataforma retém reserva (rolling reserve), informe; senão a linha fica 0.', format: `Aba Plataformas → ${p.displayName} → Editar → "Allowance %" (ex.: 2.37).` });
  }
  // Reembolso manual sem %.
  if (params.refundMode === 'manual' && params.refundPct.front == null) {
    needs.push({ key: 'refund.front', severity: 'required', title: 'Reembolso projetado sem %', detail: 'No modo % fixo o reembolso incide sobre o gross das plataformas; sem o % a linha fica 0.', format: 'Parâmetros → Reembolso → % sobre o gross (ex.: 20).' });
  }
  return needs;
}

// ---------------------------------------------------------------------
// Conveniência pras rotas
// ---------------------------------------------------------------------
export async function evaluateNetProfit(start: Date, end: Date, params: NetProfitParams): Promise<{ result: NetProfitResult; needs: Need[]; inputs: NetProfitInputs }> {
  const inputs = await loadNetProfitInputs(start, end);
  const result = computeNetProfit(inputs, params);
  const needs = await computeNeeds(inputs, params, result);
  return { result, needs, inputs };
}

// Por dia (§10.8): a MESMA fórmula aplicada a cada dia do período (fatias de
// 24h a partir do início — o front manda o início do dia em BRT).
export const DAILY_MAX_DAYS = 62;
export interface DailyRow {
  start: string;
  end: string;
  kpis: NetProfitResult['kpis'];
  channels: Array<{ key: string; gross: number; revenue: number; profit: number }>;
}

export async function evaluateNetProfitDaily(start: Date, end: Date, params: NetProfitParams): Promise<DailyRow[]> {
  const DAY = 24 * 3600_000;
  const slices: Array<{ start: Date; end: Date }> = [];
  for (let t = start.getTime(); t <= end.getTime() && slices.length < DAILY_MAX_DAYS; t += DAY) {
    slices.push({ start: new Date(t), end: new Date(Math.min(t + DAY - 1, end.getTime())) });
  }
  const rows: DailyRow[] = new Array(slices.length);
  let next = 0;
  const worker = async () => {
    while (next < slices.length) {
      const i = next++;
      const s = slices[i];
      const r = computeNetProfit(await loadNetProfitInputs(s.start, s.end, { lite: true }), params);
      rows[i] = { start: s.start.toISOString(), end: s.end.toISOString(), kpis: r.kpis, channels: r.channels.map((c) => ({ key: c.key, gross: c.gross, revenue: c.revenue, profit: c.profit })) };
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return rows;
}
