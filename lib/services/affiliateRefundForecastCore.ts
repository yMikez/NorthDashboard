// Devolução até o dia 60 (D60) por afiliado: REAL (o que já aconteceu) e
// PREVISTO (modelo do time de dados) — parte pura (testada).
//
// Fonte: dados_oficiais.afiliados_pedidos (1 linha por venda JVZoo e Vupim).
//   Real     = colunas que a tabela já tinha (reembolso, disputa, taxa_alerta,
//              taxa_disputa, reembolso_dia, taxas_dias), na regra do modelo:
//              evento até 60 dias depois da venda. Na safra fechada bate ao
//              centavo com o real do modelo.
//   Previsto = colunas r60_* (modelo M7, job ml-reembolso, BigQuery
//              ml.reembolso__previsao_pedido), por venda, desde 01/08/2026.
// Ver docs/kb/afiliados-previsao-d60.md.
//
// Vocabulário (decisão de 16/11/2026, vale para todas as telas):
//   Reembolso    = pedido pelo cliente
//   Chargeback   = valor das disputas
//   Alertas      = valor dos alertas
//   Taxas        = taxa do alerta (US$ 23) + taxa da disputa (US$ 49)
//   Devol. Total = tudo (no previsto, r60_total_previsto: o número oficial do modelo)
// Os valores previstos por pedido são ESPERADOS: soma primeiro, divide depois.

export interface D60Parts {
  refundUsd: number;
  chargebackUsd: number;
  alertsUsd: number;
  feesUsd: number;
  totalUsd: number;
}

export interface D60Forecast extends D60Parts {
  /** Pedidos com previsão (o modelo cobre vendas desde 01/08/2026). */
  orders: number;
  /** Bruto vendido dos pedidos com previsão (base do %). */
  soldUsd: number;
  /** Parte do total que já é real (venda com 60+ dias). */
  closedTotalUsd: number;
}

export interface AffiliateRefundD60 {
  /** Pedidos do afiliado (de entrada do funil) no período. */
  orders: number;
  /** Bruto vendido de todos esses pedidos (base do % do real). */
  soldUsd: number;
  /** Real até hoje (eventos até 60 dias depois da venda). */
  real: D60Parts;
  /** Previsão até o D60; null = nenhum pedido com previsão (ou colunas ainda não publicadas). */
  forecast: D60Forecast | null;
}

export interface RefundD60Source {
  /** ok = real e previsto · sem_previsao = só o real (colunas r60_* ainda não publicadas) · indisponivel = falha. */
  status: 'ok' | 'sem_previsao' | 'indisponivel';
  reason?: string;
  publicacaoId: number | null;
  /** Último dia completo visto pelo modelo (YYYY-MM-DD). */
  cutoffDay: string | null;
  modelVersion: number | null;
  /** Primeiro dia com previsão (o modelo começa em 01/08/2026). */
  since: string;
  /** Período usado (dia da venda: JVZoo dia de Nova York, Vupim dia de Brasília). */
  startDay: string;
  endDay: string;
  /** Filtros da tela que o D60 NÃO aplica (produto, país, família). */
  ignoredFilters: string[];
  /** Soma de TODAS as contas no período (a conferência com o BigQuery). */
  totals?: AffiliateRefundD60 | null;
  /** Contas com D60 que não estão na lista de afiliados da tela (entram só em `totals`). */
  unmatchedAccounts?: number;
}

export interface D60DbRow {
  slug: string;
  aff: string;
  pedidos: number;
  vendido_total: number;
  re_real: number;
  cb_real: number;
  al_real: number;
  tx_real: number;
  total_real: number;
  com_previsao: number;
  vendido: number;
  reembolso: number;
  chargeback: number;
  alertas: number;
  taxas: number;
  total: number;
  total_fechado: number;
}

export const FORECAST_SINCE = '2026-08-01';

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (x: unknown) => Number(x) || 0;

/** Dia (YYYY-MM-DD) de um instante no fuso de Brasília — o filtro da tela é BRT. */
export function brtDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Chave da conta, igual à da lista de afiliados: `${platformSlug}:${externalId}`. */
export function d60Key(slug: string, externalId: string): string {
  return `${slug.toLowerCase()}:${externalId}`;
}

