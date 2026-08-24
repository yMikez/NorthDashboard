// Sync (polling) das vendas recuperadas pela Logicall → CallCenterSale.
//
// A Logicall não tem webhook — só a API de transações por intervalo de
// datas (filtro por dateCreated). Estratégia em duas cadências (ver
// logicallScheduler): janela CURTA (últimos 3 dias) a cada 30 min pra pegar
// venda nova rápido, e janela LONGA (45 dias) uma vez por dia pra recapturar
// mudanças que acontecem NA LINHA DA VENDA depois — fulfillment
// PENDING→SHIPPED, isChargedback marcado semanas depois. Upsert por
// externalKey "logicall:<transactionId>" — idempotente.
//
// Estornos (REFUND/VOID/CHARGEBACK) vêm como transações próprias e são
// aplicados à venda-mãe:
//   - parcial (valor < venda) → venda segue APPROVED com refundedUsd
//     acumulado; receita líquida = venda − refundedUsd
//   - total → status REFUNDED/CHARGEBACK
//   - mãe ainda não sincronizada (venda anterior ao início da integração ou
//     backfill fora de ordem) → PLACEHOLDER: linha REFUNDED com amountUsd 0
//     e raw._placeholder, que a venda preenche quando chegar (o status de
//     estorno sobrevive ao update). Nunca se perde um estorno.
//
// Uma rodada de cada vez (mutex de módulo): scheduler + botão manual +
// n8n podem colidir no mesmo intervalo e o create duplicado estourava
// UNIQUE(externalKey) no meio do loop.
//
// Cada rodada grava UM IngestLog (platformSlug 'logicall', eventType 'sync')
// com o resumo — é o que a aba mostra como "última sincronização".

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { fetchLogicallTransactions } from '../connectors/logicall/client';
import { parseLogicallTransaction, externalKeyFor } from '../connectors/logicall/ingest';
import type { LogicallReversalInput, LogicallSaleInput } from '../connectors/logicall/ingest';
import { getLogicallApiKey } from './integrationSettings';
import { clearResponseCache } from '../cache/responseCache';
import { logger } from '../logger';

export interface LogicallSyncStats {
  startDate: string;
  endDate: string;
  fetched: number;
  sales: number;
  created: number;
  updated: number;
  reversals: number;
  reversalsApplied: number;
  reversalsPartial: number;
  reversalsOrphan: number;   // estorno sem venda-mãe → placeholder criado
  skipped: number;
  skipReasons: Record<string, number>;
  durationMs: number;
}

