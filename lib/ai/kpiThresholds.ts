// Limiares de KPI que a IA usa pra chamar um número de bom/atenção/ruim —
// os MESMOS da tela. A tela (public/src/pages/overview.jsx: KPI_THRESHOLDS
// + o monitor 7d do card "Reembolso por pedidos") é JSX clássico sem bundler
// e não importa TS; por isso a fonte da IA vive aqui e o teste
// kpiThresholds.test.ts avalia as funções `state` de lá e compara ponto a
// ponto com classifyKpi daqui. Mexeu num lado sem o outro → teste quebra
// (antes o prompt não tinha limiar nenhum e a IA julgava "no olho").
//
// A régua de CPA (healthyMinUsd/attentionMinUsd, opex%) NÃO está aqui: é
// configuração do admin no banco e chega pela tool get_profit_model.

export type KpiState = 'ok' | 'warn' | 'danger';

type PctUnit = 'fraction' | 'percent';

export interface KpiThreshold {
  /** Nome do KPI como a tela mostra. */
  label: string;
  /**
   * Unidade das fronteiras — a mesma do valor que a TELA compara: fração 0–1
   * ou pontos percentuais (12.3 = 12.3%).
   */
  unit: PctUnit;
  /** Lado bom da régua. */
  better: 'higher' | 'lower';
  /** Fronteira do estado "atenção". */
  warnAt: number;
  /** Fronteira do estado "ruim". */
  dangerAt: number;
  /**
   * true = o valor IGUAL à fronteira já é o estado pior (>= / <=);
   * false = só passa da fronteira (> / <). Espelha exatamente a tela.
   */
  inclusive: boolean;
  /** Onde a IA lê o número (tool.campo)… */
  whereToRead: string;
  /** …e a unidade DESSE campo (pode diferir da tela: o card de reembolso lê valuePct em pontos). */
  fieldUnit: PctUnit;
  /** Observação curta que muda a leitura. */
  note?: string;
}

export const KPI_THRESHOLDS = {
  approvalRate: {
    label: 'Taxa de aprovação',
    unit: 'fraction',
    better: 'higher',
    warnAt: 0.9,
    dangerAt: 0.85,
    inclusive: false,
    whereToRead: 'get_overview.kpis.approvalRate',
    fieldUnit: 'fraction',
    note: 'Meta 90%',
  },
  refundRate: {
    label: 'Taxa de reembolso',
    unit: 'fraction',
    better: 'lower',
    warnAt: 0.08,
    dangerAt: 0.1,
    inclusive: false,
    whereToRead: 'get_profit_split.refunds.valuePct',
    fieldUnit: 'percent',
    note: 'Meta ≤ 8%, lente de VALOR por data do estorno (card "Taxa de reembolso"); a mesma régua vale pra reembolso por afiliado/plataforma',
  },
  cbRate: {
    label: 'Chargeback',
    unit: 'fraction',
    better: 'lower',
    warnAt: 0.01,
    dangerAt: 0.02,
    inclusive: true,
    whereToRead: 'get_overview.kpis.cbRate',
    fieldUnit: 'fraction',
    note: 'Limite 2% (o card acende alerta)',
  },
  estimatedMarginPct: {
    label: 'Margem estimada',
    unit: 'percent',
    better: 'higher',
    warnAt: 10,
    dangerAt: 5,
    inclusive: false,
    whereToRead: 'get_overview.kpis.estimatedMarginPct',
    fieldUnit: 'percent',
  },
  refunds7dPct: {
    label: 'Reembolso por pedidos — monitor 7 dias',
    unit: 'percent',
    better: 'lower',
    warnAt: 8,
    dangerAt: 10,
    inclusive: false,
    whereToRead: 'get_profit_split.refunds7d.pct',
    fieldUnit: 'percent',
    note: 'Janela rolante dos últimos 7 dias a partir de agora, independente do período; > 10% acende o alerta do card',
  },
} as const satisfies Record<string, KpiThreshold>;

