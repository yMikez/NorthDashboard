// Métricas da aba "Call Center" — vendas recuperadas por PARCEIROS de
// telefone/SMS (Tauk desde 2026-07, Logicall desde 2026-08-22). Substitui a
// antiga lib/services/tauk.ts; mesma semântica de dia (BRT) e mesmo
// endpoint (/api/metrics/tauk — id da tab preservado pra permissões).
//
// Lê CallCenterSale direto (fora do pipeline Order/MV — ver model). As duas
// fontes têm profundidade diferente: a Tauk manda só cliente/valor/status;
// a Logicall traz produto, agente (humano × IA) e estorno. A resposta expõe
// o que existe e a UI mostra "—" onde a fonte não informa.
//
// Semântica de RECEITA: Σ (valor − refundedUsd) das vendas APPROVED — um
// refund PARCIAL abate só a parte devolvida; estorno TOTAL (status
// REFUNDED/CHARGEBACK) tira a venda inteira. Estornos aqui são por DATA DA
// VENDA (coorte), diferente dos cards do overview (data do estorno) — o
// rodapé da aba avisa.
//
// A tabela "Por parceiro" é calculada SEM o filtro de provider (pra
// comparar); KPIs, série, tabelas e recentes respeitam o filtro.

import { db } from '../db';
import { getProviderCommission, type CallCenterProvider } from './integrationSettings';
import { getLogicallSyncStatus } from './logicallSync';
import { isAiAgent } from '../connectors/logicall/ingest';

export const PROVIDERS: CallCenterProvider[] = ['tauk', 'logicall'];
export const PROVIDER_LABEL: Record<CallCenterProvider, string> = {
  tauk: 'Tauk',
  logicall: 'Logicall',
};

export interface CallCenterFilters {
  startDate: Date;
  endDate: Date;
  provider?: CallCenterProvider | 'all';
}

export interface ProviderSummary {
  provider: CallCenterProvider | 'all';
  label: string;
  sales: number;          // vendas recuperadas (qualquer status)
  approved: number;       // sem estorno total
  grossUsd: number;       // Σ (valor − refund parcial) das aprovadas
  aovUsd: number;
  commissionPct: number;
  commissionAssumed: boolean;
  commissionUsd: number;
  netUsd: number;
  pendingCount: number;   // fulfillment HOLD/PENDING/PROCESSING entre as aprovadas
  refundedCount: number;  // estornos TOTAIS (REFUNDED + CHARGEBACK)
  partialRefundCount: number;
  refundedUsd: number;    // $ devolvido (totais + parciais)
}

export interface CallCenterResponse {
  range: { start: string; end: string };
  provider: CallCenterProvider | 'all';
  totals: ProviderSummary;
  providers: ProviderSummary[];
  daily: Array<{ date: string; tauk: number; logicall: number; taukSales: number; logicallSales: number }>;
  byStatus: Array<{ status: string; sales: number; grossUsd: number }>;
  byAgent: Array<{ agent: string; isAi: boolean; sales: number; grossUsd: number; aovUsd: number }>;
  byProduct: Array<{ product: string; family: string | null; sales: number; grossUsd: number }>;
  recent: Array<{
    id: string;
    provider: CallCenterProvider;
    name: string;
    email: string | null;
    phone: string | null;
    amountUsd: number;
    refundedUsd: number | null;
    status: string;
    fulfillmentStatus: string | null;
    productName: string | null;
    agentName: string | null;
    purchasedAt: string;
    placeholder: boolean;
  }>;
  logicallSync: Awaited<ReturnType<typeof getLogicallSyncStatus>>;
}

// Linha mínima que a agregação precisa — a mesma shape do select abaixo,
// exportada pra teste sem banco.
export interface CallCenterRow {
  id: string;
  provider: string;
  status: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  amountUsd: number;
  refundedUsd: number | null;
  fulfillmentStatus: string | null;
  productName: string | null;
  family: string | null;
  agentName: string | null;
  purchasedAt: Date;
  /** Estorno cuja venda ainda não foi sincronizada (ver logicallSync). */
  placeholder?: boolean;
}

