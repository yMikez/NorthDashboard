// SalesBound — razão de transações (import do export CSV do CRM deles) e a
// medição por período que alimenta o canal SalesBound do Lucro real.
//
// Lentes (mesmas do resto do dash):
//   faturamento  vendas SUCCESS por data da venda, MENOS os voids dessas
//                vendas (void = venda anulada no mesmo dia, nunca capturada)
//   vendas       nº de vendas SUCCESS com valor > 0, menos pedidos anulados
//   estornos     reembolsos SUCCESS por data do ESTORNO (parciais somam)
//   estornos (coorte) reembolsos das vendas do período, qualquer data

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { parseSalesboundTransactionsCsv, type SalesboundCsvParse } from '../connectors/salesbound/transactionsCsv';
import { parseSalesboundWebhookSale } from '../connectors/salesbound/webhook';

export interface SalesboundCoverage {
  firstAt: string;
  lastAt: string;
  importedAt: string;
  csvLastAt: string | null;
  webhookLastAt: string | null;
  webhookCount: number;
}

export interface SalesboundMeasured {
  gross: number;
  sales: number;
  refunds: number;
  refundsCohort: number;
  voids: number;
  coverage: SalesboundCoverage;
}

export interface SalesboundImportResult {
  campaign: string | null;
  dateRange: string | null;
  parsed: number;
  inserted: number;
  updated: number;
  skipped: SalesboundCsvParse['skipped'];
  unlinked: number;    // reembolso/void sem venda conhecida do pedido
  reconciled: number;  // linhas criadas pelo webhook que o export reidentificou
  success: { sales: number; salesUsd: number; refunds: number; refundsUsd: number; voids: number; voidsUsd: number };
  firstAt: string | null;
  lastAt: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function importSalesboundCsv(text: string): Promise<SalesboundImportResult> {
  const parsed = parseSalesboundTransactionsCsv(text);
  const rows = parsed.rows;

  // Data da venda de cada pedido: venda SUCCESS mais antiga no arquivo; o que
  // faltar (export só de estornos) vem do que já está no banco.
  const saleAtByOrder = new Map<string, Date>();
  for (const r of rows) {
    if (r.type !== 'SALE' || r.result !== 'SUCCESS') continue;
    const cur = saleAtByOrder.get(r.orderId);
    if (!cur || r.txnAt < cur) saleAtByOrder.set(r.orderId, r.txnAt);
  }
  const missing = [...new Set(rows.filter((r) => r.type !== 'SALE' && !saleAtByOrder.has(r.orderId)).map((r) => r.orderId))];
  if (missing.length) {
    const known = await db.salesboundTransaction.findMany({
      where: { orderId: { in: missing }, type: 'SALE', result: 'SUCCESS' },
      select: { orderId: true, txnAt: true }, orderBy: { txnAt: 'asc' },
    });
    for (const k of known) if (!saleAtByOrder.has(k.orderId)) saleAtByOrder.set(k.orderId, k.txnAt);
  }

  const existing = new Set(
    (await db.salesboundTransaction.findMany({ where: { transactionId: { in: rows.map((r) => r.transactionId) } }, select: { transactionId: true } }))
      .map((e) => e.transactionId),
  );

  // Linhas que o WEBHOOK já criou (chave clientTxnId, transactionId sintético
  // "wh:…"): o export agora traz o id de verdade → renomeia a MESMA linha em
  // vez de duplicar. Se as duas já existirem, a do webhook some.
  let reconciled = 0;
  const clientIds = rows.map((r) => r.clientTxnId).filter((x): x is string => !!x);
  if (clientIds.length) {
    const known = await db.salesboundTransaction.findMany({
      where: { clientTxnId: { in: clientIds } },
      select: { id: true, clientTxnId: true, transactionId: true },
    });
    const byClient = new Map(known.filter((k) => k.clientTxnId).map((k) => [k.clientTxnId as string, k]));
    for (const r of rows) {
      const hit = r.clientTxnId ? byClient.get(r.clientTxnId) : undefined;
      if (!hit || hit.transactionId === r.transactionId) continue;
      try {
        await db.salesboundTransaction.update({ where: { id: hit.id }, data: { transactionId: r.transactionId } });
        reconciled++;
      } catch {
        // já existe uma linha com o transactionId do export: a do webhook é a duplicata.
        await db.salesboundTransaction.delete({ where: { id: hit.id } }).catch(() => undefined);
        reconciled++;
      }
    }
  }

  let unlinked = 0;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ops = rows.slice(i, i + CHUNK).map((r) => {
      const saleAt = r.type === 'SALE' ? r.txnAt : (saleAtByOrder.get(r.orderId) ?? null);
      if (r.type !== 'SALE' && r.result === 'SUCCESS' && !saleAt) unlinked++;
      const data = {
        clientTxnId: r.clientTxnId, source: 'csv',
        orderId: r.orderId, type: r.type, result: r.result, amountUsd: new Prisma.Decimal(r.amountUsd), txnAt: r.txnAt, saleAt,
        chargedback: r.chargedback, agentName: r.agentName, customerId: r.customerId, email: r.email,
        sourcePlatform: r.sourcePlatform, merchant: r.merchant, response: r.response,
        items: r.items as unknown as Prisma.InputJsonValue, family: r.family, bottles: r.bottles,
      };
      return db.salesboundTransaction.upsert({ where: { transactionId: r.transactionId }, create: { transactionId: r.transactionId, ...data }, update: data });
    });
    await db.$transaction(ops);
  }

