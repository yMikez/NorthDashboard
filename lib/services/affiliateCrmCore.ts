// Núcleo PURO do CRM de afiliados (sem banco, sem data "agora"): dado o
// retrato de um afiliado, devolve em que fase da régua ele está, qual é o
// próximo toque devido e por quê. Regras do playbook NorthScale
// (NorthScale_CRM_Playbook_Automacao), com todo "a confirmar" virando
// parâmetro (CrmConfigInput) em vez de constante.
//
// Decisões que valem a pena ler antes de mexer:
//
//  - CICLO. Cada toque é ancorado num `cycleKey`. Na régua de reativação o
//    ciclo é o DIA DA ÚLTIMA VENDA: vendeu de novo → o ciclo muda → a régua
//    reinicia sozinha e ninguém recebe "sumiu, o que houve?" no dia seguinte
//    a uma venda. Não existe job de expiração; é o dado que manda.
//  - TIER. Vale o manual; senão o que a plataforma de afiliados mandou;
//    senão inferido pelo CPA pago; senão Base. `tierSource` sempre diz qual.
//  - DORMÊNCIA POR TIER. North some antes de Base (decisão do usuário,
//    2026-09-24): o limiar é por tier, e a escada de toques corre a partir
//    dele (Base 7 → D7/D11/D14/D21; North 3 → D3/D7/D10/D17).
//  - VALOR. A ordem da lista não é por dias parado, é por valor: com metade
//    da base sem pagar o próprio CPA, reativar todo mundo é caro. `priority`
//    e `alerts` existem pra isso.

export type Tier = 'BASE' | 'ASCENDENTE' | 'NORTH';
export const TIERS: readonly Tier[] = ['BASE', 'ASCENDENTE', 'NORTH'] as const;
export const TIER_LABELS: Record<Tier, string> = { BASE: 'Base', ASCENDENTE: 'Ascendente', NORTH: 'North' };
export const TIER_ORDER: Record<Tier, number> = { BASE: 0, ASCENDENTE: 1, NORTH: 2 };

export type CrmSegment = 'onboarding' | 'ativo' | 'em_risco' | 'upgrade' | 'dormente' | 'frio' | 'fora';

export const SEGMENT_LABELS: Record<CrmSegment, string> = {
  onboarding: 'Onboarding',
  ativo: 'Ativo saudável',
  em_risco: 'Em risco',
  upgrade: 'Elegível a upgrade',
  dormente: 'Dormente',
  frio: 'Frio',
  fora: 'Fora da régua',
};

/** Ordem de exibição/priorização das abas de segmento na UI. */
export const SEGMENT_ORDER: readonly CrmSegment[] = ['dormente', 'em_risco', 'onboarding', 'upgrade', 'ativo', 'frio', 'fora'] as const;

export type TierSource = 'manual' | 'plataforma' | 'cpa' | 'padrao';
export type PhoneSource = 'manual' | 'plataforma' | 'identidade';

export interface CrmConfigInput {
  dormantDays: Record<Tier, number>;
  coldDays: number;
  /** Dias APÓS o limiar de dormência em que cada toque vence. */
  ladderOffsets: number[];
  /** Dias após o cadastro em que cada toque de onboarding vence. */
  onboardingOffsets: number[];
  onboardingDays: number;
  atRiskDropPct: number;
  atRiskWeeks: number;
  upgradeWeeks: number;
  upgradeSales: { ASCENDENTE: number; NORTH: number };
  tierCpaMin: { ASCENDENTE: number; NORTH: number };
  minValueUsd: number;
}

export const DEFAULT_CRM_CONFIG: CrmConfigInput = {
  dormantDays: { BASE: 7, ASCENDENTE: 5, NORTH: 3 },
  coldDays: 30,
  ladderOffsets: [0, 4, 7, 14],
  onboardingOffsets: [0, 1, 3, 5, 7, 10],
  onboardingDays: 10,
  atRiskDropPct: 40,
  atRiskWeeks: 4,
  upgradeWeeks: 3,
  upgradeSales: { ASCENDENTE: 10, NORTH: 25 },
  tierCpaMin: { ASCENDENTE: 230, NORTH: 240 },
  minValueUsd: 500,
};

