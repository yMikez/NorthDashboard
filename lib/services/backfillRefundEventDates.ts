// Backfill one-shot: separa VENDA × ESTORNO nas linhas estornadas das
// plataformas in-place — o pré-requisito de dados do cohort de reembolso
// (Cohort.md).
//
// O que estava errado até 2026-08-18: nessas plataformas o IPN de estorno
// REESCREVE a linha da venda, e o upsert antigo deixava:
//   ClickBank/JVZoo — orderedAt = data do ESTORNO (o payload do evento é a
//     única fonte e o transactionTime/date dele é o estorno). A data da
//     venda sumia da linha; refundedAt ficava igual (lag 0) e approvedAt
//     era anulado.
//   Cartpanda — orderedAt = venda (created_at do pedido sobrevive ao
//     evento ✓), mas refundedAt = venda também (lag 0) e approvedAt nulo.
//   BuyGoods — nenhum IPN de refund observado em prod (0 linhas): nada a
//     backfillar.
//
// Reconstrução por plataforma:
//   CB/JVZoo:  refundedAt := orderedAt atual (que É o instante do estorno);
//              orderedAt/approvedAt := data da VENDA, recuperada do
//              IngestLog do evento de venda (SALE) parseado pelo connector
//              real. Sem log de venda (estorno de venda pré-ingestão) a
//              linha fica como está — approvedAt null a mantém FORA do
//              cohort, que é o comportamento certo (dia de venda
//              desconhecido ≠ dia do estorno).
//   Cartpanda: approvedAt := orderedAt (a venda foi aprovada); refundedAt/
//              chargebackAt := refunds[].created_at do IngestLog do evento
//              (fallback: receivedAt do log; sem log, receivedAt não existe
//              → mantém o valor atual e conta em skippedNoEventSource).
//
// Idempotente: recomputa o alvo e só escreve quando difere. O upsertOrder
// novo preserva as datas daqui pra frente — isto cobre só o legado.

import { db } from '../db';
import { parseClickBankIngest } from '../connectors/clickbank/ingest';
import type { ClickBankIngestPayload } from '../connectors/clickbank/types';
import { parseJvzooIngest } from '../connectors/jvzoo/ingest';
import { parseCartpandaTimestamp } from '../connectors/cartpanda/ingest';
import type { JvzooPayload } from '../connectors/jvzoo/types';
import { logger } from '../logger';

export interface RefundEventDatesBackfillStats {
  scanned: number;
  updated: number;
  alreadyCorrect: number;
  /** CB/JVZoo sem IngestLog de venda — estorno de venda pré-ingestão. */
  skippedNoSaleLog: number;
  /** Cartpanda sem log do evento de estorno. */
  skippedNoEventSource: number;
  parseErrors: number;
  byPlatform: Record<string, { scanned: number; updated: number }>;
}

// Eventos de VENDA por plataforma no IngestLog (eventType como o route grava).
// Inclui rebill: o receipt de um rebill é próprio e o log dele é BILL/'bill'
// — sem isso, refund de rebill viraria skippedNoSaleLog pra sempre.
const SALE_EVENT_TYPES: Record<string, string[]> = {
  clickbank: ['SALE', 'TEST_SALE', 'BILL', 'UNCANCEL_REBILL', 'UNCANCEL-REBILL'],
  jvzoo: ['sale', 'bill', 'uncancel-rebill'],
};

const CARTPANDA_REVERSAL_EVENTS = ['order.refunded', 'order.chargeback'];

