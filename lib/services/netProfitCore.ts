// Lucro líquido REAL da empresa — núcleo PURO (sem DB). Aba admin-only
// "Lucro real". Consolida as fontes de receita e aplica, por canal, as
// fórmulas fechadas com o usuário (2026-09-15):
//
//   FRONT (plataformas)   Faturamento − CPA − Reembolso/CB − Taxa da plataforma
//                         − Custo de produto − Allowance                = Lucro front
//   CALL CENTERS          Faturamento − Comissão − Reembolso/CB − Custo de produto
//   RECUPERAÇÃO (Skill99, e-mail/SMS)
//                         Faturamento − Comissão − Custo de produto − Reembolso/CB
//   SALESBOUND            Faturamento − Reembolso/CB − Comissão − Custo de produto
//   TOTAL                 Σ lucros; margem = lucro ÷ faturamento
//
// Toda porcentagem aqui é PERCENTUAL 0–100 (como Platform.feeRatePct).
// Parâmetros nulos caem no valor observado/configurado (ver `resolve*`), e a
// linha diz de onde o número veio (`source`) pra auditoria. `inputs` vem
// do banco (lib/services/netProfit.ts) e é reutilizado a cada recálculo —
// mudar um parâmetro na UI é só rodar computeNetProfit de novo.

export type FrontStage = 'FRONTEND' | 'UPSELL' | 'DOWNSELL' | 'BUMP' | 'SMS_RECOVERY';
export const FRONT_STAGES: FrontStage[] = ['FRONTEND', 'UPSELL', 'DOWNSELL', 'BUMP', 'SMS_RECOVERY'];
export const STAGE_LABELS: Record<FrontStage, string> = {
  FRONTEND: 'Front-end', UPSELL: 'Upsell', DOWNSELL: 'Downsell', BUMP: 'Bump', SMS_RECOVERY: 'Recovery (funil)',
};

export type ChannelKey = 'front' | 'callcenter' | 'recovery' | 'salesbound';
export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  front: 'Front-end / Plataformas', callcenter: 'Call centers', recovery: 'Recuperação (e-mail/SMS)', salesbound: 'SalesBound',
};

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
  // (entram no front só se dedupeRecovery = false).
  recovery: StageAgg;
  sms: StageAgg;
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

export interface NetProfitInputs {
  period: { start: string; end: string };
  platforms: PlatformFrontInput[];
  callcenters: CallCenterProviderInput[];
  recoveryAffiliates: RecoveryAffiliateInput[];
  // SMS próprio (Mautic/Twilio, trafficSource=smsbrdcst): custo do Twilio
  // não passa pelo dash — comissão configurável (default 0).
  sms: { gross: number; orders: number; cogs: number; fulfillment: number; refundsObserved: number };
  affiliates: AffiliateInput[];        // contas de FRONT (afiliados de recuperação ficam em recoveryAffiliates)
  salesbound: { measured: { gross: number; sales: number; refunds: number } | null };
}

// ---------------------------------------------------------------------
// PARÂMETROS (editáveis pelo admin; null = usar observado/configurado)
// ---------------------------------------------------------------------
export interface NetProfitParams {
  refundMode: 'observed' | 'manual';
  refundPct: Record<ChannelKey, number | null>;          // % fixo (modo manual) por canal
  // Custo de produto ÚNICO (decisão do usuário 2026-09-16: front, upsell,
  // downsell e bump são "a etapa inicial, uma coisa só"). Vale pra todos os
  // canais/etapas; os campos específicos abaixo só sobrescrevem se preenchidos.
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
  commissionPct: {
    tauk: number | null;            // null = setting/env/default
    logicall: number | null;
    sms: number | null;             // default 0
    salesbound: number | null;
    recoveryOverride: number | null; // null = taxa de cada afiliado (RecoveryRatePeriod)
  };
  salesbound: { grossUsd: number; sales: number | null; refundsUsd: number | null }; // manual enquanto não há dado
  dedupeRecovery: boolean;          // subtrai recuperação/SMS do front (evita dupla contagem)
}

