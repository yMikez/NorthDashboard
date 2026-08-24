// Normalização das transações da Logicall → CallCenterSale.
//
// Diferente da Tauk (webhook pobre), a Logicall entrega um export completo:
// ID de transação (dedup de verdade), items[] com produto/SKU/fulfillment,
// agente, e os campos de estorno. Uma linha da API pode ser:
//   - VENDA:   txnType SALE + responseType SUCCESS → linha APPROVED
//   - ESTORNO: txnType REFUND/VOID/CREDIT → evento aplicado à venda-mãe
//              (parentTxnId; fallback orderId) — não vira linha própria
//   - CHARGEBACK: txnType CHARGEBACK, ou a própria venda com
//              isChargedback=1 → status CHARGEBACK na venda
//   - DECLINED/ERROR ou tipos desconhecidos → ignorados (contados)
//
// Timezone: dateCreated vem SEM fuso. A Logicall é call center US e os
// agentes ("LC-…") operam em horário americano; assumimos America/New_York
// como a Tauk e o BuyGoods. PREMISSA A VALIDAR com o parceiro — se o dia de
// venda aparecer deslocado vs o painel deles, é aqui (mesma classe de bug
// da memória "platform timezones").

import { wallClockToUtc } from '../../shared/datetime';
import { classifyProduct } from '../../services/productClassification';
import type { LogicallItem, LogicallTransaction } from './types';

export const LOGICALL_TZ = 'America/New_York';

export interface LogicallSaleInput {
  kind: 'sale';
  externalKey: string;          // "logicall:<transactionId>"
  externalId: string;
  orderId: string | null;
  status: 'APPROVED' | 'CHARGEBACK';
  chargebackAt: Date | null;
  chargebackUsd: number | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  country: string | null;
  amountUsd: number;
  fulfillmentStatus: string | null;
  productName: string | null;
  productSku: string | null;
  family: string | null;
  bottles: number | null;
  agentName: string | null;
  purchasedAt: Date;
}

export interface LogicallReversalInput {
  kind: 'reversal';
  status: 'REFUNDED' | 'CHARGEBACK';
  parentTransactionId: string | null;
  orderId: string | null;
  amountUsd: number;
  at: Date;
}

export interface LogicallSkip {
  kind: 'skip';
  reason: string;
}

export type LogicallParsed = LogicallSaleInput | LogicallReversalInput | LogicallSkip;

const REVERSAL_TYPES = new Set(['REFUND', 'VOID', 'CREDIT', 'PARTIAL_REFUND']);

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function money(v: unknown): number {
  const n = Number.parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function when(raw: unknown): Date | null {
  const s = str(raw);
  if (!s) return null;
  return wallClockToUtc(s, LOGICALL_TZ);
}

export function externalKeyFor(transactionId: string): string {
  return `logicall:${transactionId}`;
}

/** Produto principal + potes somados de todos os items (classificador). */
function summarizeItems(items: LogicallItem[] | null | undefined) {
  const list = (items ?? []).filter((i) => i && (i.product || i.sku));
  if (list.length === 0) {
    return { productName: null, productSku: null, family: null, bottles: null, fulfillmentStatus: null };
  }
  const first = list[0];
  let bottles = 0;
  let anyBottles = false;
  let family: string | null = null;
  for (const it of list) {
    const c = classifyProduct(str(it.sku) ?? 'logicall', str(it.product), 'logicall');
    if (c.family && !family) family = c.family;
    const qty = Math.max(1, Number.parseInt(String(it.quantity ?? '1'), 10) || 1);
    if (c.bottles != null) {
      bottles += (c.bottles + (c.bonusBottles ?? 0)) * qty;
      anyBottles = true;
    }
  }
  return {
    productName: str(first.product),
    productSku: str(first.sku),
    family,
    bottles: anyBottles ? bottles : null,
    fulfillmentStatus: str(first.fulfillmentStatus),
  };
}

export function parseLogicallTransaction(t: LogicallTransaction): LogicallParsed {
  const txnType = (str(t.txnType) ?? '').toUpperCase();
  const response = (str(t.responseType) ?? '').toUpperCase();
  const transactionId = str(t.transactionId);
  if (!transactionId) return { kind: 'skip', reason: 'sem transactionId' };

  // Sem data parseável não dá pra ancorar a venda num dia — e cair em
  // "agora" faria a linha mudar de dia a cada re-sync. Pula com motivo.
  const at = when(t.dateCreated);
  if (!at) return { kind: 'skip', reason: 'sem dateCreated parseável' };
  const orderId = str(t.orderId) ?? str(t.clientOrderId);

  if (REVERSAL_TYPES.has(txnType) || txnType === 'CHARGEBACK') {
    if (response && response !== 'SUCCESS') {
      return { kind: 'skip', reason: `${txnType} com responseType ${response}` };
    }
    return {
      kind: 'reversal',
      status: txnType === 'CHARGEBACK' ? 'CHARGEBACK' : 'REFUNDED',
      parentTransactionId: str(t.parentTxnId),
      orderId,
      amountUsd: Math.abs(money(t.totalAmount)),
      at,
    };
  }

  if (txnType !== 'SALE') return { kind: 'skip', reason: `txnType ${txnType || '(vazio)'}` };
  if (response !== 'SUCCESS') return { kind: 'skip', reason: `SALE ${response || '(sem response)'}` };

  const items = summarizeItems(t.items);
  const chargedBack = String(t.isChargedback ?? '0') === '1';
  const address = [str(t.address1), str(t.address2), str(t.city)].filter(Boolean).join(', ') || null;

  return {
    kind: 'sale',
    externalKey: externalKeyFor(transactionId),
    externalId: transactionId,
    orderId,
    status: chargedBack ? 'CHARGEBACK' : 'APPROVED',
    chargebackAt: chargedBack ? (when(t.chargebackDate) ?? null) : null,
    chargebackUsd: chargedBack ? (money(t.chargebackAmount) || money(t.totalAmount)) : null,
    email: str(t.emailAddress)?.toLowerCase() ?? null,
    firstName: str(t.firstName),
    lastName: str(t.lastName),
    phone: str(t.phoneNumber),
    address,
    state: str(t.state),
    country: str(t.country),
    amountUsd: money(t.totalAmount),
    fulfillmentStatus: items.fulfillmentStatus,
    productName: items.productName,
    productSku: items.productSku,
    family: items.family,
    bottles: items.bottles,
    agentName: str(t.orderAgentName),
    purchasedAt: at,
  };
}

/** "lc-ai-process" e afins = agente de IA da Logicall; "LC-1234" = humano. */
export function isAiAgent(agentName: string | null | undefined): boolean {
  const a = agentName ?? '';
  if (/^LC-\d+$/i.test(a)) return false;
  return /\bai\b|-ai-|bot|auto/i.test(a);
}
