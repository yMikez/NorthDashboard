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

// ─── FASE 2: projeção chain-ladder + Bornhuetter-Ferguson ───────────────────
//
// Triângulo sintético com padrão PERFEITO: toda coorte madura desenvolve
// 2 estornos no dia 0, +2 no dia 1, +1 no dia 2 (total 5 de 100 = 5%).
// Fatores exatos: f0 = 4/2 = 2, f1 = 5/4 = 1.25 → F(0) = 2.5, developed(0) = 0.4.
describe('computeRefundProjection (Fase 2)', () => {
  const TODAY = '2026-08-18';
  const matureBase = [
    { day: '2026-08-10', count: 100, usd: 10000 },
    { day: '2026-08-11', count: 100, usd: 10000 },
    { day: '2026-08-12', count: 100, usd: 10000 },
  ];
  const matureEvents = matureBase.flatMap((b) => [
    { day: b.day, lag: 0, count: 2, usd: 200 },
    { day: b.day, lag: 1, count: 2, usd: 200 },
    { day: b.day, lag: 2, count: 1, usd: 100 },
  ]);

  it('coorte jovem no padrão histórico projeta a taxa final madura', () => {
    const r = assembleRefundCohorts({
      base: [...matureBase, { day: TODAY, count: 100, usd: 10000 }],
      events: [...matureEvents, { day: TODAY, lag: 0, count: 2, usd: 200 }],
      todayBrt: TODAY,
      horizonDays: 2,
    });
    const young = r.cohorts.find((c) => c.day === TODAY)!;
    // developed(0) = 0.4; BF: 0.02 + prior×0.6. Prior = agregado dos
    // ultimates CL: maduras 5% cada, jovem 2×2.5=5 → prior = 5%.
    expect(young.projection?.developedCount).toBeCloseTo(0.4, 4);
    expect(r.projection.periodPctCount).toBeCloseTo(0.05, 4);
    expect(young.projection?.pctCount).toBeCloseTo(0.05, 4);
  });

  it('coorte jovem com ZERO estornos não projeta zero (BF puxa pro prior)', () => {
    const r = assembleRefundCohorts({
      base: [...matureBase, { day: TODAY, count: 100, usd: 10000 }],
      events: matureEvents,
      todayBrt: TODAY,
      horizonDays: 2,
    });
    const young = r.cohorts.find((c) => c.day === TODAY)!;
    // observado 0 + prior×(1−0.4). Prior dilui com o ultimate 0 da jovem:
    // (5+5+5+0)/400 = 3.75% → proj = 0.0375×0.6 = 2.25%.
    expect(young.projection?.pctCount).toBeGreaterThan(0.02);
    expect(young.projection?.pctCount).toBeLessThan(0.0375);
  });

  it('coorte madura: projeção = observado, developed = 1', () => {
    const r = assembleRefundCohorts({
      base: matureBase,
      events: matureEvents,
      todayBrt: TODAY,
      horizonDays: 2,
    });
    for (const c of r.cohorts) {
      expect(c.projection?.developedCount).toBe(1);
      expect(c.projection?.pctCount).toBeCloseTo(c.cells[2]!.pctCount, 4);
    }
    expect(r.projection.matureCohortCount).toBe(3);
    expect(r.projection.tailIncomplete).toBe(false);
  });

  it('sem estorno nenhum → projeção 0, não null', () => {
    const r = assembleRefundCohorts({
      base: matureBase,
      events: [],
      todayBrt: TODAY,
      horizonDays: 2,
    });
    expect(r.projection.periodPctCount).toBe(0);
    expect(r.cohorts[0].projection?.pctCount).toBe(0);
  });

  it('horizonte além da coorte mais velha → tailIncomplete e projeção-piso', () => {
    const r = assembleRefundCohorts({
      base: [{ day: '2026-08-16', count: 100, usd: 10000 }], // idade 2
      events: [{ day: '2026-08-16', lag: 0, count: 3, usd: 300 }],
      todayBrt: TODAY,
      horizonDays: 30, // ninguém viveu 30 dias
      });
    expect(r.projection.tailIncomplete).toBe(true);
    // Fatores ausentes = 1 → projeção não INVENTA crescimento: piso = observado.
    expect(r.cohorts[0].projection?.pctCount).toBeCloseTo(0.03, 4);
  });

  it('lente de valor projeta independente da de pedidos', () => {
    const r = assembleRefundCohorts({
      base: [...matureBase, { day: TODAY, count: 100, usd: 10000 }],
      // valor estornado proporcionalmente MAIOR (tickets altos voltam mais)
      events: [
        ...matureBase.flatMap((b) => [
          { day: b.day, lag: 0, count: 2, usd: 600 },
          { day: b.day, lag: 1, count: 2, usd: 600 },
          { day: b.day, lag: 2, count: 1, usd: 300 },
        ]),
        { day: TODAY, lag: 0, count: 2, usd: 600 },
      ],
      todayBrt: TODAY,
      horizonDays: 2,
    });
    const young = r.cohorts.find((c) => c.day === TODAY)!;
    expect(young.projection?.pctUsd).toBeCloseTo(0.15, 3);
    expect(young.projection?.pctCount).toBeCloseTo(0.05, 3);
  });
});