  const ok = rows.filter((r) => r.result === 'SUCCESS');
  const sum = (t: string) => r2(ok.filter((r) => r.type === t).reduce((s, r) => s + r.amountUsd, 0));
  const times = rows.map((r) => r.txnAt.getTime());
  const result: SalesboundImportResult = {
    campaign: parsed.meta.campaign, dateRange: parsed.meta.dateRange,
    parsed: rows.length, inserted: rows.filter((r) => !existing.has(r.transactionId)).length, updated: rows.filter((r) => existing.has(r.transactionId)).length,
    skipped: parsed.skipped.slice(0, 50), unlinked, reconciled,
    success: {
      sales: ok.filter((r) => r.type === 'SALE').length, salesUsd: sum('SALE'),
      refunds: ok.filter((r) => r.type === 'REFUND').length, refundsUsd: sum('REFUND'),
      voids: ok.filter((r) => r.type === 'VOID').length, voidsUsd: sum('VOID'),
    },
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
  logger.info({ ...result, skipped: parsed.skipped.length }, '[salesbound] export importado');
  // Export antigo (sem clientTxnId gravado) pode ter deixado par duplicado.
  const dedupe = await mergeWebhookIntoCsv();
  result.reconciled += dedupe.merged;
  return result;
}

/**
 * FASE 2 — evento do webhook vira linha do razão.
 *
 * Decisão do usuário (2026-09-17): o CRM deles não manda tipo de evento, então
 * TUDO conta como VENDA (só valor negativo vira REFUND). A linha nasce com
 * `transactionId` sintético "wh:<clientTxnId>" porque esse id só existe no
 * export; quando o CSV for importado, a mesma linha é reidentificada pelo
 * clientTxnId (não duplica). Linha que já veio do export NÃO é sobrescrita —
 * o CSV é mais rico (agente, resultado, recusa, origem do cliente).
 */
export type WebhookLedgerStatus = 'created' | 'updated' | 'kept-csv' | 'skipped';

export async function recordSalesboundWebhook(payload: Record<string, unknown>): Promise<{ status: WebhookLedgerStatus; clientTxnId: string | null; type?: string; amountUsd?: number }> {
  const sale = parseSalesboundWebhookSale(payload);
  if (!sale) return { status: 'skipped', clientTxnId: null };

  const existing = await db.salesboundTransaction.findUnique({ where: { clientTxnId: sale.clientTxnId }, select: { id: true, source: true } });
  if (existing?.source === 'csv') return { status: 'kept-csv', clientTxnId: sale.clientTxnId };

  // Estorno ancora na venda do mesmo pedido (se ela já estiver no razão).
  let saleAt: Date | null = sale.txnAt;
  if (sale.type !== 'SALE') {
    const parent = await db.salesboundTransaction.findFirst({
      where: { orderId: sale.orderId, type: 'SALE', result: 'SUCCESS' },
      select: { txnAt: true }, orderBy: { txnAt: 'asc' },
    });
    saleAt = parent?.txnAt ?? null;
  }
  const data = {
    clientTxnId: sale.clientTxnId, source: 'webhook',
    orderId: sale.orderId, type: sale.type, result: 'SUCCESS',
    amountUsd: new Prisma.Decimal(sale.amountUsd), txnAt: sale.txnAt, saleAt,
    chargedback: false, agentName: null, customerId: sale.customerId, email: sale.email,
    sourcePlatform: null, merchant: null,
    // Rastro do que o webhook mandou como id (o export chama esses campos de
    // txnId e de orderId-da-URL).
    response: [sale.gatewayTxnId ? `gateway:${sale.gatewayTxnId}` : null, sale.crmOrderId ? `crmOrder:${sale.crmOrderId}` : null].filter(Boolean).join(' ') || null,
    items: sale.items as unknown as Prisma.InputJsonValue, family: sale.family, bottles: sale.bottles,
  };
  if (existing) {
    await db.salesboundTransaction.update({ where: { id: existing.id }, data });
    return { status: 'updated', clientTxnId: sale.clientTxnId, type: sale.type, amountUsd: sale.amountUsd };
  }
  await db.salesboundTransaction.create({ data: { transactionId: `wh:${sale.clientTxnId}`, ...data } });
  return { status: 'created', clientTxnId: sale.clientTxnId, type: sale.type, amountUsd: sale.amountUsd };
}

/**
 * Junta linha de webhook com a linha do export que for a MESMA transação.
 *
 * Existe por causa dos exports importados antes de a coluna `clientTxnId`
 * existir: sem ela a reconciliação por chave não acha o par, e a mesma venda
 * ficaria contada duas vezes (uma por fonte). Casa por pedido + instante +
 * valor + tipo, copia o clientTxnId pra linha do export (assim os próximos
 * imports reconciliam sozinhos) e apaga a do webhook.
 */
export async function mergeWebhookIntoCsv(dryRun = false): Promise<{ candidates: number; merged: number; pairs: Array<{ clientTxnId: string | null; orderId: string; txnAt: string; amountUsd: number }> }> {
  const webhookRows = await db.salesboundTransaction.findMany({
    where: { source: 'webhook' },
    select: { id: true, clientTxnId: true, orderId: true, txnAt: true, amountUsd: true, type: true },
  });
  const pairs: Array<{ clientTxnId: string | null; orderId: string; txnAt: string; amountUsd: number }> = [];
  let merged = 0;
  for (const w of webhookRows) {
    const twin = await db.salesboundTransaction.findFirst({
      where: { source: 'csv', orderId: w.orderId, txnAt: w.txnAt, amountUsd: w.amountUsd, type: w.type },
      select: { id: true, clientTxnId: true },
    });
    if (!twin) continue;
    pairs.push({ clientTxnId: w.clientTxnId, orderId: w.orderId, txnAt: w.txnAt.toISOString(), amountUsd: Number(w.amountUsd) });
    if (dryRun) continue;
    await db.$transaction([
      db.salesboundTransaction.delete({ where: { id: w.id } }),
      ...(twin.clientTxnId ? [] : [db.salesboundTransaction.update({ where: { id: twin.id }, data: { clientTxnId: w.clientTxnId } })]),
    ]);
    merged++;
  }
  if (pairs.length) logger.info({ candidates: pairs.length, merged, dryRun }, '[salesbound] webhook × export: linhas duplicadas juntadas');
  return { candidates: pairs.length, merged, pairs: pairs.slice(0, 20) };
}

/** Reprocessa os IngestLogs do postback pro razão (nada se perde na fase 1). */
export async function replaySalesboundLogs(limit = 500): Promise<{ logs: number; created: number; updated: number; keptCsv: number; skipped: number }> {
  const logs = await db.ingestLog.findMany({
    where: { source: 'postback-salesbound' },
    orderBy: { receivedAt: 'asc' }, take: limit, select: { id: true, payload: true },
  });
  const out = { logs: logs.length, created: 0, updated: 0, keptCsv: 0, skipped: 0 };
  for (const l of logs) {
    const payload = (l.payload ?? {}) as Record<string, unknown>;
    const r = await recordSalesboundWebhook(payload);
    if (r.status === 'created') out.created++;
    else if (r.status === 'updated') out.updated++;
    else if (r.status === 'kept-csv') out.keptCsv++;
    else out.skipped++;
  }
  logger.info(out, '[salesbound] replay dos logs do postback');
  await mergeWebhookIntoCsv();
  return out;
}

/** Auditoria: o que cada fonte colocou no razão, por dia (dia BRT). */
export interface SalesboundDayStat { day: string; source: string; type: string; n: number; usd: number }

export async function salesboundBreakdown(start: Date, end: Date): Promise<SalesboundDayStat[]> {
  const rows = await db.$queryRaw<Array<{ day: string; source: string; type: string; n: bigint; usd: Prisma.Decimal }>>(Prisma.sql`
    SELECT to_char("txnAt" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
           "source", "type", COUNT(*) AS n, COALESCE(SUM("amountUsd"), 0) AS usd
    FROM "SalesboundTransaction"
    WHERE "result" = 'SUCCESS' AND "txnAt" >= ${start} AND "txnAt" <= ${end}
    GROUP BY 1, 2, 3
    ORDER BY 1 DESC, 2, 3`);
  return rows.map((r) => ({ day: r.day, source: r.source, type: r.type, n: Number(r.n), usd: Math.round(Number(r.usd) * 100) / 100 }));
}

/** Auditoria linha a linha (pra cruzar pedido × fonte quando algo não bate). */
export async function salesboundRows(start: Date, end: Date, take = 300) {
  const rows = await db.salesboundTransaction.findMany({
    where: { txnAt: { gte: start, lte: end } },
    select: { transactionId: true, clientTxnId: true, source: true, orderId: true, type: true, result: true, amountUsd: true, txnAt: true, email: true, family: true },
    orderBy: { txnAt: 'asc' }, take,
  });
  return rows.map((r) => ({ ...r, amountUsd: Number(r.amountUsd), txnAt: r.txnAt.toISOString() }));
}

/** Cobertura do razão (null = vazio → canal cai no manual). */
export async function salesboundCoverage(): Promise<SalesboundCoverage | null> {
  const [row] = await db.$queryRaw<Array<{ first: Date | null; last: Date | null; imported: Date | null; csv_last: Date | null; webhook_last: Date | null; webhook_n: bigint }>>(Prisma.sql`
    SELECT MIN("txnAt") AS first, MAX("txnAt") AS last, MAX("importedAt") AS imported,
           MAX("txnAt") FILTER (WHERE "source" = 'csv') AS csv_last,
           MAX("txnAt") FILTER (WHERE "source" = 'webhook') AS webhook_last,
           COUNT(*) FILTER (WHERE "source" = 'webhook') AS webhook_n
    FROM "SalesboundTransaction" WHERE "result" = 'SUCCESS'`);
  if (!row?.first || !row.last) return null;
  return {
    firstAt: row.first.toISOString(), lastAt: row.last.toISOString(), importedAt: (row.imported ?? row.last).toISOString(),
    csvLastAt: row.csv_last?.toISOString() ?? null,
    webhookLastAt: row.webhook_last?.toISOString() ?? null,
    webhookCount: Number(row.webhook_n ?? 0),
  };
}

export async function measureSalesbound(start: Date, end: Date): Promise<SalesboundMeasured | null> {
  const coverage = await salesboundCoverage();
  if (!coverage) return null;
  const [row] = await db.$queryRaw<Array<{ sales_usd: Prisma.Decimal; sales_n: bigint; voids_usd: Prisma.Decimal; voids_n: bigint; refunds_usd: Prisma.Decimal; refunds_cohort_usd: Prisma.Decimal }>>(Prisma.sql`
    SELECT
      COALESCE(SUM("amountUsd") FILTER (WHERE "type" = 'SALE' AND "txnAt" >= ${start} AND "txnAt" <= ${end}), 0) AS sales_usd,
      COUNT(*) FILTER (WHERE "type" = 'SALE' AND "amountUsd" > 0 AND "txnAt" >= ${start} AND "txnAt" <= ${end}) AS sales_n,
      COALESCE(SUM("amountUsd") FILTER (WHERE "type" = 'VOID' AND "saleAt" >= ${start} AND "saleAt" <= ${end}), 0) AS voids_usd,
      COUNT(DISTINCT "orderId") FILTER (WHERE "type" = 'VOID' AND "amountUsd" > 0 AND "saleAt" >= ${start} AND "saleAt" <= ${end}) AS voids_n,
      -- chargeback não tem data no export: entra pela data da venda.
      COALESCE(SUM("amountUsd") FILTER (WHERE "type" = 'REFUND' AND "txnAt" >= ${start} AND "txnAt" <= ${end}), 0)
        + COALESCE(SUM("amountUsd") FILTER (WHERE "type" = 'SALE' AND "chargedback" AND "txnAt" >= ${start} AND "txnAt" <= ${end}), 0) AS refunds_usd,
      COALESCE(SUM("amountUsd") FILTER (WHERE "type" = 'REFUND' AND "saleAt" >= ${start} AND "saleAt" <= ${end}), 0) AS refunds_cohort_usd
    FROM "SalesboundTransaction"
    WHERE "result" = 'SUCCESS'`);
  const n = (v: Prisma.Decimal | bigint | null | undefined) => (v == null ? 0 : Number(v));
  const voids = r2(n(row?.voids_usd));
  return {
    gross: r2(Math.max(0, n(row?.sales_usd) - voids)),
    sales: Math.max(0, n(row?.sales_n) - n(row?.voids_n)),
    refunds: r2(n(row?.refunds_usd)),
    refundsCohort: r2(n(row?.refunds_cohort_usd)),
    voids,
    coverage,
  };
}
