// Backfill one-shot: reconstrói Order.refundedAt / Order.chargebackAt da
// Digistore a partir do payload guardado em rawMetadata.
//
// Contexto: até 2026-08-11 o upsertOrder carimbava refundedAt = orderedAt.
// Na Digistore o refund chega como LINHA EXTRA cujo orderedAt é a data da
// VENDA ORIGINAL (order_date_time), não a do estorno — então refundedAt
// virava a data da venda, "dias até reembolsar" dava 0 e o estorno de hoje
// nunca aparecia no dia de hoje.
//
// O payload sempre trouxe o par certo (transaction_date + transaction_time
// = o instante do estorno, wall clock Europe/Berlin), então dá pra
// reconstruir tudo sem tocar na plataforma. orderedAt NÃO é alterado — a
// coorte por data de venda é o que alimenta getObservedRefundCbPct (taxa
// real do modelo NET AFTER CPA).
//
// Idempotente: rodar de novo dá zero updates.

import { db } from '../db';
import { parseDigistoreEventTimestamp } from '../connectors/digistore24/ingest';
import type { DigistorePayload } from '../connectors/digistore24/types';

export interface DigistoreRefundDateBackfillStats {
  scanned: number;
  updated: number;
  alreadyCorrect: number;
  /** rawMetadata sem transaction_date/time — data do estorno indisponível. */
  skippedNoEventDate: number;
  /** Linhas vindas do export CSV: já nasceram com a data certa. */
  skippedCsvReconciled: number;
  /** Maior distância venda→estorno encontrada, em dias (sanidade). */
  maxLagDays: number;
}

const BATCH = 500;

export async function backfillDigistoreRefundDates(): Promise<DigistoreRefundDateBackfillStats> {
  const stats: DigistoreRefundDateBackfillStats = {
    scanned: 0,
    updated: 0,
    alreadyCorrect: 0,
    skippedNoEventDate: 0,
    skippedCsvReconciled: 0,
    maxLagDays: 0,
  };

  const platform = await db.platform.findUnique({
    where: { slug: 'digistore24' },
    select: { id: true },
  });
  if (!platform) return stats;

  // Pagina por id pra não carregar milhares de rawMetadata de uma vez.
  let cursor: string | undefined;
  for (;;) {
    const orders = await db.order.findMany({
      where: {
        platformId: platform.id,
        status: { in: ['REFUNDED', 'CHARGEBACK'] },
      },
      select: {
        id: true, status: true, orderedAt: true,
        refundedAt: true, chargebackAt: true, rawMetadata: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (orders.length === 0) break;
    cursor = orders[orders.length - 1].id;

    for (const o of orders) {
      stats.scanned++;
      const meta = (o.rawMetadata ?? {}) as DigistorePayload & { _source?: string };
      // Linhas criadas pelo reconcile do export já entraram com a data do
      // estorno resolvida (e em fuso diferente do IPN) — não reinterpretar.
      if (meta._source === 'csv-reconcile') {
        stats.skippedCsvReconciled++;
        continue;
      }
      const eventAt = parseDigistoreEventTimestamp(meta);
      if (!eventAt) {
        stats.skippedNoEventDate++;
        continue;
      }

      const current = o.status === 'REFUNDED' ? o.refundedAt : o.chargebackAt;
      if (current && current.getTime() === eventAt.getTime()) {
        stats.alreadyCorrect++;
        continue;
      }

      await db.order.update({
        where: { id: o.id },
        data: o.status === 'REFUNDED'
          ? { refundedAt: eventAt }
          : { chargebackAt: eventAt },
      });
      stats.updated++;

      const lagDays = (eventAt.getTime() - o.orderedAt.getTime()) / 86_400_000;
      if (lagDays > stats.maxLagDays) stats.maxLagDays = Math.round(lagDays * 10) / 10;
    }
  }

  return stats;
}
