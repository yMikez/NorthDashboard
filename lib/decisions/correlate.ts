// Correlação decisão × métricas (números do dash, sem IA).
//
// Para cada decisão: média dos dias desde a decisão (até 30, fechando ontem)
// contra os mesmos tantos dias imediatamente antes, no escopo da decisão
// (plataformas/famílias que ela afeta; vazio = operação toda), nas métricas
// que a IA apontou. Sempre com o aviso de correlação.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { readWindow } from '../insights/windowMetrics';
import {
  buildShifts, correlationNarrative, correlationWindows, CORRELATION_DISCLAIMER,
  type MetricExpectation, type MetricShift,
} from './core';

export interface CorrelationSnapshot {
  status: 'cedo' | 'ok';
  before: { from: string; to: string; days: number };
  after: { from: string; to: string; days: number };
  scopeLabel: string;
  shifts: MetricShift[];
  narrative: string;
  disclaimer: string;
  computedAt: string;
}

/** Decisão recente (janela "depois" ainda crescendo) é refeita 1x por dia. */
const REFRESH_DAYS = 45;
const STALE_MS = 20 * 3_600_000;

export async function correlateDecision(id: string, now = new Date()): Promise<CorrelationSnapshot | null> {
  const d = await db.decision.findUnique({ where: { id } });
  if (!d) return null;
  const w = correlationWindows(d.decidedAt, now);
  const scope = (d.scope ?? {}) as { platforms?: string[]; families?: string[]; note?: string | null };
  const expectations = (Array.isArray(d.metrics) ? d.metrics : []) as unknown as MetricExpectation[];
  const platforms = scope.platforms?.length ? scope.platforms : undefined;
  const families = scope.families?.length ? scope.families : undefined;
  const scopeLabel = [
    platforms ? platforms.join(' + ') : null,
    families ? families.join(' + ') : null,
  ].filter(Boolean).join(' · ') || 'Operação toda';

  let shifts: MetricShift[] = [];
  if (!w.early && expectations.length) {
    const base = { platformSlugs: platforms, productFamilies: families };
    const [before, after] = await Promise.all([
      readWindow({ ...base, startDate: w.before.start, endDate: w.before.end }, false),
      readWindow({ ...base, startDate: w.after.start, endDate: w.after.end }, false),
    ]);
    shifts = buildShifts(expectations, before.totals, after.totals, { before: w.before.days, after: w.after.days });
  }
  const snap: CorrelationSnapshot = {
    status: w.early ? 'cedo' : 'ok',
    before: { from: w.before.from, to: w.before.to, days: w.before.days },
    after: { from: w.after.from, to: w.after.to, days: w.after.days },
    scopeLabel,
    shifts,
    narrative: correlationNarrative(d, w, shifts),
    disclaimer: CORRELATION_DISCLAIMER,
    computedAt: now.toISOString(),
  };
  await db.decision.update({
    where: { id },
    data: { correlation: JSON.parse(JSON.stringify(snap)) as Prisma.InputJsonValue, correlationAt: now },
  });
  return snap;
}

/** Sem correlação, ou recente e com mais de 20 h. Teto por rodada. */
export async function refreshCorrelations(opts: { max: number; ids?: string[] }): Promise<{ done: number; errors: number }> {
  const now = new Date();
  const ids = opts.ids?.length
    ? opts.ids
    : (await db.decision.findMany({
        where: {
          status: { not: 'DISCARDED' },
          OR: [
            { correlationAt: null },
            { correlationAt: { lt: new Date(now.getTime() - STALE_MS) }, decidedAt: { gte: new Date(now.getTime() - REFRESH_DAYS * 86_400_000) } },
          ],
        },
        orderBy: { decidedAt: 'desc' },
        take: opts.max,
        select: { id: true },
      })).map((r) => r.id);
  let done = 0;
  let errors = 0;
  for (const id of ids.slice(0, opts.max)) {
    try { await correlateDecision(id, now); done++; } catch (err) {
      errors++;
      logger.warn({ err, id }, '[decisions] correlação falhou');
    }
  }
  return { done, errors };
}
