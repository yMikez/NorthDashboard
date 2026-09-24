// Lucro real — núcleo PURO (sem DB). Aba admin-only "Lucro real".
//
// Desde 2026-09-16 segue o CÁLCULO DE MARGEM padronizado
// (calculo_margem_northscale.md): MARGEM DE CONTRIBUIÇÃO da operação, sem
// OPEX fixo, sempre com as mesmas taxas e a mesma lógica.
//
//   PLATAFORMAS (front + recuperação — vendas que passam pela plataforma)
//     Gross − Afiliados (CPA / comissão de recuperação) − Reembolso − Fee
//     − Reserva (allowance) − Produto + fulfillment        → custos variáveis
//     Reembolso, fee, reserva e produto incidem sobre o GROSS (§10.1).
//   BACKEND (call centers Tauk/Logicall + SalesBound)
//     Entra só a PARCELA LÍQUIDA da NorthScale (§10.2):
//       receita NS = (bruto − estornos informados pelo parceiro) × (100 − parcela do parceiro)%
//     Sem custo de produto/reembolso projetado (só se o admin preencher o
//     custo por canal). Estornos do parceiro: decisão 2026-09-16 — a SalesBound
//     estorna ~27%; ignorar inflaria a receita (toggle backendNetOfRefunds).
//   TOTAL
//     receita econômica  = gross das plataformas + Σ receita NS do backend (§3)
//     lucro contribuição = receita econômica − custos variáveis (§5)
//     margem OFICIAL     = lucro ÷ receita econômica (§6); sobre o gross das
//                          plataformas fica como leitura secundária
//     lucro por FE       = lucro ÷ nº de FEs (§7); CPA médio = afiliados ÷ FEs
//     buffer de risco    = % da receita econômica, linha SEPARADA (§9)
//
// Toda porcentagem aqui é PERCENTUAL 0–100 (como Platform.feeRatePct).
// Parâmetros nulos caem no valor observado/configurado, e a linha diz de
// onde o número veio (`source`). `inputs` vem do banco (netProfit.ts) e é
// reutilizado a cada recálculo — mudar um parâmetro é só rodar de novo.

export type FrontStage = 'FRONTEND' | 'UPSELL' | 'DOWNSELL' | 'BUMP' | 'SMS_RECOVERY';
export const FRONT_STAGES: FrontStage[] = ['FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP', 'SMS_RECOVERY'];
export const STAGE_LABELS: Record<FrontStage, string> = {
  FRONTEND: 'Front-end', UPSELL: 'Upsell', DOWNSELL: 'Downsell', BUMP: 'Bump', SMS_RECOVERY: 'Recovery (funil)',
};

export type ChannelKey = 'front' | 'callcenter' | 'recovery' | 'salesbound';
export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  front: 'Front-end / Plataformas', callcenter: 'Call centers', recovery: 'Recuperação (e-mail/SMS)', salesbound: 'SalesBound',
};
export const BACKEND_CHANNELS: ChannelKey[] = ['callcenter', 'salesbound'];

export interface StageAgg { gross: number; cpa: number; orders: number; cogs: number; fulfillment: number }
export const emptyStage = (): StageAgg => ({ gross: 0, cpa: 0, orders: 0, cogs: 0, fulfillment: 0 });
export const emptyStages = (): Record<FrontStage, StageAgg> => ({
  FRONTEND: emptyStage(), UPSELL: emptyStage(), DOWNSELL: emptyStage(), BUMP: emptyStage(), SMS_RECOVERY: emptyStage(),
});

// ---------------------------------------------------------------------
// INPUTS (medidos no banco)
// ---------------------------------------------------------------------
export interface PlatformFrontInput {
  slug: string;
  displayName: string;
  feePct: number | null;        // Platform.feeRatePct (cadastro em Plataformas)
  allowancePct: number | null;  // Platform.allowancePct
  refundCbPctModel: number;     // % do modelo CPA (referência)
  // Vendas APROVADAS do período (orderedAt) SEM as fontes de back
  // (afiliados de recuperação e SMS próprio) — por etapa do funil.
  byStage: Record<FrontStage, StageAgg>;
  // As mesmas vendas quando são de afiliado de recuperação / SMS próprio
  // (entram no front só se dedupeRecovery = false). `feOrders` = etapa FRONTEND.
  recovery: StageAgg & { feOrders?: number };
  sms: StageAgg & { feOrders?: number };
  // |$ devolvido| por data do ESTORNO (refundedAt/chargebackAt) no período.
  refundsObserved: { front: number; recovery: number; sms: number };
}

export interface CallCenterProviderInput {
  provider: 'tauk' | 'logicall';
  label: string;
  configured: boolean;
  gross: number;            // APPROVED amountUsd, purchasedAt no período
  sales: number;
  refundsObserved: number;  // estornos totais (refundedAt no período) + parciais
  refundsReported: boolean; // o parceiro informa estorno? (Tauk não)
  commissionPct: number;    // % (do IntegrationSetting/env/default)
  commissionAssumed: boolean;
}

export interface RecoveryAffiliateInput {
  affiliateId: string;
  externalId: string;
  nickname: string | null;
  platformSlug: string;
  gross: number;
  orders: number;
  feOrders: number;
  cogs: number;
  fulfillment: number;
  commissionUsd: number;    // já resolvida pelos períodos de taxa (RecoveryRatePeriod)
  currentPct: number;       // % vigente
  refundsObserved: number;
}

export interface AffiliateInput {
  affiliateId: string;
  externalId: string;
  nickname: string | null;
  platformSlug: string;
  mappedName: string | null; // NorthScale Afiliados
  byStage: Record<FrontStage, StageAgg>;
  refundsObserved: number;
}

