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
  // Cards de reembolso do overview: "no período aconteceram Y estornos,
  // contra X pedidos feitos no período".
  //   numerador — estornos por DATA DO ESTORNO (refundedAt/chargebackAt),
  //     inclusive de vendas anteriores ao período. Mesma leitura do painel
  //     da Digistore.
  //   denominador — pedidos/faturamento do período por orderedAt, com
  //     desconto das linhas sintéticas da Digistore (refund é LINHA EXTRA,
  //     a venda original segue APPROVED).
  // Coorte "das vendas do dia X, quantas voltaram" é outra coisa e vive em
  // getObservedRefundCbPct (profitModel) — é ela que calibra o NET AFTER CPA.
  refunds: {
    salesCount: number;
    refundedCount: number;
    chargebackCount: number;
    pct: number; // refundedCount ÷ salesCount × 100 (CB fora, tem card próprio)
    // Lente de VALOR (card TAXA DE REEMBOLSO): |$ devolvido| ÷ $ faturado.
    grossUsd: number;
    refundedUsd: number;
    valuePct: number;
  };
  // Monitor de alerta precoce (regra do usuário, 2026-08-06): janela
  // ROLANTE dos últimos 7 dias A PARTIR DE AGORA — independente do
  // período selecionado na UI, mas respeitando os filtros de
  // plataforma/família/país. Limite: 10% dos pedidos com reembolso →
  // acende alerta no card (o threshold visual fica no front).
  refunds7d: {
    salesCount: number;
    refundedCount: number;
    chargebackCount: number;
    pct: number;
    grossUsd: number;
    refundedUsd: number;
    valuePct: number;
  };
}

type StatusGroup = {
  platformId: string; status: string;
  _count: { _all: number }; _sum: { grossAmountUsd: unknown };
};
type EventGroup = {
  platformId: string;
  _count: { _all: number }; _sum: { grossAmountUsd: unknown };
};

// Reduz os grupos pras DUAS lentes de reembolso do overview.
//
// EIXOS DIFERENTES de propósito (decisão 2026-08-11):
//   denominador (`statusRows`) — por orderedAt: os pedidos/faturamento DO
//     PERÍODO. Na Digistore o refund é LINHA EXTRA carimbada com a data da
//     venda, então pedidos reais = total − linhas de refund/cb; nas demais
//     (in-place) a linha estornada É a venda → total.
//   numerador (`refundRows`/`cbRows`) — por refundedAt/chargebackAt: os
//     estornos que ACONTECERAM no período, independente de quando a venda
//     foi feita. É a leitura do painel da Digistore, e é o que faltava:
//     antes o numerador também vinha por orderedAt, então o estorno de hoje
//     (de uma venda de semanas atrás) sumia e "hoje" aparecia zerado.
//
// A coorte por data de venda continua existindo — mora em
// getObservedRefundCbPct (profitModel), que calibra o NET AFTER CPA.
function reduceRefundCounts(
  statusRows: StatusGroup[],
  refundRows: EventGroup[],
  cbRows: EventGroup[],
  slugById: Map<string, string>,
): {
  salesCount: number; refundedCount: number; chargebackCount: number; pct: number;
  grossUsd: number; refundedUsd: number; valuePct: number;
} {
  const perPlatform = new Map<string, { total: number; refunded: number; cb: number }>();
  const bucket = (platformId: string) => {
    const slug = slugById.get(platformId) ?? '';
    let a = perPlatform.get(slug);
    if (!a) { a = { total: 0, refunded: 0, cb: 0 }; perPlatform.set(slug, a); }
    return a;
  };

  let grossUsd = 0;
  for (const g of statusRows) {
    const a = bucket(g.platformId);
    a.total += g._count._all;
    const usd = g._sum.grossAmountUsd ? Number(g._sum.grossAmountUsd) : 0;
    // refunded/cb aqui são as linhas SINTÉTICAS que caem no período por
    // orderedAt — só servem pra descontar do denominador da Digistore.
    if (g.status === 'REFUNDED') a.refunded += g._count._all;
    if (g.status === 'CHARGEBACK') a.cb += g._count._all;
    if (g.status === 'APPROVED') grossUsd += usd;
  }

  let salesCount = 0;
  for (const [slug, a] of perPlatform) {
    const extraRow = slug === 'digistore24';
    salesCount += extraRow ? a.total - a.refunded - a.cb : a.total;
  }

  let refundedCount = 0;
  let refundedUsd = 0;
  for (const g of refundRows) {
    refundedCount += g._count._all;
    refundedUsd += Math.abs(g._sum.grossAmountUsd ? Number(g._sum.grossAmountUsd) : 0);
  }
  let chargebackCount = 0;
  for (const g of cbRows) chargebackCount += g._count._all;

  return {
    salesCount,
    refundedCount,
    chargebackCount,
    pct: salesCount > 0 ? Math.round((refundedCount / salesCount) * 10000) / 100 : 0,
    grossUsd: Math.round(grossUsd * 100) / 100,
    refundedUsd: Math.round(refundedUsd * 100) / 100,
    valuePct: grossUsd > 0 ? Math.round((refundedUsd / grossUsd) * 10000) / 100 : 0,
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

  // Estornos por EIXO DE EVENTO (quando o refund/CB aconteceu). Ver
  // reduceRefundCounts: o numerador dos cards vem daqui, o denominador
  // continua vindo do groupBy por orderedAt.
  const range7d = { gte: new Date(Date.now() - 7 * 86_400_000) };
  const refundedIn = (window: object) => db.order.groupBy({
    by: ['platformId'],
    where: { status: 'REFUNDED' as const, refundedAt: window, ...orderScope },
    _count: { _all: true },
    _sum: { grossAmountUsd: true },
  });
  const chargedBackIn = (window: object) => db.order.groupBy({
    by: ['platformId'],
    where: { status: 'CHARGEBACK' as const, chargebackAt: window, ...orderScope },
    _count: { _all: true },
    _sum: { grossAmountUsd: true },
  });

  const [
    frontByPlatform, frontCpa, smsAgg, recoveryOrders, statusCounts, statusCounts7d,
    refundEvents, refundEvents7d, cbEvents, cbEvents7d,
  ] = await Promise.all([
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
    // Contagem+valor por plataforma×status pros cards de reembolso do
    // overview (TODOS os pedidos do escopo — sem as exclusões de back).
    db.order.groupBy({
      by: ['platformId', 'status'],
      where: { orderedAt: range, ...orderScope },
      _count: { _all: true },
      _sum: { grossAmountUsd: true },
    }),
    // Monitor rolante: últimos 7 dias a partir de AGORA (não do período
    // selecionado) — alimenta o alerta de 10% do card por pedidos.
    db.order.groupBy({
      by: ['platformId', 'status'],
      where: { orderedAt: range7d, ...orderScope },
      _count: { _all: true },
      _sum: { grossAmountUsd: true },
    }),
    refundedIn(range),
    refundedIn(range7d),
    chargedBackIn(range),
    chargedBackIn(range7d),
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

  const refunds = reduceRefundCounts(statusCounts, refundEvents, cbEvents, slugById);
  const refunds7d = reduceRefundCounts(statusCounts7d, refundEvents7d, cbEvents7d, slugById);

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
    refunds,
    refunds7d,
  };
}
