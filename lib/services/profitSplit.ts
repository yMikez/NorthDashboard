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
    // Quanto o MODELO desconta de refund+chargeback neste período:
    // Σ gross_p × refundCb%_p (taxa REAL na Digistore, manual nas demais).
    // Exibido no card TAXA DE REEMBOLSO do overview pra tornar a
    // subtração explícita.
    refundCbUsd: number;
  };
  back: {
    sources: Array<{ key: string; label: string; grossUsd: number; costUsd: number; netUsd: number; available: boolean }>;
    profitUsd: number;
  };
  totalUsd: number;
  // Lente de CONTAGEM por coorte pro card de reembolso do overview:
  // "dos X pedidos feitos no período, Y pediram reembolso (até agora)".
  // Denominador honesto por plataforma: na Digistore o refund é LINHA
  // EXTRA (venda original segue APPROVED), então pedidos reais =
  // total − linhas de refund/cb; nas demais (in-place) = total.
  // O "(até agora)" importa: coorte recente ainda vai receber refunds.
  refunds: {
    salesCount: number;
    refundedCount: number;
    chargebackCount: number;
    pct: number; // refundedCount ÷ salesCount × 100 (CB fora, tem card próprio)
  };
}

export interface ProfitSplitFilters {
  startDate: Date;
  endDate: Date;
  // Filtros de ordem (plataforma/família/país) — aplicados ao FRONT e às
  // fontes de back baseadas em Order (recovery/SMS). Tauk NÃO tem
  // plataforma/produto: com qualquer um desses filtros ativo, a fonte
  // Tauk é OMITIDA (não dá pra atribuir) em vez de mentir um global.
  platformSlugs?: string[];
  productFamilies?: string[];
  countries?: string[];
}

