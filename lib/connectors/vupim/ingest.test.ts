import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/sale-approved.json';
import legacyFixture from './__fixtures__/sale-approved-legacy.json';
import type { VupimEnvelope } from './types';
import { parseVupimOrder, vupimAffiliateKey, vupimEventKey, vupimMajor, vupimProductName, vupimShouldApply, VupimCurrencyError, VUPIM_ORDER_EVENTS } from './ingest';
import { signVupimBody, signVupimTimestamped, verifyVupimSignature, vupimSecrets } from './signature';

// Exemplos LITERAIS da doc da Vupim (sale.approved) — https://vupim.com/docs/webhook.
// `approved`: doc relida em 22/10/2026 (upsell com funil, itens, valores em USD,
// afiliado, version). `legacy`: o exemplo de 21/10, sem os campos novos.
const approved = fixture as unknown as VupimEnvelope;
const legacy = legacyFixture as unknown as VupimEnvelope;
const variant = (base: VupimEnvelope, event: string, data: Record<string, unknown> = {}, timestamp = '2026-10-23T10:00:00.000Z'): VupimEnvelope =>
  ({ ...base, id: `d-${event}`, event, timestamp, data: { ...base.data, ...data } });

describe('parseVupimOrder — sale.approved (exemplo da doc de 22/10)', () => {
  const o = parseVupimOrder(approved);
  it('identidade, funil e papel', () => {
    expect(o).toMatchObject({
      platformSlug: 'vupim', externalId: '019a3f2b-5b7d-7e10-8c3f-7a2b9d4e6f01',
      parentExternalId: '8b1e2c3d-4f5a-4b6c-9d7e-0f1a2b3c4d5e', funnelSessionId: '8b1e2c3d-4f5a-4b6c-9d7e-0f1a2b3c4d5e',
      productExternalId: 'off_2b8d41', productName: 'Neuro Mind Pro 6 Bottles', productType: 'UPSELL', funnelStep: 1,
      status: 'APPROVED', eventType: 'sale.approved', billingType: 'SINGLE_PAYMENT',
    });
    expect(o.orderedAt.toISOString()).toBe('2026-10-21T21:10:00.981Z');
    expect(o.eventAt).toBeNull();
  });
  it('dinheiro: bruto, imposto, taxa da Vupim informada, parte do produtor e do afiliado', () => {
    expect(o).toMatchObject({ currencyOriginal: 'USD', grossAmountOrig: 198, grossAmountUsd: 198, taxAmount: 0, fees: 9.9, netAmountUsd: 128.1, cpaPaidUsd: 60 });
  });
  it('afiliado com nome e e-mail; cliente pelo id estável, nome separado, idioma e cidade; sub1 como rastreio', () => {
    expect(o).toMatchObject({
      affiliateExternalId: 'usr_5c1e77', affiliateNickname: 'Alex Rivera', affiliateEmail: 'alex@example.com',
      customerExternalId: 'usr_9a8b7c', customerEmail: 'jane@example.com', customerFirstName: 'Jane', customerLastName: 'Doe',
      customerLanguage: 'en', customerPhone: '15551234567', country: 'US', state: 'CA', city: 'Los Angeles',
      trafficSource: 'facebook', campaignKey: 'nmp-us', clickId: '6740c3f2a1b2', trackingId: 'campaign-a',
    });
  });
  it('guarda versão, evento, venda pai, SKU e origem da visita', () => {
    expect(o.rawMetadata).toMatchObject({
      vupimVersion: 17926170015401, eventId: '019a3f2b-5e10-7a44-8f21-3c9d7e2b1a60', livemode: true,
      parentTransactionId: '019a3f29-1d2e-7f30-9a4b-5c6d7e8f9a0b', funnelStepName: 'Upsell 1', sku: 'NMP-6',
      reserveAmount: 1281, referrer: 'https://example.com/neuro-mind-pro',
    });
  });
});

