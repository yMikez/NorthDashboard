import { describe, expect, it } from 'vitest';
import { parseSalesboundWebhookSale, salesboundWebhookDate } from './webhook';

// Evento real recebido em 2026-09-17 (token já removido pela captura).
const real = {
  city: 'Santa Fe,', state: 'NM', country: 'US', postalcode: '87507', address1: '6141 Monte Azul Pl.',
  orderId: 279415, clientOrderID: '3ABA6A99DD', clientTxnId: '67FAC581C1A7', transactionId: '12569839087',
  campaignId: 7, campaignName: 'Salesbound - Phone Sales Team',
  dateCreated: '2026-09-17 16:23:08', timeCreated: '16:23:08',
  emailAddress: 'RTorrence275@Gmail.com', fullName: 'Richard Torrence', phoneNumber: '15056608654',
  product1_name: 'NeuroRecall - 1 Bottle', product1_crmId: '601', product1_id: '', product1_sku: 'neurorecall-1',
  product1_qty: '6', product1_price: '282.00', product1_campaignProductId: '11089',
  totalDiscount: '0.00', totalPrice: '282.00',
};

describe('parseSalesboundWebhookSale', () => {
  it('evento real → VENDA no razão: chave clientTxnId, pedido = clientOrderID, hora Eastern → UTC', () => {
    const s = parseSalesboundWebhookSale(real)!;
    expect(s).toMatchObject({
      clientTxnId: '67FAC581C1A7',   // ponte com o export
      orderId: '3ABA6A99DD',         // = orderId do export (agrupa venda + estornos)
      type: 'SALE', amountUsd: 282, email: 'rtorrence275@gmail.com',
      gatewayTxnId: '12569839087',   // export chama de txnId (repete)
      crmOrderId: '279415',          // pedido no CRM (não é a transação)
      family: 'NeuroRecall', bottles: 6,
    });
    expect(s.txnAt.toISOString()).toBe('2026-09-17T20:23:08.000Z');   // EDT = UTC−4
    expect(s.items).toEqual([{ name: 'NeuroRecall - 1 Bottle', sku: '601', qty: 6, price: 282, family: 'NeuroRecall', bottles: 1 }]);
  });
  it('vários produtos: família é a do item mais caro e potes somam', () => {
    const s = parseSalesboundWebhookSale({
      ...real, totalPrice: '846.00',
      product2_name: 'Glyco Pulse - 1 Bottle', product2_crmId: '1', product2_sku: 'glycopulse-1', product2_qty: '12', product2_price: '564.00',
    })!;
    expect(s.amountUsd).toBe(846);
    expect(s.items).toHaveLength(2);
    expect(s.family).toBe('GlycoPulse');
    expect(s.bottles).toBe(18);
  });
  it('TUDO é venda (o CRM deles não manda tipo de evento) — só valor negativo vira estorno', () => {
    expect(parseSalesboundWebhookSale({ ...real, totalPrice: '0.00' })).toMatchObject({ type: 'SALE', amountUsd: 0 });
    expect(parseSalesboundWebhookSale({ ...real, totalPrice: '-2,970.00' })).toMatchObject({ type: 'REFUND', amountUsd: 2970 });
  });
  it('sem clientTxnId ou sem data → null (o IngestLog continua guardado pra replay)', () => {
    expect(parseSalesboundWebhookSale({ ...real, clientTxnId: '' })).toBeNull();
    expect(parseSalesboundWebhookSale({ ...real, dateCreated: '' })).toBeNull();
    expect(parseSalesboundWebhookSale({})).toBeNull();
  });
  it('sem clientOrderID o pedido vira a própria transação', () => {
    expect(parseSalesboundWebhookSale({ ...real, clientOrderID: '' })!.orderId).toBe('67FAC581C1A7');
  });
});

describe('salesboundWebhookDate', () => {
  it('aceita data com hora junto ou data + timeCreated separados; horário de inverno (EST = UTC−5)', () => {
    expect(salesboundWebhookDate('2026-09-17 16:23:08', null)!.toISOString()).toBe('2026-09-17T20:23:08.000Z');
    expect(salesboundWebhookDate('2026-09-17', '16:23:08')!.toISOString()).toBe('2026-09-17T20:23:08.000Z');
    expect(salesboundWebhookDate('2026-01-15', '10:00:00')!.toISOString()).toBe('2026-01-15T15:00:00.000Z');
    expect(salesboundWebhookDate('2026-09-17', null)!.toISOString()).toBe('2026-09-17T04:00:00.000Z');
    expect(salesboundWebhookDate('', '10:00:00')).toBeNull();
  });
});