const BRT_OFFSET_MS = 3 * 3600_000;
function brtDay(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
const PENDING_STATUSES = new Set(['HOLD', 'PENDING', 'PROCESSING']);

function emptySummary(provider: CallCenterProvider | 'all', label: string, pct: number, assumed: boolean): ProviderSummary {
  return {
    provider, label, sales: 0, approved: 0, grossUsd: 0, aovUsd: 0,
    commissionPct: pct, commissionAssumed: assumed, commissionUsd: 0, netUsd: 0,
    pendingCount: 0, refundedCount: 0, partialRefundCount: 0, refundedUsd: 0,
  };
}

function finishSummary(s: ProviderSummary): ProviderSummary {
  return {
    ...s,
    grossUsd: round2(s.grossUsd),
    aovUsd: s.approved > 0 ? round2(s.grossUsd / s.approved) : 0,
    commissionUsd: round2(s.grossUsd * s.commissionPct),
    netUsd: round2(s.grossUsd * (1 - s.commissionPct)),
    refundedUsd: round2(s.refundedUsd),
  };
}

/** Resumo por parceiro (+ total) — usado com e sem filtro. */
export function summarizeProviders(
  rows: CallCenterRow[],
  commissions: Record<CallCenterProvider, { pct: number; assumed: boolean }>,
): { totals: ProviderSummary; providers: ProviderSummary[] } {
  const summaries = new Map<CallCenterProvider, ProviderSummary>();
  for (const p of PROVIDERS) {
    summaries.set(p, emptySummary(p, PROVIDER_LABEL[p], commissions[p].pct, commissions[p].assumed));
  }
  for (const r of rows) {
    const provider = (r.provider === 'logicall' ? 'logicall' : 'tauk') as CallCenterProvider;
    const s = summaries.get(provider)!;
    const reversed = r.status === 'REFUNDED' || r.status === 'CHARGEBACK';
    if (reversed) {
      // Placeholder (venda não sincronizada) conta como estorno, não como venda.
      if (!r.placeholder) s.sales++;
      s.refundedCount++;
      s.refundedUsd += r.refundedUsd ?? r.amountUsd;
      continue;
    }
    s.sales++;
    s.approved++;
    const partial = r.refundedUsd ?? 0;
    s.grossUsd += Math.max(0, r.amountUsd - partial);
    if (partial > 0) { s.partialRefundCount++; s.refundedUsd += partial; }
    if (PENDING_STATUSES.has((r.fulfillmentStatus ?? '').toUpperCase())) s.pendingCount++;
  }
  const providers = PROVIDERS.map((p) => finishSummary(summaries.get(p)!));

  // Total: comissão = Σ das comissões por parceiro (taxas podem diferir);
  // pct exibido = taxa efetiva; sem receita, mostra a da Tauk (referência).
  const totals = providers.reduce<ProviderSummary>((acc, p) => ({
    ...acc,
    sales: acc.sales + p.sales,
    approved: acc.approved + p.approved,
    grossUsd: round2(acc.grossUsd + p.grossUsd),
    commissionUsd: round2(acc.commissionUsd + p.commissionUsd),
    netUsd: round2(acc.netUsd + p.netUsd),
    pendingCount: acc.pendingCount + p.pendingCount,
    refundedCount: acc.refundedCount + p.refundedCount,
    partialRefundCount: acc.partialRefundCount + p.partialRefundCount,
    refundedUsd: round2(acc.refundedUsd + p.refundedUsd),
    commissionAssumed: acc.commissionAssumed || (p.commissionAssumed && p.sales > 0),
  }), emptySummary('all', 'Call Center', 0, false));
  totals.aovUsd = totals.approved > 0 ? round2(totals.grossUsd / totals.approved) : 0;
  totals.commissionPct = totals.grossUsd > 0
    ? Math.round((totals.commissionUsd / totals.grossUsd) * 10000) / 10000
    : commissions.tauk.pct;
  return { totals, providers };
}

export function aggregateCallCenter(
  rows: CallCenterRow[],
  commissions: Record<CallCenterProvider, { pct: number; assumed: boolean }>,
): Pick<CallCenterResponse, 'totals' | 'providers' | 'daily' | 'byStatus' | 'byAgent' | 'byProduct'> {
  const { totals, providers } = summarizeProviders(rows, commissions);
  const byDay = new Map<string, { tauk: number; logicall: number; taukSales: number; logicallSales: number }>();
  const byStatus = new Map<string, { sales: number; gross: number }>();
  const byAgent = new Map<string, { sales: number; gross: number }>();
  const byProduct = new Map<string, { family: string | null; sales: number; gross: number }>();

  for (const r of rows) {
    if (r.status === 'REFUNDED' || r.status === 'CHARGEBACK') continue;
    const provider = (r.provider === 'logicall' ? 'logicall' : 'tauk') as CallCenterProvider;
    const net = Math.max(0, r.amountUsd - (r.refundedUsd ?? 0));
    const fs = (r.fulfillmentStatus ?? '').toUpperCase() || 'DESCONHECIDO';

    const st = byStatus.get(fs) ?? { sales: 0, gross: 0 };
    st.sales++; st.gross += net;
    byStatus.set(fs, st);

    const day = brtDay(r.purchasedAt);
    const d = byDay.get(day) ?? { tauk: 0, logicall: 0, taukSales: 0, logicallSales: 0 };
    d[provider] += net;
    d[`${provider}Sales`]++;
    byDay.set(day, d);

    if (r.agentName) {
      const a = byAgent.get(r.agentName) ?? { sales: 0, gross: 0 };
      a.sales++; a.gross += net;
      byAgent.set(r.agentName, a);
    }
    if (r.productName) {
      const p = byProduct.get(r.productName) ?? { family: r.family, sales: 0, gross: 0 };
      p.sales++; p.gross += net;
      byProduct.set(r.productName, p);
    }
  }

  return {
    totals,
    providers,
    daily: Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, d]) => ({
        date, tauk: round2(d.tauk), logicall: round2(d.logicall),
        taukSales: d.taukSales, logicallSales: d.logicallSales,
      })),
    byStatus: Array.from(byStatus.entries())
      .sort(([, a], [, b]) => b.sales - a.sales)
      .map(([status, s]) => ({ status, sales: s.sales, grossUsd: round2(s.gross) })),
    byAgent: Array.from(byAgent.entries())
      .sort(([, a], [, b]) => b.gross - a.gross)
      .map(([agent, a]) => ({
        agent, isAi: isAiAgent(agent), sales: a.sales,
        grossUsd: round2(a.gross), aovUsd: a.sales > 0 ? round2(a.gross / a.sales) : 0,
      })),
    byProduct: Array.from(byProduct.entries())
      .sort(([, a], [, b]) => b.gross - a.gross)
      .map(([product, p]) => ({ product, family: p.family, sales: p.sales, grossUsd: round2(p.gross) })),
  };
}