// Regressões dos cenários da revisão adversarial 2026-08-18 (probes reais
// que quebravam a implementação em fatores encadeados).
describe('computeRefundProjection — regressões da revisão', () => {
  const TODAY = '2026-08-18';

  it('estornos que só começam no D1+ não zeram a projeção (den=0 no fator antigo)', () => {
    // Maduras: 0% no D0, 2% no D1, 5% no D2 — nenhum estorno same-day.
    const base = [
      { day: '2026-08-10', count: 100, usd: 10000 },
      { day: '2026-08-11', count: 100, usd: 10000 },
      { day: '2026-08-12', count: 100, usd: 10000 },
      { day: TODAY, count: 100, usd: 10000 },          // jovem, 0 estornos
    ];
    const events = ['2026-08-10', '2026-08-11', '2026-08-12'].flatMap((day) => [
      { day, lag: 1, count: 2, usd: 200 },
      { day, lag: 2, count: 3, usd: 300 },
    ]);
    const r = assembleRefundCohorts({ base, events, todayBrt: TODAY, horizonDays: 2 });
    const young = r.cohorts.find((c) => c.day === TODAY)!;
    // O D0 nunca revelou nada → developed(0) = 0 e a projeção é o prior
    // inteiro (5%), não um "piso" de 2,25% sem flag.
    expect(young.projection?.developedCount).toBe(0);
    expect(young.projection?.pctCount).toBeCloseTo(0.05, 4);
    expect(r.projection.tailIncomplete).toBe(false);
  });

  it('chip do período == média base-ponderada da coluna de projeções (reconciliação)', () => {
    // Surto: jovem com 10 estornos no D0 (maduras a 5%).
    const base = [
      { day: '2026-08-10', count: 100, usd: 10000 },
      { day: '2026-08-11', count: 100, usd: 10000 },
      { day: '2026-08-12', count: 100, usd: 10000 },
      { day: TODAY, count: 100, usd: 10000 },
    ];
    const events = [
      ...['2026-08-10', '2026-08-11', '2026-08-12'].flatMap((day) => [
        { day, lag: 0, count: 2, usd: 200 },
        { day, lag: 1, count: 2, usd: 200 },
        { day, lag: 2, count: 1, usd: 100 },
      ]),
      { day: TODAY, lag: 0, count: 10, usd: 1000 },
    ];
    const r = assembleRefundCohorts({ base, events, todayBrt: TODAY, horizonDays: 2 });
    const weighted = r.cohorts.reduce((s, c) => s + (c.projection?.pctCount ?? 0) * c.baseCount, 0)
      / r.cohorts.reduce((s, c) => s + c.baseCount, 0);
    expect(r.projection.periodPctCount).toBeCloseTo(weighted, 3);
    // E o prior Cape Cod segura o ruído: surto de D0 não dobra o período.
    // (obs 25 ÷ exposição 340 = 7,35% — o prior ingênuo dava 10%.)
    expect(r.projection.periodPctCount).toBeCloseTo(0.0735, 3);
  });

  it('rampa de volume: coorte jovem gigante sem estornos não esconde a taxa madura', () => {
    const base = [
      { day: '2026-08-10', count: 100, usd: 10000 },
      { day: '2026-08-11', count: 100, usd: 10000 },
      { day: '2026-08-12', count: 100, usd: 10000 },
      { day: TODAY, count: 1000, usd: 100000 },        // 10× volume, idade 0
    ];
    const events = ['2026-08-10', '2026-08-11', '2026-08-12'].flatMap((day) => [
      { day, lag: 0, count: 2, usd: 200 },
      { day, lag: 1, count: 2, usd: 200 },
      { day, lag: 2, count: 1, usd: 100 },
    ]);
    const r = assembleRefundCohorts({ base, events, todayBrt: TODAY, horizonDays: 2 });
    const young = r.cohorts.find((c) => c.day === TODAY)!;
    // Zero estorno no D0 de 1000 vendas É evidência (esperava-se ~20 no
    // padrão) — a projeção fica abaixo do prior, mas nunca zero.
    expect(young.projection?.pctCount).toBeGreaterThan(0.005);
    expect(young.projection?.pctCount).toBeLessThan(0.05);
    // E o chip continua reconciliando com a coluna.
    const weighted = r.cohorts.reduce((s, c) => s + (c.projection?.pctCount ?? 0) * c.baseCount, 0)
      / r.cohorts.reduce((s, c) => s + c.baseCount, 0);
    expect(r.projection.periodPctCount).toBeCloseTo(weighted, 3);
  });
});
