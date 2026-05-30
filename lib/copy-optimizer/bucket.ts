// Hash bucket sticky (djb2) — decide quem vê Black 2.
//
// PORTADO VERBATIM do js/utm-webhook.js do Upsell01. A implementação precisa
// ser bit-a-bit idêntica à do cliente antigo: garante que a MESMA venda
// (order_id_global) sempre cai no MESMO bucket — decisão sticky entre reloads
// e estável durante a migração client→server.

/**
 * djb2(order_id_global) mod 100 → bucket 0..99. Retorna -1 pra string vazia.
 * Lead vê Black 2 quando bucket < black2Pct.
 */
export function hashToBucket(str: string | null | undefined): number {
  if (!str) return -1;
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % 100;
}
