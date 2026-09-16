import { describe, expect, it } from 'vitest';
import { parseCsv, parseSalesboundTransactionsCsv, sourcePlatformOf } from './transactionsCsv';

// Recorte do export real (2026-09-16), colunas reduzidas às que o parser lê
// + product1..2 — a ordem não importa, o parser mapeia pelo cabeçalho.
const HEADER = 'date,orderId,orderAgentName,customerId,emailAddress,merchantName,isChargedback,type,amount,result,response,custom3,"product1 name","product1 id","product1 qty","product1 price","product2 name","product2 id","product2 qty","product2 price",transactionId';
const CSV = [
  'Transaction Details',
  'Date Range (by transactionDate): 2025-09-16 00:00:00 - 2026-09-16 23:59:59',
  'Campaign Id: 7',
  'Campaign Name: Salesbound - Phone Sales Team',
  '',
  HEADER,
  '"2026-09-15 22:52:29",74916789FB,Sam.Abbasi-NorthScale,61953,Tim@Example.com,PayArc,0,Refund,"-2,970.00",Success,Approved,"BuyGoods Order","Glyco Pulse - 1 Bottle",1,12,540.00,"Thermoburn Pro - 1 Bottle",7,18,810.00,280035',
  '"2026-09-15 21:13:06",A270AB38FD,Joshua.Fields-NorthScale,188791,52rrodriguez52@gmail.com,PayArc,0,Sale,348.00,"Hard Decline","Pick up card - SF","JVZoo Order","NeuroRecall - 1 Bottle",601,12,348.00,,,,,279907',
  '"2026-07-01 10:00:00",74916789FB,Sam.Abbasi-NorthScale,61953,tim@example.com,PayArc,0,Sale,"2,970.00",Success,Approved,"BuyGoods Order","Glyco Pulse - 1 Bottle",1,12,540.00,,,,,200001',
  'bad-date,X1,,,,,0,Sale,1.00,Success,,,,,,,,,,,1',
  'Total,,,,,,,,"178,911.78",,,,,,,,,,,,',
].join('\r\n');

describe('parseSalesboundTransactionsCsv', () => {
  const r = parseSalesboundTransactionsCsv(CSV);
  it('lê o cabeçalho de metadados e ignora o rodapé Total', () => {
    expect(r.meta).toEqual({ campaign: 'Salesbound - Phone Sales Team', campaignId: '7', dateRange: '2025-09-16 00:00:00 - 2026-09-16 23:59:59' });
    expect(r.rows).toHaveLength(3);
    expect(r.skipped).toEqual([{ line: 10, reason: 'data inválida: bad-date' }]);
  });
  it('normaliza tipo/resultado, valor absoluto com milhar, origem, e-mail e itens', () => {
    const refund = r.rows[0];
    expect(refund).toMatchObject({
      transactionId: '280035', orderId: '74916789FB', type: 'REFUND', result: 'SUCCESS', amountUsd: 2970,
      agentName: 'Sam.Abbasi-NorthScale', email: 'tim@example.com', sourcePlatform: 'buygoods', merchant: 'PayArc', chargedback: false, bottles: 30,
    });
    expect(refund.items.map((i) => [i.name, i.qty, i.price])).toEqual([['Glyco Pulse - 1 Bottle', 12, 540], ['Thermoburn Pro - 1 Bottle', 18, 810]]);
    expect(r.rows[1]).toMatchObject({ type: 'SALE', result: 'HARD_DECLINE', amountUsd: 348, sourcePlatform: 'jvzoo' });
  });
  it('data é wall clock America/New_York (EDT = UTC−4)', () => {
    expect(r.rows[0].txnAt.toISOString()).toBe('2026-09-16T02:52:29.000Z');
  });
  it('arquivo sem o cabeçalho do export → nenhuma linha e motivo', () => {
    const bad = parseSalesboundTransactionsCsv('a,b,c\n1,2,3');
    expect(bad.rows).toEqual([]);
    expect(bad.skipped[0].reason).toContain('cabeçalho');
  });
});

describe('helpers', () => {
  it('parseCsv trata aspas escapadas e vírgula/quebra dentro de aspas', () => {
    expect(parseCsv('a,"b,""c""\nd",e\r\n1,2,3')).toEqual([['a', 'b,"c"\nd', 'e'], ['1', '2', '3']]);
  });
  it('sourcePlatformOf mapeia o custom3 do CRM', () => {
    expect(sourcePlatformOf('Digistore24 Order')).toBe('digistore24');
    expect(sourcePlatformOf('cartpanda_pay')).toBe('cartpanda');
    expect(sourcePlatformOf('https://crm.checkoutchamp.com/x')).toBeNull();
    expect(sourcePlatformOf('')).toBeNull();
  });
});
