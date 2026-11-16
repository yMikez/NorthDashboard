import { describe, expect, it } from 'vitest';
import { brtDay, d60Key, d60Map, forecastTotalPct, sumD60, totalsFromRows, type D60DbRow } from './affiliateRefundForecastCore';

const row = (over: Partial<D60DbRow> = {}): D60DbRow => ({
  slug: 'jvzoo', aff: '123', pedidos: 10, vendido_total: 1200,
  re_real: 60, cb_real: 20, al_real: 30, tx_real: 10, total_real: 120,
  com_previsao: 9, vendido: 1000, reembolso: 100, chargeback: 30, alertas: 50, taxas: 20, total: 199.5, total_fechado: 40,
  ...over,
});

describe('affiliateRefundForecastCore', () => {
  it('dia BRT do filtro: início e fim do dia BRT viram o mesmo dia de calendário', () => {
    expect(brtDay(new Date('2026-11-01T03:00:00.000Z'))).toBe('2026-11-01');
    expect(brtDay(new Date('2026-11-17T02:59:59.999Z'))).toBe('2026-11-16');
  });

  it('chave igual à da lista de afiliados (slug minúsculo); real e previsto separados', () => {
    expect(d60Key('JVZoo', '3552213')).toBe('jvzoo:3552213');
    const m = d60Map([row({ slug: 'JVZoo' }), row({ slug: 'vupim', aff: 'abc' })]);
    expect(m.get('jvzoo:123')?.real.totalUsd).toBe(120);
    expect(m.get('jvzoo:123')?.forecast?.totalUsd).toBe(199.5);
    expect(m.get('vupim:abc')?.forecast?.orders).toBe(9);
  });

  it('sem pedido com previsão: só o real (forecast null)', () => {
    const d = d60Map([row({ com_previsao: 0, vendido: 0, total: 0 })]).get('jvzoo:123')!;
    expect(d.forecast).toBeNull();
    expect(d.real.refundUsd).toBe(60);
    expect(forecastTotalPct(d)).toBeNull();
  });

  it('parceiro: soma as contas e o % sai do total (soma antes de dividir)', () => {
    const m = d60Map([row(), row({ slug: 'vupim', aff: 'x', vendido: 3000, total: 300, reembolso: 200 }), row({ aff: 'y', com_previsao: 0 })]);
    const s = sumD60([m.get('jvzoo:123'), m.get('vupim:x'), m.get('jvzoo:y'), null])!;
    expect(s.orders).toBe(30);
    expect(s.real.totalUsd).toBe(360);
    expect(s.forecast!.soldUsd).toBe(4000);
    expect(s.forecast!.totalUsd).toBe(499.5);
    expect(s.forecast!.refundUsd).toBe(300);
    expect(forecastTotalPct(s)).toBeCloseTo(499.5 / 4000, 10);
  });

  it('total geral: soma sem arredondar conta a conta (não acumula centavos)', () => {
    const rows = [row({ total: 0.004 }), row({ aff: '2', total: 0.004 }), row({ aff: '3', total: 0.004 })];
    expect(sumD60([...d60Map(rows).values()])!.forecast!.totalUsd).toBe(0);
    expect(totalsFromRows(rows)!.forecast!.totalUsd).toBe(0.01);
    expect(totalsFromRows([])).toBeNull();
    expect(sumD60([null, undefined])).toBeNull();
  });
});
