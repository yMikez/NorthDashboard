// Tipos do POSTBACK URL da Cartpanda.
//
// Diferente das outras plataformas (que mandam JSON/form de IPN com o ciclo de
// vida completo da venda), a Cartpanda dispara um POSTBACK — um GET numa URL
// que NÓS configuramos no painel deles, com macros {token} substituídas. Os
// valores chegam todos como string na query string (ou no body, conforme o
// n8n repassa). O conjunto de campos é o que escolhemos incluir na URL; aqui
// listamos todas as macros disponíveis no painel (print 2026-06-13).
//
// IMPORTANTE: pelo print, o postback dispara só pra VENDA aprovada (front e
// upsell). Não há campo de evento/status de refund/chargeback nesse canal —
// rastrear estorno exigiria o webhook da Cartpanda (feature futura). Por isso
// toda order desse ingest entra como APPROVED.

export interface CartpandaPostback {
  // ---- Identificadores ----
  order_id?: string;       // ID da order Cartpanda. Compartilhado entre FE e
                           // upsells da mesma compra (anchor da sessão).
  product_id?: string;     // ID numérico do produto
  product_name?: string;   // Nome livre do produto
  shop_slug?: string;      // Slug da loja (vendor account)
  cid?: string;            // click_id — chave da sessão do funil (compartilhada
                           // pelo visitante em FE + upsells; mais confiável que
                           // order_id pra agrupar, igual ao sessid2 do BuyGoods)

  // ---- Funil ----
  order_type?: string;     // Tipo da order (ex: "front"/"upsell"/"downsell"/"bump").
                           // Vocabulário exato a confirmar com postback real.
  upsell_no?: string;      // Número do upsell: 0 = front, 1+ = upsell N

  // ---- Valores ----
  total_price?: string;    // Gross da venda
  amount_net?: string;     // Net (residual do vendor, conforme a Cartpanda reporta)
  amount_affiliate?: string; // Comissão paga ao afiliado (CPA)
  currency?: string;       // ISO (ex "USD", "BRL")

  // ---- Afiliado ----
  afid?: string;           // ID do afiliado (numérico)
  affiliate_slug?: string; // Slug/nome do afiliado

  // ---- Customer ----
  email?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;

  // ---- Geo ----
  country?: string;        // Código do país (ex "BR", "US")

  // ---- Tempo ----
  datetime_unix?: string;  // Epoch em segundos — autoritativo (sem ambiguidade de fuso)
  datetime_utc?: string;   // "YYYY-MM-DD HH:mm:ss" em UTC
  datetime_full?: string;  // Display

  // ---- Flags ----
  is_test?: string;        // "1" = teste/sandbox

  // ---- Tracking ----
  campaignkey?: string;
  src?: string;
  sck?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  adclid?: string;
  adclida?: string;
  random?: string;

  // Permite macros ad-hoc que a Cartpanda possa adicionar.
  [key: string]: string | undefined;
}
