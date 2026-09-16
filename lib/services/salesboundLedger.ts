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

export interface SalesboundMeasured {
  gross: number;
  sales: number;
  refunds: number;
  refundsCohort: number;
  voids: number;
  coverage: { firstAt: string; lastAt: string; importedAt: string };
}

export interface SalesboundImportResult {
  campaign: string | null;
  dateRange: string | null;
  parsed: number;
  inserted: number;
  updated: number;
  skipped: SalesboundCsvParse['skipped'];
  unlinked: number;   // reembolso/void sem venda conhecida do pedido
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

  let unlinked = 0;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ops = rows.slice(i, i + CHUNK).map((r) => {
      const saleAt = r.type === 'SALE' ? r.txnAt : (saleAtByOrder.get(r.orderId) ?? null);
      if (r.type !== 'SALE' && r.result === 'SUCCESS' && !saleAt) unlinked++;
      const data = {
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
    skipped: parsed.skipped.slice(0, 50), unlinked,
    success: {
      sales: ok.filter((r) => r.type === 'SALE').length, salesUsd: sum('SALE'),
      refunds: ok.filter((r) => r.type === 'REFUND').length, refundsUsd: sum('REFUND'),
      voids: ok.filter((r) => r.type === 'VOID').length, voidsUsd: sum('VOID'),
    },
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
  logger.info({ ...result, skipped: parsed.skipped.length }, '[salesbound] export importado');
  return result;
}

/** Cobertura do razão (null = nunca importado → canal cai no manual). */
export async function salesboundCoverage(): Promise<SalesboundMeasured['coverage'] | null> {
  const [row] = await db.$queryRaw<Array<{ first: Date | null; last: Date | null; imported: Date | null }>>(Prisma.sql`
    SELECT MIN("txnAt") AS first, MAX("txnAt") AS last, MAX("importedAt") AS imported
    FROM "SalesboundTransaction" WHERE "result" = 'SUCCESS'`);
  if (!row?.first || !row.last) return null;
  return { firstAt: row.first.toISOString(), lastAt: row.last.toISOString(), importedAt: (row.imported ?? row.last).toISOString() };
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