export async function getCallCenterSales(filters: CallCenterFilters): Promise<CallCenterResponse> {
  const provider = filters.provider && filters.provider !== 'all' ? filters.provider : 'all';
  const [rows, tauk, logicall, logicallSync] = await Promise.all([
    db.callCenterSale.findMany({
      where: { purchasedAt: { gte: filters.startDate, lte: filters.endDate } },
      orderBy: { purchasedAt: 'desc' },
      select: {
        id: true, provider: true, status: true, email: true, firstName: true, lastName: true,
        phone: true, amountUsd: true, refundedUsd: true, fulfillmentStatus: true,
        productName: true, family: true, agentName: true, purchasedAt: true, raw: true,
      },
    }),
    getProviderCommission('tauk'),
    getProviderCommission('logicall'),
    getLogicallSyncStatus(),
  ]);

  const all: CallCenterRow[] = rows.map((r) => ({
    ...r,
    amountUsd: Number(r.amountUsd),
    refundedUsd: r.refundedUsd != null ? Number(r.refundedUsd) : null,
    placeholder: Boolean((r.raw as { _placeholder?: boolean } | null)?._placeholder),
  }));
  const commissions = { tauk, logicall };
  const scoped = provider === 'all' ? all : all.filter((r) => r.provider === provider);

  const agg = aggregateCallCenter(scoped, commissions);
  // "Por parceiro" sempre sobre TODAS as linhas — é a comparação.
  const { providers } = summarizeProviders(all, commissions);

  return {
    range: { start: filters.startDate.toISOString(), end: filters.endDate.toISOString() },
    provider,
    ...agg,
    providers,
    recent: scoped.slice(0, 80).map((r) => ({
      id: r.id,
      provider: (r.provider === 'logicall' ? 'logicall' : 'tauk') as CallCenterProvider,
      name: [r.firstName, r.lastName].filter(Boolean).join(' ') || '—',
      email: r.email,
      phone: r.phone,
      amountUsd: r.amountUsd,
      refundedUsd: r.refundedUsd,
      status: r.status,
      fulfillmentStatus: r.fulfillmentStatus,
      productName: r.productName,
      agentName: r.agentName,
      purchasedAt: r.purchasedAt.toISOString(),
      placeholder: Boolean(r.placeholder),
    })),
    logicallSync,
  };
}