// Vendas de FRONT (mesmo escopo do canal) por família de produto × plataforma.
export interface ProductInput {
  family: string;           // '—' = sem família no catálogo
  byPlatform: Array<{ slug: string; byStage: Record<FrontStage, StageAgg>; refundsObserved: number }>;
}

export interface SalesboundMeasuredInput {
  gross: number;
  sales: number;
  refunds: number;
  refundsCohort?: number;
  voids?: number;
  // Duas fontes no mesmo razão: export CSV (venda + estorno + void) e webhook
  // do CRM (só venda — eles não mandam tipo de evento).
  coverage?: { firstAt: string; lastAt: string; importedAt: string; csvLastAt?: string | null; webhookLastAt?: string | null; webhookCount?: number };
}

export interface NetProfitInputs {
  period: { start: string; end: string };
  platforms: PlatformFrontInput[];
  callcenters: CallCenterProviderInput[];
  recoveryAffiliates: RecoveryAffiliateInput[];
  // SMS próprio (Mautic/Twilio, trafficSource=smsbrdcst): custo do Twilio
  // não passa pelo dash — comissão configurável (default 0). Fee/reserva
  // saem de platforms[].sms (cada plataforma com a sua taxa).
  sms: { gross: number; orders: number; feOrders?: number; cogs: number; fulfillment: number; refundsObserved: number };
  affiliates: AffiliateInput[];        // contas de FRONT (afiliados de recuperação ficam em recoveryAffiliates)
  products?: ProductInput[];
  // Razão importado do export do CRM da SalesBound; null = nunca importado.
  salesbound: { measured: SalesboundMeasuredInput | null };
  // Modelo CPA (planilha): só o opex% global entra aqui — fee, reserva e
  // refund&cb% do modelo já vêm por plataforma em PlatformFrontInput.
  profitModel?: { opexPct: number };
}

// ---------------------------------------------------------------------
// PARÂMETROS (editáveis pelo admin; null = usar observado/configurado)
// ---------------------------------------------------------------------
export interface NetProfitParams {
  refundMode: 'observed' | 'manual';
  // % projetado sobre o gross das PLATAFORMAS (§10.1). Recuperação vazio =
  // mesmo % do front. Backend não recebe % projetado.
  refundPct: { front: number | null; recovery: number | null };
  // Custo de produto ÚNICO (front, upsell, downsell, bump e recuperação — "a
  // etapa inicial, uma coisa só", decisão 2026-09-16). Campos por etapa/canal
  // só sobrescrevem se preenchidos. Backend: só se preenchido por canal.
  productCostDefaultPct: number | null;
  productCostPct: {
    front: Record<FrontStage, number | null>;
    callcenter: number | null;
    recovery: number | null;
    salesbound: number | null;
  };
  feePctOverride: Record<string, number | null>;         // por plataforma (slug)
  allowancePctOverride: Record<string, number | null>;
  includeAllowance: boolean;
  // Parcela do PARCEIRO (%): a NorthScale fica com 100 − isso.
  commissionPct: {
    tauk: number | null;            // null = setting/env/default
    logicall: number | null;
    sms: number | null;             // default 0
    salesbound: number | null;
    recoveryOverride: number | null; // null = taxa de cada afiliado (RecoveryRatePeriod)
  };
  salesbound: { grossUsd: number; sales: number | null; refundsUsd: number | null }; // manual enquanto não há export importado
  backendNetOfRefunds: boolean;     // parcela NS calculada sobre bruto − estornos do parceiro
  riskBufferPct: number | null;     // % da receita econômica (§9); null/0 = desligado
  dedupeRecovery: boolean;          // subtrai recuperação/SMS do front (evita dupla contagem)
}

export function defaultParams(): NetProfitParams {
  return {
    refundMode: 'observed',
    refundPct: { front: null, recovery: null },
    productCostDefaultPct: null,
    productCostPct: { front: { FRONTEND: null, UPSELL: null, DOWNSELL: null, BUMP: null, SMS_RECOVERY: null }, callcenter: null, recovery: null, salesbound: null },
    feePctOverride: {},
    allowancePctOverride: {},
    includeAllowance: true,
    commissionPct: { tauk: null, logicall: null, sms: 0, salesbound: null, recoveryOverride: null },
    salesbound: { grossUsd: 0, sales: null, refundsUsd: null },
    backendNetOfRefunds: true,
    riskBufferPct: null,
    dedupeRecovery: true,
  };
}

const pctOrNull = (v: unknown, max = 100): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null;
};
const usdOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/** Sanitiza um JSON vindo do banco/UI pra NetProfitParams (nunca lança). */
export function normalizeParams(raw: unknown): NetProfitParams {
  const d = defaultParams();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const rp = obj(r.refundPct);
  const pc = obj(r.productCostPct);
  const pcf = obj(pc.front);
  const cm = obj(r.commissionPct);
  const sb = obj(r.salesbound);
  const overrides = (v: unknown): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const [k, val] of Object.entries(obj(v))) {
      const p = pctOrNull(val);
      if (p != null && /^[a-z0-9_-]{1,40}$/.test(k)) out[k] = p;
    }
    return out;
  };
  const front = { ...d.productCostPct.front };
  for (const s of FRONT_STAGES) front[s] = pctOrNull(pcf[s]);
  return {
    refundMode: r.refundMode === 'manual' ? 'manual' : 'observed',
    refundPct: { front: pctOrNull(rp.front), recovery: pctOrNull(rp.recovery) },
    productCostDefaultPct: pctOrNull(r.productCostDefaultPct),
    productCostPct: { front, callcenter: pctOrNull(pc.callcenter), recovery: pctOrNull(pc.recovery), salesbound: pctOrNull(pc.salesbound) },
    feePctOverride: overrides(r.feePctOverride),
    allowancePctOverride: overrides(r.allowancePctOverride),
    includeAllowance: r.includeAllowance !== false,
    commissionPct: {
      tauk: pctOrNull(cm.tauk), logicall: pctOrNull(cm.logicall),
      sms: pctOrNull(cm.sms) ?? 0, salesbound: pctOrNull(cm.salesbound), recoveryOverride: pctOrNull(cm.recoveryOverride),
    },
    salesbound: { grossUsd: usdOrNull(sb.grossUsd) ?? 0, sales: usdOrNull(sb.sales), refundsUsd: usdOrNull(sb.refundsUsd) },
    backendNetOfRefunds: r.backendNetOfRefunds !== false,
    riskBufferPct: pctOrNull(r.riskBufferPct, 50),
    dedupeRecovery: r.dedupeRecovery !== false,
  };
}