/**
 * Piso pra chamar de "em risco": abaixo disso a variação semanal é ruído
 * (cair de 1 venda pra 0 não é queda de produção, é a base pequena).
 */
export const AT_RISK_MIN_BASELINE = 2;

/** Nº mínimo de vendas no mês pra apontar prejuízo — evita alarme por 1 venda. */
export const LOSS_MIN_SALES = 5;

export interface TouchRecord {
  touchpoint: string;
  cycleKey: string;
  tag: string | null;
  sentAt: string;
  origin?: string;
}

export interface CrmInput {
  key: string;
  name: string;
  kind: 'partner' | 'affiliate' | 'mapping';
  platforms: string[];
  /** status do mapeamento do sistema de afiliados ('inactive' sai da régua). */
  mappingStatus?: 'active' | 'inactive' | null;
  tierManual: Tier | null;
  tierPlatform: string | null;
  phoneManual: string | null;
  phonePlatform: string | null;
  phoneIdentity: string | null;
  optOut: boolean;
  /** null = nunca vendeu. */
  daysSinceLastSale: number | null;
  lastSaleDay: string | null;
  daysSinceFirstSeen: number | null;
  firstSeenDay: string | null;
  cpaAtual: number | null;
  mainFamily: string | null;
  sales7: number;
  sales30: number;
  revenue30: number;
  netAfterCpa30: number | null;
  /** Melhor receita de 30 dias na cobertura — o que ele JÁ foi. */
  peakRevenue30: number;
  /** Blocos de 7 dias terminando hoje, mais recente por ÚLTIMO. */
  weeklySales: number[];
  rankTop10: boolean;
  /** Semana ISO corrente — âncora dos toques que repetem por semana. */
  weekKey: string;
  touches: TouchRecord[];
}

export interface NextTouch {
  id: string;
  label: string;
  tag: string;
  /** Dia (desde a última venda / cadastro) em que venceu. null = sem prazo. */
  dueDay: number | null;
  /** Há quantos dias está vencido. 0 = venceu hoje. */
  overdueDays: number;
}

export interface CrmRow {
  key: string;
  name: string;
  kind: 'partner' | 'affiliate' | 'mapping';
  platforms: string[];
  segment: CrmSegment;
  tier: Tier;
  tierSource: TierSource;
  tierPlatformRaw: string | null;
  phone: string | null;
  phoneSource: PhoneSource | null;
  optOut: boolean;
  daysSinceLastSale: number | null;
  lastSaleDay: string | null;
  cycleKey: string;
  cpaAtual: number | null;
  mainFamily: string | null;
  sales7: number;
  sales30: number;
  revenue30: number;
  netAfterCpa30: number | null;
  valueUsd: number;
  weeklySales: number[];
  upgradeTo: Tier | null;
  nextTouch: NextTouch | null;
  pending: boolean;
  touchesInCycle: TouchRecord[];
  lastTouchAt: string | null;
  priority: 'alta' | 'media' | 'baixa';
  alerts: string[];
  reason: string;
}

// ── normalizações ──────────────────────────────────────────────────────

/** Aceita o rótulo cru da plataforma de afiliados; devolve null se não reconhecer. */
export function normalizeTier(raw: string | null | undefined): Tier | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('base')) return 'BASE';
  if (s.startsWith('ascend')) return 'ASCENDENTE';
  if (s.startsWith('north') || s === 'vip' || s.includes('north')) return 'NORTH';
  return null;
}

