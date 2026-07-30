// Lucro FRONT × BACK (Visão Geral) — decisão do usuário: dois blocos
// separados, total = soma.
//
// FRONT = vendas de funil (Orders aprovadas) EXCLUINDO o que é backend,
// na pegada da planilha CPA: por plataforma,
//   gross_p × (1 − (refund&cb%_p + fee%_p + opex%)/100), somado, − CPA pago.
// (COGS/fulfillment reais NÃO entram aqui — o opex% manual da planilha é
// o guarda-chuva de custos operacionais; visão de custo real fica em
// Custos/Fulfillment.)
//
// BACK = fontes de recuperação/retenção, cada uma com receita−custo:
//   recovery   → vendas aprovadas de afiliados de recuperação − comissão %
//   tauk       → TaukSale − comissão Tauk (env TAUK_COMMISSION_PCT, 35%)
//   sms        → vendas aprovadas com trafficSource=smsbrdcst (custo 0 —
//                o custo do Twilio não passa pelo dash)
//   salesbound → placeholder 0 (fonte ainda não integrada)
//   email      → placeholder 0 (canal futuro)
// Backend NUNCA conta no FRONT (sem dupla contagem): recovery e sms saem
// do front pelo mesmo critério que entram no back; Tauk já vive fora de
// Order; SMS_RECOVERY (productType) também é back.

import { db } from '../db';
import { getProfitModelInputs } from './profitModel';
import { SMS_UTM_SOURCE } from '../connectors/sms/config';

const TAUK_COMMISSION_PCT = (() => {
  const v = Number(process.env.TAUK_COMMISSION_PCT ?? '0.35');
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.35;
})();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ProfitSplitResponse {
  range: { start: string; end: string };
  opexPct: number;
  front: {
    grossUsd: number;
    cpaUsd: number;
    orders: number;
    profitUsd: number; // modelo CPA (ver header)
  };
  back: {
    sources: Array<{ key: string; label: string; grossUsd: number; costUsd: number; netUsd: number; available: boolean }>;
    profitUsd: number;
  };
  totalUsd: number;
}

export async function getProfitSplit(filters: { startDate: Date; endDate: Date }): Promise<ProfitSplitResponse> {
  const { startDate, endDate } = filters;
  const range = { gte: startDate, lte: endDate };

  const [pm, recoveryAffs, taukAgg] = await Promise.all([
    getProfitModelInputs(),
    db.recoveryAffiliate.findMany({
      where: { enabled: true },
      select: { affiliateId: true, commissionPct: true },
    }),
    db.taukSale.aggregate({
      where: { purchasedAt: range },
      _sum: { amountUsd: true },
      _count: { _all: true },
    }),
  ]);
  const recoveryIds = recoveryAffs.map((r) => r.affiliateId);
  const recoveryPct = new Map(recoveryAffs.map((r) => [r.affiliateId, Number(r.commissionPct)]));

  // CUIDADO com NOT em campo nullable: NOT { trafficSource: X } descarta
  // linhas com trafficSource NULL (lógica de 3 valores do SQL) — foi o bug
  // que deixou o front com ~4% do gross. Cada exclusão trata NULL
  // explicitamente.
  const frontExclusions = [
    { OR: [{ trafficSource: null }, { NOT: { trafficSource: { equals: SMS_UTM_SOURCE, mode: 'insensitive' as const } } }] },
    { NOT: { productType: 'SMS_RECOVERY' as const } },
    ...(recoveryIds.length
      ? [{ OR: [{ affiliateId: null }, { affiliateId: { notIn: recoveryIds } }] }]
      : []),
  ];

  const [frontByPlatform, frontCpa, smsAgg, recoveryOrders] = await Promise.all([
    // FRONT: aprovadas do período SEM as fontes de back.
    db.order.groupBy({
      by: ['platformId'],
      where: { status: 'APPROVED', orderedAt: range, AND: frontExclusions },
      _sum: { grossAmountUsd: true, cpaPaidUsd: true },
      _count: { _all: true },
    }),
    db.platform.findMany({ select: { id: true, slug: true } }),
    db.order.aggregate({
      where: { status: 'APPROVED', orderedAt: range, trafficSource: { equals: SMS_UTM_SOURCE, mode: 'insensitive' } },
      _sum: { grossAmountUsd: true },
    }),
    recoveryIds.length
      ? db.order.groupBy({
          by: ['affiliateId'],
          where: { status: 'APPROVED', orderedAt: range, affiliateId: { in: recoveryIds } },
          _sum: { grossAmountUsd: true },
        })
      : Promise.resolve([] as Array<{ affiliateId: string | null; _sum: { grossAmountUsd: unknown } }>),
  ]);

  const slugById = new Map(frontCpa.map((p) => [p.id, p.slug]));
  let frontGross = 0;
  let frontModelNet = 0;
  let frontCpaTotal = 0;
  let frontOrders = 0;
  for (const g of frontByPlatform) {
    const slug = slugById.get(g.platformId) ?? '';
    const pcts = pm.byPlatform.get(slug) ?? { feePct: 0, refundCbPct: 0 };
    const gross = g._sum.grossAmountUsd ? Number(g._sum.grossAmountUsd) : 0;
    frontGross += gross;
    frontModelNet += gross * (1 - (pcts.refundCbPct + pcts.feePct + pm.opexPct) / 100);
    frontCpaTotal += g._sum.cpaPaidUsd ? Number(g._sum.cpaPaidUsd) : 0;
    frontOrders += g._count._all;
  }
  const frontProfit = round2(frontModelNet - frontCpaTotal);

  const taukGross = taukAgg._sum.amountUsd ? Number(taukAgg._sum.amountUsd) : 0;
  const smsGross = smsAgg._sum.grossAmountUsd ? Number(smsAgg._sum.grossAmountUsd) : 0;
  let recoveryGross = 0;
  let recoveryCost = 0;
  for (const g of recoveryOrders) {
    const gross = g._sum.grossAmountUsd ? Number(g._sum.grossAmountUsd) : 0;
    recoveryGross += gross;
    recoveryCost += gross * (recoveryPct.get(g.affiliateId ?? '') ?? 0);
  }

  const sources = [
    { key: 'recovery', label: 'Recuperação', grossUsd: round2(recoveryGross), costUsd: round2(recoveryCost), netUsd: round2(recoveryGross - recoveryCost), available: true },
    { key: 'tauk', label: 'Tauk', grossUsd: round2(taukGross), costUsd: round2(taukGross * TAUK_COMMISSION_PCT), netUsd: round2(taukGross * (1 - TAUK_COMMISSION_PCT)), available: true },
    { key: 'sms', label: 'SMS', grossUsd: round2(smsGross), costUsd: 0, netUsd: round2(smsGross), available: true },
    { key: 'salesbound', label: 'SalesBound', grossUsd: 0, costUsd: 0, netUsd: 0, available: false },
    { key: 'email', label: 'Email', grossUsd: 0, costUsd: 0, netUsd: 0, available: false },
  ];
  const backProfit = round2(sources.reduce((s, x) => s + x.netUsd, 0));

  return {
    range: { start: startDate.toISOString(), end: endDate.toISOString() },
    opexPct: pm.opexPct,
    front: { grossUsd: round2(frontGross), cpaUsd: round2(frontCpaTotal), orders: frontOrders, profitUsd: frontProfit },
    back: { sources, profitUsd: backProfit },
    totalUsd: round2(frontProfit + backProfit),
  };
}
