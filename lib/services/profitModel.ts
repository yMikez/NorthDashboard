// Modelo de lucro estilo planilha CPA (.xlsx na raiz do repo, decodificada
// em 2026-07-29):
//   NET AOV       = AOV × (1 − refund&cb% − fee da plataforma − opex%)
//   NET AFTER CPA = NET AOV − CPA
//   STATUS        : ≥ healthyMinUsd → SAUDÁVEL · ≥ attentionMinUsd →
//                   ATENÇÃO · abaixo → RENEGOCIAR (régua editável, admin)
//
// Fontes (decisões do usuário): AOV = atribuído por sessão (FE+UPs+DWs ÷
// nº de FEs — o "AOV global" da lista de afiliados); fee = REAL da
// plataforma (Platform.feeRatePct, %); refund&cb% = MANUAL por plataforma
// (Platform.refundCbPct, %) calibrada pela taxa observada em coorte
// MADURA (60–150d atrás — refund chega até 60-90d depois da venda, coorte
// recente subestima); opex% = global (ProfitConfig). CPA = detectado das
// transações (cpaPerFe, último valor).
//
// EXCEÇÃO DIGISTORE (decisão 2026-08-06): refund&cb% do MODELO vem dos
// DADOS REAIS (eventos on_refund/on_chargeback ingeridos), não do campo
// manual — taxa em VALOR da coorte madura (|$refund+$cb| ÷ $vendas).
// O manual vira fallback quando a amostra madura é pequena. Faturamento
// bruto segue INTACTO (a venda reembolsada continua APPROVED — modelo de
// linha-extra, ver memória project-refund-accounting): o refund só é
// subtraído aqui, na hora de presumir o NET AFTER CPA.

import { db } from '../db';

// Plataformas onde o refund cria LINHA EXTRA (venda original continua
// APPROVED) em vez de atualizar in-place. Muda o denominador das taxas:
// APPROVED já é o total de vendas reais.
export const EXTRA_ROW_REFUND_PLATFORMS = new Set(['digistore24']);

/**
 * Pedidos REAIS de um recorte, descontando as linhas sintéticas.
 *
 * Na Digistore o estorno é uma LINHA EXTRA (a venda original segue APPROVED),
 * então contar todas as linhas infla o denominador e dilui qualquer taxa
 * calculada em cima dele — era o bug de "9,36% exibido vs 10,45% real".
 * Nas plataformas in-place a linha estornada É a venda, então conta.
 *
 * Definição única — usada pelo modelo de lucro, pelos cards de reembolso da
 * Visão Geral e pelas taxas por afiliado.
 */
export function realOrderCount(
  platformSlug: string,
  allOrders: number,
  refunds: number,
  chargebacks: number,
): number {
  return EXTRA_ROW_REFUND_PLATFORMS.has(platformSlug)
    ? Math.max(0, allOrders - refunds - chargebacks)
    : allOrders;
}
// Amostra mínima da coorte madura pra confiar na taxa real; abaixo disso
// o modelo cai no refundCbPct manual da plataforma.
const REAL_RATE_MIN_SAMPLE = 50;

export type CpaStatus = 'saudavel' | 'atencao' | 'renegociar';

export interface ProfitPcts {
  // Percentuais (15 = 15%) — mesma convenção do Platform.feeRatePct.
  refundCbPct: number;
  feePct: number;
  opexPct: number;
}

export interface ProfitThresholds {
  healthyMinUsd: number;
  attentionMinUsd: number;
}

export interface ProfitModelInputs {
  opexPct: number;
  thresholds: ProfitThresholds;
  // slug → { feePct, refundCbPct } (0 quando não cadastrado).
  byPlatform: Map<string, { feePct: number; refundCbPct: number }>;
}

export function netAovUsd(aov: number, pcts: ProfitPcts): number {
  const keep = 1 - (pcts.refundCbPct + pcts.feePct + pcts.opexPct) / 100;
  return Math.round(aov * keep * 100) / 100;
}

export function cpaStatus(netAfterCpa: number, th: ProfitThresholds): CpaStatus {
  if (netAfterCpa >= th.healthyMinUsd) return 'saudavel';
  if (netAfterCpa >= th.attentionMinUsd) return 'atencao';
  return 'renegociar';
}

