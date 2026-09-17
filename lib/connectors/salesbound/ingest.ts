// SalesBound (parceira de cross-sell) — FASE 1: captura do postback.
//
// A SalesBound dispara um postback por evento (GET com macros na querystring
// ou POST JSON/form) pra URL que a gente entrega:
//   https://dash.thenorthscales.com/api/ingest/salesbound?token=<TOKEN>[&...]
// Ainda não sabemos o esquema deles — este parser só NORMALIZA o mínimo
// pra indexar o IngestLog (tipo do evento, id externo, flag de teste) e
// guarda o payload INTEIRO (query + body + meta). A modelagem de verdade
// (CallCenterSale provider 'salesbound', lucro BACK, aba) vem na fase 2,
// por replay dos IngestLogs — nada se perde enquanto isso.

export interface SalesboundCapture {
  eventType: string;          // minúsculas; 'unknown' quando não veio nada reconhecível
  externalId: string | null;  // id do pedido/transação, quando houver
  isTest: boolean;
  payload: Record<string, unknown>; // query (sem token) + body + _meta
}

// Chaves candidatas, em ordem de preferência (case-insensitive).
const EVENT_KEYS = ['event', 'event_type', 'eventtype', 'type', 'txn_type', 'transaction_type', 'status', 'action'];
// A transação vem primeiro: no CRM deles um orderId junta várias transações
// (venda + reembolsos) e o transactionId é a chave única do razão
// (SalesboundTransaction, mesma do export CSV).
const ID_KEYS = ['transaction_id', 'transactionid', 'txn_id', 'txid', 'order_id', 'orderid', 'invoice', 'invoice_id', 'sale_id', 'order', 'id'];
const SECRET_KEYS = new Set(['token', 'secret', 'api_key', 'apikey', 'postback_token', 'auth_token']);

function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) lower.set(k.toLowerCase(), v);
  for (const k of keys) {
    const v = lower.get(k);
    if (v == null) continue;
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    if (s) return s;
  }
  return null;
}

/**
 * Token mandado DENTRO do corpo (o CRM da SalesBound põe `"token"` no JSON e
 * não manda querystring). Só chaves de segredo conhecidas, string não-vazia.
 */
export function tokenFromBody(body: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(body)) {
    if (!SECRET_KEYS.has(k.toLowerCase())) continue;
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) return s;
  }
  return null;
}

/** Corpo cru → objeto. JSON (objeto ou array de 1), form-urlencoded, ou texto solto. */
export function parseSalesboundBody(raw: string, contentType: string | null): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};
  const ct = (contentType ?? '').toLowerCase();
  const tryJson = (): Record<string, unknown> | null => {
    try {
      const j: unknown = JSON.parse(text);
      if (Array.isArray(j)) return j.length === 1 && j[0] && typeof j[0] === 'object' ? (j[0] as Record<string, unknown>) : { _items: j };
      if (j && typeof j === 'object') return j as Record<string, unknown>;
      return { _value: j };
    } catch { return null; }
  };
  const tryForm = (): Record<string, unknown> | null => {
    if (!text.includes('=')) return null;
    const o = Object.fromEntries(new URLSearchParams(text));
    return Object.keys(o).length ? o : null;
  };
  if (ct.includes('json')) return tryJson() ?? tryForm() ?? { _raw: text };
  if (ct.includes('x-www-form-urlencoded')) return tryForm() ?? tryJson() ?? { _raw: text };
  return tryJson() ?? tryForm() ?? { _raw: text };
}

export function parseSalesboundPostback(
  query: Record<string, string>,
  body: Record<string, unknown>,
  meta: { method: string; contentType: string | null; userAgent: string | null; ip: string | null },
): SalesboundCapture {
  const q: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) if (!SECRET_KEYS.has(k.toLowerCase())) q[k] = v;
  const b: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (!SECRET_KEYS.has(k.toLowerCase())) b[k] = v;
  // body vence a query quando a mesma chave vem nos dois.
  const merged: Record<string, unknown> = { ...q, ...b };
  const eventRaw = pick(merged, EVENT_KEYS);
  const eventType = (eventRaw ?? 'unknown').toLowerCase().replace(/\s+/g, '_').slice(0, 64);
  const externalId = pick(merged, ID_KEYS);
  const testFlag = pick(merged, ['test', 'is_test', 'istest', 'sandbox']);
  const isTest = (testFlag != null && ['1', 'true', 'yes'].includes(testFlag.toLowerCase())) || /test/.test(eventType);
  return {
    eventType,
    externalId: externalId ? externalId.slice(0, 128) : null,
    isTest,
    payload: {
      ...merged,
      _meta: { method: meta.method, contentType: meta.contentType, userAgent: meta.userAgent, ip: meta.ip, queryKeys: Object.keys(q), bodyKeys: Object.keys(b) },
    },
  };
}