/**
 * Só dígitos (o formato que as ferramentas de WhatsApp importam). Devolve
 * null pra qualquer coisa curta demais pra ser um número discável.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D+/g, '').replace(/^00/, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export function inferTierFromCpa(cpa: number | null, cfg: CrmConfigInput): Tier | null {
  if (cpa == null || !(cpa > 0)) return null;
  if (cpa >= cfg.tierCpaMin.NORTH) return 'NORTH';
  if (cpa >= cfg.tierCpaMin.ASCENDENTE) return 'ASCENDENTE';
  return 'BASE';
}

export function resolveTier(input: CrmInput, cfg: CrmConfigInput): { tier: Tier; source: TierSource } {
  if (input.tierManual) return { tier: input.tierManual, source: 'manual' };
  const fromPlatform = normalizeTier(input.tierPlatform);
  if (fromPlatform) return { tier: fromPlatform, source: 'plataforma' };
  const fromCpa = inferTierFromCpa(input.cpaAtual, cfg);
  if (fromCpa) return { tier: fromCpa, source: 'cpa' };
  return { tier: 'BASE', source: 'padrao' };
}

export function resolvePhone(input: CrmInput): { phone: string | null; source: PhoneSource | null } {
  const manual = normalizePhone(input.phoneManual);
  if (manual) return { phone: manual, source: 'manual' };
  const platform = normalizePhone(input.phonePlatform);
  if (platform) return { phone: platform, source: 'plataforma' };
  const identity = normalizePhone(input.phoneIdentity);
  if (identity) return { phone: identity, source: 'identidade' };
  return { phone: null, source: null };
}

// ── escada de toques ───────────────────────────────────────────────────

export interface LadderStep { id: string; dueDay: number; label: string; tag: string }

/** Escada de reativação a partir do limiar do tier (Base 7 → D7/D11/D14/D21). */
export function reactivationLadder(tier: Tier, cfg: CrmConfigInput): LadderStep[] {
  const threshold = cfg.dormantDays[tier] ?? DEFAULT_CRM_CONFIG.dormantDays[tier];
  return cfg.ladderOffsets
    .map((off, i) => ({ id: `R${i + 1}`, dueDay: threshold + off }))
    .filter((s) => s.dueDay < cfg.coldDays)
    .map((s) => ({ ...s, label: `D${s.dueDay}`, tag: `reativacao_d${s.dueDay}` }));
}

export function onboardingLadder(cfg: CrmConfigInput): LadderStep[] {
  return cfg.onboardingOffsets.map((off, i) => ({
    id: `O${i + 1}`, dueDay: off, label: `D${off}`, tag: `onboarding_d${off}`,
  }));
}

export const COLD_STEP: LadderStep = { id: 'F1', dueDay: 0, label: 'Frio', tag: 'reativacao_frio' };
export const RISK_STEP: LadderStep = { id: 'RISK', dueDay: 0, label: 'Check-in', tag: 'risco_checkin' };
export const TOP10_STEP: LadderStep = { id: 'TOP10', dueDay: 0, label: 'Top 10', tag: 'top10_semana' };
/** Marca "pular este ciclo" — some da fila sem virar toque enviado. */
export const SKIP_TOUCHPOINT = 'SKIP';

export function upgradeStep(to: Tier): LadderStep {
  return { id: 'UP', dueDay: 0, label: `Upgrade ${TIER_LABELS[to]}`, tag: `upgrade_${to.toLowerCase()}` };
}

// ── classificação ──────────────────────────────────────────────────────