export type KpiKey = keyof typeof KPI_THRESHOLDS;

/** Estado de um valor na régua da tela (mesma comparação do overview.jsx). */
export function classifyKpi(key: KpiKey, value: number): KpiState {
  const t: KpiThreshold = KPI_THRESHOLDS[key];
  const past = (edge: number): boolean => {
    if (t.better === 'lower') return t.inclusive ? value >= edge : value > edge;
    return t.inclusive ? value <= edge : value < edge;
  };
  if (past(t.dangerAt)) return 'danger';
  if (past(t.warnAt)) return 'warn';
  return 'ok';
}

/**
 * Convenções de AMOSTRA da análise (não são da tela): abaixo disso o número
 * é provisório e a IA diz isso em vez de concluir. Coorte madura = vendas
 * de 60–150 dias atrás, a mesma janela que calibra o refund&cb% do modelo
 * (profitModel.getObservedRefundCbPct).
 */
export const SAMPLE_MINIMUMS = {
  /** Vendas/FEs mínimas pra chamar uma taxa (aprovação, reembolso, CPA) de conclusiva. */
  salesForRate: 30,
  /** Vendas mínimas numa coorte pra ela não ser ruído. */
  cohortSales: 30,
  /** FEs mínimas por família antes de comparar take rate entre períodos. */
  fesForTakeRate: 50,
  /** Idade (dias) em que uma coorte de reembolso passa a ser madura. */
  matureCohortMinAgeDays: 60,
  matureCohortMaxAgeDays: 150,
} as const;

function fmtEdge(v: number, unit: PctUnit): string {
  const pct = unit === 'fraction' ? v * 100 : v;
  // Formato US do dash: inteiro sem casas (8%), senão 1 casa (8.5%).
  return `${Number.isInteger(Math.round(pct * 1e6) / 1e6) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

function describe(t: KpiThreshold): string {
  const w = fmtEdge(t.warnAt, t.unit);
  const d = fmtEdge(t.dangerAt, t.unit);
  if (t.better === 'higher') {
    const okOp = t.inclusive ? '>' : '≥';
    const badOp = t.inclusive ? '≤' : '<';
    return `ok ${okOp} ${w}; atenção entre ${d} e ${w}; ruim ${badOp} ${d}`;
  }
  const okOp = t.inclusive ? '<' : '≤';
  const badOp = t.inclusive ? '≥' : '>';
  return `ok ${okOp} ${w}; atenção entre ${w} e ${d}; ruim ${badOp} ${d}`;
}

/** Seção "# Limiares" do prompt estável, gerada destas constantes. */
export function renderThresholdsPrompt(): string {
  const lines = (Object.values(KPI_THRESHOLDS) as KpiThreshold[]).map((t) => {
    const unit = t.fieldUnit === 'fraction' ? 'fração 0–1' : 'pontos percentuais';
    return `- ${t.label} (${t.whereToRead}, ${unit}): ${describe(t)}.${t.note ? ` ${t.note}.` : ''}`;
  });
  const s = SAMPLE_MINIMUMS;
  lines.push(
    `- Amostra: < ${s.salesForRate} vendas/FEs = número provisório (diga isso); coorte com < ${s.cohortSales} vendas = ruído; take rate só se compara com ≥ ${s.fesForTakeRate} FEs na família; coorte madura = vendas de ${s.matureCohortMinAgeDays}–${s.matureCohortMaxAgeDays} dias atrás.`,
    '- CPA: use o cpaStatus que a tool devolve (saudavel / atencao / renegociar). A régua (healthyMinUsd, attentionMinUsd), o opex% e fee/refund&cb/reserva por plataforma vêm de get_profit_model — nunca invente a régua.',
    '- Métrica sem limiar: compare com uma base (período anterior equivalente ou média dos últimos 30 dias fechados) e diga qual base usou.',
  );
  return lines.join('\n');
}