export async function getProfitSplit(filters: ProfitSplitFilters): Promise<ProfitSplitResponse> {
  const { startDate, endDate, platformSlugs, productFamilies, countries } = filters;
  const range = { gte: startDate, lte: endDate };

  const orderScope = {
    ...(platformSlugs?.length ? { platform: { slug: { in: platformSlugs } } } : {}),
    ...(productFamilies?.length ? { product: { family: { in: productFamilies } } } : {}),
    ...(countries?.length ? { country: { in: countries } } : {}),
  };
  const hasOrderScope = Object.keys(orderScope).length > 0;

  const [pm, recoveryAffs, taukAgg] = await Promise.all([
    getProfitModelInputs(),
    db.recoveryAffiliate.findMany({
      where: { enabled: true },
      select: { affiliateId: true, commissionPct: true },
    }),
    hasOrderScope
      ? Promise.resolve(null)
      : db.taukSale.aggregate({
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

  const [frontByPlatform, frontCpa, smsAgg, recoveryOrders, statusCounts] = await Promise.all([
    // FRONT: aprovadas do período SEM as fontes de back, DENTRO do escopo
    // de filtro da UI (plataforma/família/país) — antes o card ignorava o
    // filtro e mostrava o global com cara de filtrado.
    db.order.groupBy({
      by: ['platformId'],
      where: { status: 'APPROVED', orderedAt: range, ...orderScope, AND: frontExclusions },
      _sum: { grossAmountUsd: true, cpaPaidUsd: true },
      _count: { _all: true },
    }),
    db.platform.findMany({ select: { id: true, slug: true } }),
    db.order.aggregate({
      where: { status: 'APPROVED', orderedAt: range, ...orderScope, trafficSource: { equals: SMS_UTM_SOURCE, mode: 'insensitive' } },
      _sum: { grossAmountUsd: true },
    }),
    recoveryIds.length
      ? db.order.groupBy({
          by: ['affiliateId'],
          where: { status: 'APPROVED', orderedAt: range, ...orderScope, affiliateId: { in: recoveryIds } },
          _sum: { grossAmountUsd: true },
        })
      : Promise.resolve([] as Array<{ affiliateId: string | null; _sum: { grossAmountUsd: unknown } }>),
    // Contagem por plataforma×status pro card de reembolso do overview
    // (TODOS os pedidos do escopo — sem as exclusões de back do front).
    db.order.groupBy({
      by: ['platformId', 'status'],
      where: { orderedAt: range, ...orderScope },
      _count: { _all: true },
    }),
  ]);

  const slugById = new Map(frontCpa.map((p) => [p.id, p.slug]));
  let frontGross = 0;
  let frontModelNet = 0;
  let frontCpaTotal = 0;
  let frontOrders = 0;
  let frontRefundCbUsd = 0;
  for (const g of frontByPlatform) {
    const slug = slugById.get(g.platformId) ?? '';
    const pcts = pm.byPlatform.get(slug) ?? { feePct: 0, refundCbPct: 0 };
    const gross = g._sum.grossAmountUsd ? Number(g._sum.grossAmountUsd) : 0;
    frontGross += gross;
    frontModelNet += gross * (1 - (pcts.refundCbPct + pcts.feePct + pm.opexPct) / 100);
    frontRefundCbUsd += gross * (pcts.refundCbPct / 100);
    frontCpaTotal += g._sum.cpaPaidUsd ? Number(g._sum.cpaPaidUsd) : 0;
    frontOrders += g._count._all;
  }
  const frontProfit = round2(frontModelNet - frontCpaTotal);

  const taukGross = taukAgg?._sum.amountUsd ? Number(taukAgg._sum.amountUsd) : 0;
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
    // Tauk some quando há filtro de ordem ativo (venda Tauk não carrega
    // plataforma/produto — melhor omitir do que somar um global no card
    // filtrado).
    ...(hasOrderScope
      ? []
      : [{ key: 'tauk', label: 'Tauk', grossUsd: round2(taukGross), costUsd: round2(taukGross * TAUK_COMMISSION_PCT), netUsd: round2(taukGross * (1 - TAUK_COMMISSION_PCT)), available: true }]),
    { key: 'sms', label: 'SMS', grossUsd: round2(smsGross), costUsd: 0, netUsd: round2(smsGross), available: true },
    { key: 'salesbound', label: 'SalesBound', grossUsd: 0, costUsd: 0, netUsd: 0, available: false },
    { key: 'email', label: 'Email', grossUsd: 0, costUsd: 0, netUsd: 0, available: false },
  ];
  const backProfit = round2(sources.reduce((s, x) => s + x.netUsd, 0));

  // Lente de contagem por coorte (ver interface). Denominador por modelo
  // de contabilidade: Digistore (linha-extra) → pedidos reais = total −
  // linhas sintéticas de refund/cb; demais (in-place) → todas as linhas.
  let salesCount = 0;
  let refundedCount = 0;
  let chargebackCount = 0;
  const perPlatform = new Map<string, { total: number; refunded: number; cb: number }>();
  for (const g of statusCounts) {
    const slug = slugById.get(g.platformId) ?? '';
    const a = perPlatform.get(slug) ?? { total: 0, refunded: 0, cb: 0 };
    a.total += g._count._all;
    if (g.status === 'REFUNDED') a.refunded += g._count._all;
    if (g.status === 'CHARGEBACK') a.cb += g._count._all;
    perPlatform.set(slug, a);
  }
  for (const [slug, a] of perPlatform) {
    const extraRow = slug === 'digistore24';
    salesCount += extraRow ? a.total - a.refunded - a.cb : a.total;
    refundedCount += a.refunded;
    chargebackCount += a.cb;
  }

  return {
    range: { start: startDate.toISOString(), end: endDate.toISOString() },
    opexPct: pm.opexPct,
    front: {
      grossUsd: round2(frontGross),
      cpaUsd: round2(frontCpaTotal),
      orders: frontOrders,
      profitUsd: frontProfit,
      refundCbUsd: round2(frontRefundCbUsd),
    },
    back: { sources, profitUsd: backProfit },
    totalUsd: round2(frontProfit + backProfit),
    refunds: {
      salesCount,
      refundedCount,
      chargebackCount,
      pct: salesCount > 0 ? Math.round((refundedCount / salesCount) * 10000) / 100 : 0,
    },
  };
}
