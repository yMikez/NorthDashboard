// Webhook da Vupim (https://vupim.com/docs/webhook, relido em 2026-10-22).
// POST JSON com envelope { id, eventId, event, timestamp, livemode, data },
// assinado no header X-Webhook-Signature ("t=<unix>,v1=<hex>" desde 21/10/2026,
// ou "sha256=<hex>" nos webhooks antigos). Valores em UNIDADE MÍNIMA da moeda
// (9700 USD = $97.00); campos *Usd em centavos de dólar; datas ISO 8601 UTC.

export type VupimEventKey =
  | 'checkout.initiated'
  | 'sale.created'
  | 'sale.approved'
  | 'sale.declined'
  | 'sale.refunded'
  | 'sale.partial_refund'
  | 'sale.chargeback'
  | 'sale.chargeback_won'
  | 'sale.chargeback_lost'
  | 'sale.shipped'
  | 'subscription.renewed'
  | 'subscription.payment_failed'
  | 'subscription.canceled'
  | 'checkout.abandoned'
  | 'webhook.test'
  | string;

export interface VupimCustomer {
  /** Igual em toda compra do mesmo comprador. */
  id?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  document?: string | null;
  country?: string | null;
  /** state/city vêm do endereço de entrega, quando há. */
  state?: string | null;
  city?: string | null;
  ip?: string | null;
  locale?: string | null;
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

export interface VupimItem {
  /** main | order_bump | kit */
  type?: string | null;
  productId?: string | null;
  offerId?: string | null;
  sku?: string | null;
  name?: string | null;
  productName?: string | null;
  quantity?: number | null;
  unitAmount?: number | null;
  discountAmount?: number | null;
  amount?: number | null;
}

export interface VupimAffiliate {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  commission?: number | null;
  /** 0.3 = 30% da venda antes do imposto. */
  commissionRate?: number | null;
  subIds?: Record<string, string | null> | null;
}

/** Campos de `data` (cada evento usa um subconjunto — ver a doc). */
export interface VupimData {
  transactionId?: string | null;
  /** Venda que abriu o funil (front de um upsell/downsell; 1ª cobrança de uma renovação). */
  parentTransactionId?: string | null;
  /** Sessão em que o funil começou: igual na venda de front e em todos os upsells/downsells. */
  checkoutSessionId?: string | null;
  stepCheckoutSessionId?: string | null;
  /** direct | upsell | downsell | renewal | call_center */
  origin?: string | null;
  /** 1 = primeira página depois da compra; null na venda que abriu o funil. */
  funnelStep?: number | null;
  funnelStepName?: string | null;
  /** Só cresce ao longo da vida da venda: guardar a maior e ignorar evento com menor. */
  version?: number | null;
  /** approved | pending | declined | refunded | partial_refund | chargeback | chargeback_won | chargeback_lost */
  status?: string | null;
  currency?: string | null;
  amount?: number | null;
  /** credit_card | pix | boleto */
  paymentMethod?: string | null;
  country?: string | null;
  productId?: string | null;
  productName?: string | null;
  offerId?: string | null;
  offerName?: string | null;
  items?: VupimItem[] | null;
  affiliateId?: string | null;
  affiliate?: VupimAffiliate | null;
  /** O que a conta do endpoint ganha (produtor: a parte dele). */
  commission?: number | null;
  /** O que fica com o produtor depois de imposto, taxa e parceiros (= commission no webhook do produtor). */
  netAmount?: number | null;
  /** Comissão do afiliado que indicou (só em endpoint de produtor). */
  affiliateCommission?: number | null;
  coproducerCommission?: number | null;
  fees?: { platformFee?: number | null; [key: string]: number | null | undefined } | null;
  reserveAmount?: number | null;
  reserveReleaseAt?: string | null;
  /** Dólares por unidade da moeda da venda; 1 em USD; null sem taxa. */
  exchangeRate?: number | null;
  amountUsd?: number | null;
  netAmountUsd?: number | null;
  taxAmountUsd?: number | null;
  feesUsd?: number | null;
  affiliateCommissionUsd?: number | null;
  customer?: VupimCustomer | null;
  shipping?: VupimShipping | null;
  subscriptionId?: string | null;
  chargeNumber?: number | null;
  subIds?: Record<string, string | null> | null;
  taxAmount?: number | null;
  reason?: string | null;
  refundAmount?: number | null;
  totalRefunded?: number | null;
  refundId?: string | null;
  refundedAt?: string | null;
  chargebackFee?: number | null;
  chargebackAt?: string | null;
  chargebackResolvedAt?: string | null;
  outcome?: string | null;
  evidenceDeadline?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  clickId?: string | null;
  src?: string | null;
  sck?: string | null;
  landingUrl?: string | null;
  referrer?: string | null;
  approvedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export interface VupimEnvelope {
  /** Id da ENTREGA — igual em toda nova tentativa dela. */
  id: string;
  /** Id do EVENTO — igual em retry, Resend e Send past sales (chave de idempotência). */
  eventId?: string;
  event: VupimEventKey;
  /** Quando esta entrega foi escrita (ISO 8601 UTC); a data do fato está em data.*At. */
  timestamp: string;
  /** false = teste (Send test ou venda-teste do checkout): não conta. */
  livemode?: boolean;
  data: VupimData;
}
