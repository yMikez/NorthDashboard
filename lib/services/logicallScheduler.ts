// Scheduler in-process do sync da Logicall.
//
// O dashboard não tem cron (o do n8n pra MV segue pendente — memória do
// projeto), então o próprio processo Node, que é long-running na VPS, roda
// o polling. Duas cadências:
//   - a cada 30 min: janela CURTA (3 dias) — venda nova aparece rápido;
//   - 1x por dia (a cada 48 ticks): janela LONGA (45 dias) — a API filtra
//     por dateCreated, então mudança NA LINHA da venda semanas depois
//     (fulfillment PENDING→SHIPPED, chargeback marcado) só é recapturada
//     relendo a venda antiga.
// Primeira rodada 60s após o boot (já longa, pra cobrir o que perdeu
// enquanto o processo esteve fora). Timers unref'd. Sem chave → pulado.
//
// Armado a partir de instrumentation.ts (register() do Next, runtime nodejs).
// Idempotente: startLogicallScheduler() múltiplas vezes = 1 timer.

import {
  syncLogicall, windowOfDays, LogicallNotConfiguredError, LogicallSyncBusyError,
} from './logicallSync';
import { logger } from '../logger';

const FIRST_RUN_DELAY_MS = 60_000;
const INTERVAL_MS = 30 * 60_000;
const LONG_EVERY_TICKS = 48;      // 48 × 30 min = 24 h
export const LONG_WINDOW_DAYS = 45;

let started = false;
let ticks = 0;

async function tick(long: boolean): Promise<void> {
  try {
    await syncLogicall(long ? windowOfDays(LONG_WINDOW_DAYS) : undefined, {
      source: long ? 'scheduler-logicall-long' : 'scheduler-logicall',
    });
  } catch (err) {
    if (err instanceof LogicallNotConfiguredError || err instanceof LogicallSyncBusyError) return;
    logger.warn({ err, long }, '[logicallScheduler] rodada falhou (tenta de novo no próximo tick)');
  }
}

export function startLogicallScheduler(): void {
  if (started) return;
  started = true;
  const first = setTimeout(() => {
    void tick(true);
    const every = setInterval(() => {
      ticks++;
      void tick(ticks % LONG_EVERY_TICKS === 0);
    }, INTERVAL_MS);
    every.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();
  logger.info({ intervalMin: INTERVAL_MS / 60_000, longWindowDays: LONG_WINDOW_DAYS }, '[logicallScheduler] armado');
}