describe('parseVupimOrder — estornos, chargeback, renovação e moeda', () => {
  it('estorno total: mesma venda (in-place), gross negativo, data do estorno = refundedAt', () => {
    const o = parseVupimOrder(variant(approved, 'sale.refunded', { status: 'refunded', refundAmount: 19800, totalRefunded: 19800, refundedAt: '2026-10-22T14:00:00.000Z' }));
    expect(o).toMatchObject({ externalId: approved.data.transactionId, status: 'REFUNDED', grossAmountUsd: -198, grossAmountOrig: -198 });
    expect(o.orderedAt.toISOString()).toBe('2026-10-21T21:10:00.981Z');
    expect(o.eventAt!.toISOString()).toBe('2026-10-22T14:00:00.000Z');
  });
  it('sem refundedAt (webhook antigo): data do estorno = timestamp do envelope', () => {
    const o = parseVupimOrder(variant(legacy, 'sale.refunded', { totalRefunded: 9700 }, '2026-10-20T10:00:00.000Z'));
    expect(o.eventAt!.toISOString()).toBe('2026-10-20T10:00:00.000Z');
  });
  it('estorno parcial usa o total devolvido até agora; chargeback devolve tudo com a data da disputa', () => {
    expect(parseVupimOrder(variant(approved, 'sale.partial_refund', { refundAmount: 2000, totalRefunded: 3500 })).grossAmountUsd).toBe(-35);
    const cb = parseVupimOrder(variant(approved, 'sale.chargeback', { chargebackFee: 1500, chargebackAt: '2026-10-25T09:00:00.000Z' }));
    expect(cb).toMatchObject({ status: 'CHARGEBACK', grossAmountUsd: -198 });
    expect(cb.eventAt!.toISOString()).toBe('2026-10-25T09:00:00.000Z');
  });
  it('chargeback ganho volta a ser venda; perdido segue chargeback', () => {
    expect(parseVupimOrder(variant(approved, 'sale.chargeback_won', { outcome: 'won' }))).toMatchObject({ status: 'APPROVED', grossAmountUsd: 198, eventAt: null });
    expect(parseVupimOrder(variant(approved, 'sale.chargeback_lost', { outcome: 'lost' }))).toMatchObject({ status: 'CHARGEBACK', grossAmountUsd: -198 });
  });
  it('estorno que chegou antes da venda: versão de venda (asSale) com o valor cheio', () => {
    const o = parseVupimOrder(variant(approved, 'sale.refunded', { totalRefunded: 19800 }), { asSale: true });
    expect(o).toMatchObject({ status: 'APPROVED', grossAmountUsd: 198, eventType: 'sale.approved', eventAt: null });
  });
  it('renovação: pedido próprio, assinatura, nº da cobrança e sessão própria', () => {
    const o = parseVupimOrder(variant(approved, 'subscription.renewed', { transactionId: 'tx-ren-2', origin: 'renewal', subscriptionId: 'sub_1', chargeNumber: 2, funnelStep: null }));
    expect(o).toMatchObject({ externalId: 'tx-ren-2', status: 'APPROVED', billingType: 'SUBSCRIPTION', paySequenceNo: 2, productType: 'FRONTEND', funnelStep: 0, parentExternalId: 'tx-ren-2', funnelSessionId: 'tx-ren-2' });
  });
  it('origin: direct → FRONTEND (passo 0), downsell → DOWNSELL', () => {
    expect(parseVupimOrder(variant(approved, 'sale.approved', { origin: 'direct', funnelStep: null }))).toMatchObject({ productType: 'FRONTEND', funnelStep: 0 });
    expect(parseVupimOrder(variant(approved, 'sale.approved', { origin: 'downsell', funnelStep: 2 }))).toMatchObject({ productType: 'DOWNSELL', funnelStep: 2 });
  });
  it('venda em BRL: valores em USD do payload; estorno convertido pela taxa da venda', () => {
    const brl = { currency: 'BRL', amount: 100000, exchangeRate: 0.18, amountUsd: 18000, netAmountUsd: 11000, taxAmountUsd: 0, feesUsd: 900, affiliateCommissionUsd: 6100 };
    expect(parseVupimOrder(variant(approved, 'sale.approved', brl))).toMatchObject({
      currencyOriginal: 'BRL', grossAmountOrig: 1000, grossAmountUsd: 180, netAmountUsd: 110, fees: 9, cpaPaidUsd: 61,
    });
    expect(parseVupimOrder(variant(approved, 'sale.partial_refund', { ...brl, totalRefunded: 50000 }))).toMatchObject({ grossAmountUsd: -90, grossAmountOrig: -500 });
  });
  it('moeda sem valor em USD nem taxa: erro próprio', () => {
    expect(() => parseVupimOrder(variant(legacy, 'sale.approved', { currency: 'BRL', amount: 19700 }))).toThrow(VupimCurrencyError);
    expect(vupimMajor(9700, 'JPY')).toBe(9700);
    expect(vupimMajor(9700, 'USD')).toBe(97);
  });
  it('sem transactionId ou evento que não é de pedido: erro', () => {
    expect(() => parseVupimOrder(variant(approved, 'sale.approved', { transactionId: null }))).toThrow(/transactionId/);
    expect(() => parseVupimOrder(variant(approved, 'sale.created'))).toThrow(/não gera pedido/);
  });
  it('eventos que viram pedido; nomes antigos em português são aceitos', () => {
    expect(Object.keys(VUPIM_ORDER_EVENTS).sort()).toEqual([
      'sale.approved', 'sale.chargeback', 'sale.chargeback_lost', 'sale.chargeback_won', 'sale.partial_refund', 'sale.refunded', 'subscription.renewed',
    ]);
    expect(vupimEventKey('Venda.Aprovada')).toBe('sale.approved');
    expect(vupimEventKey('sale.created')).toBe('sale.created');
  });
  it('nome do SKU junta produto e oferta quando a oferta não repete o produto', () => {
    expect(vupimProductName({ productName: 'NeuroMind Pro', offerName: '6 Bottles' })).toBe('NeuroMind Pro - 6 Bottles');
    expect(vupimProductName({ productName: 'Keto Guide', offerName: 'Keto Guide — 3 months' })).toBe('Keto Guide — 3 months');
  });
});

