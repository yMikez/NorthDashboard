// Números de uma janela pras leituras da IA (briefing e decisões), das
// MESMAS funções que desenham a Visão geral — o texto nunca contradiz a tela:
//   faturamento, pedidos, AOV, aprovação, chargeback → getOverview (kpis)
//   Net after CPA e reembolso (US$ pela data do estorno) → getOverviewPanels

import { getOverview, type MetricsFilters } from '../services/metrics';
import { getOverviewPanels, type OverviewPanelsDay } from '../services/overviewPanels';
import type { MetricKey } from '../briefing/core';

export interface WindowRead {
  totals: Record<MetricKey, number>;
  daily: OverviewPanelsDay[];
  previousDaily: OverviewPanelsDay[];
  previous: Record<MetricKey, number> | null;
  stages: { front: number; backend: number; recovery: number; backendAvailable: boolean };
}

/** `compare` = também os mesmos tantos dias imediatamente antes. */
export async function readWindow(f: MetricsFilters, compare: boolean): Promise<WindowRead> {
  const [ov, panels] = await Promise.all([getOverview(f, compare), getOverviewPanels(f)]);
  const k = ov.kpis;
  const refunds = (days: OverviewPanelsDay[]) => days.reduce((s, d) => s + d.refundUsd, 0);
  const net = (days: OverviewPanelsDay[]) => days.reduce((s, d) => s + d.netAfterCpa, 0);
  const totals: Record<MetricKey, number> = {
    faturamento: k.gross,
    pedidos: k.approvedCount,
    aov: k.aov,
    net_after_cpa: panels.netAfterCpa.usd,
    aprovacao: k.approvalRate,
    reembolso: refunds(panels.daily),
    chargeback: k.cbRate,
  };
  const p = ov.previous;
  const prevDaily = panels.previous?.daily ?? [];
  const previous: Record<MetricKey, number> | null = compare && p
    ? {
        faturamento: p.gross,
        pedidos: p.approvedCount,
        aov: p.aov,
        net_after_cpa: net(prevDaily),
        aprovacao: p.approvalRate,
        reembolso: refunds(prevDaily),
        chargeback: p.cbRate,
      }
    : null;
  return {
    totals,
    daily: panels.daily,
    previousDaily: prevDaily,
    previous,
    stages: {
      front: panels.stages.front.usd,
      backend: panels.stages.backend.usd,
      recovery: panels.stages.recovery.usd,
      backendAvailable: panels.stages.backend.available,
    },
  };
}
