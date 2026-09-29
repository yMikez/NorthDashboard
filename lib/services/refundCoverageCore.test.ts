import { describe, expect, it } from 'vitest';
import { detectRefundSilence, silentInScope, MIN_SALES_FOR_SILENCE } from './refundCoverageCore';

describe('detectRefundSilence', () => {
  it('volume alto e zero estorno = leitura parcial (o caso BuyGoods)', () => {
    const [r] = detectRefundSilence([{ platform: 'buygoods', displayName: 'BuyGoods', sales: 29007, refundEvents: 0 }]);
    expect(r.silent).toBe(true);
  });
  it('qualquer estorno registrado tira o alerta', () => {
    const [r] = detectRefundSilence([{ platform: 'buygoods', displayName: 'BuyGoods', sales: 29007, refundEvents: 1 }]);
    expect(r.silent).toBe(false);
  });
  it('base pequena sem estorno é normal, não alerta', () => {
    const [r] = detectRefundSilence([{ platform: 'cartpanda', displayName: 'Cartpanda', sales: MIN_SALES_FOR_SILENCE - 1, refundEvents: 0 }]);
    expect(r.silent).toBe(false);
  });
});

describe('silentInScope', () => {
  const rows = detectRefundSilence([
    { platform: 'buygoods', displayName: 'BuyGoods', sales: 5000, refundEvents: 0 },
    { platform: 'jvzoo', displayName: 'JVZoo', sales: 5000, refundEvents: 80 },
  ]);
  it('sem filtro de plataforma, vale para a operação toda', () => {
    expect(silentInScope(rows, []).map((r) => r.platform)).toEqual(['buygoods']);
  });
  it('filtrado numa plataforma íntegra, não mostra o aviso', () => {
    expect(silentInScope(rows, ['jvzoo'])).toEqual([]);
  });
  it('filtrado na plataforma silenciosa, mostra', () => {
    expect(silentInScope(rows, ['buygoods', 'jvzoo']).map((r) => r.platform)).toEqual(['buygoods']);
  });
});