// ---------------------------------------------------------------------
// RESULTADO
// ---------------------------------------------------------------------
export type LineSource = 'observed' | 'manual' | 'config' | 'default' | 'none';
// cost  = custo variável da NorthScale (entra nos custos, §4)
// share = não é receita da NorthScale (parcela do parceiro, estorno do
//         parceiro) — sai do bruto ANTES da receita econômica (§10.2)
export type LineKind = 'cost' | 'share';
export interface Line {
  key: string;
  label: string;
  usd: number;                 // valor POSITIVO da dedução
  pctOfGross: number | null;   // % do bruto da linha-mãe
  source: LineSource;
  kind: LineKind;
  note?: string;
}
export interface Breakdown {
  key: string;
  label: string;
  gross: number;
  orders: number;
  lines: Line[];
  revenue: number;             // receita econômica (bruto − linhas share)
  profit: number;
  marginPct: number;           // lucro ÷ receita econômica
}
export interface ChannelResult {
  key: ChannelKey;
  label: string;
  type: 'platform' | 'backend';
  gross: number;               // bruto
  orders: number;
  fes: number;
  revenue: number;             // receita econômica (plataforma: = bruto; backend: parcela NS)
  costs: number;               // custos variáveis
  lines: Line[];               // somadas dos breakdowns, na ordem da fórmula
  profit: number;
  marginPct: number;           // lucro ÷ receita econômica
  shareOfRevenuePct: number;   // da receita econômica total
  shareOfProfitPct: number;
  breakdown: Breakdown[];
  available: boolean;          // false = sem dado nem parâmetro manual
}
export interface AffiliateResult {
  affiliateId: string;
  externalId: string;
  nickname: string | null;
  platformSlug: string;
  mappedName: string | null;
  channel: 'front' | 'recovery';
  gross: number;
  orders: number;
  fes: number;
  cpa: number;                 // front: CPA pago; recovery: comissão
  refund: number;
  fee: number;
  productCost: number;
  allowance: number;
  profit: number;
  marginPct: number;
  profitPerFe: number | null;
  // PROJEÇÃO (modelo CPA da planilha, pedido 2026-09-23): o que o faturamento
  // deste afiliado DEVE deixar de lucro pra operação —
  //   NET AOV = AOV × (1 − refund&cb% do modelo − fee − opex% − reserva)
  //   projeção/FE = NET AOV − CPA por FE (recuperação: comissão por FE)
  //   projeção = projeção/FE × FEs
  // Difere do `profit` acima em duas premissas: o reembolso é a taxa do
  // MODELO (por plataforma, calibrada em coorte madura) em vez do parâmetro
  // da aba, e o custo é o opex% global em vez do custo de produto %.
  projection: number | null;          // só o FRONT (modelo CPA)
  projectionPerFe: number | null;
  // O que esses clientes ainda rendem no BACKEND (call centers + SalesBound):
  // lucro do backend no período ÷ FEs de plataforma × FEs do afiliado. É a
  // taxa da operação inteira — o backend não é atribuído por afiliado.
  backendProjection: number | null;
  // Projeção TOTAL = front (modelo CPA) + backend. É o número da coluna
  // "Projeção": o que o faturamento do afiliado vai deixar de lucro pra
  // operação (pedido do usuário, 2026-09-23).
  projectionTotal: number | null;
  projectionTotalPerFe: number | null;
  shareOfRevenuePct: number;   // da receita econômica TOTAL
  shareOfChannelPct: number;   // do bruto do próprio canal
}
export interface ProductResult {
  family: string;
  gross: number;
  orders: number;
  fes: number;
  cpa: number;
  refund: number;
  fee: number;
  productCost: number;
  allowance: number;
  profit: number;
  marginPct: number;
  profitPerFe: number | null;
  shareOfFrontPct: number;
}
export interface NetProfitKpis {
  revenue: number;             // RECEITA ECONÔMICA (§3)
  grossTotal: number;          // bruto de todos os canais (antes da parcela dos parceiros)
  platformGross: number;       // gross das plataformas (front + recuperação) — "gross principal"
  backendNet: number;          // Σ parcela NorthScale do backend
  costs: number;               // custos variáveis (§4)
  profit: number;              // lucro de contribuição (§5)
  marginPct: number;           // OFICIAL: lucro ÷ receita econômica (§6)
  marginOnGrossPct: number;    // lucro ÷ gross das plataformas (§6, leitura secundária)
  fes: number;
  profitPerFe: number | null;  // §7
  affiliateCost: number;       // CPA + comissões de recuperação
  cpaAvg: number | null;       // §2.1
  // Lucro do backend (call centers + SalesBound) por FE de plataforma —
  // a taxa usada na projeção por afiliado.
  backendPerFe: number | null;
  buffer: { pct: number; usd: number; adjustedProfit: number; adjustedMarginPct: number } | null; // §9
}
export interface NetProfitResult {
  kpis: NetProfitKpis;
  channels: ChannelResult[];
  affiliates: AffiliateResult[];
  products: ProductResult[];
  // % REAL observado de custo de produto (COGS + frete dos snapshots ÷
  // faturamento) — o que os parâmetros nulos usam e a sugestão da UI.
  observedProductCostPct: { front: Record<FrontStage, number | null>; recovery: number | null; sms: number | null };
  salesbound: { mode: 'measured' | 'manual' | 'none'; coverage: SalesboundMeasuredInput['coverage'] | null; voids: number; refundsCohort: number | null };
  warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pctOf = (part: number, whole: number): number => (whole > 0 ? r2((part / whole) * 100) : 0);
const line = (key: string, label: string, usd: number, gross: number, source: LineSource, kind: LineKind, note?: string): Line => ({
  key, label, usd: r2(usd), pctOfGross: gross > 0 ? r2((usd / gross) * 100) : null, source, kind, ...(note ? { note } : {}),
});
const sumStages = (s: Record<FrontStage, StageAgg>): StageAgg => FRONT_STAGES.reduce((a, k) => ({
  gross: a.gross + s[k].gross, cpa: a.cpa + s[k].cpa, orders: a.orders + s[k].orders, cogs: a.cogs + s[k].cogs, fulfillment: a.fulfillment + s[k].fulfillment,
}), emptyStage());
const addStage = (a: StageAgg, b: StageAgg): StageAgg => ({ gross: a.gross + b.gross, cpa: a.cpa + b.cpa, orders: a.orders + b.orders, cogs: a.cogs + b.cogs, fulfillment: a.fulfillment + b.fulfillment });

function observedProductCost(inputs: NetProfitInputs): NetProfitResult['observedProductCostPct'] {
  const front = {} as Record<FrontStage, number | null>;
  for (const s of FRONT_STAGES) {
    let gross = 0, cost = 0;
    for (const p of inputs.platforms) { gross += p.byStage[s].gross; cost += p.byStage[s].cogs + p.byStage[s].fulfillment; }
    front[s] = gross > 0 ? r2((cost / gross) * 100) : null;
  }
  let rg = 0, rc = 0;
  for (const a of inputs.recoveryAffiliates) { rg += a.gross; rc += a.cogs + a.fulfillment; }
  const sms = inputs.sms.gross > 0 ? r2(((inputs.sms.cogs + inputs.sms.fulfillment) / inputs.sms.gross) * 100) : null;
  return { front, recovery: rg > 0 ? r2((rc / rg) * 100) : null, sms };
}

/** Deduções somadas por `key` (mesma ordem da primeira ocorrência). */
function sumLines(groups: Line[][]): Line[] {
  const order: string[] = [];
  const acc = new Map<string, { label: string; usd: number; kind: LineKind; sources: Set<LineSource>; notes: Set<string> }>();
  for (const lines of groups) for (const l of lines) {
    let a = acc.get(l.key);
    if (!a) { a = { label: l.label, usd: 0, kind: l.kind, sources: new Set(), notes: new Set() }; acc.set(l.key, a); order.push(l.key); }
    a.usd += l.usd; a.sources.add(l.source); if (l.note) a.notes.add(l.note);
  }
  return order.map((k) => {
    const a = acc.get(k)!;
    const source: LineSource = a.sources.size === 1 ? [...a.sources][0] : 'config';
    return { key: k, label: a.label, usd: r2(a.usd), pctOfGross: null, source, kind: a.kind, ...(a.notes.size ? { note: [...a.notes].join(' · ') } : {}) };
  });
}

const sumKind = (lines: Line[], kind: LineKind) => lines.reduce((s, l) => s + (l.kind === kind ? l.usd : 0), 0);

function finishBreakdown(key: string, label: string, gross: number, orders: number, lines: Line[]): Breakdown {
  const revenue = r2(gross - sumKind(lines, 'share'));
  const profit = r2(revenue - sumKind(lines, 'cost'));
  return { key, label, gross: r2(gross), orders, lines, revenue, profit, marginPct: pctOf(profit, revenue) };
}

type PartialChannel = Omit<ChannelResult, 'shareOfRevenuePct' | 'shareOfProfitPct'>;
function finishChannel(key: ChannelKey, breakdown: Breakdown[], available: boolean, fes: number): PartialChannel {
  const gross = r2(breakdown.reduce((s, b) => s + b.gross, 0));
  const orders = breakdown.reduce((s, b) => s + b.orders, 0);
  const lines = sumLines(breakdown.map((b) => b.lines)).map((l) => ({ ...l, pctOfGross: gross > 0 ? r2((l.usd / gross) * 100) : null }));
  const revenue = r2(gross - sumKind(lines, 'share'));
  const costs = r2(sumKind(lines, 'cost'));
  const profit = r2(revenue - costs);
  return {
    key, label: CHANNEL_LABELS[key], type: BACKEND_CHANNELS.includes(key) ? 'backend' : 'platform',
    gross, orders, fes, revenue, costs, lines, profit, marginPct: pctOf(profit, revenue), breakdown, available,
  };
}

// ---------------------------------------------------------------------
// CÁLCULO
// ---------------------------------------------------------------------
export function computeNetProfit(inputs: NetProfitInputs, params: NetProfitParams): NetProfitResult {
  const warnings: string[] = [];
  const observed = observedProductCost(inputs);
  const manualRefund = params.refundMode === 'manual';
  const refundPctFront = (): number => {
    const v = params.refundPct.front;
    if (v == null) { warnings.push('Reembolso manual sem % definido para as plataformas — usando 0%.'); return 0; }
    return v;
  };
  const refundPctRecovery = (): number => params.refundPct.recovery ?? refundPctFront();
  const platBySlug = new Map(inputs.platforms.map((p) => [p.slug, p]));
  const feeFor = (slug: string): { pct: number | null; source: LineSource } => {
    const o = params.feePctOverride[slug];
    if (o != null) return { pct: o, source: 'manual' };
    const c = platBySlug.get(slug)?.feePct ?? null;
    return { pct: c, source: c == null ? 'none' : 'config' };
  };
  const allowanceFor = (slug: string): { pct: number | null; source: LineSource } => {
    const o = params.allowancePctOverride[slug];
    if (o != null) return { pct: o, source: 'manual' };
    const c = platBySlug.get(slug)?.allowancePct ?? null;
    return { pct: c, source: c == null ? 'none' : 'config' };
  };

  // Custo de produto das plataformas por etapa: parâmetro > % único > observado > 0.
  const dflt = params.productCostDefaultPct;
  const frontCostPct = (s: FrontStage): { pct: number; source: LineSource } => {
    const p = params.productCostPct.front[s] ?? dflt;
    if (p != null) return { pct: p, source: 'manual' };
    const o = observed.front[s];
    return o != null ? { pct: o, source: 'observed' } : { pct: 0, source: 'none' };
  };
  const frontCostForStages = (stages: Record<FrontStage, StageAgg>): { usd: number; sources: Set<LineSource> } => {
    let usd = 0; const sources = new Set<LineSource>();
    for (const s of FRONT_STAGES) {
      if (stages[s].gross <= 0) continue;
      const { pct, source } = frontCostPct(s);
      usd += stages[s].gross * (pct / 100); sources.add(source);
    }
    return { usd, sources };
  };
  const oneSource = (set: Set<LineSource>): LineSource => (set.size === 0 ? 'none' : set.size === 1 ? [...set][0] : 'config');

  // Fatia de PLATAFORMA (mesma fórmula pra canal, afiliado e produto):
  // Gross − CPA − Reembolso − Fee − Produto − Reserva.
  const frontSlice = (slug: string, stages: Record<FrontStage, StageAgg>, refundsObserved: number) => {
    const tot = sumStages(stages);
    const fee = feeFor(slug);
    const allow = allowanceFor(slug);
    const refund = manualRefund ? tot.gross * (refundPctFront() / 100) : refundsObserved;
    const cost = frontCostForStages(stages);
    return {
      tot, fee, allow, refund, cost,
      feeUsd: fee.pct != null ? tot.gross * (fee.pct / 100) : 0,
      allowanceUsd: params.includeAllowance && allow.pct != null ? tot.gross * (allow.pct / 100) : 0,
    };
  };

  // ── FRONT por plataforma ─────────────────────────────────────────────
  const frontBreakdown: Breakdown[] = [];
  let frontFes = 0;
  for (const p of inputs.platforms) {
    // Sem dedupe, vendas de recuperação/SMS entram no front (dupla contagem
    // deliberada — o toggle existe pra quem quer ver o bruto "como a
    // plataforma mostra").
    const stages = emptyStages();
    for (const s of FRONT_STAGES) stages[s] = { ...p.byStage[s] };
    if (!params.dedupeRecovery) {
      stages.FRONTEND = addStage(stages.FRONTEND, addStage(p.recovery, p.sms));
    }
    const refundsObs = p.refundsObserved.front + (params.dedupeRecovery ? 0 : p.refundsObserved.recovery + p.refundsObserved.sms);
    const f = frontSlice(p.slug, stages, refundsObs);
    if (f.tot.gross <= 0 && f.tot.orders === 0) continue;
    frontFes += stages.FRONTEND.orders;
    const lines: Line[] = [
      line('cpa', 'Afiliados (CPA pago)', f.tot.cpa, f.tot.gross, 'observed', 'cost'),
      line('refund', 'Reembolso + chargeback', f.refund, f.tot.gross, manualRefund ? 'manual' : 'observed', 'cost', manualRefund ? 'projetado sobre o gross' : 'por data do estorno'),
      line('fee', 'Fee da plataforma', f.feeUsd, f.tot.gross, f.fee.source, 'cost', f.fee.pct == null ? 'taxa não cadastrada em Plataformas' : `${f.fee.pct}%`),
      line('product', 'Produto + fulfillment', f.cost.usd, f.tot.gross, oneSource(f.cost.sources), 'cost'),
    ];
    if (params.includeAllowance) {
      lines.push(line('allowance', 'Reserva (allowance)', f.allowanceUsd, f.tot.gross, f.allow.source, 'cost', f.allow.pct == null ? 'reserva não cadastrada' : `${f.allow.pct}%`));
    }
    if (f.fee.pct == null) warnings.push(`${p.displayName}: taxa da plataforma não cadastrada (Plataformas → Editar).`);
    frontBreakdown.push(finishBreakdown(p.slug, p.displayName, f.tot.gross, f.tot.orders, lines));
  }
  const front = finishChannel('front', frontBreakdown, frontBreakdown.length > 0, frontFes);

  // ── RECUPERAÇÃO: parceiros (Skill99…) + SMS próprio ──────────────────
  // São vendas de plataforma: mesma fórmula do front, comissão no lugar do CPA.
  const recBreakdown: Breakdown[] = [];
  const recManual = params.productCostPct.recovery ?? dflt;
  const recCostPct = recManual ?? observed.recovery ?? observed.front.FRONTEND ?? 0;
  const recCostSource: LineSource = recManual != null ? 'manual' : observed.recovery != null || observed.front.FRONTEND != null ? 'observed' : 'none';
  const recoveryCommission = (a: RecoveryAffiliateInput) => (params.commissionPct.recoveryOverride != null ? a.gross * (params.commissionPct.recoveryOverride / 100) : a.commissionUsd);
  const recoverySlice = (slug: string, gross: number, refundsObserved: number) => {
    const fee = feeFor(slug); const allow = allowanceFor(slug);
    return {
      fee, allow,
      feeUsd: fee.pct != null ? gross * (fee.pct / 100) : 0,
      allowanceUsd: params.includeAllowance && allow.pct != null ? gross * (allow.pct / 100) : 0,
      refund: manualRefund ? gross * (refundPctRecovery() / 100) : refundsObserved,
    };
  };
  let recFes = 0;
  for (const a of inputs.recoveryAffiliates) {
    if (a.gross <= 0 && a.orders === 0) continue;
    recFes += a.feOrders;
    const s = recoverySlice(a.platformSlug, a.gross, a.refundsObserved);
    const lines: Line[] = [
      line('commission', 'Afiliados (comissão de recuperação)', recoveryCommission(a), a.gross, params.commissionPct.recoveryOverride != null ? 'manual' : 'config', 'cost', params.commissionPct.recoveryOverride != null ? `${params.commissionPct.recoveryOverride}%` : `${r2(a.currentPct)}% vigente`),
      line('refund', 'Reembolso + chargeback', s.refund, a.gross, manualRefund ? 'manual' : 'observed', 'cost'),
      line('fee', 'Fee da plataforma', s.feeUsd, a.gross, s.fee.source, 'cost', s.fee.pct != null ? `${s.fee.pct}%` : undefined),
      line('product', 'Produto + fulfillment', a.gross * (recCostPct / 100), a.gross, recCostSource, 'cost', `${r2(recCostPct)}%`),
    ];
    if (params.includeAllowance) lines.push(line('allowance', 'Reserva (allowance)', s.allowanceUsd, a.gross, s.allow.source, 'cost', s.allow.pct != null ? `${s.allow.pct}%` : undefined));
    recBreakdown.push(finishBreakdown(`aff:${a.affiliateId}`, `${a.nickname || a.externalId} · ${a.platformSlug}`, a.gross, a.orders, lines));
  }
  if (inputs.sms.gross > 0 || inputs.sms.orders > 0) {
    const g = inputs.sms.gross;
    const smsPct = params.commissionPct.sms ?? 0;
    const smsCostPct = recManual ?? observed.sms ?? observed.front.FRONTEND ?? 0;
    // fee/reserva por plataforma de origem das vendas SMS
    let feeUsd = 0, allowanceUsd = 0;
    for (const p of inputs.platforms) {
      if (p.sms.gross <= 0) continue;
      const s = recoverySlice(p.slug, p.sms.gross, 0);
      feeUsd += s.feeUsd; allowanceUsd += s.allowanceUsd;
    }
    recFes += inputs.sms.feOrders ?? 0;
    const lines: Line[] = [
      line('commission', 'Afiliados (comissão de recuperação)', g * (smsPct / 100), g, smsPct > 0 ? 'manual' : 'default', 'cost', `${smsPct}% (SMS próprio)`),
      line('refund', 'Reembolso + chargeback', manualRefund ? g * (refundPctRecovery() / 100) : inputs.sms.refundsObserved, g, manualRefund ? 'manual' : 'observed', 'cost'),
      line('fee', 'Fee da plataforma', feeUsd, g, 'config', 'cost'),
      line('product', 'Produto + fulfillment', g * (smsCostPct / 100), g, recManual != null ? 'manual' : 'observed', 'cost', `${r2(smsCostPct)}%`),
    ];
    if (params.includeAllowance) lines.push(line('allowance', 'Reserva (allowance)', allowanceUsd, g, 'config', 'cost'));
    recBreakdown.push(finishBreakdown('sms', 'SMS próprio (Mautic/Twilio)', g, inputs.sms.orders, lines));
  }
  const recovery = finishChannel('recovery', recBreakdown, recBreakdown.length > 0, recFes);

  // ── BACKEND: parcela líquida da NorthScale ───────────────────────────
  const backendLines = (gross: number, refunds: number, refundSource: LineSource, refundNote: string | undefined, partnerPct: number, partnerSource: LineSource, partnerNote: string, costPct: number | null): Line[] => {
    const refundUsd = params.backendNetOfRefunds ? Math.min(refunds, gross) : 0;
    const base = gross - refundUsd;
    const lines: Line[] = [];
    if (params.backendNetOfRefunds) lines.push(line('refund', 'Estornos informados pelo parceiro', refundUsd, gross, refundSource, 'share', refundNote));
    lines.push(line('commission', 'Parcela do parceiro', base * (partnerPct / 100), gross, partnerSource, 'share', partnerNote));
    if (costPct != null && costPct > 0) lines.push(line('product', 'Produto + fulfillment', base * (costPct / 100), gross, 'manual', 'cost', `${costPct}% (por canal)`));
    return lines;
  };

  // Call centers
  const ccBreakdown: Breakdown[] = [];
  for (const c of inputs.callcenters) {
    if (!c.configured && c.gross === 0) continue;
    const pct = params.commissionPct[c.provider] ?? c.commissionPct;
    const src: LineSource = params.commissionPct[c.provider] != null ? 'manual' : 'config';
    const note = `${pct}%${c.commissionAssumed && params.commissionPct[c.provider] == null ? ' (assumida)' : ''} · NS fica com ${r2(100 - pct)}%`;
    const lines = backendLines(c.gross, c.refundsObserved, c.refundsReported ? 'observed' : 'none', c.refundsReported ? undefined : 'parceiro não informa estorno', pct, src, note, params.productCostPct.callcenter);
    ccBreakdown.push(finishBreakdown(c.provider, c.label, c.gross, c.sales, lines));
  }
  const callcenter = finishChannel('callcenter', ccBreakdown, ccBreakdown.length > 0, 0);

  // SalesBound: razão importado (export do CRM) ou manual
  const sbBreakdown: Breakdown[] = [];
  const sbMeasured = inputs.salesbound.measured;
  const sbGross = sbMeasured ? sbMeasured.gross : params.salesbound.grossUsd;
  const sbSales = sbMeasured ? sbMeasured.sales : (params.salesbound.sales ?? 0);
  if (sbGross > 0 || (sbMeasured && sbSales > 0)) {
    const sbPct = params.commissionPct.salesbound;
    const refunds = sbMeasured ? sbMeasured.refunds : (params.salesbound.refundsUsd ?? 0);
    const note = sbPct != null ? `${sbPct}% · NS fica com ${r2(100 - sbPct)}%` : 'parcela não informada';
    const lines = backendLines(sbGross, refunds, sbMeasured ? 'observed' : 'manual', sbMeasured ? 'export do CRM, por data do estorno' : undefined, sbPct ?? 0, sbPct != null ? 'manual' : 'none', note, params.productCostPct.salesbound);
    if (sbPct == null) warnings.push('SalesBound: parcela do parceiro (%) não informada — usando 0%.');
    sbBreakdown.push(finishBreakdown('salesbound', sbMeasured ? 'SalesBound (export do CRM)' : 'SalesBound (manual)', sbGross, sbSales, lines));
  }
  const salesbound = finishChannel('salesbound', sbBreakdown, sbBreakdown.length > 0, 0);
  if (sbMeasured?.coverage && Date.parse(inputs.period.end) > Date.parse(sbMeasured.coverage.lastAt) + 36 * 3600_000 && Date.parse(inputs.period.start) <= Date.now()) {
    warnings.push(`SalesBound: o export importado vai até ${sbMeasured.coverage.lastAt.slice(0, 10)} — dias depois disso estão sem venda SalesBound.`);
  }

  // ── Totais (§3–§9) ──────────────────────────────────────────────────
  const partial = [front, callcenter, recovery, salesbound];
  const revenue = r2(partial.reduce((s, c) => s + c.revenue, 0));
  const costs = r2(partial.reduce((s, c) => s + c.costs, 0));
  const profit = r2(revenue - costs);
  const platformGross = r2(front.gross + recovery.gross);
  const backendNet = r2(callcenter.revenue + salesbound.revenue);
  const fes = front.fes + recovery.fes;
  const affiliateCost = r2([front, recovery].reduce((s, c) => s + c.lines.filter((l) => l.key === 'cpa' || l.key === 'commission').reduce((t, l) => t + l.usd, 0), 0));
  // CPA médio = CPA pago ÷ FEs do FRONT. Afiliado de recuperação fica fora
  // (mesma regra da aba Ranking, pedido do usuário 2026-09-22): ele recebe
  // comissão %, não CPA — misturar os dois puxava a média pra baixo.
  const frontCpa = front.lines.find((l) => l.key === 'cpa')?.usd ?? 0;
  const bufferPct = params.riskBufferPct ?? 0;
  const bufferUsd = r2(revenue * (bufferPct / 100));
  const channels: ChannelResult[] = partial.map((c) => ({
    ...c,
    shareOfRevenuePct: pctOf(c.revenue, revenue),
    shareOfProfitPct: profit !== 0 ? r2((c.profit / profit) * 100) : 0,
  }));

  // ── Afiliados (mesma fórmula do canal, individual — §10.8) ───────────
  // Projeção pelo modelo CPA (mesma conta de lib/services/profitModel.ts —
  // replicada aqui pra este núcleo continuar sem dependência de banco).
  const opexPct = inputs.profitModel?.opexPct ?? 0;
  // Backend por FE: o que call centers + SalesBound deixaram ÷ FEs que as
  // plataformas trouxeram no mesmo período (front + recuperação). Premissa
  // de regime: o backend deste período veio de clientes de períodos
  // anteriores, e as FEs deste período rendem backend nos próximos.
  const platformFes = front.fes + recovery.fes;
  const backendPerFe = platformFes > 0 ? r2((callcenter.profit + salesbound.profit) / platformFes) : 0;
  const withBackend = (pj: { total: number | null; perFe: number | null }, fes: number) => ({
    projection: pj.total, projectionPerFe: pj.perFe,
    backendProjection: fes > 0 ? r2(fes * backendPerFe) : null,
    projectionTotal: pj.total != null ? r2(pj.total + fes * backendPerFe) : null,
    projectionTotalPerFe: pj.perFe != null ? r2(pj.perFe + backendPerFe) : null,
  });
  const projectionFor = (slug: string, gross: number, fes: number, affiliateCostUsd: number): { total: number | null; perFe: number | null } => {
    if (fes <= 0) return { total: null, perFe: null };
    const p = platBySlug.get(slug);
    const keep = 1 - ((p?.refundCbPctModel ?? 0) + (feeFor(slug).pct ?? 0) + opexPct + (params.includeAllowance ? (allowanceFor(slug).pct ?? 0) : 0)) / 100;
    const netAov = r2((gross / fes) * keep);
    const perFe = r2(netAov - affiliateCostUsd / fes);
    return { total: r2(perFe * fes), perFe };
  };
  const affiliates: AffiliateResult[] = [];
  for (const a of inputs.affiliates) {
    const f = frontSlice(a.platformSlug, a.byStage, a.refundsObserved);
    if (f.tot.gross <= 0 && f.tot.orders === 0) continue;
    const prof = r2(f.tot.gross - f.tot.cpa - f.refund - f.feeUsd - f.cost.usd - f.allowanceUsd);
    const feCount = a.byStage.FRONTEND.orders;
    affiliates.push({
      affiliateId: a.affiliateId, externalId: a.externalId, nickname: a.nickname, platformSlug: a.platformSlug, mappedName: a.mappedName,
      channel: 'front', gross: r2(f.tot.gross), orders: f.tot.orders, fes: feCount, cpa: r2(f.tot.cpa), refund: r2(f.refund), fee: r2(f.feeUsd),
      productCost: r2(f.cost.usd), allowance: r2(f.allowanceUsd), profit: prof, marginPct: pctOf(prof, f.tot.gross),
      profitPerFe: feCount > 0 ? r2(prof / feCount) : null,
      ...withBackend(projectionFor(a.platformSlug, f.tot.gross, feCount, f.tot.cpa), feCount),
      shareOfRevenuePct: pctOf(f.tot.gross, revenue), shareOfChannelPct: pctOf(f.tot.gross, front.gross),
    });
  }
  for (const a of inputs.recoveryAffiliates) {
    if (a.gross <= 0 && a.orders === 0) continue;
    const commission = recoveryCommission(a);
    const s = recoverySlice(a.platformSlug, a.gross, a.refundsObserved);
    const productCost = a.gross * (recCostPct / 100);
    const prof = r2(a.gross - commission - s.refund - s.feeUsd - productCost - s.allowanceUsd);
    affiliates.push({
      affiliateId: a.affiliateId, externalId: a.externalId, nickname: a.nickname, platformSlug: a.platformSlug, mappedName: null,
      channel: 'recovery', gross: r2(a.gross), orders: a.orders, fes: a.feOrders, cpa: r2(commission), refund: r2(s.refund), fee: r2(s.feeUsd),
      productCost: r2(productCost), allowance: r2(s.allowanceUsd), profit: prof, marginPct: pctOf(prof, a.gross),
      profitPerFe: a.feOrders > 0 ? r2(prof / a.feOrders) : null,
      ...withBackend(projectionFor(a.platformSlug, a.gross, a.feOrders, commission), a.feOrders),
      shareOfRevenuePct: pctOf(a.gross, revenue), shareOfChannelPct: pctOf(a.gross, recovery.gross),
    });
  }
  affiliates.sort((x, y) => y.gross - x.gross);

  // ── Por produto (família) — vendas de front, mesma fórmula (§10.8) ───
  const products: ProductResult[] = [];
  for (const pr of inputs.products ?? []) {
    const acc = { gross: 0, orders: 0, fes: 0, cpa: 0, refund: 0, fee: 0, productCost: 0, allowance: 0 };
    for (const part of pr.byPlatform) {
      const f = frontSlice(part.slug, part.byStage, part.refundsObserved);
      acc.gross += f.tot.gross; acc.orders += f.tot.orders; acc.fes += part.byStage.FRONTEND.orders; acc.cpa += f.tot.cpa;
      acc.refund += f.refund; acc.fee += f.feeUsd; acc.productCost += f.cost.usd; acc.allowance += f.allowanceUsd;
    }
    if (acc.gross <= 0 && acc.orders === 0) continue;
    const prof = r2(acc.gross - acc.cpa - acc.refund - acc.fee - acc.productCost - acc.allowance);
    products.push({
      family: pr.family, gross: r2(acc.gross), orders: acc.orders, fes: acc.fes, cpa: r2(acc.cpa), refund: r2(acc.refund), fee: r2(acc.fee),
      productCost: r2(acc.productCost), allowance: r2(acc.allowance), profit: prof, marginPct: pctOf(prof, acc.gross),
      profitPerFe: acc.fes > 0 ? r2(prof / acc.fes) : null, shareOfFrontPct: pctOf(acc.gross, front.gross),
    });
  }
  products.sort((x, y) => y.gross - x.gross);

  return {
    kpis: {
      revenue, grossTotal: r2(partial.reduce((s, c) => s + c.gross, 0)), platformGross, backendNet,
      costs, profit, marginPct: pctOf(profit, revenue), marginOnGrossPct: pctOf(profit, platformGross),
      fes, profitPerFe: fes > 0 ? r2(profit / fes) : null,
      affiliateCost, cpaAvg: front.fes > 0 ? r2(frontCpa / front.fes) : null,
      backendPerFe: platformFes > 0 ? backendPerFe : null,
      buffer: bufferPct > 0 ? { pct: bufferPct, usd: bufferUsd, adjustedProfit: r2(profit - bufferUsd), adjustedMarginPct: pctOf(profit - bufferUsd, revenue) } : null,
    },
    channels,
    affiliates,
    products,
    observedProductCostPct: observed,
    salesbound: {
      mode: sbMeasured ? 'measured' : params.salesbound.grossUsd > 0 ? 'manual' : 'none',
      coverage: sbMeasured?.coverage ?? null,
      voids: r2(sbMeasured?.voids ?? 0),
      refundsCohort: sbMeasured?.refundsCohort ?? null,
    },
    warnings: [...new Set(warnings)],
  };
}

/** Caminhos folha → valor (pra diff do histórico de premissas). */
export function flattenParams(p: NetProfitParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (v: unknown, path: string) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k);
    } else out[path] = v ?? null;
  };
  walk(p, '');
  return out;
}

export function diffParams(before: NetProfitParams | null, after: NetProfitParams): Array<{ path: string; from: unknown; to: unknown }> {
  const a = before ? flattenParams(before) : {};
  const b = flattenParams(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).map((k) => ({ path: k, from: a[k] ?? null, to: b[k] ?? null }));
}
