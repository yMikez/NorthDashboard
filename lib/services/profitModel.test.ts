import { describe, it, expect } from 'vitest';
import { netAovUsd, cpaStatus, realOrderCount } from './profitModel';

const TH = { healthyMinUsd: 10, attentionMinUsd: 0 };

describe('netAovUsd (fórmula da planilha CPA)', () => {
  it('reproduz a linha real da planilha: 340 × (1−15%−8%−10%) = 227.80', () => {
    expect(netAovUsd(340, { refundCbPct: 15, feePct: 8, opexPct: 10 })).toBe(227.8);
  });
  it('percentuais zerados → NET AOV = AOV', () => {
    expect(netAovUsd(200, { refundCbPct: 0, feePct: 0, opexPct: 0 })).toBe(200);
  });
  it('AOV 0 (sem sessões) → 0', () => {
    expect(netAovUsd(0, { refundCbPct: 15, feePct: 8, opexPct: 10 })).toBe(0);
  });
});

describe('cpaStatus (régua da planilha: ≥10 saudável, ≥0 atenção, <0 renegociar)', () => {
  it('casos da planilha', () => {
    expect(cpaStatus(227.8 - 270, TH)).toBe('renegociar'); // −42.20 (JOAODAQUINA)
    expect(cpaStatus(5, TH)).toBe('atencao');
    expect(cpaStatus(10, TH)).toBe('saudavel');
    expect(cpaStatus(0, TH)).toBe('atencao');
    expect(cpaStatus(-0.01, TH)).toBe('renegociar');
  });
  it('régua configurável desloca as fronteiras', () => {
    const th = { healthyMinUsd: 50, attentionMinUsd: 20 };
    expect(cpaStatus(49, th)).toBe('atencao');
    expect(cpaStatus(50, th)).toBe('saudavel');
    expect(cpaStatus(19, th)).toBe('renegociar');
  });
});

// Denominador das taxas por afiliado/plataforma. A Digistore cria uma LINHA
// EXTRA no estorno (a venda original segue APPROVED ao lado); contar as duas
// dilui qualquer taxa calculada em cima — era o bug de 9,36% vs 10,45%.
describe('realOrderCount (denominador honesto)', () => {
  it('digistore: desconta estornos e chargebacks (linhas sintéticas)', () => {
    // 100 linhas = 88 vendas + 10 estornos + 2 CB → 88 pedidos reais.
    expect(realOrderCount('digistore24', 100, 10, 2)).toBe(88);
  });

  it('digistore: a taxa deixa de ser diluída', () => {
    const antes = 10 / 100;                                  // denominador inflado
    const agora = 10 / realOrderCount('digistore24', 100, 10, 2);
    expect(antes).toBeCloseTo(0.10, 4);
    expect(agora).toBeCloseTo(0.1136, 4);
    expect(agora).toBeGreaterThan(antes);
  });

  it('plataformas in-place: a linha estornada É a venda, conta inteira', () => {
    for (const slug of ['clickbank', 'buygoods', 'jvzoo', 'cartpanda']) {
      expect(realOrderCount(slug, 100, 10, 2)).toBe(100);
    }
  });

  it('sem estorno no período → não muda nada em plataforma nenhuma', () => {
    expect(realOrderCount('digistore24', 42, 0, 0)).toBe(42);
    expect(realOrderCount('buygoods', 42, 0, 0)).toBe(42);
  });

  it('nunca devolve negativo (recorte só de linhas de estorno)', () => {
    // Filtro por período pode pegar só as linhas sintéticas, sem as vendas.
    expect(realOrderCount('digistore24', 3, 3, 0)).toBe(0);
    expect(realOrderCount('digistore24', 2, 3, 1)).toBe(0);
  });

  it('plataforma desconhecida é tratada como in-place (conservador)', () => {
    expect(realOrderCount('plataforma-nova', 100, 10, 2)).toBe(100);
  });
});
