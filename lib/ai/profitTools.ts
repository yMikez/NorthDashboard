// get_profit_model e get_net_profit: as PREMISSAS do lucro que o chat antes
// não enxergava.
//
//   get_profit_model — régua do modelo CPA (NET AOV / NET AFTER CPA): opex%,
//     limiares do status, fee/refund&cb/allowance por plataforma (a taxa
//     usada E a observada em coorte madura, pra calibrar), metas de
//     reembolso/chargeback. É o "por que o NET AFTER CPA deu X".
//   get_net_profit — margem de contribuição OFICIAL da aba Lucro real
//     (admin-only na UI → admin-only aqui: é a única tool nova com gate).

import { db } from '../db';
import { EXTRA_ROW_REFUND_PLATFORMS, getObservedRefundCbPct, getProfitModelInputs } from '../services/profitModel';
import { DAILY_MAX_DAYS, evaluateNetProfit, evaluateNetProfitDaily, getNetProfitParams } from '../services/netProfit';
import type { ToolContext } from './toolTypes';
import { brtDayOf, resolveInstants } from './compare';

export async function getProfitModel(): Promise<Record<string, unknown>> {
  const [inputs, observed, platforms, config] = await Promise.all([
    getProfitModelInputs(),
    getObservedRefundCbPct(),
    db.platform.findMany({
      select: { slug: true, displayName: true, feeRatePct: true, refundCbPct: true, allowancePct: true, feesUpdatedAt: true },
      orderBy: { displayName: 'asc' },
    }),
    db.profitConfig.findUnique({ where: { id: 'global' } }),
  ]);
  return {
    formula: {
      netAovUsd: 'AOV × (1 − (refund&cb% + fee% + opex% + allowance%) / 100)',
      netAfterCpaUsd: 'NET AOV − CPA negociado (último cpaPaidUsd > 0 numa FE aprovada), por FE; total = × FEs aprovadas',
      cpaStatus: 'saudavel se NET AFTER CPA ≥ healthyMinUsd; atencao se ≥ attentionMinUsd; senão renegociar',
      frontProfitSplit: 'get_profit_split.front.profitUsd = Σ gross_plataforma × (1 − (refund&cb% + fee% + opex%)/100) − CPA pago',
    },
    opexPct: inputs.opexPct,
    thresholds: inputs.thresholds,
    targets: config
      ? {
          refundTargetD30Pct: Number(config.refundTargetD30Pct),
          refundLimitD30Pct: Number(config.refundLimitD30Pct),
          chargebackWarnPct: Number(config.chargebackWarnPct),
          chargebackLimitPct: Number(config.chargebackLimitPct),
        }
      : null,
    platforms: platforms.map((p) => {
      const used = inputs.byPlatform.get(p.slug);
      const obs = observed.get(p.slug) ?? null;
      const manual = p.refundCbPct != null ? Number(p.refundCbPct) : null;
      // Digistore usa a taxa REAL (valor, coorte madura) quando a amostra
      // basta; as demais, o manual. O valor usado diz qual venceu.
      const source = EXTRA_ROW_REFUND_PLATFORMS.has(p.slug) && obs != null && used?.refundCbPct === obs.valuePct
        ? 'observed_mature_cohort'
        : 'manual';
      return {
        slug: p.slug,
        displayName: p.displayName,
        feePct: used?.feePct ?? 0,
        allowancePct: used?.allowancePct ?? 0,
        refundCbPctUsed: used?.refundCbPct ?? 0,
        refundCbSource: source,
        manualRefundCbPct: manual,
        observedMature: obs ? { refundCbPctByOrders: obs.pct, refundCbPctByValue: obs.valuePct, sampleOrders: obs.sample } : null,
        feesUpdatedAt: p.feesUpdatedAt?.toISOString() ?? null,
        feeMissing: p.feeRatePct == null,
      };
    }),
    observedWindow: 'coorte madura = vendas feitas entre 150 e 60 dias atrás (refund chega até 60–90d depois)',
    units: {
      opexPct: 'percent', 'thresholds.healthyMinUsd': 'usd', 'thresholds.attentionMinUsd': 'usd',
      feePct: 'percent', allowancePct: 'percent', refundCbPctUsed: 'percent', manualRefundCbPct: 'percent',
      refundCbPctByOrders: 'percent', refundCbPctByValue: 'percent',
      refundTargetD30Pct: 'percent', refundLimitD30Pct: 'percent', chargebackWarnPct: 'percent', chargebackLimitPct: 'percent',
    },
  };
}

export class NetProfitInputError extends Error {}

export async function getNetProfitForChat(input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  if (ctx.user?.role !== 'ADMIN') {
    return { error: 'forbidden', message: 'get_net_profit (aba Lucro real) é só para administradores — use get_profit_split (Net after CPA, modelo) e get_costs_overview (custo real).' };
  }
  const now = ctx.now ?? new Date();
  const { startAt, endAt, source } = resolveInstants(input, ctx, now);
  const daily = input.daily === true;
  const days = Math.ceil((endAt.getTime() - startAt.getTime() + 1) / 86_400_000);
  if (daily && days > DAILY_MAX_DAYS) throw new NetProfitInputError(`daily aceita no máximo ${DAILY_MAX_DAYS} dias (o período tem ${days}) — estreite o período`);
  const { params, updatedAt } = await getNetProfitParams();
  const [{ result, needs }, dailyRows] = await Promise.all([
    evaluateNetProfit(startAt, endAt, params),
    daily ? evaluateNetProfitDaily(startAt, endAt, params) : Promise.resolve(null),
  ]);
  return {
    period: { startBrt: brtDayOf(startAt), endBrt: brtDayOf(endAt), days, source },
    lens: 'margem de contribuição OFICIAL (aba Lucro real): receita econômica = plataformas + parcela NorthScale do backend; margem = lucro ÷ receita econômica',
    paramsUpdatedAt: updatedAt,
    kpis: result.kpis,
    channels: result.channels.map((c) => ({
      ...c,
      breakdown: c.breakdown.map((b) => ({ key: b.key, label: b.label, gross: b.gross, orders: b.orders, revenue: b.revenue, profit: b.profit, marginPct: b.marginPct })),
    })),
    products: [...result.products].sort((a, b) => b.gross - a.gross),
    affiliates: [...result.affiliates].sort((a, b) => b.gross - a.gross),
    salesbound: result.salesbound,
    observedProductCostPct: result.observedProductCostPct,
    warnings: result.warnings,
    needs: needs.map((n) => ({ key: n.key, severity: n.severity, title: n.title, detail: n.detail })),
    ...(dailyRows ? { daily: dailyRows } : {}),
    units: {
      marginPct: 'percent', marginOnGrossPct: 'percent', pctOfGross: 'percent', shareOfRevenuePct: 'percent', shareOfProfitPct: 'percent',
      shareOfChannelPct: 'percent', shareOfFrontPct: 'percent', 'buffer.pct': 'percent', observedProductCostPct: 'percent',
    },
  };
}
