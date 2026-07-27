// Normalização do webhook JVZoo → NormalizedOrder.
//
// Dinheiro: o array transactionPayouts é a fonte de verdade dos rachos —
//   AFFILIATES     → cpaPaidUsd (o que o afiliado levou)
//   JVZOO DOT COM  → fees (taxa da plataforma)
//   net = total − tax − fees − cpa (JVZoo é USD-only).
//
// Sessão/funil: prekey = "WR-" + receipt. Na FE o prekey aponta pro
// PRÓPRIO transaction_id; a PREMISSA (a validar com o primeiro upsell
// real) é que em upsells ele aponta pro receipt da FE — então
// parentExternalId = prekey sem o prefixo agrupa a sessão, e
// prekey ≠ próprio id ⇒ UPSELL. rawMetadata guarda o payload inteiro
// pra forward-fix se a premissa falhar (padrão BG codename collision).
//
// Timestamp: `date` vem como wall clock SEM timezone. JVZoo (Flórida)
// segue o padrão BuyGoods: tratamos como America/New_York (EST/EDT via
// wallClockToUtc). Se o primeiro dia real mostrar offset, é 1 backfill
// igual ao 20260530120000_backfill_buygoods_eastern_offset.
//
// Assinatura: cverify (SHA-1 + secret) NÃO é validado aqui — o n8n é o
// único emissor e o endpoint valida x-ingest-secret (mesmo modelo do
// ClickBank/BuyGoods, onde a validação da plataforma fica upstream).

import type { NormalizedBillingType, NormalizedOrder, NormalizedOrderStatus, NormalizedProductType } from '../../shared/types';
import { wallClockToUtc } from '../../shared/datetime';
import type { JvzooPayload, JvzooPayout } from './types';

// País vem como enum verboso ("UNITED_STATES"). Mapeia pros ISO2 usados
// pelas outras plataformas (filtro de país da UI é um só). Fora do mapa,
// mantém o valor cru — aparece feio no filtro, mas não some.
const COUNTRY_ISO2: Record<string, string> = {
  UNITED_STATES: 'US', CANADA: 'CA', UNITED_KINGDOM: 'GB', AUSTRALIA: 'AU',
  NEW_ZEALAND: 'NZ', IRELAND: 'IE', GERMANY: 'DE', FRANCE: 'FR', ITALY: 'IT',
  SPAIN: 'ES', PORTUGAL: 'PT', NETHERLANDS: 'NL', BELGIUM: 'BE',
  SWITZERLAND: 'CH', AUSTRIA: 'AT', SWEDEN: 'SE', NORWAY: 'NO', DENMARK: 'DK',
  FINLAND: 'FI', POLAND: 'PL', CZECH_REPUBLIC: 'CZ', GREECE: 'GR',
  HUNGARY: 'HU', ROMANIA: 'RO', BRAZIL: 'BR', MEXICO: 'MX', ARGENTINA: 'AR',
  CHILE: 'CL', COLOMBIA: 'CO', PERU: 'PE', JAPAN: 'JP', SOUTH_KOREA: 'KR',
  SINGAPORE: 'SG', MALAYSIA: 'MY', PHILIPPINES: 'PH', THAILAND: 'TH',
  INDIA: 'IN', INDONESIA: 'ID', SOUTH_AFRICA: 'ZA', ISRAEL: 'IL',
  UNITED_ARAB_EMIRATES: 'AE', SAUDI_ARABIA: 'SA', TURKEY: 'TR',
};

function required(p: JvzooPayload, key: string): string {
  const value = p[key];
  if (!value) {
    throw new Error(`JVZoo payload missing required field: ${key}`);
  }
  return value;
}