export class LogicallNotConfiguredError extends Error {
  constructor() {
    super('Logicall: chave da API não configurada (LOGICALL_API_KEY ou setting logicall.apiKey)');
    this.name = 'LogicallNotConfiguredError';
  }
}
export class LogicallSyncBusyError extends Error {
  constructor() {
    super('Logicall: já existe uma sincronização em andamento');
    this.name = 'LogicallSyncBusyError';
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Janela curta: hoje e os 2 dias anteriores (+1 dia de folga de fuso). */
export function defaultSyncWindow(now = new Date()): { startDate: string; endDate: string } {
  return windowOfDays(3, now);
}

/** Janela de N dias terminando amanhã (folga de fuso da Logicall). */
export function windowOfDays(days: number, now = new Date()): { startDate: string; endDate: string } {
  const end = new Date(now.getTime() + 24 * 3600_000);
  const start = new Date(now.getTime() - (days - 1) * 24 * 3600_000);
  return { startDate: ymd(start), endDate: ymd(end) };
}

let inFlight: Promise<LogicallSyncStats> | null = null;
export function isLogicallSyncRunning(): boolean {
  return inFlight !== null;
}

export async function syncLogicall(
  window?: { startDate: string; endDate: string },
  opts: { source?: string } = {},
): Promise<LogicallSyncStats> {
  if (inFlight) throw new LogicallSyncBusyError();
  inFlight = runSync(window, opts);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function runSync(
  window: { startDate: string; endDate: string } | undefined,
  opts: { source?: string },
): Promise<LogicallSyncStats> {
  const apiKey = await getLogicallApiKey();
  if (!apiKey) throw new LogicallNotConfiguredError();

  const { startDate, endDate } = window ?? defaultSyncWindow();
  const t0 = Date.now();
  const stats: LogicallSyncStats = {
    startDate, endDate, fetched: 0, sales: 0, created: 0, updated: 0,
    reversals: 0, reversalsApplied: 0, reversalsPartial: 0, reversalsOrphan: 0,
    skipped: 0, skipReasons: {}, durationMs: 0,
  };

  const log = await db.ingestLog.create({
    data: {
      source: opts.source ?? 'poll-logicall',
      platformSlug: 'logicall',
      eventType: 'sync',
      externalId: `${startDate}..${endDate}`,
      payload: { startDate, endDate },
      signatureOk: null,
    },
    select: { id: true },
  });

  try {
    const rows = await fetchLogicallTransactions(apiKey, startDate, endDate);
    stats.fetched = rows.length;

    const sales: LogicallSaleInput[] = [];
    const reversals: LogicallReversalInput[] = [];
    for (const row of rows) {
      const parsed = parseLogicallTransaction(row);
      if (parsed.kind === 'sale') sales.push(parsed);
      else if (parsed.kind === 'reversal') reversals.push(parsed);
      else {
        stats.skipped++;
        stats.skipReasons[parsed.reason] = (stats.skipReasons[parsed.reason] ?? 0) + 1;
      }
    }
    stats.sales = sales.length;
    stats.reversals = reversals.length;

    for (const s of sales) {
      const raw = rows.find((r) => String(r.transactionId) === s.externalId) ?? null;
      const base = {
        provider: 'logicall',
        externalId: s.externalId,
        orderId: s.orderId,
        email: s.email,
        firstName: s.firstName,
        lastName: s.lastName,
        phone: s.phone,
        address: s.address,
        state: s.state,
        country: s.country,
        amountUsd: s.amountUsd,
        fulfillmentStatus: s.fulfillmentStatus,
        productName: s.productName,
        productSku: s.productSku,
        family: s.family,
        bottles: s.bottles,
        agentName: s.agentName,
        purchasedAt: s.purchasedAt,
        raw: raw as unknown as object,
      };
      const existing = await db.callCenterSale.findUnique({
        where: { externalKey: s.externalKey },
        select: { id: true, status: true, refundedUsd: true },
      });
      if (!existing) {
        try {
          await db.callCenterSale.create({
            data: {
              ...base,
              externalKey: s.externalKey,
              status: s.status,
              refundedAt: s.status === 'CHARGEBACK' ? s.chargebackAt : null,
              refundedUsd: s.status === 'CHARGEBACK' ? s.chargebackUsd : null,
            },
          });
          stats.created++;
          continue;
        } catch (err) {
          // Corrida com outra rodada (mesmo externalKey criado entre o
          // findUnique e o create) → cai pro caminho de update.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        }
      }
      // UPDATE: nunca rebaixa REFUNDED/CHARGEBACK → APPROVED (o estorno
      // aplicado numa rodada anterior — ou o placeholder — tem que
      // sobreviver à re-sincronização da linha SALE, que não sabe disso).
      const keepReversal = existing?.status === 'REFUNDED' || existing?.status === 'CHARGEBACK';
      await db.callCenterSale.update({
        where: { externalKey: s.externalKey },
        data: {
          ...base,
          ...(s.status === 'CHARGEBACK'
            ? { status: 'CHARGEBACK', refundedAt: s.chargebackAt, refundedUsd: s.chargebackUsd }
            : keepReversal ? {} : { status: 'APPROVED' }),
        },
      });
      stats.updated++;
    }

    for (const r of reversals) {
      const parent = await findParentSale(r);
      if (!parent) {
        // Placeholder: guarda o estorno até a venda chegar.
        if (!r.parentTransactionId) { stats.reversalsOrphan++; continue; }
        await db.callCenterSale.upsert({
          where: { externalKey: externalKeyFor(r.parentTransactionId) },
          create: {
            externalKey: externalKeyFor(r.parentTransactionId),
            provider: 'logicall',
            externalId: r.parentTransactionId,
            orderId: r.orderId,
            status: r.status,
            amountUsd: 0,
            refundedAt: r.at,
            refundedUsd: r.amountUsd,
            purchasedAt: r.at,
            raw: { _placeholder: true, reason: 'estorno antes da venda ser sincronizada' },
          },
          update: {},
        });
        stats.reversalsOrphan++;
        continue;
      }
      const already = Number(parent.refundedUsd ?? 0);
      const total = already + r.amountUsd;
      const amount = Number(parent.amountUsd);
      // Parcial = ainda sobra valor na venda (tolerância de 1 centavo).
      const isFull = r.status === 'CHARGEBACK' || total >= amount - 0.01 || amount === 0;
      await db.callCenterSale.update({
        where: { id: parent.id },
        data: {
          status: isFull ? r.status : parent.status,
          refundedAt: r.at,
          refundedUsd: Math.min(total, amount || total),
        },
      });
      stats.reversalsApplied++;
      if (!isFull) stats.reversalsPartial++;
    }

    stats.durationMs = Date.now() - t0;
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date(), payload: stats as unknown as object },
    });
    logger.info({ ...stats, skipReasons: undefined }, 'logicall sync ok');
    return stats;
  } catch (err) {
    stats.durationMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: false, processedAt: new Date(), error: message.slice(0, 500), payload: stats as unknown as object },
    });
    logger.error({ err, startDate, endDate }, 'logicall sync failed');
    throw err;
  } finally {
    // Sempre: o status da integração (última rodada) faz parte da resposta
    // da aba, então até uma rodada sem mudança/falha precisa aparecer.
    clearResponseCache();
  }
}

