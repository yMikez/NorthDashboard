import { describe, expect, it } from 'vitest';
import { assembleRefundCohorts } from './refundCohorts';

// Coorte sintética: vendas em 3 dias, estornos com lags variados.
// hoje = 2026-08-18 (BRT).
const TODAY = '2026-08-18';

describe('assembleRefundCohorts', () => {
  it('célula = % ACUMULADO até o lag da coluna', () => {
    const r = assembleRefundCohorts({
      base: [{ day: '2026-08-10', count: 100, usd: 10000 }],
      events: [
        { day: '2026-08-10', lag: 0, count: 2, usd: 200 },
        { day: '2026-08-10', lag: 3, count: 3, usd: 450 },
      ],
      todayBrt: TODAY,
      horizonDays: 7,
    });
    const c = r.cohorts[0];
    expect(c.ageDays).toBe(8);
    expect(c.cells[0]).toMatchObject({ cumCount: 2, pctCount: 0.02 });
    expect(c.cells[2]).toMatchObject({ cumCount: 2 });         // nada no dia 1-2
    expect(c.cells[3]).toMatchObject({ cumCount: 5, pctCount: 0.05, cumUsd: 650 });
    expect(c.cells[7]).toMatchObject({ cumCount: 5 });         // acumula até o fim
    expect(c.cells[3]?.pctUsd).toBeCloseTo(0.065, 4);
  });

  it('CENSURA: coorte que não viveu o dia N tem célula null, não zero', () => {
    const r = assembleRefundCohorts({
      base: [{ day: '2026-08-16', count: 50, usd: 5000 }],  // idade 2
      events: [],
      todayBrt: TODAY,
      horizonDays: 7,
    });
    const c = r.cohorts[0];
    expect(c.cells[0]).not.toBeNull();
    expect(c.cells[2]).not.toBeNull();
    expect(c.cells[3]).toBeNull();   // idade 2 < coluna 3 → em branco
    expect(c.cells[7]).toBeNull();
  });

  it('coorte de hoje (idade 0) só tem a coluna 0', () => {
    const r = assembleRefundCohorts({
      base: [{ day: TODAY, count: 10, usd: 1000 }],
      events: [{ day: TODAY, lag: 0, count: 1, usd: 100 }],
      todayBrt: TODAY,
      horizonDays: 7,
    });
    const c = r.cohorts[0];
    expect(c.cells[0]).toMatchObject({ cumCount: 1, pctCount: 0.1 });
    expect(c.cells[1]).toBeNull();
  });

  it('estorno com lag > horizonte fica fora da matriz e é contado à parte', () => {
    const r = assembleRefundCohorts({
      base: [{ day: '2026-05-01', count: 100, usd: 10000 }],
      events: [{ day: '2026-05-01', lag: 95, count: 4, usd: 400 }],
      todayBrt: TODAY,
      horizonDays: 30,
    });
    expect(r.cohorts[0].cells[30]).toMatchObject({ cumCount: 0 });
    expect(r.totals.beyondHorizonCount).toBe(4);
  });

  it('curva de maturação exclui coortes imaturas do agregado daquela idade', () => {
    const r = assembleRefundCohorts({
      base: [
        { day: '2026-08-08', count: 100, usd: 10000 }, // idade 10 — madura p/ N<=10
        { day: '2026-08-16', count: 100, usd: 10000 }, // idade 2  — madura só p/ N<=2
      ],
      events: [
        { day: '2026-08-08', lag: 5, count: 10, usd: 1000 },
        { day: '2026-08-16', lag: 0, count: 1, usd: 100 },
      ],
      todayBrt: TODAY,
      horizonDays: 10,
    });
    // N=0: as duas coortes elegíveis → (0+1)/200
    expect(r.curve[0]).toMatchObject({ pctCount: 0.005, eligibleBaseCount: 200 });
    // N=5: só a coorte de 08-08 é elegível → 10/100
    expect(r.curve[5]).toMatchObject({ pctCount: 0.1, eligibleBaseCount: 100 });
    // N=3..4 (antes do lag 5): elegível só a madura, ainda 0
    expect(r.curve[3]).toMatchObject({ pctCount: 0, eligibleBaseCount: 100 });
  });

  it('curva com idade sem nenhuma coorte elegível → null (não 0)', () => {
    const r = assembleRefundCohorts({
      base: [{ day: '2026-08-16', count: 100, usd: 10000 }], // idade 2
      events: [],
      todayBrt: TODAY,
      horizonDays: 10,
    });
    expect(r.curve[2].pctCount).toBe(0);
    expect(r.curve[3].pctCount).toBeNull();
  });

  it('coortes vêm ordenadas da mais recente pra mais antiga', () => {
    const r = assembleRefundCohorts({
      base: [
        { day: '2026-08-10', count: 1, usd: 100 },
        { day: '2026-08-15', count: 1, usd: 100 },
      ],
      events: [],
      todayBrt: TODAY,
      horizonDays: 7,
    });
    expect(r.cohorts.map((c) => c.day)).toEqual(['2026-08-15', '2026-08-10']);
  });

  it('dia com estorno mas base 0 (só linhas não-elegíveis) não divide por zero', () => {
    const r = assembleRefundCohorts({
      base: [{ day: '2026-08-10', count: 0, usd: 0 }],
      events: [{ day: '2026-08-10', lag: 1, count: 1, usd: 100 }],
      todayBrt: TODAY,
      horizonDays: 7,
    });
    expect(r.cohorts[0].cells[1]).toMatchObject({ cumCount: 1, pctCount: 0 });
  });
});

describe('assembleRefundCohorts — eventos órfãos', () => {
  it('estorno em dia sem base elegível é contado à parte, não silenciado', () => {
    const r = assembleRefundCohorts({
      base: [{ day: '2026-08-10', count: 10, usd: 1000 }],
      events: [
        { day: '2026-08-10', lag: 1, count: 1, usd: 100 },
        { day: '2026-07-01', lag: 2, count: 3, usd: 300 }, // dia sem base no recorte
      ],
      todayBrt: '2026-08-18',
      horizonDays: 7,
    });
    expect(r.totals.refundCount).toBe(1);
    expect(r.totals.orphanEventCount).toBe(3);
  });
});
