// Regra por afiliado na aba VSLs: como a página descobre o afiliado e como a
// regra viaja no script público sem expor a lista de IDs em texto puro.
//
// De onde vem o afiliado, por plataforma (medido em 2026-10-03):
//   - JVZoo: `aid` na URL do upsell = Affiliate.externalId do dash.
//   - BuyGoods: a URL do upsell NÃO traz o afiliado (só order_id/
//     order_id_global) e o IPN do front chega ao dash ~15 s depois da venda
//     (p50) — tarde demais pra decidir a VSL. A página de vendas (mesmo
//     domínio) monta o link de checkout com aff_id e account_id: a "memória do
//     afiliado" colada nela guarda `aff_id@account_id` (= Affiliate.externalId
//     no dash) no localStorage, e o script do upsell lê.

export type AffiliateSource = 'aid' | 'mem';

/** Plataformas com afiliado legível na página e de onde ele vem. */
export const AFFILIATE_SOURCE: Record<string, AffiliateSource> = {
  jvzoo: 'aid',
  buygoods: 'mem',
};

export function affiliateSourceFor(platform: string): AffiliateSource | null {
  return AFFILIATE_SOURCE[platform] ?? null;
}

/** Afiliado como a página lê: JVZoo "3552295"; BuyGoods "62@13457". */
export const AFFILIATE_KEY_RE = /^[0-9]{1,20}(?:@[0-9]{1,12})?$/;

/** Formato exato que o script da página lê em cada plataforma (JVZoo só dígitos; BuyGoods aff_id@loja). */
const PAGE_KEY_BY_SOURCE: Record<AffiliateSource, RegExp> = {
  aid: /^[0-9]{1,20}$/,
  mem: /^[0-9]{1,20}@[0-9]{1,12}$/,
};

/** A conta do dash casa com o que a página dessa plataforma lê? ("0" = sem afiliado.) */
export function affiliateKeyReadable(platform: string, key: string): boolean {
  const src = affiliateSourceFor(platform);
  return !!src && key !== "0" && PAGE_KEY_BY_SOURCE[src].test(key);
}

/** Validade da memória do afiliado (BuyGoods): da página de vendas ao upsell. */
export const AFFILIATE_MEMORY_HOURS = 6;

/**
 * Hash da regra (página + afiliado). Mesma conta no script da página (ES5):
 * h = (h·33 + c) mod 2^32, em base 36. Não é segredo — só tira os IDs do
 * texto puro do código-fonte.
 */
export function affRuleHash(pageKey: string, affiliateKey: string): string {
  const s = `${pageKey}|${affiliateKey}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) % 4294967296;
  return h.toString(36);
}
