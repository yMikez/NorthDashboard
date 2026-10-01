// Identidade do afiliado BuyGoods no dash: `aff_id@loja`.
//
// A BuyGoods numera os afiliados POR LOJA (account_id = vendor account, uma
// por produto/marca): o aff_id 62 da loja 12595 é o Nicolas Yago Zapora, o 62
// da 12610 é o Marco Cunha e o 62 da 13457 é a MailX. Até 2026-10-01 a conta
// era só o aff_id e o dash somava pessoas diferentes na mesma linha (29 dos
// 226 aff_ids colidiam; 1.919 vendas creditadas à pessoa errada). A chave da
// conta (Affiliate.externalId) leva a loja junto; a migração
// 20261001120000_buygoods_affiliate_per_store separou o histórico.
//
// "0" é "sem afiliado" em toda loja — fica sem loja (regra de interno /^0$/).

export const BUYGOODS_NO_AFFILIATE = '0';

/** account_id normalizado — a wire às vezes repete o campo ("12592,12592"). */
export function buyGoodsStore(raw: unknown): string | null {
  if (raw == null) return null;
  const first = String(raw).split(',')[0].trim();
  return first || null;
}

/** Chave da conta: `aff_id@loja`; "0" e pedido sem loja ficam só com o aff_id. */
export function buyGoodsAffiliateKey(affId: unknown, store: unknown): string | null {
  const id = affId == null ? '' : String(affId).trim();
  if (!id) return null;
  if (id === BUYGOODS_NO_AFFILIATE) return id;
  const s = buyGoodsStore(store);
  return s ? `${id}@${s}` : id;
}

/** Separa a chave em aff_id cru + loja (null = conta antiga, sem loja). */
export function splitBuyGoodsKey(key: string): { affId: string; store: string | null } {
  const at = key.lastIndexOf('@');
  if (at <= 0) return { affId: key, store: null };
  return { affId: key.slice(0, at), store: key.slice(at + 1) || null };
}

/**
 * Conta BuyGoods sem loja (cadastrada antes da correção, sem venda). Nunca
 * mais recebe venda — toda venda nova chega como `aff_id@loja`.
 */
export function isStorelessBuyGoodsKey(key: string): boolean {
  const { affId, store } = splitBuyGoodsKey(key);
  return !store && affId !== BUYGOODS_NO_AFFILIATE;
}

export type BuyGoodsRef =
  | { ok: true; affId: string; store: string; key: string; fromLink: boolean }
  | { ok: false; error: string };

const NEEDS_STORE =
  'A BuyGoods numera o afiliado por loja: cole o link do checkout do parceiro (ele traz aff_id e account_id) ou escreva ID@loja (ex.: 62@13457).';

/**
 * Conta BuyGoods digitada ou colada pelo operador: o link do checkout,
 * `ID@loja`, ou só o ID (recusado — sem a loja não dá pra saber de quem é).
 */
export function parseBuyGoodsAffiliateRef(input: string): BuyGoodsRef {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'Informe o ID do afiliado.' };

  if (/^https?:\/\//i.test(raw) || /[?&]aff_id=/i.test(raw)) {
    let params: URLSearchParams;
    try {
      params = new URL(raw).searchParams;
    } catch {
      params = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw);
    }
    const affId = (params.get('aff_id') ?? '').trim();
    const store = buyGoodsStore(params.get('account_id'));
    if (!affId) return { ok: false, error: 'O link não tem aff_id.' };
    if (!store) return { ok: false, error: 'O link não tem account_id (a loja).' };
    return checked(affId, store, true);
  }

  const m = /^([^@\s]+)@\s*(\d+)$/.exec(raw);
  if (m) return checked(m[1].trim(), m[2], false);
  return { ok: false, error: NEEDS_STORE };
}

function checked(affId: string, store: string, fromLink: boolean): BuyGoodsRef {
  if (affId === BUYGOODS_NO_AFFILIATE) return { ok: false, error: 'aff_id 0 é venda sem afiliado — não é uma conta de parceiro.' };
  if (!/^\d+$/.test(store)) return { ok: false, error: `Loja "${store}" inválida: o account_id da BuyGoods é numérico.` };
  return { ok: true, affId, store, key: `${affId}@${store}`, fromLink };
}
