// POST /api/metrics/copy-aov-calculator — Painel B.
// Roda o modelo de AOV (lib/aov-math, portado do calculadoraAOV.html) sobre os
// inputs e devolve os 5 cenários + sugestão de ajuste de regras (a partir do
// lift histórico por afiliado do /copy-funnel). Admin-only.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { computeAov, type AovInputs, type UpsellStage } from '@/lib/copy-optimizer/aov-math';
import { buildRuleSuggestions } from '@/lib/copy-optimizer/suggest';
import { getCopyFunnel } from '@/lib/services/copyFunnel';
import { DEFAULT_AUTOTUNE_CONFIG } from '@/lib/copy-optimizer/autotune';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseStages(raw: unknown): UpsellStage[] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  return raw.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return {
      name: typeof o.name === 'string' ? o.name : `UP${i + 1}`,
      price: num(o.price),
      floor: num(o.floor), // já em fração 0..1
    };
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const up = parseStages(body.up);
  if (!up) return NextResponse.json({ error: 'up deve ter exatamente 3 stages' }, { status: 400 });

  const inputs: AovInputs = {
    front: num(body.front),
    orders: Math.max(1, Math.round(num(body.orders, 1))),
    target: num(body.target),
    up,
  };
  if (inputs.target <= 0) return NextResponse.json({ error: 'target inválido' }, { status: 400 });

  try {
    const comp = computeAov(inputs);

    // Sugestão: lift histórico por afiliado (últimos 7d) → bump proporcional.
    let suggestedRuleUpdates: ReturnType<typeof buildRuleSuggestions> = { scenario: comp.easiestLabel, rules: [] };
    try {
      const funnel = await getCopyFunnel({ period: '7d', target: inputs.target });
      suggestedRuleUpdates = buildRuleSuggestions({
        easiestLabel: comp.easiestLabel,
        gap: comp.gap,
        affiliates: funnel.byAffiliate.map((a) => ({ key: a.key, liftPp: a.liftPp, currentPct: a.currentPct })),
        liftThresholdPp: DEFAULT_AUTOTUNE_CONFIG.liftThresholdPp,
      });
    } catch (err) {
      logger.warn({ err }, 'copy-aov-calculator: suggestion step failed (returning scenarios anyway)');
    }

    return NextResponse.json({
      baselineAov: comp.baselineAov,
      gap: comp.gap,
      easiestScenario: comp.easiestLabel,
      scenarios: comp.scenarios,
      suggestedRuleUpdates,
    });
  } catch (err) {
    logger.error({ err }, 'copy-aov-calculator failed');
    return NextResponse.json({ error: 'calculation failed' }, { status: 500 });
  }
}
