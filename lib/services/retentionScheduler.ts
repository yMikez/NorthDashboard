// Scheduler in-process do pull da retenção (SendTrace).
//
// 30 minutos — cadência pedida por eles em 25/09. Primeira rodada 90s após
// o boot (depois da Logicall e do mapping, pra não disputar o start).
// Sem URL/chave configurada, cada tick é um no-op silencioso: a integração
// fica armada esperando eles subirem o endpoint.
//
// Armado em instrumentation.ts. Idempotente: chamar duas vezes = 1 timer.

import { syncRetention, relinkOrphanRetention, RetentionNotConfiguredError, RetentionSyncBusyError } from './retentionSync';
import { logger } from '../logger';

const FIRST_RUN_DELAY_MS = 90_000;
const INTERVAL_MS = 30 * 60_000;

let started = false;
/** Não repetir o mesmo aviso de "não configurado" a cada 30 min no log. */
let warnedNotConfigured = false;

async function tick(): Promise<void> {
  try {
    await syncRetention({ source: 'scheduler-retencao' });
    warnedNotConfigured = false;
    await relinkOrphanRetention();
  } catch (err) {
    if (err instanceof RetentionSyncBusyError) return;
    if (err instanceof RetentionNotConfiguredError) {
      if (!warnedNotConfigured) {
        warnedNotConfigured = true;
        logger.info({ motivo: err.message }, '[retentionScheduler] integração ainda não configurada — pulando');
      }
      return;
    }
    logger.warn({ err }, '[retentionScheduler] rodada falhou (tenta de novo no próximo tick)');
  }
}

export function startRetentionScheduler(): void {
  if (started) return;
  started = true;
  const first = setTimeout(() => {
    void tick();
    const every = setInterval(() => { void tick(); }, INTERVAL_MS);
    every.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();
  logger.info({ intervalMin: INTERVAL_MS / 60_000 }, '[retentionScheduler] armado');
}
