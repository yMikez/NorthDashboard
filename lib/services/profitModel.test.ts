import { describe, it, expect } from 'vitest';
import { netAovUsd, cpaStatus } from './profitModel';

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
