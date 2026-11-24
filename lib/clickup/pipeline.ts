// ClickUp → decisões: leitura do chat, extração pela IA e correlação.
//
// Agendador in-process (mesmo modelo do da Logicall): 1ª rodada 2 min após o
// boot, depois a cada 30 min. Sem token configurado = pulado em silêncio.
// Teto de chamadas à IA por rodada (custo previsível): a fila de threads
// antigas anda aos poucos, liderança e recentes primeiro.

import { logger } from '../logger';
import { ClickUpNotConfiguredError } from './client';
import { ClickUpSyncBusyError, syncClickUp, type ClickUpSyncSummary } from './sync';
import { extractDecisions, type ExtractSummary } from '../decisions/extract';
import { refreshCorrelations } from '../decisions/correlate';

const FIRST_RUN_DELAY_MS = 120_000;
const INTERVAL_MS = 30 * 60_000;
export const AI_CALLS_PER_RUN = 20;

export interface PipelineResult {
  sync: ClickUpSyncSummary;
  extract: ExtractSummary;
  correlations: { done: number; errors: number };
}

let busy = false;

export async function runClickUpPipeline(opts: { source: string; aiCalls?: number }): Promise<PipelineResult> {
  if (busy) throw new ClickUpSyncBusyError();
  busy = true;
  try {
    const sync = await syncClickUp({ source: opts.source });
    const ex = await extractDecisions({ maxCalls: opts.aiCalls ?? AI_CALLS_PER_RUN });
    // Decisões novas primeiro; depois as que ficaram velhas.
    const fresh = ex.newIds.length ? await refreshCorrelations({ max: ex.newIds.length, ids: ex.newIds }) : { done: 0, errors: 0 };
    const stale = await refreshCorrelations({ max: 15 });
    const { newIds: _ids, ...extract } = ex;
    return { sync, extract, correlations: { done: fresh.done + stale.done, errors: fresh.errors + stale.errors } };
  } finally {
    busy = false;
  }
}

let started = false;

async function tick(): Promise<void> {
  try {
    await runClickUpPipeline({ source: 'scheduler-clickup' });
  } catch (err) {
    if (err instanceof ClickUpNotConfiguredError || err instanceof ClickUpSyncBusyError) return;
    logger.warn({ err }, '[clickup] rodada falhou (tenta de novo no próximo tick)');
  }
}

export function startClickUpScheduler(): void {
  if (started) return;
  started = true;
  const first = setTimeout(() => {
    void tick();
    const every = setInterval(() => { void tick(); }, INTERVAL_MS);
    every.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();
  logger.info({ intervalMin: INTERVAL_MS / 60_000, aiCallsPerRun: AI_CALLS_PER_RUN }, '[clickup] agendador armado');
}