describe('parseVupimOrder — webhook antigo (exemplo de 21/10, sem campos novos)', () => {
  const o = parseVupimOrder(legacy);
  it('continua funcionando: e-mail como chave do cliente, taxa da Vupim pela diferença', () => {
    expect(o).toMatchObject({
      productType: 'FRONTEND', grossAmountUsd: 97, netAmountUsd: 62.67, cpaPaidUsd: 29.1, fees: 5.23,
      customerExternalId: 'jane@example.com', customerFirstName: 'Jane', customerLastName: 'Doe', affiliateNickname: null,
    });
    expect(o.rawMetadata).toMatchObject({ vupimVersion: null, eventId: null });
  });
});

describe('vupimShouldApply — entrega fora de ordem', () => {
  it('com version: só a maior vale', () => {
    const ex = { status: 'REFUNDED', grossAmountUsd: -198, version: 20 };
    expect(vupimShouldApply('APPROVED', ex, 0, { version: 30 })).toBe(true);
    expect(vupimShouldApply('APPROVED', ex, 0, { version: 10 })).toBe(false);
    expect(vupimShouldApply('CHARGEBACK', ex, 198, { version: 20 })).toBe(false);
  });
  it('sem version: aprovação antiga não desfaz estorno nem chargeback', () => {
    expect(vupimShouldApply('APPROVED', null, 0)).toBe(true);
    expect(vupimShouldApply('APPROVED', { status: 'APPROVED', grossAmountUsd: 97 }, 0)).toBe(true);
    expect(vupimShouldApply('APPROVED', { status: 'REFUNDED', grossAmountUsd: -97 }, 0)).toBe(false);
    expect(vupimShouldApply('APPROVED', { status: 'CHARGEBACK', grossAmountUsd: -97 }, 0)).toBe(false);
  });
  it('sem version: chargeback ganho só desfaz chargeback', () => {
    expect(vupimShouldApply('APPROVED', { status: 'CHARGEBACK', grossAmountUsd: -97 }, 0, { chargebackWon: true })).toBe(true);
    expect(vupimShouldApply('APPROVED', { status: 'REFUNDED', grossAmountUsd: -97 }, 0, { chargebackWon: true })).toBe(false);
  });
  it('sem version: estorno só avança; chargeback sempre vale', () => {
    expect(vupimShouldApply('REFUNDED', { status: 'REFUNDED', grossAmountUsd: -35 }, 97)).toBe(true);
    expect(vupimShouldApply('REFUNDED', { status: 'REFUNDED', grossAmountUsd: -97 }, 35)).toBe(false);
    expect(vupimShouldApply('REFUNDED', { status: 'CHARGEBACK', grossAmountUsd: -97 }, 97)).toBe(false);
    expect(vupimShouldApply('CHARGEBACK', { status: 'REFUNDED', grossAmountUsd: -97 }, 97)).toBe(true);
  });
});