function decimal(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// transactionPayouts é um JSON stringificado DENTRO do form-urlencoded.
// Tolerante: JSON quebrado/ausente → zeros (raw preserva pra investigação).
export function parsePayouts(raw: string | undefined): { affiliateUsd: number; platformFeeUsd: number } {
  if (!raw) return { affiliateUsd: 0, platformFeeUsd: 0 };
  let list: JvzooPayout[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { affiliateUsd: 0, platformFeeUsd: 0 };
    list = parsed as JvzooPayout[];
  } catch {
    return { affiliateUsd: 0, platformFeeUsd: 0 };
  }
  let affiliateUsd = 0;
  let platformFeeUsd = 0;
  for (const p of list) {
    const amount = decimal(p.payee_amount);
    const type = (p.payout_type ?? '').toUpperCase();
    if (type === 'AFFILIATES') affiliateUsd += amount;
    else if (type === 'JVZOO DOT COM') platformFeeUsd += amount;
    // VENDOR/JV = nós mesmos (o total já é o gross) — ignorados de propósito.
  }
  return { affiliateUsd: round2(affiliateUsd), platformFeeUsd: round2(platformFeeUsd) };
}

function mapStatus(transactionType: string): NormalizedOrderStatus {
  switch (transactionType) {
    case 'SALE':
    case 'BILL':
    case 'UNCANCEL-REBILL':
      return 'APPROVED';
    case 'RFND':
      return 'REFUNDED';
    case 'CGBK':
      return 'CHARGEBACK';
    case 'INSF':
    case 'CANCEL-REBILL':
      return 'CANCELED';
    default:
      return 'PENDING';
  }
}

function mapBillingType(raw: string | undefined): NormalizedBillingType {
  switch ((raw ?? '').toUpperCase()) {
    case 'RECURRING':
      return 'SUBSCRIPTION';
    case 'SINGLE':
    case 'STANDARD':
    case 'ONETIME':
      return 'SINGLE_PAYMENT';
    default:
      return 'UNKNOWN';
  }
}

// other_params é uma querystring embutida (vtid, sid1, aid, tid, utms...).
function parseOtherParams(raw: string | undefined): URLSearchParams {
  try {
    return new URLSearchParams(raw ?? '');
  } catch {
    return new URLSearchParams();
  }
}

export function parseJvzooIngest(payload: JvzooPayload): NormalizedOrder {
  const transactionId = required(payload, 'transaction_id');
  const transactionType = (payload.transaction_type ?? '').toUpperCase();

  // prekey "WR-<receipt>": na FE aponta pro próprio id (ver header).
  const prekeyBase = (payload.prekey ?? '').replace(/^WR-/, '') || transactionId;
  const productType: NormalizedProductType = prekeyBase !== transactionId ? 'UPSELL' : 'FRONTEND';

  const gross = decimal(payload.total);
  const tax = decimal(payload.tax_total);
  const { affiliateUsd, platformFeeUsd } = parsePayouts(payload.transactionPayouts);

  const other = parseOtherParams(payload.other_params);
  const countryRaw = payload.delivery_country ?? '';

  return {
    platformSlug: 'jvzoo',
    externalId: transactionId,
    parentExternalId: prekeyBase,
    previousTransactionId: null,
    vendorAccount: payload.vendor_name || payload.vendor_id || null,

    productExternalId: required(payload, 'product_id'),
    productName: payload.product_name || payload.sku || '',
    productType,

    affiliateExternalId: payload.affiliate_id || null,
    affiliateNickname: payload.affiliate_name || null,

    // Sem buyer id no payload — email é o identificador estável.
    customerExternalId: payload.customer_email || null,
    customerEmail: payload.customer_email || null,
    customerFirstName: payload.customer_first_name || null,
    customerLastName: payload.customer_last_name || null,
    customerLanguage: null,

    status: mapStatus(transactionType),
    eventType: transactionType.toLowerCase(),
    billingType: mapBillingType(payload.product_type),
    paySequenceNo: null,
    numberOfInstallments: null,

    currencyOriginal: 'USD',
    grossAmountOrig: gross,
    grossAmountUsd: gross,
    taxAmount: tax,
    fees: platformFeeUsd,
    netAmountUsd: round2(gross - tax - platformFeeUsd - affiliateUsd),
    cpaPaidUsd: affiliateUsd,

    paymentMethod: payload.payment_method || null,
    country: countryRaw ? (COUNTRY_ISO2[countryRaw] ?? countryRaw) : null,
    state: payload.delivery_region || null,
    city: payload.delivery_city || null,

    funnelSessionId: prekeyBase,
    funnelStep: null,
    clickId: other.get('vtid') || null,
    trackingId: other.get('tid') || payload.tid || null,
    campaignKey: other.get('utm_campaign') || null,
    // utm_source no link (quando o tráfego marca) — mesma atribuição de
    // fonte usada na Digistore (ex.: smsbrdcst na aba SMS).
    trafficSource: other.get('utm_source') || null,
    deviceType: null,
    browser: null,

    detailsUrl: null,

    orderedAt: parseJvzooTimestamp(payload.date),
    rawMetadata: payload as unknown as Record<string, unknown>,
  };
}

/**
 * "2026-07-26 04:25:29" como wall clock em America/New_York (premissa —
 * ver header). Fallback: agora (perder o horário exato < perder o evento).
 */
export function parseJvzooTimestamp(raw: string | undefined): Date {
  if (raw) {
    const d = wallClockToUtc(raw, 'America/New_York');
    if (d) return d;
  }
  return new Date();
}
