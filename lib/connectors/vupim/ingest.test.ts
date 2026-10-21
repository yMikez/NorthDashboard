import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/sale-approved.json';
import type { VupimEnvelope } from './types';
import { parseVupimOrder, vupimEventKey, vupimMajor, vupimProductName, vupimShouldApply, VupimCurrencyError, VUPIM_ORDER_EVENTS } from './ingest';
import { signVupimBody, verifyVupimSignature, vupimSecrets } from './signature';

// Exemplo LITERAL da doc da Vupim (sale.approved) — https://vupim.com/docs/webhook.
const approved = fixture as unknown as VupimEnvelope;
const variant = (event: string, data: Record<string, unknown> = {}, timestamp = '2026-10-20T10:00:00.000Z'): VupimEnvelope =>
  ({ ...approved, id: `d-${event}`, event, timestamp, data: { ...approved.data, ...data } });

describe('parseVupimOrder — sale.approved (exemplo da doc)', () => {
  const o = parseVupimOrder(approved);
  it('identidade, sessão e papel', () => {
    expect(o).toMatchObject({
      platformSlug: 'vupim', externalId: '01929f3a-5b7d-7e10-8c3f-7a2b9d4e6f01',
      parentExternalId: '8b1e2c3d-4f5a-4b6c-9d7e-0f1a2b3c4d5e', funnelSessionId: '8b1e2c3d-4f5a-4b6c-9d7e-0f1a2b3c4d5e',
      productExternalId: 'off_2b8d41', productName: 'Keto Guide — 3 months', productType: 'FRONTEND',
      status: 'APPROVED', eventType: 'sale.approved', affiliateExternalId: 'usr_5c1e77',
    });
    expect(o.orderedAt.toISOString()).toBe('2026-10-15T21:02:58.112Z');
    expect(o.eventAt).toBeNull();
  });
  it('dinheiro em unidade mínima: bruto, parte do produtor, comissão do afiliado e taxa da Vupim', () => {
    expect(o).toMatchObject({ currencyOriginal: 'USD', grossAmountOrig: 97, grossAmountUsd: 97, netAmountUsd: 62.67, cpaPaidUsd: 29.1, taxAmount: 0, fees: 5.23 });
  });
  it('cliente: e-mail como chave, nome dividido, telefone só dígitos; rastreio', () => {
    expect(o).toMatchObject({
      customerExternalId: 'jane@example.com', customerEmail: 'jane@example.com', customerFirstName: 'Jane', customerLastName: 'Doe', customerPhone: '15551234567',
      country: 'US', paymentMethod: 'credit_card', trafficSource: 'facebook', campaignKey: 'keto-us', clickId: '6740c3f2a1b2',
    });
    expect(o.rawMetadata).toMatchObject({ deliveryId: '01929f3a-6c1e-7b52-9d0a-2f4c8e6a1b3d', utmMedium: 'cpc' });
  });
});

