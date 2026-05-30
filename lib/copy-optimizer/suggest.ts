// Fase 6 — heurística de sugestão de ajuste de regras a partir do gap de AOV e
// do lift histórico por afiliado (PHASE_5_6_7_BRIEFING §4.4). PURA e testável.
//
// Regra: se há gap (AOV < target), pra cada afiliado com lift de Black 2
// acima do threshold, propõe subir o pct proporcional ao lift (cap 100).

export interface AffiliateLift {
  key: string;
  liftPp: number | null;
  currentPct: number | null;
}

export interface RuleSuggestion {
  key: string;
  currentPct: number;
  newPct: number;
  reasoning: string;
}

export interface SuggestionResult {
  scenario: string | null;
  rules: RuleSuggestion[];
}

export function buildRuleSuggestions(opts: {
  easiestLabel: string | null;
  gap: number; // target - baseline; >0 = abaixo do alvo
  affiliates: AffiliateLift[];
  liftThresholdPp: number;
}): SuggestionResult {
  const rules: RuleSuggestion[] = [];
  // Sem gap → já bate o alvo; nada a sugerir.
  if (opts.gap <= 0) return { scenario: opts.easiestLabel, rules };

  for (const a of opts.affiliates) {
    if (a.currentPct == null || a.liftPp == null) continue;
    if (a.liftPp < opts.liftThresholdPp) continue;

    if (a.currentPct >= 100) {
      rules.push({ key: a.key, currentPct: a.currentPct, newPct: 100, reasoning: 'já em max (100%)' });
      continue;
    }
    const bump = Math.min(50, Math.max(5, Math.round(a.liftPp)));
    const newPct = Math.min(100, a.currentPct + bump);
    rules.push({
      key: a.key,
      currentPct: a.currentPct,
      newPct,
      reasoning: `lift +${a.liftPp}pp em Black 2 → +${newPct - a.currentPct}pp`,
    });
  }
  return { scenario: opts.easiestLabel, rules };
}
