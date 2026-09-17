import { describe, expect, it } from 'vitest';
import { parseSalesboundBody, parseSalesboundPostback, tokenFromBody } from './ingest';

const meta = { method: 'GET', contentType: null, userAgent: 'SalesBound/1.0', ip: '1.2.3.4' };

describe('parseSalesboundBody', () => {
  it('JSON objeto, array de 1 (desembrulha), form-urlencoded e texto solto', () => {
    expect(parseSalesboundBody('{"a":1}', 'application/json')).toEqual({ a: 1 });
    expect(parseSalesboundBody('[{"a":1}]', 'application/json')).toEqual({ a: 1 });
    expect(parseSalesboundBody('[{"a":1},{"b":2}]', 'application/json')).toEqual({ _items: [{ a: 1 }, { b: 2 }] });
    expect(parseSalesboundBody('a=1&b=x%20y', 'application/x-www-form-urlencoded')).toEqual({ a: '1', b: 'x y' });
    expect(parseSalesboundBody('{"a":1}', null)).toEqual({ a: 1 });          // sem content-type: tenta JSON
    expect(parseSalesboundBody('a=1', null)).toEqual({ a: '1' });            // … depois form
    expect(parseSalesboundBody('oi', 'text/plain')).toEqual({ _raw: 'oi' }); // … senão guarda cru
    expect(parseSalesboundBody('   ', 'application/json')).toEqual({});
  });
  it('content-type mentiroso não perde o dado (JSON dito como form)', () => {
    expect(parseSalesboundBody('{"a":1}', 'application/x-www-form-urlencoded')).toEqual({ a: 1 });
  });
});

describe('parseSalesboundPostback', () => {
  it('GET com macros: tipo do evento, id e payload sem o token', () => {
    const c = parseSalesboundPostback({ token: 'segredo', event: 'Sale', order_id: 'SB-1', email: 'x@y.com', amount: '97.00' }, {}, meta);
    expect(c.eventType).toBe('sale');
    expect(c.externalId).toBe('SB-1');
    expect(c.isTest).toBe(false);
    expect(c.payload).not.toHaveProperty('token');
    expect(c.payload).toMatchObject({ event: 'Sale', order_id: 'SB-1', email: 'x@y.com', amount: '97.00' });
    expect((c.payload._meta as { queryKeys: string[] }).queryKeys).toEqual(['event', 'order_id', 'email', 'amount']);
  });
  it('POST JSON vence a query na mesma chave; chaves alternativas (type/transaction_id); test flag e evento com "test"', () => {
    const c = parseSalesboundPostback({ event: 'query' }, { event: 'Refund Issued', transaction_id: 12345, is_test: 'true' }, { ...meta, method: 'POST', contentType: 'application/json' });
    expect(c.eventType).toBe('refund_issued');
    expect(c.externalId).toBe('12345');
    expect(c.isTest).toBe(true);
    const c2 = parseSalesboundPostback({ event: 'test_ping' }, {}, meta);
    expect(c2.isTest).toBe(true);
    expect(c2.externalId).toBeNull();
  });
  it('nada reconhecível → unknown, sem id, nunca lança', () => {
    const c = parseSalesboundPostback({}, {}, meta);
    expect(c).toMatchObject({ eventType: 'unknown', externalId: null, isTest: false });
  });
  it('status como fallback de evento quando não há event/type; type como alternativa a event', () => {
    expect(parseSalesboundPostback({ status: 'APPROVED', id: '9' }, {}, meta)).toMatchObject({ eventType: 'approved', externalId: '9' });
    expect(parseSalesboundPostback({}, { type: 'Chargeback', txid: 'T1' }, meta)).toMatchObject({ eventType: 'chargeback', externalId: 'T1' });
  });
  it('webhook real do CRM (2026-09-17): id é a TRANSAÇÃO (chave do razão), não o pedido; token fora do payload', () => {
    const c = parseSalesboundPostback({}, {
      orderId: '74916789FB', transactionId: '280035', campaignName: 'Salesbound - Phone Sales Team',
      emailAddress: 'x@y.com', totalPrice: '294.00', product1_name: 'Glyco Pulse - 1 Bottle',
      token: '77bdcaf6768234d4adb87ecff61353b6efbb2e15a4a7f3b5',
    }, { ...meta, method: 'POST', contentType: 'application/json' });
    expect(c.externalId).toBe('280035');
    expect(c.eventType).toBe('unknown');   // o CRM não manda tipo de evento
    expect(c.payload).not.toHaveProperty('token');
    expect(c.payload).toMatchObject({ orderId: '74916789FB', totalPrice: '294.00' });
  });
});

describe('tokenFromBody', () => {
  it('lê o token do CORPO (o CRM deles não manda querystring) só nas chaves de segredo', () => {
    expect(tokenFromBody({ orderId: 'A', token: ' abc ' })).toBe('abc');
    expect(tokenFromBody({ postback_token: 'xyz' })).toBe('xyz');
    expect(tokenFromBody({ Token: 'maiusculo' })).toBe('maiusculo');
    expect(tokenFromBody({ orderId: 'A' })).toBeNull();
    expect(tokenFromBody({ token: '' })).toBeNull();
    expect(tokenFromBody({ token: 123 })).toBeNull();   // só string conta
  });
});