export function cycleKeyFor(segment: CrmSegment, input: CrmInput): string {
  if (segment === 'dormente' || segment === 'frio') return `sale:${input.lastSaleDay ?? 'nunca'}`;
  if (segment === 'onboarding') return `onb:${input.firstSeenDay ?? 'sem-data'}`;
  return `w:${input.weekKey}`;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Média semanal das semanas ANTERIORES à corrente (a corrente é o "agora"). */
export function baselineWeekly(weeklySales: number[], weeks: number): number {
  if (weeklySales.length < 2) return 0;
  const prev = weeklySales.slice(Math.max(0, weeklySales.length - 1 - weeks), weeklySales.length - 1);
  return mean(prev);
}

export function isAtRisk(input: CrmInput, cfg: CrmConfigInput): boolean {
  if (input.sales7 < 1) return false;
  const base = baselineWeekly(input.weeklySales, cfg.atRiskWeeks);
  if (base < AT_RISK_MIN_BASELINE) return false;
  return input.sales7 <= base * (1 - cfg.atRiskDropPct / 100);
}

/** Tier que ele já sustenta há `upgradeWeeks` semanas, se for acima do atual. */
export function upgradeTarget(input: CrmInput, tier: Tier, cfg: CrmConfigInput): Tier | null {
  const weeks = input.weeklySales.slice(-cfg.upgradeWeeks);
  if (weeks.length < cfg.upgradeWeeks) return null;
  const sustains = (n: number) => weeks.every((w) => w >= n);
  let target: Tier | null = null;
  if (sustains(cfg.upgradeSales.NORTH)) target = 'NORTH';
  else if (sustains(cfg.upgradeSales.ASCENDENTE)) target = 'ASCENDENTE';
  if (!target) return null;
  return TIER_ORDER[target] > TIER_ORDER[tier] ? target : null;
}

export function classifySegment(input: CrmInput, tier: Tier, cfg: CrmConfigInput): CrmSegment {
  if (input.optOut || input.mappingStatus === 'inactive') return 'fora';
  const days = input.daysSinceLastSale;
  const everSold = days != null;

  if (!everSold) {
    // Cadastrado e ainda sem primeira venda: onboarding enquanto a janela
    // durar; depois dela vira frio (nunca ativou).
    const since = input.daysSinceFirstSeen;
    if (since != null && since <= cfg.onboardingDays) return 'onboarding';
    return 'frio';
  }
  if (days >= cfg.coldDays) return 'frio';
  if (days >= (cfg.dormantDays[tier] ?? DEFAULT_CRM_CONFIG.dormantDays[tier])) return 'dormente';
  // Vendendo. Onboarding continua até fechar a janela do cadastro.
  if (input.daysSinceFirstSeen != null && input.daysSinceFirstSeen <= cfg.onboardingDays) return 'onboarding';
  if (isAtRisk(input, cfg)) return 'em_risco';
  if (upgradeTarget(input, tier, cfg)) return 'upgrade';
  return 'ativo';
}

function pickNext(steps: LadderStep[], elapsed: number | null, sent: Set<string>): NextTouch | null {
  for (const s of steps) {
    if (sent.has(s.id)) continue;
    if (elapsed != null && elapsed < s.dueDay) continue;
    return {
      id: s.id, label: s.label, tag: s.tag, dueDay: s.dueDay,
      overdueDays: elapsed != null ? Math.max(0, elapsed - s.dueDay) : 0,
    };
  }
  return null;
}

export function nextTouchFor(
  input: CrmInput, segment: CrmSegment, tier: Tier, cfg: CrmConfigInput, cycleKey: string,
): NextTouch | null {
  if (segment === 'fora') return null;
  const inCycle = input.touches.filter((t) => t.cycleKey === cycleKey);
  const sent = new Set(inCycle.map((t) => t.touchpoint));
  if (sent.has(SKIP_TOUCHPOINT)) return null;

  switch (segment) {
    case 'dormente':
      return pickNext(reactivationLadder(tier, cfg), input.daysSinceLastSale, sent);
    case 'frio':
      // Uma última mensagem por ciclo; depois dela ele fica quieto na lista.
      return pickNext([COLD_STEP], 0, sent);
    case 'onboarding':
      return pickNext(onboardingLadder(cfg), input.daysSinceFirstSeen, sent);
    case 'em_risco':
      return pickNext([RISK_STEP], 0, sent);
    case 'upgrade': {
      const to = upgradeTarget(input, tier, cfg);
      return to ? pickNext([upgradeStep(to)], 0, sent) : null;
    }
    case 'ativo':
      return input.rankTop10 ? pickNext([TOP10_STEP], 0, sent) : null;
    default:
      return null;
  }
}

function priorityFor(valueUsd: number, tier: Tier, netAfterCpa30: number | null, cfg: CrmConfigInput): 'alta' | 'media' | 'baixa' {
  const losing = netAfterCpa30 != null && netAfterCpa30 < 0;
  if (valueUsd >= cfg.minValueUsd * 3 || (tier === 'NORTH' && valueUsd >= cfg.minValueUsd)) {
    return losing && valueUsd < cfg.minValueUsd * 3 ? 'media' : 'alta';
  }
  if (valueUsd >= cfg.minValueUsd) return losing ? 'baixa' : 'media';
  return 'baixa';
}

function alertsFor(input: CrmInput, tier: Tier, phone: string | null, tierSource: TierSource, cfg: CrmConfigInput): string[] {
  const out: string[] = [];
  if (!phone) out.push('sem_whatsapp');
  if (tierSource === 'padrao') out.push('tier_indefinido');
  if (input.netAfterCpa30 != null && input.netAfterCpa30 < 0 && input.sales30 >= LOSS_MIN_SALES) out.push('prejuizo');
  // Paga de North sem entregar volume de North: não é régua de WhatsApp, é
  // conversa de CPA — mas a lista sai daqui (segmento 6 do playbook).
  if (input.cpaAtual != null && input.cpaAtual >= cfg.tierCpaMin.NORTH) {
    const recent = mean(input.weeklySales.slice(-cfg.upgradeWeeks));
    if (input.sales30 > 0 && recent < cfg.upgradeSales.ASCENDENTE) out.push('cpa_acima_do_volume');
  }
  if (input.optOut) out.push('opt_out');
  return out;
}

function pt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function reasonFor(input: CrmInput, segment: CrmSegment, tier: Tier, cfg: CrmConfigInput, upTo: Tier | null): string {
  const d = input.daysSinceLastSale;
  switch (segment) {
    case 'dormente':
      return `${d} dias sem vender (limiar ${TIER_LABELS[tier]}: ${cfg.dormantDays[tier]}). Melhor mês: US$ ${pt(input.peakRevenue30)}.`;
    case 'frio':
      return d == null
        ? `Cadastrado há ${input.daysSinceFirstSeen ?? '?'} dias e nunca vendeu.`
        : `${d} dias sem vender — passou dos ${cfg.coldDays} da régua.`;
    case 'onboarding':
      return d == null
        ? `Novo: ${input.daysSinceFirstSeen} dias de cadastro, primeira venda ainda não veio.`
        : `Novo: primeira venda feita, ${input.daysSinceFirstSeen} dias de casa.`;
    case 'em_risco': {
      const base = baselineWeekly(input.weeklySales, cfg.atRiskWeeks);
      return `Caiu de ~${base.toFixed(1)} vendas/semana pra ${input.sales7} nos últimos 7 dias, mas ainda está vendendo.`;
    }
    case 'upgrade':
      return `Sustenta o volume de ${TIER_LABELS[upTo ?? tier]} há ${cfg.upgradeWeeks} semanas (${input.weeklySales.slice(-cfg.upgradeWeeks).join(', ')} vendas/semana).`;
    case 'ativo':
      return `Vendendo normal: ${input.sales7} nos últimos 7 dias, US$ ${pt(input.revenue30)} no mês.`;
    case 'fora':
      return input.optOut ? 'Marcado como "não contatar".' : 'Inativo no sistema de afiliados.';
    default:
      return '';
  }
}

export function buildCrmRow(input: CrmInput, cfg: CrmConfigInput): CrmRow {
  const { tier, source: tierSource } = resolveTier(input, cfg);
  const { phone, source: phoneSource } = resolvePhone(input);
  const segment = classifySegment(input, tier, cfg);
  const cycleKey = cycleKeyFor(segment, input);
  const upgradeTo = segment === 'upgrade' ? upgradeTarget(input, tier, cfg) : null;
  const nextTouch = nextTouchFor(input, segment, tier, cfg, cycleKey);
  const touchesInCycle = input.touches.filter((t) => t.cycleKey === cycleKey);
  const lastTouch = [...input.touches].sort((a, b) => a.sentAt.localeCompare(b.sentAt)).pop() ?? null;
  const valueUsd = Math.round(Math.max(input.revenue30, input.peakRevenue30) * 100) / 100;

  return {
    key: input.key,
    name: input.name,
    kind: input.kind,
    platforms: input.platforms,
    segment,
    tier,
    tierSource,
    tierPlatformRaw: input.tierPlatform,
    phone,
    phoneSource,
    optOut: input.optOut,
    daysSinceLastSale: input.daysSinceLastSale,
    lastSaleDay: input.lastSaleDay,
    cycleKey,
    cpaAtual: input.cpaAtual,
    mainFamily: input.mainFamily,
    sales7: input.sales7,
    sales30: input.sales30,
    revenue30: input.revenue30,
    netAfterCpa30: input.netAfterCpa30,
    valueUsd,
    weeklySales: input.weeklySales,
    upgradeTo,
    nextTouch,
    pending: nextTouch != null,
    touchesInCycle,
    lastTouchAt: lastTouch?.sentAt ?? null,
    priority: priorityFor(valueUsd, tier, input.netAfterCpa30, cfg),
    alerts: alertsFor(input, tier, phone, tierSource, cfg),
    reason: reasonFor(input, segment, tier, cfg, upgradeTo),
  };
}

// ── resumo ─────────────────────────────────────────────────────────────

export interface CrmSummary {
  total: number;
  bySegment: Record<CrmSegment, number>;
  pending: number;
  pendingWithoutPhone: number;
  withoutPhone: number;
  valuePendingUsd: number;
}

export function summarize(rows: CrmRow[]): CrmSummary {
  const bySegment = Object.fromEntries(SEGMENT_ORDER.map((s) => [s, 0])) as Record<CrmSegment, number>;
  let pending = 0, pendingWithoutPhone = 0, withoutPhone = 0, valuePendingUsd = 0;
  for (const r of rows) {
    bySegment[r.segment] = (bySegment[r.segment] ?? 0) + 1;
    if (!r.phone) withoutPhone++;
    if (r.pending) {
      pending++;
      valuePendingUsd += r.valueUsd;
      if (!r.phone) pendingWithoutPhone++;
    }
  }
  return {
    total: rows.length, bySegment, pending, pendingWithoutPhone, withoutPhone,
    valuePendingUsd: Math.round(valuePendingUsd * 100) / 100,
  };
}

/** Ordem da fila: quem está devendo toque primeiro, e dentro disso por valor. */
export function sortForQueue(rows: CrmRow[]): CrmRow[] {
  const prio = { alta: 0, media: 1, baixa: 2 } as const;
  return [...rows].sort((a, b) => {
    if (a.pending !== b.pending) return a.pending ? -1 : 1;
    if (prio[a.priority] !== prio[b.priority]) return prio[a.priority] - prio[b.priority];
    if (b.valueUsd !== a.valueUsd) return b.valueUsd - a.valueUsd;
    return a.name.localeCompare(b.name);
  });
}

// ── export pro disparo (colunas §2.10 do playbook) ─────────────────────

export const CSV_COLUMNS = [
  'nome', 'whatsapp', 'tier', 'dias_sem_venda', 'produto_principal', 'cpa_atual', 'tag_sugerida',
  'segmento', 'toque', 'valor_usd', 'ultima_venda', 'prioridade', 'plataformas', 'crm_key', 'ciclo',
] as const;

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: CrmRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      r.name,
      r.phone ?? '',
      TIER_LABELS[r.tier],
      r.daysSinceLastSale ?? '',
      r.mainFamily ?? '',
      r.cpaAtual != null ? r.cpaAtual.toFixed(2) : '',
      r.nextTouch?.tag ?? '',
      SEGMENT_LABELS[r.segment],
      r.nextTouch?.label ?? '',
      r.valueUsd.toFixed(2),
      r.lastSaleDay ?? '',
      r.priority,
      r.platforms.join('|'),
      r.key,
      r.cycleKey,
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}