describe('assinatura (X-Webhook-Signature)', () => {
  const raw = JSON.stringify(approved);
  const now = 1792617002_000;
  it('com data: t=<unix>,v1=HMAC("t.corpo"), dentro de 5 min', () => {
    const sig = signVupimTimestamped(raw, 'whsec_teste', 1792617002);
    expect(sig).toMatch(/^t=1792617002,v1=[0-9a-f]{64}$/);
    expect(verifyVupimSignature(raw, sig, ['whsec_teste'], now)).toBe('VALID');
    expect(verifyVupimSignature(raw, sig, ['whsec_teste'], now + 299_000)).toBe('VALID');
  });
  it('com data: t fora da janela = vencida; t trocado, corpo mexido ou segredo errado = inválida', () => {
    const sig = signVupimTimestamped(raw, 'whsec_teste', 1792617002);
    expect(verifyVupimSignature(raw, sig, ['whsec_teste'], now + 301_000)).toBe('EXPIRED');
    expect(verifyVupimSignature(raw, sig.replace('t=1792617002', 't=1792617100'), ['whsec_teste'], now)).toBe('INVALID');
    expect(verifyVupimSignature(raw + ' ', sig, ['whsec_teste'], now)).toBe('INVALID');
    expect(verifyVupimSignature(raw, sig, ['outro'], now)).toBe('INVALID');
    expect(verifyVupimSignature(raw, 't=abc,v1=00', ['whsec_teste'], now)).toBe('INVALID');
  });
  it('com data, troca de segredo: aceita qualquer v1 válido', () => {
    const v1 = signVupimTimestamped(raw, 'whsec_antigo', 1792617002).split(',')[1];
    expect(verifyVupimSignature(raw, `t=1792617002,v1=deadbeef,${v1}`, vupimSecrets('whsec_novo,whsec_antigo'), now)).toBe('VALID');
  });
  it('antigo: HMAC-SHA256 do corpo cru em hex, prefixo sha256=', () => {
    const sig = signVupimBody(raw, 'whsec_teste');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyVupimSignature(raw, sig, ['whsec_teste'])).toBe('VALID');
  });
  it('antigo: corpo reformatado ou segredo errado não passa; sem segredo = não configurado', () => {
    const sig = signVupimBody(raw, 'whsec_teste');
    expect(verifyVupimSignature(JSON.stringify(approved, null, 2), sig, ['whsec_teste'])).toBe('INVALID');
    expect(verifyVupimSignature(raw, sig, ['outro'])).toBe('INVALID');
    expect(verifyVupimSignature(raw, null, ['whsec_teste'])).toBe('INVALID');
    expect(verifyVupimSignature(raw, sig, [])).toBe('NOT_CONFIGURED');
  });
  it('troca de segredo: aceita o antigo e o novo ao mesmo tempo', () => {
    expect(vupimSecrets(' whsec_novo , whsec_antigo ,')).toEqual(['whsec_novo', 'whsec_antigo']);
    expect(verifyVupimSignature(raw, signVupimBody(raw, 'whsec_antigo'), vupimSecrets('whsec_novo,whsec_antigo'))).toBe('VALID');
  });
});

describe('vupimAffiliateKey', () => {
  it('ID do painel (VP + 32) vira o do webhook; o resto passa igual', () => {
    expect(vupimAffiliateKey(' VPQ7xLmN2pR4sT6uV8wY0zA1bC3dE5fG7h ')).toBe('Q7xLmN2pR4sT6uV8wY0zA1bC3dE5fG7h');
    expect(vupimAffiliateKey('Q7xLmN2pR4sT6uV8wY0zA1bC3dE5fG7h')).toBe('Q7xLmN2pR4sT6uV8wY0zA1bC3dE5fG7h');
    // "VP" que é parte de um ID de 32 não é prefixo.
    expect(vupimAffiliateKey('VPx2Nc5Bv8Mq1Wl4Ek7Rt0Yu3Io6Pa9Sd')).toBe('VPx2Nc5Bv8Mq1Wl4Ek7Rt0Yu3Io6Pa9Sd');
    expect(vupimAffiliateKey('usr_5c1e77')).toBe('usr_5c1e77');
  });
});
