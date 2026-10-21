// Webhook da Vupim (https://vupim.com/docs/webhook, lido em 2026-10-21).
// POST JSON com envelope { id, event, timestamp, data }, assinado com
// HMAC-SHA256 do corpo cru no header X-Webhook-Signature ("sha256=<hex>").
// Valores em UNIDADE MÍNIMA da moeda (9700 USD = $97.00); datas ISO 8601 UTC.

export type VupimEventKey =
  | 'checkout.initiated'
  | 'sale.created'
  | 'sale.approved'
  | 'sale.declined'
  | 'sale.refunded'
  | 'sale.partial_refund'
  | 'sale.chargeback'
  | 'sale.shipped'
  | 'subscription.renewed'
  | 'subscription.payment_failed'
  | 'subscription.canceled'
  | 'checkout.abandoned'
  | 'webhook.test'
  | string;

export interface VupimCustomer {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface VupimShipping {
  name?: string | null;
  phone?: string | null;
  line1?: string | null;
  streetNumber?: string | null;
  line2?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/** Campos de `data` (cada evento usa um subconjunto — ver a doc). */
export interface VupimData {
  transactionId?: string | null;
  checkoutSessionId?: string | null;
  /** approved | pending | declined | refunded | partial_refund | chargeback */
  status?: string | null;
  currency?: string | null;
  amount?: number | null;
  /** credit_card | pix | boleto */
  paymentMethod?: string | null;
  country?: string | null;
  /** direct (checkout) | upsell (etapa do funil depois de outra venda) */
  origin?: string | null;
  productId?: string | null;
  productName?: string | null;
  offerId?: string | null;
  offerName?: string | null;
  affiliateId?: string | null;
  /** O que a conta do endpoint ganha (produtor: a parte dele). */
  commission?: number | null;
  /** Comissão do afiliado que indicou (só em endpoint de produtor). */
  affiliateCommission?: number | null;
  customer?: VupimCustomer | null;
  shipping?: VupimShipping | null;
  taxAmount?: number | null;
  reason?: string | null;
  refundAmount?: number | null;
  totalRefunded?: number | null;
  chargebackFee?: number | null;
  evidenceDeadline?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  clickId?: string | null;
  src?: string | null;
  sck?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export interface VupimEnvelope {
  /** Id da ENTREGA — igual em toda nova tentativa (chave de idempotência). */
  id: string;
  event: VupimEventKey;
  /** Quando o evento aconteceu (ISO 8601 UTC). */
  timestamp: string;
  data: VupimData;
}
