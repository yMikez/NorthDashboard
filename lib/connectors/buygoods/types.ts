// Tipos do payload IPN BuyGoods (postback form-urlencoded).
//
// Campos observados em payload real (capturado via N8N em 2026-05-14).
// BuyGoods envia alguns campos DUPLICADOS na wire (account_id=X&account_id=X),
// que quando passam por URLSearchParams viram o último valor — comportamento
// correto pro nosso caso já que os duplicados são idênticos.
//
// Todos os valores chegam como string (form-urlencoded). Conversões pra
// number/Date acontecem no parser.

export interface BuyGoodsPayload {
  // ---- Identificadores ----
  order_id?: string;              // ID local da transação BG (ex: "111")
  order_id_global?: string;       // ID compartilhado entre FE+UPs da mesma sessão
  account_id?: string;            // ID do vendor account (12595, etc)
  product_codename?: string;      // Slug do produto ("prod_cod")
  product_id?: string;            // ID numérico do produto BG
  sku?: string;                   // Composto: "12595-prod_cod:1"
  user_id?: string;               // ID do user/buyer
  sessid2?: string;               // Session ID do funnel

  // ---- Evento / ação ----
  action_type?: string;           // "neworder" | "refund" | "chargeback" | "cancel" | ...
  payment_status?: string;        // "Completed" | "Pending" | "Refunded" | ...
  was_canceled?: string;          // "0" | "1"
  was_fulfilled?: string;
  is_test?: string;               // "1" = sandbox

  // ---- Tempo ----
  rr_createdate?: string;         // "2026-05-14 01:06:55" — autoritativo
  date_canceled?: string;
  date_fulfillment?: string;
  sale_saved_date?: string;
  order_date?: string;            // "March 15, 2023" — display only
  order_date_time?: string;
  order_date_eu?: string;

  // ---- Produto ----
  product_name?: string;
  product_price?: string;         // unit price ex "69.00"
  product_quantity?: string;
  product?: string;               // "Physical Product: TestProd  "
  flag_frontend?: string;         // "1" = FE
  flag_upsell?: string;           // "1" = UP
  funnel_codename?: string;
  funnel_step?: string;           // step number quando upsell/downsell
  picture_thumbnail?: string;

  // ---- Valores ----
  total?: string;                 // pode vir corrompido (encoding)
  total_clean?: string;           // numérico limpo, ex "78.95"
  total_amount_charged?: string;
  total_amount_charged_in_currency?: string;
  amount_in_currency?: string;    // "$78.95"
  total_comma?: string;
  currency?: string;              // "USD"
  total_collected?: string;
  total_outstanding?: string;
  shipping_cost?: string;
  shipping_cost_total?: string;
  taxes?: string;
  coupon_discount?: string;
  cogs?: string;                  // BG envia seu próprio cogs

  // ---- Comissões ----
  aff_commission?: string;        // CPA pago ao afiliado
  merchant_commission?: string;   // taxa BG?
  accrual_total?: string;

  // ---- Afiliado ----
  aff_id?: string;
  aff_name?: string;

  // ---- Customer ----
  customer_firstname?: string;
  customer_lastname?: string;
  customer_name?: string;
  customer_emailaddress?: string;
  customer_phone?: string;
  customer_country?: string;
  customer_state?: string;
  customer_city?: string;
  customer_zip?: string;

  // ---- Geo ----
  country?: string;
  country_2letter?: string;
  state?: string;
  city?: string;
  zip?: string;
  address?: string;
  lang?: string;

  // ---- Billing ----
  billing_firstname?: string;
  billing_lastname?: string;
  billing_country?: string;
  billing_state?: string;
  billing_address?: string;
  billing_zip?: string;
  billing_city?: string;
  hidden_cardnumber?: string;

  // ---- Shipping ----
  shipping_method?: string;
  shipping_status?: string;
  shipping_name?: string;
  shipping_address?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_country?: string;
  shipping_zip?: string;

  // ---- Pagamento ----
  payment_method?: string;        // "Visa ending with 1111"
  payment_cardtype?: string;      // "Visa"
  payment_cardlast4?: string;

  // ---- Tracking ----
  subid?: string;                 // "aaa140323extra"
  subid2?: string;
  subid3?: string;
  subid4?: string;
  subid5?: string;
  sid?: string;
  referrer_url?: string;
  referrer_sid?: string;
  referrer_self?: string;
  traffic_source?: string;
  vid1?: string;
  vid2?: string;
  vid3?: string;
  browser_user_agent?: string;
  ipaddress?: string;

  // ---- IDs externos ----
  external_order_id?: string;
  external_order_id2?: string;
  external_order_id3?: string;
  external_order_id4?: string;
  external_order_id5?: string;

  // ---- Auth ----
  token?: string;
  token_ipn?: string;
  help_token?: string;

  // Outros
  storecheckedoutcarts_id?: string;
  flag_sms_sent?: string;
  flag_autofulfill?: string;
  is_free?: string;
  comments?: string;
  order_details?: string;
  buy_url?: string;
  payment_terms?: string;
  register_id?: string;
  RUNNING_OFFLINE?: string;

  // Permite campos ad-hoc que BG possa adicionar
  [key: string]: string | undefined;
}

// Action types observados / documentados pela BG.
// Mapeamento pra NormalizedOrderStatus em ingest.ts.
export type BuyGoodsActionType =
  | 'neworder'
  | 'newsale'           // alias visto em alguns vendors
  | 'rebill'
  | 'refund'
  | 'chargeback'
  | 'cancel'
  | 'canceledfromrebill'
  | 'failedrebill'
  | 'connection_test';