export function defaultParams(): NetProfitParams {
  return {
    refundMode: 'observed',
    refundPct: { front: null, callcenter: null, recovery: null, salesbound: null },
    productCostDefaultPct: null,
    productCostPct: { front: { FRONTEND: null, UPSELL: null, DOWNSELL: null, BUMP: null, SMS_RECOVERY: null }, callcenter: null, recovery: null, salesbound: null },
    feePctOverride: {},
    allowancePctOverride: {},
    includeAllowance: true,
    commissionPct: { tauk: null, logicall: null, sms: 0, salesbound: null, recoveryOverride: null },
    salesbound: { grossUsd: 0, sales: null, refundsUsd: null },
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
    refundPct: { front: pctOrNull(rp.front), callcenter: pctOrNull(rp.callcenter), recovery: pctOrNull(rp.recovery), salesbound: pctOrNull(rp.salesbound) },
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
    dedupeRecovery: r.dedupeRecovery !== false,
  };
}

// ---------------------------------------------------------------------
// RESULTADO
// ---------------------------------------------------------------------
export type LineSource = 'observed' | 'manual' | 'config' | 'default' | 'none';
export interface Line {
  key: string;
  label: string;
  usd: number;                 // valor POSITIVO da dedução
  pctOfGross: number | null;   // % do faturamento da linha-mãe
  source: LineSource;
  note?: string;
}
export interface Breakdown {
  key: string;
  label: string;
  gross: number;
  orders: number;
  lines: Line[];
  profit: number;
  marginPct: number;
}
export interface ChannelResult {
  key: ChannelKey;
  label: string;
  gross: number;
  orders: number;
  costs: number;
  lines: Line[];               // somadas dos breakdowns, na ordem da fórmula
  profit: number;
  marginPct: number;
  shareOfRevenuePct: number;
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
  cpa: number;                 // front: CPA pago; recovery: comissão
  refund: number;
  fee: number;
  productCost: number;
  allowance: number;
  profit: number;
  marginPct: number;
  shareOfRevenuePct: number;   // do faturamento TOTAL (todos os canais)
  shareOfChannelPct: number;   // do faturamento do próprio canal
}
export interface NetProfitResult {
  kpis: { revenue: number; costs: number; profit: number; marginPct: number };
  channels: ChannelResult[];
  affiliates: AffiliateResult[];
  // % REAL observado de custo de produto (COGS + frete dos snapshots ÷
  // faturamento) — o que os parâmetros nulos usam e a sugestão da UI.
  observedProductCostPct: { front: Record<FrontStage, number | null>; recovery: number | null; sms: number | null };
  warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pctOf = (part: number, whole: number): number => (whole > 0 ? r2((part / whole) * 100) : 0);
const line = (key: string, label: string, usd: number, gross: number, source: LineSource, note?: string): Line => ({
  key, label, usd: r2(usd), pctOfGross: gross > 0 ? r2((usd / gross) * 100) : null, source, ...(note ? { note } : {}),
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
  const acc = new Map<string, { label: string; usd: number; sources: Set<LineSource>; notes: Set<string> }>();
  for (const lines of groups) for (const l of lines) {
    let a = acc.get(l.key);
    if (!a) { a = { label: l.label, usd: 0, sources: new Set(), notes: new Set() }; acc.set(l.key, a); order.push(l.key); }
    a.usd += l.usd; a.sources.add(l.source); if (l.note) a.notes.add(l.note);
  }
  return order.map((k) => {
    const a = acc.get(k)!;
    const source: LineSource = a.sources.size === 1 ? [...a.sources][0] : 'config';
    return { key: k, label: a.label, usd: r2(a.usd), pctOfGross: null, source, ...(a.notes.size ? { note: [...a.notes].join(' · ') } : {}) };
  });
}

function finishBreakdown(key: string, label: string, gross: number, orders: number, lines: Line[]): Breakdown {
  const costs = lines.reduce((s, l) => s + l.usd, 0);
  const profit = r2(gross - costs);
  return { key, label, gross: r2(gross), orders, lines, profit, marginPct: pctOf(profit, gross) };
}

function finishChannel(key: ChannelKey, breakdown: Breakdown[], available: boolean): Omit<ChannelResult, 'shareOfRevenuePct' | 'shareOfProfitPct'> {
  const gross = r2(breakdown.reduce((s, b) => s + b.gross, 0));
  const orders = breakdown.reduce((s, b) => s + b.orders, 0);
  const lines = sumLines(breakdown.map((b) => b.lines)).map((l) => ({ ...l, pctOfGross: gross > 0 ? r2((l.usd / gross) * 100) : null }));
  const costs = r2(lines.reduce((s, l) => s + l.usd, 0));
  const profit = r2(gross - costs);
  return { key, label: CHANNEL_LABELS[key], gross, orders, costs, lines, profit, marginPct: pctOf(profit, gross), breakdown, available };
}

// ---------------------------------------------------------------------
// CÁLCULO
// ---------------------------------------------------------------------
export function computeNetProfit(inputs: NetProfitInputs, params: NetProfitParams): NetProfitResult {
  const warnings: string[] = [];
  const observed = observedProductCost(inputs);
  const manualRefund = params.refundMode === 'manual';
  const refundPctFor = (ch: ChannelKey): number => {
    const v = params.refundPct[ch];
    if (v == null) { warnings.push(`Reembolso manual sem % definido para ${CHANNEL_LABELS[ch]} — usando 0%.`); return 0; }
    return v;
  };
  // Custo de produto do front por etapa: parâmetro > observado > 0.
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

  // ── FRONT por plataforma ─────────────────────────────────────────────
  const frontBreakdown: Breakdown[] = [];
  for (const p of inputs.platforms) {
    // Sem dedupe, vendas de recuperação/SMS entram no front (dupla contagem
    // deliberada — o toggle existe pra quem quer ver o bruto "como a
    // plataforma mostra").
    const stages = emptyStages();
    for (const s of FRONT_STAGES) stages[s] = { ...p.byStage[s] };
    if (!params.dedupeRecovery) {
      stages.FRONTEND = addStage(stages.FRONTEND, addStage(p.recovery, p.sms));
    }
    const tot = sumStages(stages);
    if (tot.gross <= 0 && tot.orders === 0) continue;
    const feePct = params.feePctOverride[p.slug] ?? p.feePct;
    const allowPct = params.allowancePctOverride[p.slug] ?? p.allowancePct;
    const refundUsd = manualRefund
      ? tot.gross * (refundPctFor('front') / 100)
      : p.refundsObserved.front + (params.dedupeRecovery ? 0 : p.refundsObserved.recovery + p.refundsObserved.sms);
    const cost = frontCostForStages(stages);
    const lines: Line[] = [
      line('cpa', 'CPA pago aos afiliados', tot.cpa, tot.gross, 'observed'),
      line('refund', 'Reembolso + chargeback', refundUsd, tot.gross, manualRefund ? 'manual' : 'observed', manualRefund ? undefined : 'por data do estorno'),
      line('fee', 'Taxa da plataforma', feePct != null ? tot.gross * (feePct / 100) : 0, tot.gross, feePct == null ? 'none' : params.feePctOverride[p.slug] != null ? 'manual' : 'config', feePct == null ? 'taxa não cadastrada em Plataformas' : `${feePct}%`),
      line('product', 'Custo de produto', cost.usd, tot.gross, oneSource(cost.sources)),
    ];
    if (params.includeAllowance) {
      lines.push(line('allowance', 'Allowance (reserva)', allowPct != null ? tot.gross * (allowPct / 100) : 0, tot.gross, allowPct == null ? 'none' : params.allowancePctOverride[p.slug] != null ? 'manual' : 'config', allowPct == null ? 'allowance não cadastrado' : `${allowPct}%`));
    }
    if (feePct == null) warnings.push(`${p.displayName}: taxa da plataforma não cadastrada (Plataformas → Editar).`);
    frontBreakdown.push(finishBreakdown(p.slug, p.displayName, tot.gross, tot.orders, lines));
  }
  const front = finishChannel('front', frontBreakdown, frontBreakdown.length > 0);

  // ── CALL CENTERS por parceiro ────────────────────────────────────────
  const ccBreakdown: Breakdown[] = [];
  const ccManual = params.productCostPct.callcenter ?? dflt;
  const ccCostPct = ccManual ?? observed.front.FRONTEND ?? 0;
  const ccCostSource: LineSource = ccManual != null ? 'manual' : observed.front.FRONTEND != null ? 'observed' : 'none';
  for (const c of inputs.callcenters) {
    if (!c.configured && c.gross === 0) continue;
    const pct = params.commissionPct[c.provider] ?? c.commissionPct;
    const commissionSource: LineSource = params.commissionPct[c.provider] != null ? 'manual' : 'config';
    const refundUsd = manualRefund ? c.gross * (refundPctFor('callcenter') / 100) : c.refundsObserved;
    const lines: Line[] = [
      line('commission', 'Comissão do parceiro', c.gross * (pct / 100), c.gross, commissionSource, `${pct}%${c.commissionAssumed && params.commissionPct[c.provider] == null ? ' (assumida)' : ''}`),
      line('refund', 'Reembolso + chargeback', refundUsd, c.gross, manualRefund ? 'manual' : 'observed'),
      line('product', 'Custo de produto', c.gross * (ccCostPct / 100), c.gross, ccCostSource, `${r2(ccCostPct)}%`),
    ];
    ccBreakdown.push(finishBreakdown(c.provider, c.label, c.gross, c.sales, lines));
  }
  const callcenter = finishChannel('callcenter', ccBreakdown, ccBreakdown.length > 0);

  // ── RECUPERAÇÃO: parceiros (Skill99…) + SMS próprio ──────────────────
  const recBreakdown: Breakdown[] = [];
  const recManual = params.productCostPct.recovery ?? dflt;
  const recCostPct = recManual ?? observed.recovery ?? observed.front.FRONTEND ?? 0;
  const recCostSource: LineSource = recManual != null ? 'manual' : observed.recovery != null ? 'observed' : observed.front.FRONTEND != null ? 'observed' : 'none';
  for (const a of inputs.recoveryAffiliates) {
    if (a.gross <= 0 && a.orders === 0) continue;
    const commission = params.commissionPct.recoveryOverride != null ? a.gross * (params.commissionPct.recoveryOverride / 100) : a.commissionUsd;
    const refundUsd = manualRefund ? a.gross * (refundPctFor('recovery') / 100) : a.refundsObserved;
    const lines: Line[] = [
      line('commission', 'Comissão do parceiro', commission, a.gross, params.commissionPct.recoveryOverride != null ? 'manual' : 'config', params.commissionPct.recoveryOverride != null ? `${params.commissionPct.recoveryOverride}%` : `${r2(a.currentPct)}% vigente`),
      line('product', 'Custo de produto', a.gross * (recCostPct / 100), a.gross, recCostSource, `${r2(recCostPct)}%`),
      line('refund', 'Reembolso + chargeback', refundUsd, a.gross, manualRefund ? 'manual' : 'observed'),
    ];
    recBreakdown.push(finishBreakdown(`aff:${a.affiliateId}`, `${a.nickname || a.externalId} · ${a.platformSlug}`, a.gross, a.orders, lines));
  }
  if (inputs.sms.gross > 0 || inputs.sms.orders > 0) {
    const g = inputs.sms.gross;
    const smsPct = params.commissionPct.sms ?? 0;
    const smsCostPct = recManual ?? observed.sms ?? observed.front.FRONTEND ?? 0;
    const refundUsd = manualRefund ? g * (refundPctFor('recovery') / 100) : inputs.sms.refundsObserved;
    const lines: Line[] = [
      line('commission', 'Comissão do parceiro', g * (smsPct / 100), g, smsPct > 0 ? 'manual' : 'default', `${smsPct}% (SMS próprio)`),
      line('product', 'Custo de produto', g * (smsCostPct / 100), g, recManual != null ? 'manual' : 'observed', `${r2(smsCostPct)}%`),
      line('refund', 'Reembolso + chargeback', refundUsd, g, manualRefund ? 'manual' : 'observed'),
    ];
    recBreakdown.push(finishBreakdown('sms', 'SMS próprio (Mautic/Twilio)', g, inputs.sms.orders, lines));
  }
  const recovery = finishChannel('recovery', recBreakdown, recBreakdown.length > 0);

  // ── SALESBOUND: medido (fase 2) ou manual ────────────────────────────
  const sbBreakdown: Breakdown[] = [];
  const sbMeasured = inputs.salesbound.measured;
  const sbGross = sbMeasured ? sbMeasured.gross : params.salesbound.grossUsd;
  const sbSales = sbMeasured ? sbMeasured.sales : (params.salesbound.sales ?? 0);
  if (sbGross > 0) {
    const sbPct = params.commissionPct.salesbound;
    const sbCost = params.productCostPct.salesbound ?? dflt;
    const refundUsd = manualRefund
      ? sbGross * (refundPctFor('salesbound') / 100)
      : sbMeasured ? sbMeasured.refunds : (params.salesbound.refundsUsd ?? 0);
    const lines: Line[] = [
      line('refund', 'Reembolso + chargeback', refundUsd, sbGross, manualRefund || !sbMeasured ? 'manual' : 'observed'),
      line('commission', 'Comissão do parceiro', sbGross * ((sbPct ?? 0) / 100), sbGross, sbPct != null ? 'manual' : 'none', sbPct != null ? `${sbPct}%` : 'comissão não informada'),
      line('product', 'Custo de produto', sbGross * ((sbCost ?? 0) / 100), sbGross, sbCost != null ? 'manual' : 'none', sbCost != null ? `${sbCost}%` : '% não informado'),
    ];
    if (sbPct == null) warnings.push('SalesBound: comissão % não informada — usando 0%.');
    if (sbCost == null) warnings.push('SalesBound: custo de produto % não informado — usando 0%.');
    sbBreakdown.push(finishBreakdown('salesbound', sbMeasured ? 'SalesBound (medido)' : 'SalesBound (manual)', sbGross, sbSales, lines));
  }
  const salesbound = finishChannel('salesbound', sbBreakdown, sbBreakdown.length > 0);

  // ── Totais e participações ──────────────────────────────────────────
  const partial = [front, callcenter, recovery, salesbound];
  const revenue = r2(partial.reduce((s, c) => s + c.gross, 0));
  const profit = r2(partial.reduce((s, c) => s + c.profit, 0));
  const costs = r2(revenue - profit);
  const channels: ChannelResult[] = partial.map((c) => ({
    ...c,
    shareOfRevenuePct: pctOf(c.gross, revenue),
    shareOfProfitPct: profit !== 0 ? r2((c.profit / profit) * 100) : 0,
  }));

  // ── Afiliados (mesma fórmula do canal, individual) ───────────────────
  const platBySlug = new Map(inputs.platforms.map((p) => [p.slug, p]));
  const affiliates: AffiliateResult[] = [];
  for (const a of inputs.affiliates) {
    const tot = sumStages(a.byStage);
    if (tot.gross <= 0 && tot.orders === 0) continue;
    const p = platBySlug.get(a.platformSlug);
    const feePct = params.feePctOverride[a.platformSlug] ?? p?.feePct ?? 0;
    const allowPct = params.includeAllowance ? (params.allowancePctOverride[a.platformSlug] ?? p?.allowancePct ?? 0) : 0;
    const refund = manualRefund ? tot.gross * ((params.refundPct.front ?? 0) / 100) : a.refundsObserved;
    const fee = tot.gross * (feePct / 100);
    const productCost = frontCostForStages(a.byStage).usd;
    const allowance = tot.gross * (allowPct / 100);
    const prof = r2(tot.gross - tot.cpa - refund - fee - productCost - allowance);
    affiliates.push({
      affiliateId: a.affiliateId, externalId: a.externalId, nickname: a.nickname, platformSlug: a.platformSlug, mappedName: a.mappedName,
      channel: 'front', gross: r2(tot.gross), orders: tot.orders, cpa: r2(tot.cpa), refund: r2(refund), fee: r2(fee),
      productCost: r2(productCost), allowance: r2(allowance), profit: prof, marginPct: pctOf(prof, tot.gross),
      shareOfRevenuePct: pctOf(tot.gross, revenue), shareOfChannelPct: pctOf(tot.gross, front.gross),
    });
  }
  for (const a of inputs.recoveryAffiliates) {
    if (a.gross <= 0 && a.orders === 0) continue;
    const commission = params.commissionPct.recoveryOverride != null ? a.gross * (params.commissionPct.recoveryOverride / 100) : a.commissionUsd;
    const refund = manualRefund ? a.gross * ((params.refundPct.recovery ?? 0) / 100) : a.refundsObserved;
    const productCost = a.gross * (recCostPct / 100);
    const prof = r2(a.gross - commission - productCost - refund);
    affiliates.push({
      affiliateId: a.affiliateId, externalId: a.externalId, nickname: a.nickname, platformSlug: a.platformSlug, mappedName: null,
      channel: 'recovery', gross: r2(a.gross), orders: a.orders, cpa: r2(commission), refund: r2(refund), fee: 0,
      productCost: r2(productCost), allowance: 0, profit: prof, marginPct: pctOf(prof, a.gross),
      shareOfRevenuePct: pctOf(a.gross, revenue), shareOfChannelPct: pctOf(a.gross, recovery.gross),
    });
  }
  affiliates.sort((x, y) => y.gross - x.gross);

  return {
    kpis: { revenue, costs, profit, marginPct: pctOf(profit, revenue) },
    channels,
    affiliates,
    observedProductCostPct: observed,
    warnings: [...new Set(warnings)],
  };
}
