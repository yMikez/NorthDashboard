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

import { db } from '../db';

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
  const [config, platforms] = await Promise.all([
    db.profitConfig.findUnique({ where: { id: 'global' } }),
    db.platform.findMany({ select: { slug: true, feeRatePct: true, refundCbPct: true } }),
  ]);
  return {
    opexPct: config ? Number(config.opexPct) : 10,
    thresholds: {
      healthyMinUsd: config ? Number(config.healthyMinUsd) : 10,
      attentionMinUsd: config ? Number(config.attentionMinUsd) : 0,
    },
    byPlatform: new Map(platforms.map((p) => [
      p.slug,
      {
        feePct: p.feeRatePct ? Number(p.feeRatePct) : 0,
        refundCbPct: p.refundCbPct ? Number(p.refundCbPct) : 0,
      },
    ])),
  };
}

// Taxa de refund+chargeback OBSERVADA por plataforma, em coorte MADURA:
// vendas ordenadas entre 150 e 60 dias atrás (já tiveram tempo de ser
// reembolsadas). refunded+chargeback ÷ (approved+refunded+chargeback).
// Exposta na página Plataformas ao lado do campo manual, pra calibração.
export async function getObservedRefundCbPct(): Promise<Map<string, { pct: number; sample: number }>> {
  const now = Date.now();
  const rows = await db.order.groupBy({
    by: ['platformId', 'status'],
    where: {
      orderedAt: { gte: new Date(now - 150 * 86_400_000), lte: new Date(now - 60 * 86_400_000) },
      status: { in: ['APPROVED', 'REFUNDED', 'CHARGEBACK'] },
    },
    _count: { _all: true },
  });
  const platforms = await db.platform.findMany({ select: { id: true, slug: true } });
  const slugById = new Map(platforms.map((p) => [p.id, p.slug]));

  const acc = new Map<string, { bad: number; total: number }>();
  for (const r of rows) {
    const slug = slugById.get(r.platformId);
    if (!slug) continue;
    const a = acc.get(slug) ?? { bad: 0, total: 0 };
    a.total += r._count._all;
    if (r.status !== 'APPROVED') a.bad += r._count._all;
    acc.set(slug, a);
  }
  const out = new Map<string, { pct: number; sample: number }>();
  for (const [slug, a] of acc) {
    out.set(slug, {
      pct: a.total > 0 ? Math.round((a.bad / a.total) * 10000) / 100 : 0,
      sample: a.total,
    });
  }
  return out;
}
