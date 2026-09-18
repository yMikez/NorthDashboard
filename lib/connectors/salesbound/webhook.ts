// SalesBound — FASE 2: webhook do CRM deles → linha do razão
// (SalesboundTransaction). Parser PURO; a gravação fica no
// lib/services/salesboundLedger.ts.
//
// O payload é de PEDIDO, não de evento: não diz se é venda, reembolso ou
// recusa (perguntado a eles em 2026-09-17, sem resposta). Decisão do usuário
// no mesmo dia: TRATAR TUDO COMO VENDA. A única exceção é valor negativo —
// aí registra como REFUND, senão um estorno entraria somando faturamento.
//
// IDs (os nomes NÃO batem com os do export CSV — ver ingest.ts):
//   clientTxnId   → chave da transação e PONTE com o export (@unique no razão)
//   clientOrderID → pedido que agrupa venda + estornos (= orderId do export)
//   transactionId → id do gateway, repete; orderId → pedido no CRM
//
// Datas: `dateCreated` vem "2026-09-17 16:23:08" (ou só a data, com a hora em
// `timeCreated`), wall clock America/New_York — mesma premissa do export.

import { wallClockToUtc } from '../../shared/datetime';
import { classifyProduct } from '../../services/productClassification';
import { SALESBOUND_TIMEZONE, type SalesboundItem } from './transactionsCsv';

export interface SalesboundWebhookSale {
  clientTxnId: string;
  orderId: string;
  type: 'SALE' | 'REFUND';
  amountUsd: number;
  txnAt: Date;
  email: string | null;
  customerId: string | null;
  gatewayTxnId: string | null;
  crmOrderId: string | null;
  items: SalesboundItem[];
  family: string | null;
  bottles: number | null;
}

const str = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return t ? t : null;
};
const money = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Junta dateCreated + timeCreated no instante UTC (wall clock Eastern). */
export function salesboundWebhookDate(dateCreated: unknown, timeCreated: unknown): Date | null {
  const d = str(dateCreated);
  if (!d) return null;
  const withTime = /\d{4}-\d{2}-\d{2}[T\s]+\d{2}:\d{2}/.test(d) ? d : `${d} ${str(timeCreated) ?? '00:00:00'}`;
  return wallClockToUtc(withTime, SALESBOUND_TIMEZONE);
}

/**
 * Payload do webhook → linha do razão. `null` quando falta o mínimo
 * (clientTxnId ou data) — o IngestLog continua guardado pra replay.
 */
export function parseSalesboundWebhookSale(payload: Record<string, unknown>): SalesboundWebhookSale | null {
  const clientTxnId = str(payload.clientTxnId) ?? str(payload.clienttxnid);
  const txnAt = salesboundWebhookDate(payload.dateCreated, payload.timeCreated);
  if (!clientTxnId || !txnAt) return null;

  const items: SalesboundItem[] = [];
  for (let n = 1; n <= 20; n++) {
    const name = str(payload[`product${n}_name`]);
    if (!name) continue;
    // `product{n}_crmId` é o mesmo id que o export traz em "product{n} id".
    const sku = str(payload[`product${n}_crmId`]) ?? str(payload[`product${n}_id`]) ?? str(payload[`product${n}_sku`]);
    const c = classifyProduct(str(payload[`product${n}_sku`]) ?? sku ?? 'salesbound', name, 'salesbound');
    items.push({
      name, sku, qty: money(payload[`product${n}_qty`]), price: money(payload[`product${n}_price`]),
      family: c.family ? c.family.replace(/[\s-]+$/, '') || null : null, bottles: c.bottles ?? null,
    });
  }
  const top = items.reduce<SalesboundItem | null>((best, it) => (!best || it.price > best.price ? it : best), null);
  const qty = items.reduce((s, it) => s + it.qty, 0);
  const total = money(payload.totalPrice);

  return {
    clientTxnId,
    // Sem clientOrderID o pedido fica sendo a própria transação (não agrupa
    // nada, mas mantém a linha íntegra até o CSV trazer o pedido de verdade).
    orderId: str(payload.clientOrderID) ?? str(payload.clientOrderId) ?? clientTxnId,
    type: total < 0 ? 'REFUND' : 'SALE',
    amountUsd: Math.round(Math.abs(total) * 100) / 100,
    txnAt,
    email: str(payload.emailAddress)?.toLowerCase() ?? null,
    customerId: str(payload.customerId),
    gatewayTxnId: str(payload.transactionId),
    crmOrderId: str(payload.orderId),
    items,
    family: top?.family ?? null,
    bottles: qty > 0 ? Math.round(qty) : null,
  };
}
