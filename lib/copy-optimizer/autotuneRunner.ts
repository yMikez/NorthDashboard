// Fase 7 — orquestrador do auto-tune (I/O). Carrega config + regras com
// autotune ligado, computa métricas da janela por afiliado, chama o algoritmo
// puro decideAutotune, e (se não for dry-run) aplica o novo pct + grava
// AutotuneLog. Só grava log em MUDANÇAS — então o último log É a última
// mudança, o que alimenta o cooldown corretamente.

import { db } from '../db';
import { decideAutotune, DEFAULT_AUTOTUNE_CONFIG, type AutotuneConfig } from './autotune';
import { queryCopyFunnel, metricsFromViews } from '../services/copyFunnel';
import { invalidateRulesCache } from './rules';

export async function getAutotuneConfig(): Promise<AutotuneConfig> {
  const c = await db.copyAutotuneConfig.findUnique({ where: { id: 'global' } });
  if (!c) return DEFAULT_AUTOTUNE_CONFIG;
  return {
    cooldownH: c.cooldownH,
    windowH: c.windowH,
    minSample: c.minSample,
    liftThresholdPp: c.liftThresholdPp,
    adverseThresholdPp: c.adverseThresholdPp,
    globalTargetAov: Number(c.globalTargetAov),
  };
}

export interface AutotuneRunResult {
  processed: number;
  changed: number;
  dryRun: boolean;
  decisions: Array<{
    ruleKey: string;
    before: number;
    after: number;
    reason: string;
    changed: boolean;
  }>;
}

export async function runAutotune(opts: { dryRun?: boolean } = {}): Promise<AutotuneRunResult> {
  const dryRun = !!opts.dryRun;
  const config = await getAutotuneConfig();
  const now = Date.now();

  const rules = await db.affiliateCopyRule.findMany({
    where: { enabled: true, autotune: true },
    select: { id: true, key: true, black2Pct: true, minPct: true, maxPct: true, stepPct: true, targetAov: true },
  });

  const decisions: AutotuneRunResult['decisions'] = [];
  let changed = 0;

  for (const rule of rules) {
    const views = await queryCopyFunnel({
      period: '24h',
      windowHours: config.windowH,
      affiliate: rule.key,
      target: config.globalTargetAov,
    });
    const metrics = metricsFromViews(views);
    const lastLog = await db.autotuneLog.findFirst({
      where: { ruleId: rule.id },
      orderBy: { decidedAt: 'desc' },
      select: { decidedAt: true },
    });

    const decision = decideAutotune({
      rule: {
        black2Pct: rule.black2Pct,
        minPct: rule.minPct,
        maxPct: rule.maxPct,
        stepPct: rule.stepPct,
        targetAov: rule.targetAov != null ? Number(rule.targetAov) : null,
      },
      config,
      metrics,
      lastChangeAt: lastLog ? lastLog.decidedAt.getTime() : null,
      now,
    });

    if (decision.changed && !dryRun) {
      await db.$transaction([
        db.affiliateCopyRule.update({
          where: { id: rule.id },
          data: { black2Pct: decision.pctAfter, updatedBy: 'autotune' },
        }),
        db.autotuneLog.create({
          data: {
            ruleId: rule.id,
            pctBefore: decision.pctBefore,
            pctAfter: decision.pctAfter,
            reason: decision.reason,
            metrics: decision.metrics,
          },
        }),
      ]);
    }
    if (decision.changed) changed++;
    decisions.push({
      ruleKey: rule.key,
      before: decision.pctBefore,
      after: decision.pctAfter,
      reason: decision.reason,
      changed: decision.changed,
    });
  }

  if (changed > 0 && !dryRun) invalidateRulesCache();
  return { processed: rules.length, changed, dryRun, decisions };
}
