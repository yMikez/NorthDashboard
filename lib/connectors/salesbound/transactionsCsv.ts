// SalesBound — parser PURO do export "Transaction Details" do CRM deles
// (CheckoutChamp). Formato observado (2026-09-16):
//
//   Transaction Details
//   Date Range (by transactionDate): 2025-09-16 00:00:00 - 2026-09-16 23:59:59
//   Campaign Id: 7
//   Campaign Name: Salesbound - Phone Sales Team
//   <linha vazia>
//   date,orderId,orderAgentName,…,type,amount,…,result,response,…   ← 207 colunas
//   "2026-09-15 22:52:29",74916789FB,Sam.Abbasi-NorthScale,…
//   …
//   Total,,,…,"178,911.78",…                                          ← rodapé
//
// Uma linha por TRANSAÇÃO: Sale (inclusive recusadas — result Soft/Hard
// Decline), Refund (valor negativo, pode ser parcial e mais de um por pedido)
// e Void (anula a venda no mesmo dia). Valores com milhar ("2,970.00").
// custom3 diz de onde veio o cliente ("BuyGoods Order", "JVZoo Order",
// "Digistore24 Order", "cartpanda_pay"); produtos em product1..20.

import { wallClockToUtc } from '../../shared/datetime';
import { classifyProduct } from '../../services/productClassification';

export const SALESBOUND_TIMEZONE = 'America/New_York';

export interface SalesboundItem { name: string; sku: string | null; qty: number; price: number; family: string | null; bottles: number | null }

export interface SalesboundTxnRow {
  transactionId: string;
  orderId: string;
  type: string;        // SALE | REFUND | VOID | …
  result: string;      // SUCCESS | SOFT_DECLINE | HARD_DECLINE | …
  amountUsd: number;   // absoluto
  txnAt: Date;
  chargedback: boolean;
  agentName: string | null;
  customerId: string | null;
  email: string | null;
  sourcePlatform: string | null;
  merchant: string | null;
  response: string | null;
  items: SalesboundItem[];
  family: string | null;
  bottles: number | null;
}

export interface SalesboundCsvParse {
  meta: { campaign: string | null; campaignId: string | null; dateRange: string | null };
  rows: SalesboundTxnRow[];
  skipped: Array<{ line: number; reason: string }>;
}

/** CSV RFC 4180 (aspas duplas escapadas, vírgula e quebra dentro de aspas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const money = (v: string | undefined): number => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: string | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};
const upperSnake = (v: string | undefined): string => (v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'UNKNOWN';

const SOURCE_MAP: Array<[RegExp, string]> = [
  [/buygoods/i, 'buygoods'], [/jvzoo/i, 'jvzoo'], [/digistore/i, 'digistore24'],
  [/cartpanda/i, 'cartpanda'], [/clickbank/i, 'clickbank'],
];
export function sourcePlatformOf(custom3: string | undefined): string | null {
  const t = (custom3 ?? '').trim();
  if (!t) return null;
  for (const [re, slug] of SOURCE_MAP) if (re.test(t)) return slug;
  return null;
}

export function parseSalesboundTransactionsCsv(text: string): SalesboundCsvParse {
  const all = parseCsv(text.replace(/^\uFEFF/, ''));
  const meta: SalesboundCsvParse['meta'] = { campaign: null, campaignId: null, dateRange: null };
  const headerIdx = all.findIndex((r) => r[0]?.trim() === 'date' && r[1]?.trim() === 'orderId');
  for (const r of all.slice(0, headerIdx < 0 ? 10 : headerIdx)) {
    const line = r.join(',');
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^Campaign Name:\s*(.+)$/i))) meta.campaign = m[1].trim();
    else if ((m = line.match(/^Campaign Id:\s*(.+)$/i))) meta.campaignId = m[1].trim();
    else if ((m = line.match(/^Date Range[^:]*:\s*(.+)$/i))) meta.dateRange = m[1].trim();
  }
  if (headerIdx < 0) return { meta, rows: [], skipped: [{ line: 0, reason: 'cabeçalho "date,orderId,…" não encontrado — é o export Transaction Details?' }] };

  const header = all[headerIdx].map((h) => h.trim());
  const col = new Map(header.map((h, i) => [h, i]));
  for (const need of ['date', 'orderId', 'type', 'amount', 'result', 'transactionId']) {
    if (!col.has(need)) return { meta, rows: [], skipped: [{ line: headerIdx + 1, reason: `coluna obrigatória ausente: ${need}` }] };
  }
  const get = (r: string[], name: string): string | undefined => { const i = col.get(name); return i == null ? undefined : r[i]; };

  const rows: SalesboundTxnRow[] = [];
  const skipped: SalesboundCsvParse['skipped'] = [];
  for (let i = headerIdx + 1; i < all.length; i++) {
    const r = all[i];
    const date = (r[0] ?? '').trim();
    if (!date || /^total$/i.test(date)) continue;          // vazio / rodapé
    const line = i + 1;
    const txnAt = wallClockToUtc(date, SALESBOUND_TIMEZONE);
    if (!txnAt) { skipped.push({ line, reason: `data inválida: ${date.slice(0, 40)}` }); continue; }
    const transactionId = str(get(r, 'transactionId'));
    const orderId = str(get(r, 'orderId'));
    if (!transactionId || !orderId) { skipped.push({ line, reason: 'sem transactionId/orderId' }); continue; }

    const items: SalesboundItem[] = [];
    for (let n = 1; n <= 20; n++) {
      const name = str(get(r, `product${n} name`));
      if (!name) continue;
      const sku = str(get(r, `product${n} id`));
      const c = classifyProduct(sku ?? 'salesbound', name, 'salesbound');
      items.push({
        name, sku, qty: money(get(r, `product${n} qty`)), price: money(get(r, `product${n} price`)),
        // nome desconhecido pro classificador sai com o " -" do "X - 1 Bottle"
        family: c.family ? c.family.replace(/[\s-]+$/, '') || null : null, bottles: c.bottles ?? null,
      });
    }
    const top = items.reduce<SalesboundItem | null>((best, it) => (!best || it.price > best.price ? it : best), null);
    const qty = items.reduce((s, it) => s + it.qty, 0);

    rows.push({
      transactionId, orderId,
      type: upperSnake(get(r, 'type')),
      result: upperSnake(get(r, 'result')),
      amountUsd: Math.round(Math.abs(money(get(r, 'amount'))) * 100) / 100,
      txnAt,
      chargedback: (get(r, 'isChargedback') ?? '').trim() === '1',
      agentName: str(get(r, 'orderAgentName')),
      customerId: str(get(r, 'customerId')),
      email: str(get(r, 'emailAddress'))?.toLowerCase() ?? null,
      sourcePlatform: sourcePlatformOf(get(r, 'custom3')),
      merchant: str(get(r, 'merchantName')),
      response: str(get(r, 'response')),
      items,
      family: top?.family ?? null,
      bottles: qty > 0 ? Math.round(qty) : null,
    });
  }
  return { meta, rows, skipped };
}