export function rowToD60(r: D60DbRow): AffiliateRefundD60 {
  const withForecast = num(r.com_previsao);
  return {
    orders: num(r.pedidos),
    soldUsd: r2(num(r.vendido_total)),
    real: {
      refundUsd: r2(num(r.re_real)), chargebackUsd: r2(num(r.cb_real)), alertsUsd: r2(num(r.al_real)),
      feesUsd: r2(num(r.tx_real)), totalUsd: r2(num(r.total_real)),
    },
    forecast: withForecast > 0 ? {
      orders: withForecast, soldUsd: r2(num(r.vendido)),
      refundUsd: r2(num(r.reembolso)), chargebackUsd: r2(num(r.chargeback)), alertsUsd: r2(num(r.alertas)),
      feesUsd: r2(num(r.taxas)), totalUsd: r2(num(r.total)), closedTotalUsd: r2(num(r.total_fechado)),
    } : null,
  };
}

export function d60Map(rows: D60DbRow[]): Map<string, AffiliateRefundD60> {
  const m = new Map<string, AffiliateRefundD60>();
  for (const r of rows) m.set(d60Key(r.slug, r.aff), rowToD60(r));
  return m;
}

const SOMAVEIS: Array<Exclude<keyof D60DbRow, 'slug' | 'aff'>> = [
  'pedidos', 'vendido_total', 're_real', 'cb_real', 'al_real', 'tx_real', 'total_real',
  'com_previsao', 'vendido', 'reembolso', 'chargeback', 'alertas', 'taxas', 'total', 'total_fechado',
];

/** Total de todas as contas a partir das linhas do banco: soma sem arredondar e arredonda uma vez (bate ao centavo). */
export function totalsFromRows(rows: D60DbRow[]): AffiliateRefundD60 | null {
  if (!rows.length) return null;
  const t = { slug: '', aff: '' } as D60DbRow;
  for (const k of SOMAVEIS) t[k] = rows.reduce((n, r) => n + num(r[k]), 0);
  return rowToD60(t);
}

const sumParts = <T extends D60Parts>(xs: T[], f: (x: T) => number) => r2(xs.reduce((n, x) => n + f(x), 0));

/** Soma várias contas (linha do parceiro). Nenhuma conta com D60 = null. */
export function sumD60(list: Array<AffiliateRefundD60 | null | undefined>): AffiliateRefundD60 | null {
  const xs = list.filter((x): x is AffiliateRefundD60 => !!x);
  if (!xs.length) return null;
  const rs = xs.map((x) => x.real);
  const fs = xs.map((x) => x.forecast).filter((x): x is D60Forecast => !!x);
  return {
    orders: xs.reduce((n, x) => n + x.orders, 0),
    soldUsd: r2(xs.reduce((n, x) => n + x.soldUsd, 0)),
    real: {
      refundUsd: sumParts(rs, (x) => x.refundUsd), chargebackUsd: sumParts(rs, (x) => x.chargebackUsd),
      alertsUsd: sumParts(rs, (x) => x.alertsUsd), feesUsd: sumParts(rs, (x) => x.feesUsd), totalUsd: sumParts(rs, (x) => x.totalUsd),
    },
    forecast: fs.length ? {
      orders: fs.reduce((n, x) => n + x.orders, 0), soldUsd: sumParts(fs, (x) => x.soldUsd),
      refundUsd: sumParts(fs, (x) => x.refundUsd), chargebackUsd: sumParts(fs, (x) => x.chargebackUsd),
      alertsUsd: sumParts(fs, (x) => x.alertsUsd), feesUsd: sumParts(fs, (x) => x.feesUsd),
      totalUsd: sumParts(fs, (x) => x.totalUsd), closedTotalUsd: sumParts(fs, (x) => x.closedTotalUsd),
    } : null,
  };
}

/** Devol. Total prevista ÷ vendido com previsão (null sem previsão). */
export function forecastTotalPct(d: AffiliateRefundD60 | null | undefined): number | null {
  return d?.forecast && d.forecast.soldUsd > 0 ? d.forecast.totalUsd / d.forecast.soldUsd : null;
}
