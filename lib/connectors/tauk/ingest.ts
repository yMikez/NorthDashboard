// Parser do feed da Tauk Solutions (serviço de recuperação de vendas por
// telefone/SMS). A Tauk chama o webhook do n8n via GET com os dados nos
// QUERY PARAMS (body vazio), com chaves inconsistentes ("Fulfillment Status",
// "Purchase Date", "purchase amount", fname, lname...). O n8n encaminha o
// objeto query como JSON pro dashboard.
//
// Payload observado (2026-07-06):
//   Fulfillment Status=HOLD | Purchase Date=2026-07-06 13:52:41
//   purchase amount=207.00  | fname/lname/email/phone/address
//
// Sem ID de transação → chave de dedup = email|purchase-date (reenvio faz
// upsert). "Purchase Date" vem SEM timezone; a Tauk é operação US (recupera
// vendas de nutra US) → tratamos como America/New_York, mesmo racional do
// BuyGoods (ver lib/connectors/buygoods/ingest.ts, Gotcha 2). Valor em USD.

import { wallClockToUtc } from '../../shared/datetime';

export interface TaukSaleInput {
  externalKey: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  amountUsd: number;
  fulfillmentStatus: string | null;
  purchasedAt: Date;
}

// Normaliza chave: minúsculo, só alfanumérico ("Fulfillment Status" →
// "fulfillmentstatus", "purchase amount" → "purchaseamount"). Tolerante a
// variações de caixa/espaço/underscore que webhooks assim costumam ter.
function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const FIELD_ALIASES: Record<string, string[]> = {
  email: ['email', 'emailaddress', 'customeremail'],
  firstName: ['fname', 'firstname', 'first'],
  lastName: ['lname', 'lastname', 'last'],
  phone: ['phone', 'phonenumber', 'telephone'],
  address: ['address', 'address1', 'street'],
  amount: ['purchaseamount', 'amount', 'total', 'purchasetotal', 'price'],
  status: ['fulfillmentstatus', 'status', 'orderstatus'],
  date: ['purchasedate', 'date', 'purchasedatetime', 'orderdate'],
};

export function parseTaukPayload(raw: Record<string, unknown>): TaukSaleInput {
  const byKey = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) byKey.set(normKey(k), s);
  }
  const pick = (field: keyof typeof FIELD_ALIASES): string | null => {
    for (const alias of FIELD_ALIASES[field]) {
      const v = byKey.get(alias);
      if (v) return v;
    }
    return null;
  };

  const email = pick('email');
  const dateRaw = pick('date');
  if (!email && !dateRaw) {
    throw new Error('Tauk payload sem email e sem Purchase Date — nada pra chavear');
  }

  const amountRaw = pick('amount');
  const amountUsd = amountRaw ? parseFloat(amountRaw.replace(/[^0-9.\-]/g, '')) : 0;

  // Wall clock America/New_York → UTC. Sem data → usa o momento do recebimento.
  const purchasedAt = (dateRaw && wallClockToUtc(dateRaw, 'America/New_York')) || new Date();

  // Dedup: payload não tem ID → email|data-crua. Estável entre reenvios do
  // mesmo evento; duas compras do mesmo cliente em segundos diferentes geram
  // chaves distintas (data tem precisão de segundo).
  const externalKey = `${(email ?? 'sem-email').toLowerCase()}|${dateRaw ?? 'sem-data'}`;

  return {
    externalKey,
    email,
    firstName: pick('firstName'),
    lastName: pick('lastName'),
    phone: pick('phone'),
    address: pick('address'),
    amountUsd: Number.isFinite(amountUsd) ? Math.round(amountUsd * 100) / 100 : 0,
    fulfillmentStatus: pick('status'),
    purchasedAt,
  };
}