/** Venda-mãe do estorno: parentTxnId → externalKey; fallback orderId (a
 *  transação mais recente do pedido, preferindo a de valor igual). */
async function findParentSale(r: LogicallReversalInput) {
  const sel = { id: true, status: true, amountUsd: true, refundedUsd: true } as const;
  if (r.parentTransactionId) {
    const byKey = await db.callCenterSale.findUnique({
      where: { externalKey: externalKeyFor(r.parentTransactionId) },
      select: sel,
    });
    if (byKey) return byKey;
  }
  if (!r.orderId) return null;
  const candidates = await db.callCenterSale.findMany({
    where: { provider: 'logicall', orderId: r.orderId, status: 'APPROVED' },
    orderBy: { purchasedAt: 'desc' },
    take: 10,
    select: sel,
  });
  if (candidates.length === 0) return null;
  return candidates.find((c) => Math.abs(Number(c.amountUsd) - r.amountUsd) < 0.01) ?? candidates[0];
}

/** Estado da integração pra aba: última rodada CONCLUÍDA + se há uma em voo. */
export async function getLogicallSyncStatus(): Promise<{
  configured: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastStats: Partial<LogicallSyncStats> | null;
}> {
  const [key, last] = await Promise.all([
    getLogicallApiKey(),
    db.ingestLog.findFirst({
      where: { platformSlug: 'logicall', eventType: 'sync', processedAt: { not: null } },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true, processedOk: true, error: true, payload: true },
    }),
  ]);
  return {
    configured: Boolean(key),
    running: isLogicallSyncRunning(),
    lastRunAt: last?.receivedAt.toISOString() ?? null,
    lastOk: last ? last.processedOk === true : null,
    lastError: last?.error ?? null,
    lastStats: (last?.payload as Partial<LogicallSyncStats> | null) ?? null,
  };
}
