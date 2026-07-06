// Métricas da aba "Tauk" (vendas recuperadas pela Tauk Solutions).
// Lê TaukSale direto (fora do pipeline Order/MV — ver comentário no model).
// Dia bucketado em BRT (UTC-3, sem DST desde 2019) — mesma semântica de
// "dia" da daily_metrics MV, pra série diária bater com o resto do dash.

import { db } from '../db';

export interface TaukFilters {
  startDate: Date;
  endDate: Date;
}

// Comissão da Tauk sobre CADA venda recuperada (acordo comercial: 35%).
// Computada on-the-fly (não vira payout) — muda via env TAUK_COMMISSION_PCT
// (fração, ex "0.35") + restart, sem deploy. Se um dia precisar de histórico
// de taxa (vendas antigas na taxa antiga), seguir o modelo RecoveryRatePeriod.
const TAUK_COMMISSION_PCT = (() => {
  const v = Number(process.env.TAUK_COMMISSION_PCT ?? '0.35');
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.35;
})();

export interface TaukResponse {
  range: { start: string; end: string };
  kpis: {
    sales: number;
    grossUsd: number;
    aovUsd: number;
    // Comissão da Tauk (fração em commissionPct) e líquido pós-comissão.
    commissionPct: number;
    commissionUsd: number;
    netUsd: number;
    // Vendas ainda em HOLD (não enviadas) — sinal de fila de fulfillment.
    holdCount: number;
  };
  daily: Array<{ date: string; sales: number; grossUsd: number }>;
  byStatus: Array<{ status: string; sales: number; grossUsd: number }>;
  recent: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    amountUsd: number;
    fulfillmentStatus: string | null;
    purchasedAt: string;
  }>;
}

const BRT_OFFSET_MS = 3 * 3600_000;

function brtDay(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getTauk(filters: TaukFilters): Promise<TaukResponse> {
  const rows = await db.taukSale.findMany({
    where: { purchasedAt: { gte: filters.startDate, lte: filters.endDate } },
    orderBy: { purchasedAt: 'desc' },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      amountUsd: true,
      fulfillmentStatus: true,
      purchasedAt: true,
    },
  });

  let gross = 0;
  let holdCount = 0;
  const byDay = new Map<string, { sales: number; gross: number }>();
  const byStatus = new Map<string, { sales: number; gross: number }>();

  for (const r of rows) {
    const usd = Number(r.amountUsd);
    gross += usd;

    const status = (r.fulfillmentStatus ?? 'desconhecido').toUpperCase();
    if (status === 'HOLD') holdCount++;
    const st = byStatus.get(status) ?? { sales: 0, gross: 0 };
    st.sales++;
    st.gross += usd;
    byStatus.set(status, st);

    const day = brtDay(r.purchasedAt);
    const d = byDay.get(day) ?? { sales: 0, gross: 0 };
    d.sales++;
    d.gross += usd;
    byDay.set(day, d);
  }

  return {
    range: { start: filters.startDate.toISOString(), end: filters.endDate.toISOString() },
    kpis: {
      sales: rows.length,
      grossUsd: round2(gross),
      aovUsd: rows.length > 0 ? round2(gross / rows.length) : 0,
      commissionPct: TAUK_COMMISSION_PCT,
      commissionUsd: round2(gross * TAUK_COMMISSION_PCT),
      netUsd: round2(gross * (1 - TAUK_COMMISSION_PCT)),
      holdCount,
    },
    daily: Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, d]) => ({ date, sales: d.sales, grossUsd: round2(d.gross) })),
    byStatus: Array.from(byStatus.entries())
      .sort(([, a], [, b]) => b.sales - a.sales)
      .map(([status, s]) => ({ status, sales: s.sales, grossUsd: round2(s.gross) })),
    recent: rows.slice(0, 50).map((r) => ({
      id: r.id,
      name: [r.firstName, r.lastName].filter(Boolean).join(' ') || '—',
      email: r.email,
      phone: r.phone,
      amountUsd: Number(r.amountUsd),
      fulfillmentStatus: r.fulfillmentStatus,
      purchasedAt: r.purchasedAt.toISOString(),
    })),
  };
}
