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
//   SALESBOUND   ainda sem dado medido (fase 1 = captura) → manual.
//   AFILIADOS    contas de front por etapa + estornos por evento.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { SMS_UTM_SOURCE } from '../connectors/sms/config';
import { getProviderCommission, getLogicallApiKey } from './integrationSettings';
import { getProfitModelInputs } from './profitModel';
import { ratePeriodAt, recoveryCommission, type RatePeriod } from './recovery';
import { mappedIdentityMap } from './affiliateMapping';
import {
  FRONT_STAGES, CHANNEL_LABELS, STAGE_LABELS, computeNetProfit, defaultParams, normalizeParams, emptyStage, emptyStages,
  type AffiliateInput, type FrontStage, type NetProfitInputs, type NetProfitParams, type NetProfitResult,
  type PlatformFrontInput, type RecoveryAffiliateInput, type StageAgg,
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

export async function loadNetProfitInputs(start: Date, end: Date): Promise<NetProfitInputs> {
  const key = `${start.toISOString()}|${end.toISOString()}`;
  const hit = inputsCache.get(key);
  if (hit && Date.now() - hit.at < INPUTS_TTL_MS) return hit.promise;
  const promise = measureInputs(start, end);
  inputsCache.set(key, { at: Date.now(), promise });
  promise.catch(() => inputsCache.delete(key));
  if (inputsCache.size > 20) {
    const oldest = [...inputsCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) inputsCache.delete(oldest[0]);
  }
  return promise;
}

async function measureInputs(start: Date, end: Date): Promise<NetProfitInputs> {
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
    ccApproved, ccRefunds, ccPartial, recOrders, recRefund, recCb, affRows, affRefund, affCb] = await Promise.all([
    db.order.groupBy({ by: ['platformId', 'productType'], where: { status: 'APPROVED', orderedAt: range, ...frontScopeWithStage }, _sum: { grossAmountUsd: true, cpaPaidUsd: true, cogsUsd: true, fulfillmentUsd: true }, _count: { _all: true } }),
    db.order.groupBy({ by: ['platformId'], where: { status: 'APPROVED', orderedAt: range, ...recoveryScope }, _sum: { grossAmountUsd: true, cpaPaidUsd: true, cogsUsd: true, fulfillmentUsd: true }, _count: { _all: true } }),
    db.order.groupBy({ by: ['platformId'], where: { status: 'APPROVED', orderedAt: range, ...smsScope }, _sum: { grossAmountUsd: true, cpaPaidUsd: true, cogsUsd: true, fulfillmentUsd: true }, _count: { _all: true } }),
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
      ? db.order.findMany({ where: { status: 'APPROVED', orderedAt: range, affiliateId: { in: recoveryIds } }, select: { affiliateId: true, grossAmountUsd: true, orderedAt: true, cogsUsd: true, fulfillmentUsd: true } })
      : Promise.resolve([] as Array<{ affiliateId: string | null; grossAmountUsd: Prisma.Decimal; orderedAt: Date; cogsUsd: Prisma.Decimal | null; fulfillmentUsd: Prisma.Decimal | null }>),
    db.order.groupBy({ by: ['affiliateId'], where: { status: 'REFUNDED', refundedAt: range, ...recoveryScope }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['affiliateId'], where: { status: 'CHARGEBACK', chargebackAt: range, ...recoveryScope }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['affiliateId', 'productType'], where: { status: 'APPROVED', orderedAt: range, affiliateId: { not: null }, ...frontScope }, _sum: { grossAmountUsd: true, cpaPaidUsd: true, cogsUsd: true, fulfillmentUsd: true }, _count: { _all: true } }),
    db.order.groupBy({ by: ['affiliateId'], where: { status: 'REFUNDED', refundedAt: range, affiliateId: { not: null }, ...frontScope }, _sum: { grossAmountUsd: true } }),
    db.order.groupBy({ by: ['affiliateId'], where: { status: 'CHARGEBACK', chargebackAt: range, affiliateId: { not: null }, ...frontScope }, _sum: { grossAmountUsd: true } }),
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
  for (const r of recRows) { const p = byPlat.get(r.platformId); if (p) p.recovery = agg(r); }
  for (const r of smsRows) { const p = byPlat.get(r.platformId); if (p) p.sms = agg(r); }
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
    recAgg.set(id, { affiliateId: id, externalId: info.externalId, nickname: info.nickname, platformSlug: info.platformSlug, gross: 0, orders: 0, cogs: 0, fulfillment: 0, commissionUsd: 0, currentPct: r2(info.currentPct), refundsObserved: 0 });
  }
  for (const o of recOrders) {
    if (!o.affiliateId) continue;
    const a = recAgg.get(o.affiliateId); const info = recInfo.get(o.affiliateId); if (!a || !info) continue;
    const gross = num(o.grossAmountUsd);
    const period = ratePeriodAt(info.periods, o.orderedAt);
    a.gross += gross; a.orders++; a.cogs += num(o.cogsUsd); a.fulfillment += num(o.fulfillmentUsd);
    a.commissionUsd += recoveryCommission(gross, period?.commissionPct ?? info.currentPct / 100);
  }
  for (const rows of [recRefund, recCb]) for (const r of rows) { if (r.affiliateId) { const a = recAgg.get(r.affiliateId); if (a) a.refundsObserved += Math.abs(num(r._sum.grossAmountUsd)); } }
  const recoveryAffiliates = [...recAgg.values()].map((a) => ({ ...a, gross: r2(a.gross), cogs: r2(a.cogs), fulfillment: r2(a.fulfillment), commissionUsd: r2(a.commissionUsd), refundsObserved: r2(a.refundsObserved) }));

  // ── SMS próprio ──
  const sms = { gross: 0, orders: 0, cogs: 0, fulfillment: 0, refundsObserved: 0 };
  for (const p of byPlat.values()) { sms.gross += p.sms.gross; sms.orders += p.sms.orders; sms.cogs += p.sms.cogs; sms.fulfillment += p.sms.fulfillment; sms.refundsObserved += p.refundsObserved.sms; }
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

  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    platforms: [...byPlat.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    callcenters,
    recoveryAffiliates,
    sms,
    affiliates,
    salesbound: { measured: null },
  };
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
  await db.netProfitParams.upsert({
    where: { id: 'default' },
    create: { id: 'default', params: params as unknown as Prisma.InputJsonValue, updatedById: userId },
    update: { params: params as unknown as Prisma.InputJsonValue, updatedById: userId },
  });
  logger.info({ userId }, '[netProfit] parâmetros salvos');
  return params;
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
  // SalesBound: sem histórico (postback criado em 2026-09-15).
  if (!inputs.salesbound.measured) {
    needs.push({
      key: 'salesbound.revenue', severity: params.salesbound.grossUsd > 0 ? 'suggested' : 'required',
      title: 'SalesBound: faturamento e estornos do período',
      detail: 'A SalesBound acabou de receber a URL de postback — ainda não há eventos gravados, então o canal não tem dado medido. Enquanto isso o cálculo usa o que você digitar.',
      format: 'Painel de parâmetros → SalesBound: "Faturamento (USD)" no período selecionado, "Vendas" (nº) e "Estornos (USD)". Ex.: 12500.00 / 48 / 600.00.',
    });
    if (params.commissionPct.salesbound == null) needs.push({ key: 'salesbound.commission', severity: 'required', title: 'SalesBound: comissão do parceiro', detail: 'Percentual que a SalesBound cobra sobre cada venda.', format: 'Parâmetros → Comissões → SalesBound: número em % (ex.: 25).' });
    if (params.productCostPct.salesbound == null && params.productCostDefaultPct == null) needs.push({ key: 'salesbound.cost', severity: 'required', title: 'SalesBound: custo de produto', detail: 'Sem SKU nos eventos ainda, o custo entra como % do faturamento.', format: 'Parâmetros → Custo de produto → SalesBound: % do faturamento (ex.: 12).' });
  }
  // Custo de produto: um % único (front/upsell/downsell/bump/canais); sem
  // ele, cada linha usa o real observado dos snapshots.
  const obs = result.observedProductCostPct;
  if (params.productCostDefaultPct == null) {
    const missing = [
      ...FRONT_STAGES.filter((s) => params.productCostPct.front[s] == null && inputs.platforms.some((p) => p.byStage[s].gross > 0)).map((s) => STAGE_LABELS[s]),
      ...(inputs.callcenters.some((c) => c.gross > 0) && params.productCostPct.callcenter == null ? ['call centers'] : []),
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
  if (params.refundMode === 'manual') {
    for (const ch of ['front', 'callcenter', 'recovery', 'salesbound'] as const) {
      const active = result.channels.find((c) => c.key === ch)?.available;
      if (active && params.refundPct[ch] == null) needs.push({ key: `refund.${ch}`, severity: 'required', title: `Reembolso manual sem % — ${CHANNEL_LABELS[ch]}`, detail: 'No modo manual cada canal precisa do % fixo; sem ele a linha fica 0.', format: `Parâmetros → Reembolso → ${CHANNEL_LABELS[ch]}: % (ex.: 8).` });
    }
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