describe('parseVupimOrder — estornos, upsell e limites', () => {
  it('estorno total: mesma venda (in-place), gross negativo, data do estorno no eventAt', () => {
    const o = parseVupimOrder(variant('sale.refunded', { status: 'refunded', refundAmount: 9700, totalRefunded: 9700, reason: 'requested_by_customer' }));
    expect(o).toMatchObject({ externalId: approved.data.transactionId, status: 'REFUNDED', grossAmountUsd: -97 });
    expect(o.orderedAt.toISOString()).toBe('2026-10-15T21:02:58.112Z');
    expect(o.eventAt!.toISOString()).toBe('2026-10-20T10:00:00.000Z');
  });
  it('estorno parcial usa o total devolvido até agora; chargeback devolve tudo', () => {
    expect(parseVupimOrder(variant('sale.partial_refund', { refundAmount: 2000, totalRefunded: 3500 })).grossAmountUsd).toBe(-35);
    expect(parseVupimOrder(variant('sale.chargeback', { chargebackFee: 1500 })).grossAmountUsd).toBe(-97);
  });
  it('estorno que chegou antes da venda: versão de venda (asSale) com o valor cheio', () => {
    const o = parseVupimOrder(variant('sale.refunded', { totalRefunded: 9700 }), { asSale: true });
    expect(o).toMatchObject({ status: 'APPROVED', grossAmountUsd: 97, eventType: 'sale.approved', eventAt: null });
  });
  it('origin upsell vira UPSELL; direct vira FRONTEND', () => {
    expect(parseVupimOrder(variant('sale.approved', { origin: 'upsell', offerName: 'Keto Guide 6 Bottles' })).productType).toBe('UPSELL');
    expect(parseVupimOrder(variant('sale.approved', { origin: 'direct' })).productType).toBe('FRONTEND');
  });
  it('nome do SKU junta produto e oferta quando a oferta não repete o produto', () => {
    expect(vupimProductName({ productName: 'NeuroMind Pro', offerName: '6 Bottles' })).toBe('NeuroMind Pro - 6 Bottles');
    expect(vupimProductName({ productName: 'Keto Guide', offerName: 'Keto Guide — 3 months' })).toBe('Keto Guide — 3 months');
  });
  it('moeda diferente de USD: erro próprio (o dash ainda não converte)', () => {
    expect(() => parseVupimOrder(variant('sale.approved', { currency: 'BRL', amount: 19700 }))).toThrow(VupimCurrencyError);
    expect(vupimMajor(9700, 'JPY')).toBe(9700);
    expect(vupimMajor(9700, 'USD')).toBe(97);
  });
  it('sem transactionId ou evento que não é de pedido: erro', () => {
    expect(() => parseVupimOrder(variant('sale.approved', { transactionId: null }))).toThrow(/transactionId/);
    expect(() => parseVupimOrder(variant('sale.created'))).toThrow(/não gera pedido/);
  });
  it('só 4 eventos viram pedido; nomes antigos em português são aceitos', () => {
    expect(Object.keys(VUPIM_ORDER_EVENTS).sort()).toEqual(['sale.approved', 'sale.chargeback', 'sale.partial_refund', 'sale.refunded']);
    expect(vupimEventKey('Venda.Aprovada')).toBe('sale.approved');
    expect(vupimEventKey('sale.created')).toBe('sale.created');
  });
});

describe('vupimShouldApply — entrega fora de ordem', () => {
  it('aprovação antiga não desfaz estorno nem chargeback', () => {
    expect(vupimShouldApply('APPROVED', null, 0)).toBe(true);
    expect(vupimShouldApply('APPROVED', { status: 'APPROVED', grossAmountUsd: 97 }, 0)).toBe(true);
    expect(vupimShouldApply('APPROVED', { status: 'REFUNDED', grossAmountUsd: -97 }, 0)).toBe(false);
    expect(vupimShouldApply('APPROVED', { status: 'CHARGEBACK', grossAmountUsd: -97 }, 0)).toBe(false);
  });
  it('estorno só avança; chargeback sempre vale', () => {
    expect(vupimShouldApply('REFUNDED', { status: 'REFUNDED', grossAmountUsd: -35 }, 97)).toBe(true);
    expect(vupimShouldApply('REFUNDED', { status: 'REFUNDED', grossAmountUsd: -97 }, 35)).toBe(false);
    expect(vupimShouldApply('REFUNDED', { status: 'CHARGEBACK', grossAmountUsd: -97 }, 97)).toBe(false);
    expect(vupimShouldApply('CHARGEBACK', { status: 'REFUNDED', grossAmountUsd: -97 }, 97)).toBe(true);
  });
});

describe('assinatura (X-Webhook-Signature)', () => {
  const raw = JSON.stringify(approved);
  it('HMAC-SHA256 do corpo cru em hex, prefixo sha256=', () => {
    const sig = signVupimBody(raw, 'whsec_teste');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyVupimSignature(raw, sig, ['whsec_teste'])).toBe('VALID');
  });
  it('corpo reformatado ou segredo errado não passa; sem segredo = não configurado', () => {
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