export async function getProfitModelInputs(): Promise<ProfitModelInputs> {
  const [config, platforms, observed] = await Promise.all([
    db.profitConfig.findUnique({ where: { id: 'global' } }),
    db.platform.findMany({ select: { slug: true, feeRatePct: true, refundCbPct: true } }),
    getObservedRefundCbPct(),
  ]);
  return {
    opexPct: config ? Number(config.opexPct) : 10,
    thresholds: {
      healthyMinUsd: config ? Number(config.healthyMinUsd) : 10,
      attentionMinUsd: config ? Number(config.attentionMinUsd) : 0,
    },
    byPlatform: new Map(platforms.map((p) => {
      const manual = p.refundCbPct ? Number(p.refundCbPct) : 0;
      // Digistore: taxa REAL em valor (coorte madura) no lugar do manual.
      // Propaga automaticamente pros dois consumidores do modelo: a coluna
      // NET AOV/NET AFTER CPA dos afiliados (metrics.ts) e o lucro FRONT
      // do overview (profitSplit.ts).
      const obs = observed.get(p.slug);
      const useReal =
        EXTRA_ROW_REFUND_PLATFORMS.has(p.slug)
        && obs != null
        && obs.sample >= REAL_RATE_MIN_SAMPLE;
      return [
        p.slug,
        {
          feePct: p.feeRatePct ? Number(p.feeRatePct) : 0,
          refundCbPct: useReal ? obs.valuePct : manual,
        },
      ];
    })),
  };
}

// Taxa de refund+chargeback OBSERVADA por plataforma, em coorte MADURA:
// vendas ordenadas entre 150 e 60 dias atrás (já tiveram tempo de ser
// reembolsadas). Duas lentes:
//   pct      — % de PEDIDOS reembolsados (contagem)
//   valuePct — % do VALOR reembolsado (|$refund+$cb| ÷ $vendas) — robusta
//              a refund parcial; é a que o modelo NET AFTER CPA usa na
//              Digistore.
//
// DENOMINADOR depende do modelo de contabilidade da plataforma:
//   - in-place (ClickBank etc.): a venda reembolsada VIRA a linha REFUNDED
//     → vendas reais = APPROVED + REFUNDED + CHARGEBACK.
//   - linha-extra (Digistore): a venda reembolsada CONTINUA APPROVED e o
//     refund é uma linha adicional → vendas reais = APPROVED, e usar
//     A+R+C dobraria os reembolsos no denominador (era o bug que diluía
//     a taxa da D24: 9,36% exibido vs 10,45% real).
// Exposta na página Plataformas ao lado do campo manual, pra calibração.
export async function getObservedRefundCbPct(): Promise<
  Map<string, { pct: number; valuePct: number; sample: number }>
> {
  const now = Date.now();
  const rows = await db.order.groupBy({
    by: ['platformId', 'status'],
    where: {
      orderedAt: { gte: new Date(now - 150 * 86_400_000), lte: new Date(now - 60 * 86_400_000) },
      status: { in: ['APPROVED', 'REFUNDED', 'CHARGEBACK'] },
    },
    _count: { _all: true },
    _sum: { grossAmountUsd: true },
  });
  const platforms = await db.platform.findMany({ select: { id: true, slug: true } });
  const slugById = new Map(platforms.map((p) => [p.id, p.slug]));

  const acc = new Map<string, { bad: number; approved: number; badUsd: number; approvedUsd: number }>();
  for (const r of rows) {
    const slug = slugById.get(r.platformId);
    if (!slug) continue;
    const a = acc.get(slug) ?? { bad: 0, approved: 0, badUsd: 0, approvedUsd: 0 };
    const gross = r._sum.grossAmountUsd ? Number(r._sum.grossAmountUsd) : 0;
    if (r.status === 'APPROVED') {
      a.approved += r._count._all;
      a.approvedUsd += gross;
    } else {
      a.bad += r._count._all;
      // Linhas de refund/CB carregam gross NEGATIVO (D24) ou o valor
      // estornado (in-place) — abs cobre os dois.
      a.badUsd += Math.abs(gross);
    }
    acc.set(slug, a);
  }
  const out = new Map<string, { pct: number; valuePct: number; sample: number }>();
  for (const [slug, a] of acc) {
    // Vendas reais: ver comentário do denominador acima.
    const sales = EXTRA_ROW_REFUND_PLATFORMS.has(slug) ? a.approved : a.approved + a.bad;
    const salesUsd = EXTRA_ROW_REFUND_PLATFORMS.has(slug) ? a.approvedUsd : a.approvedUsd + a.badUsd;
    out.set(slug, {
      pct: sales > 0 ? Math.round((a.bad / sales) * 10000) / 100 : 0,
      valuePct: salesUsd > 0 ? Math.round((a.badUsd / salesUsd) * 10000) / 100 : 0,
      sample: sales,
    });
  }
  return out;
}
