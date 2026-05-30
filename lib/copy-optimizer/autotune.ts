// Auto-tune — algoritmo de decisão PURO (seção 5.1 do PHASE_5_6_7_BRIEFING).
// Sem I/O: recebe a regra, a config, as métricas da janela e o timestamp da
// última mudança; devolve a decisão (subir/descer/segurar + motivo). O
// orquestrador (endpoint /api/admin/copy-autotune/run) é quem busca métricas,
// aplica o novo pct e grava no AutotuneLog.

export interface AutotuneConfig {
  cooldownH: number; // horas mínimas entre mudanças na mesma regra
  windowH: number; // janela de avaliação (usada pelo orquestrador pra computar metrics)
  minSample: number; // n mínimo por variante pra agir
  liftThresholdPp: number; // lift (pp) pra subir
  adverseThresholdPp: number; // lift (pp) pra retrair (negativo)
  globalTargetAov: number; // target padrão se a regra não tiver o seu
}

export const DEFAULT_AUTOTUNE_CONFIG: AutotuneConfig = {
  cooldownH: 12,
  windowH: 48,
  minSample: 30,
  liftThresholdPp: 5,
  adverseThresholdPp: -5,
  globalTargetAov: 220,
};

export interface AutotuneRuleSnapshot {
  black2Pct: number;
  minPct: number;
  maxPct: number;
  stepPct: number;
  targetAov: number | null;
}

export interface AutotuneMetrics {
  n_b1: number;
  n_b2: number;
  conv_b1: number; // 0..1
  conv_b2: number; // 0..1
  aov_observed: number;
}

export type AutotuneReason =
  | 'aov_gap_up'
  | 'adverse_lift_down'
  | 'cap_hit'
  | 'cooldown'
  | 'no_sample'
  | 'hold';

export interface AutotuneDecision {
  changed: boolean;
  pctBefore: number;
  pctAfter: number;
  reason: AutotuneReason;
  metrics: {
    lift_pp: number;
    aov_gap: number;
    aov_observed: number;
    aov_target: number;
    conv_b1: number;
    conv_b2: number;
    n_b1: number;
    n_b2: number;
  };
}

export interface DecideAutotuneInput {
  rule: AutotuneRuleSnapshot;
  config: AutotuneConfig;
  metrics: AutotuneMetrics;
  /** epoch ms da última decisão que MUDOU o pct (AutotuneLog). null se nunca. */
  lastChangeAt: number | null;
  /** epoch ms de agora. */
  now: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Decide o próximo pct de uma regra. Ordem: cooldown → sample mínimo → gradiente.
 * Gradiente: se AOV abaixo do alvo E Black 2 lifta o suficiente, sobe stepPct
 * (clamp em maxPct). Se Black 2 está performando mal (lift adverso), desce
 * stepPct (clamp em minPct). Senão, segura.
 */
export function decideAutotune(input: DecideAutotuneInput): AutotuneDecision {
  const { rule, config, metrics, lastChangeAt, now } = input;

  const liftPp = (metrics.conv_b2 - metrics.conv_b1) * 100;
  const target = rule.targetAov ?? config.globalTargetAov;
  const aovGap = target - metrics.aov_observed;

  const metricsSnapshot = {
    lift_pp: Math.round(liftPp * 100) / 100,
    aov_gap: Math.round(aovGap * 100) / 100,
    aov_observed: metrics.aov_observed,
    aov_target: target,
    conv_b1: metrics.conv_b1,
    conv_b2: metrics.conv_b2,
    n_b1: metrics.n_b1,
    n_b2: metrics.n_b2,
  };

  const hold = (reason: AutotuneReason): AutotuneDecision => ({
    changed: false,
    pctBefore: rule.black2Pct,
    pctAfter: rule.black2Pct,
    reason,
    metrics: metricsSnapshot,
  });

  // STEP 1 — cooldown
  if (lastChangeAt != null && now - lastChangeAt < config.cooldownH * HOUR_MS) {
    return hold('cooldown');
  }

  // STEP 2 — sample mínimo por variante
  if (metrics.n_b1 < config.minSample || metrics.n_b2 < config.minSample) {
    return hold('no_sample');
  }

  // STEP 3 — gradiente
  if (aovGap > 0 && liftPp >= config.liftThresholdPp) {
    const newPct = Math.min(rule.black2Pct + rule.stepPct, rule.maxPct);
    if (newPct === rule.black2Pct) return hold('cap_hit');
    return { changed: true, pctBefore: rule.black2Pct, pctAfter: newPct, reason: 'aov_gap_up', metrics: metricsSnapshot };
  }

  if (liftPp <= config.adverseThresholdPp) {
    const newPct = Math.max(rule.black2Pct - rule.stepPct, rule.minPct);
    if (newPct === rule.black2Pct) return hold('cap_hit');
    return { changed: true, pctBefore: rule.black2Pct, pctAfter: newPct, reason: 'adverse_lift_down', metrics: metricsSnapshot };
  }

  return hold('hold');
}
