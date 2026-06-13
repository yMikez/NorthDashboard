// Tipos do WEBHOOK da Cartpanda.
//
// A Cartpanda dispara um webhook (POST JSON) por EVENTO de pedido, com o
// objeto `order` inteiro aninhado. Eventos assinados pelo usuário:
//   order.paid       — pedido pago (FE + bumps de checkout)
//   order.upsell     — upsell pós-compra adicionado ao pedido
//   order.refunded   — pedido reembolsado
//   order.chargeback — chargeback (disputa)
//
// O payload é ENORME (inclui shop_info, settings, domínio, etc). Tipamos só
// os campos que o parser usa; o resto vem via index signature. Schema baseado
// em payloads reais capturados em 2026-06-13.
//
// MODELO: um webhook = um pedido com line_items[]. A FE e cada upsell são
// itens do MESMO pedido (order.id é a sessão). Geramos uma Order por line
// item, agrupadas por order.id (parentExternalId). Reprocessar o mesmo evento
// é idempotente: externalId = `${order.id}-${line_item.id}`.

export interface CartpandaLineItem {
  id: number;
  sku?: string | null;
  name?: string | null;
  title?: string | null;
  price?: number | string;
  quantity?: number;
  product_id?: number;
  variant_id?: number;
  // up_sell_id = 0 no FE; > 0 em upsell. up_sell_type = "Upsell 1" / "Upsell 2"
  // / "Downsell 1" / null. São a fonte de verdade do papel no funil.
  up_sell_id?: number;
  up_sell_type?: string | null;
  is_refunded?: number;
  refunded_quantity?: number;
}

export interface CartpandaOrder {
  id: number;
  name?: string;
  number?: number;
  order_number?: string;
  email?: string;
  phone?: string;
  // test = 1 → pedido de teste explícito (não ingerir). is_cartx_test = 1 →
  // pedido de sandbox (ingerido normalmente, pra permitir verificação).
  test?: number;
  is_cartx_test?: number;
  currency?: string;
  // Valores podem vir como número OU string em formato BR ("7,50"). O parser
  // (parseMoney) trata os dois.
  total_price?: number | string;
  subtotal_price?: number | string;
  unformatted_total_price?: number; // total em centavos (inteiro)
  // Afiliado (CPA): comissão do afiliado sobre o pedido.
  afid?: string | null;
  affiliate_slug?: string | null;
  affiliate_amount?: number | string | null;
  created_at?: string;
  processed_at?: string;
  chargeback_received?: number;
  status_id?: string;
  payment_type?: string;
  thank_you_page?: string;
  shop_id?: number;

  customer?: {
    id?: number;
    email?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    phone?: string;
  } | null;
  address?: {
    country_code?: string;
    city?: string;
    province_code?: string;
  } | null;
  shop?: {
    id?: number;
    slug?: string;
    name?: string;
  } | null;
  payment?: {
    type?: string;
    gateway?: string;
    split_fee?: number | string;      // taxa da plataforma
    seller_split_amount?: number | string;
    amount?: number | string;
  } | null;
  line_items?: CartpandaLineItem[];
  refunds?: Array<{ total_amount?: number | string }> | null;

  [key: string]: unknown;
}

export interface CartpandaWebhook {
  event: string; // "order.paid" | "order.upsell" | "order.refunded" | "order.chargeback"
  order: CartpandaOrder;
  webhook?: unknown;
}
