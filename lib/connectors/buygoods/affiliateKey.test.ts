import { describe, expect, it } from 'vitest';
import { buyGoodsAffiliateKey, buyGoodsStore, isStorelessBuyGoodsKey, parseBuyGoodsAffiliateRef, splitBuyGoodsKey } from './affiliateKey';

// Links reais (2026-10-01) — MailX e Recoverly têm um aff_id por loja.
const MAILX_12610 = 'https://buygoods.com/secure/checkout.html?account_id=12610&product_codename=the6sms&redirect=aHR0cHM6Ly9nZXR0aGVybW9idXJuLmNvbS9iZy9VcHNlbGwwMS8%3D&sessid=sessid2026&sessid2=sessid2026&aff_id=58134';
const MAILX_13457 = 'https://buygoods.com/secure/checkout.html?sessid2=sessid20260824200813963&aff_id=62&account_id=13457&product_codename=neu6sms&redirect=aHR0cHM6Ly9nZXRuZXVyb3JlY2FsbC5jb20vYmcvVXBzZWxsMDEtYi8%3D&aff_id=62&sessid=sessid20260824200813963';

describe('chave do afiliado BuyGoods', () => {
  it('leva a loja junto; "0" (sem afiliado) e pedido sem loja ficam só com o aff_id', () => {
    expect(buyGoodsAffiliateKey('62', '12595')).toBe('62@12595');
    expect(buyGoodsAffiliateKey(' 62 ', '12592,12592')).toBe('62@12592');
    expect(buyGoodsAffiliateKey('0', '12595')).toBe('0');
    expect(buyGoodsAffiliateKey('62', null)).toBe('62');
    expect(buyGoodsAffiliateKey('', '12595')).toBeNull();
    expect(buyGoodsStore('12592,12592')).toBe('12592');
    expect(buyGoodsStore('  ')).toBeNull();
  });

  it('separa e reconhece conta antiga sem loja', () => {
    expect(splitBuyGoodsKey('62@13457')).toEqual({ affId: '62', store: '13457' });
    expect(splitBuyGoodsKey('364622')).toEqual({ affId: '364622', store: null });
    expect(isStorelessBuyGoodsKey('364622')).toBe(true);
    expect(isStorelessBuyGoodsKey('0')).toBe(false);
    expect(isStorelessBuyGoodsKey('62@13457')).toBe(false);
  });

  it('aceita o link do checkout (aff_id/account_id em qualquer ordem, repetidos)', () => {
    expect(parseBuyGoodsAffiliateRef(MAILX_12610)).toMatchObject({ ok: true, key: '58134@12610', fromLink: true });
    expect(parseBuyGoodsAffiliateRef(MAILX_13457)).toMatchObject({ ok: true, key: '62@13457', fromLink: true });
    expect(parseBuyGoodsAffiliateRef('checkout.html?aff_id=290&account_id=13457')).toMatchObject({ ok: true, key: '290@13457' });
  });

  it('aceita ID@loja e recusa ID sem loja, link sem loja e aff_id 0', () => {
    expect(parseBuyGoodsAffiliateRef('364622@12595')).toMatchObject({ ok: true, key: '364622@12595', fromLink: false });
    const semLoja = parseBuyGoodsAffiliateRef('62');
    expect(semLoja.ok).toBe(false);
    expect(!semLoja.ok && semLoja.error).toMatch(/por loja/);
    expect(parseBuyGoodsAffiliateRef('https://buygoods.com/secure/checkout.html?aff_id=62').ok).toBe(false);
    expect(parseBuyGoodsAffiliateRef('0@12595').ok).toBe(false);
    expect(parseBuyGoodsAffiliateRef('62@abc').ok).toBe(false);
  });
});