export async function backfillRefundEventDates(): Promise<RefundEventDatesBackfillStats> {
  const stats: RefundEventDatesBackfillStats = {
    scanned: 0,
    updated: 0,
    alreadyCorrect: 0,
    skippedNoSaleLog: 0,
    skippedNoEventSource: 0,
    parseErrors: 0,
    byPlatform: {},
  };

  const platforms = await db.platform.findMany({
    where: { slug: { in: ['clickbank', 'jvzoo', 'cartpanda'] } },
    select: { id: true, slug: true },
  });

  for (const platform of platforms) {
    const bp = { scanned: 0, updated: 0 };
    stats.byPlatform[platform.slug] = bp;

    const rows = await db.order.findMany({
      where: { platformId: platform.id, status: { in: ['REFUNDED', 'CHARGEBACK'] } },
      select: {
        id: true, externalId: true, status: true,
        orderedAt: true, approvedAt: true, refundedAt: true, chargebackAt: true,
      },
    });

    for (const row of rows) {
      stats.scanned++;
      bp.scanned++;
      try {
        const target = platform.slug === 'cartpanda'
          ? await cartpandaTarget(row)
          : await saleLogTarget(platform.slug, row);

        if (!target) continue;

        const changed =
          row.orderedAt.getTime() !== target.orderedAt.getTime()
          || (row.approvedAt?.getTime() ?? null) !== target.approvedAt.getTime()
          || (row.refundedAt?.getTime() ?? null) !== (target.refundedAt?.getTime() ?? null)
          || (row.chargebackAt?.getTime() ?? null) !== (target.chargebackAt?.getTime() ?? null);
        if (!changed) {
          stats.alreadyCorrect++;
          continue;
        }
        await db.order.update({
          where: { id: row.id },
          data: {
            orderedAt: target.orderedAt,
            approvedAt: target.approvedAt,
            refundedAt: target.refundedAt,
            chargebackAt: target.chargebackAt,
            ...('originalGrossUsd' in target && target.originalGrossUsd != null
              ? { originalGrossUsd: target.originalGrossUsd }
              : {}),
          },
        });
        stats.updated++;
        bp.updated++;
      } catch (err) {
        stats.parseErrors++;
        logger.warn({ err, externalId: row.externalId, platform: platform.slug },
          '[backfillRefundEventDates] linha pulada');
      }
    }
  }

  async function saleLogTarget(
    slug: string,
    row: { externalId: string; status: string; orderedAt: Date },
  ) {
    const saleLog = await db.ingestLog.findFirst({
      where: {
        platformSlug: slug,
        externalId: row.externalId,
        eventType: { in: SALE_EVENT_TYPES[slug] ?? [] },
      },
      orderBy: { receivedAt: 'asc' },
      select: { payload: true },
    });
    if (!saleLog) {
      stats.skippedNoSaleLog++;
      return null;
    }
    const sale = slug === 'clickbank'
      ? parseClickBankIngest(saleLog.payload as unknown as ClickBankIngestPayload)
      : parseJvzooIngest(saleLog.payload as unknown as JvzooPayload);
    const saleAt = sale.orderedAt;
    // O orderedAt ATUAL da linha é o instante do estorno (o evento
    // sobrescreveu) — vira o refundedAt/chargebackAt antes de restaurarmos
    // a venda. Se um backfill anterior já rodou (orderedAt ≈ saleAt), o
    // refundedAt existente é mantido.
    const eventAt = row.orderedAt.getTime() === saleAt.getTime()
      ? null // já restaurado — não derive evento da venda
      : row.orderedAt;
    return {
      orderedAt: saleAt,
      approvedAt: saleAt,
      refundedAt: row.status === 'REFUNDED'
        ? (eventAt ?? (row as { refundedAt?: Date | null }).refundedAt ?? saleAt)
        : null,
      chargebackAt: row.status === 'CHARGEBACK'
        ? (eventAt ?? (row as { chargebackAt?: Date | null }).chargebackAt ?? saleAt)
        : null,
      // O gross da VENDA está no payload do SALE log — restaura o snapshot
      // pra lente de VALOR do cohort (linhas legadas guardavam ABS do valor
      // do estorno, que subestima a base em refund parcial).
      originalGrossUsd: sale.grossAmountUsd > 0 ? sale.grossAmountUsd : null,
    };
  }

  async function cartpandaTarget(
    row: { externalId: string; status: string; orderedAt: Date; refundedAt: Date | null; chargebackAt: Date | null },
  ) {
    // externalId = `${orderId}-${lineId}`; o log guarda o orderId puro.
    const orderId = row.externalId.split('-')[0];
    const evLog = await db.ingestLog.findFirst({
      where: {
        platformSlug: 'cartpanda',
        externalId: orderId,
        eventType: { in: CARTPANDA_REVERSAL_EVENTS },
      },
      orderBy: { receivedAt: 'desc' },
      select: { payload: true, receivedAt: true },
    });
    let eventAt: Date | null = null;
    if (evLog) {
      const payload = evLog.payload as unknown as {
        order?: { refunds?: Array<{ created_at?: string }> | null };
      };
      const stamps = (payload.order?.refunds ?? [])
        .map((r) => r?.created_at)
        .filter((v): v is string => !!v)
        .sort();
      const last = stamps[stamps.length - 1];
      // parseTimestamp do PRÓPRIO connector — created_at pode vir wall clock
      // ("2026-08-18 09:50:21") OU ISO com Z; a regra de parse é uma só.
      eventAt = last ? parseCartpandaTimestamp(last) : evLog.receivedAt;
    }
    if (!eventAt) {
      // Sem log do evento: mantém o refundedAt atual se já difere da venda
      // (ingest pós-fix); senão não há fonte — conta e pula.
      const current = row.status === 'REFUNDED' ? row.refundedAt : row.chargebackAt;
      if (current && current.getTime() !== row.orderedAt.getTime()) {
        eventAt = current;
      } else {
        stats.skippedNoEventSource++;
        return null;
      }
    }
    return {
      orderedAt: row.orderedAt,          // já é a venda (created_at sobrevive)
      approvedAt: row.orderedAt,         // a venda foi aprovada antes do estorno
      refundedAt: row.status === 'REFUNDED' ? eventAt : null,
      chargebackAt: row.status === 'CHARGEBACK' ? eventAt : null,
    };
  }

  return stats;
}
