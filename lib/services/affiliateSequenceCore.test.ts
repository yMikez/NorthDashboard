import { describe, expect, it } from 'vitest';
import { metricsFor, ZERO_BUCKET, type Bucket, type RateInputs, type WindowMetrics } from './affiliateAnalysisCore';
import { sequenceRanges, narrateEntity, transitionBetween, healthNote, riskText, reactivationList, type EntitySeries } from './affiliateSequenceCore';

const rates: RateInputs = { slug: 'jvzoo', feePct: 5, refundCbPct: 15, opexPct: 10, thresholds: { healthyMinUsd: 10, attentionMinUsd: 0 } };
const m = (revenue: number, fe = Math.max(1, Math.round(revenue / 350)), cpa = 250, approval = 0.9): WindowMetrics => {
  const all = Math.round(fe / approval);
  return metricsFor({ ...ZERO_BUCKET, allOrders: all, approved: fe, revenue, feApproved: fe, feRevenue: revenue } as Bucket, 7, 7, cpa, rates);
};
const L = ['Semana 1', 'Semana 2', 'Semana 3'];
const series = (name: string, metrics: Array<WindowMetrics | null>, ranks: Array<number | null>): EntitySeries => ({ key: name, name, metrics, ranks });

describe('sequenceRanges', () => {
  it('K janelas consecutivas terminando em lastIdx, mais antiga primeiro', () => {
    expect(sequenceRanges(7, 3, 119)).toEqual([{ from: 99, to: 105 }, { from: 106, to: 112 }, { from: 113, to: 119 }]);
  });
});

describe('narrateEntity — tags e textos', () => {
  it('breakout: estreou e disparou', () => {
    const n = narrateEntity(series('xx483', [null, m(40407.96), m(434529.58)], [null, 5, 1]), L);
    expect(n.tag).toBe('breakout');
    expect(n.title).toMatch(/Breakout — disparada de 975,4%/);
    expect(n.text).toMatch(/liderança isolada/);
    expect(n.deltas).toEqual([null, null, 9.7536]);
  });
  it('estagnado depois de queda', () => {
    const n = narrateEntity(series('nicolas', [m(316100), m(234815), m(237229)], [1, 2, 2]), L);
    expect(n.tag).toBe('estagnado');
    expect(n.text).toMatch(/segue em #2 há duas janelas seguidas/);
  });
  it('queda forte com net melhorando (CPA caiu mais que receita)', () => {
    const n = narrateEntity(series('adsmastery', [m(86685, 213, 230), m(23313, 62, 220), m(3901, 10, 50)], [3, 8, 20]), L);
    expect(n.tag).toBe('queda_forte');
    expect(n.title).toBe('Queda forte — de #3 para #20');
    expect(n.text).toMatch(/Net após CPA melhorou/);
  });
  it('novo entrante forte', () => {
    const n = narrateEntity(series('lucas', [null, null, m(29615)], [null, null, 6]), L);
    expect(n.tag).toBe('novo');
    expect(n.title).toMatch(/estreia forte/);
    expect(n.text).toMatch(/Apareceu na Semana 3 já em #6/);
  });
  it('churn total', () => {
    const n = narrateEntity(series('health-club', [m(17782), null, null], [9, null, null]), L);
    expect(n.tag).toBe('churn');
    expect(n.title).toBe('Saiu do radar — churn total');
    expect(n.text).toMatch(/\$17,782 na Semana 1 \(#9\)/);
  });
  it('volátil: pico e queda voltando ao ponto de partida', () => {
    const n = narrateEntity(series('neha', [m(15778), m(39773), m(19953)], [10, 6, 9]), L);
    expect(n.tag).toBe('volatil');
    expect(n.title).toMatch(/voltou quase ao ponto de partida/);
  });
  it('crescimento que estabilizou', () => {
    const n = narrateEntity(series('jamie', [m(21987), m(43490), m(44013)], [7, 4, 5]), L);
    expect(n.tag).toBe('crescimento');
    expect(n.title).toMatch(/estabilizou/);
  });
  it('estável e saudável (net alto em todas)', () => {
    const n = narrateEntity(series('skill99', [m(17946, 88, 33), m(19399, 103, 33), m(20096, 110, 33)], [8, 9, 8]), L);
    expect(n.tag).toBe('estavel');
    expect(n.title).toBe('Estável e saudável');
    expect(n.text).toMatch(/nenhuma ação necessária/);
  });
  it('renegociar: net negativo com o CPA atual; base quase zero vira "de quase zero a #N"', () => {
    const n = narrateEntity(series('marco', [null, m(909, 3, 220), m(21383, 73, 220, 0.99)], [null, 38, 7]), L);
    expect(n.tag).toBe('breakout');
    expect(n.title).toBe('Breakout — de quase zero a #7');
    expect(n.text).toMatch(/renegociar antes de escalar/);
  });
  it('NÃO é breakout quando derreteu e voltou pouco (compara com o pico, não só o último passo)', () => {
    const n = narrateEntity(series('x', [m(50000), m(30, 1), m(400, 1)], [1, 60, 40]), L);
    expect(n.tag).toBe('queda_forte');
    expect(n.title).toMatch(/recuperação parcial/);
  });
  it('voltar ao patamar é "queda e recuperação", não breakout; receita irrelevante não vira breakout', () => {
    expect(narrateEntity(series('y', [m(1000), m(300), m(1000)], [5, 12, 5]), L).title).toBe('Queda e recuperação');
    expect(narrateEntity(series('z', [m(30, 1), m(95, 1)], [20, 15]), ['J1', 'J2']).tag).not.toBe('breakout');
  });
  it('intermitente (vendeu, sumiu, voltou)', () => {
    const n = narrateEntity(series('w', [m(100, 1), null, m(110, 1)], [8, null, 7]), L);
    expect(n.tag).toBe('volatil');
    expect(n.title).toMatch(/Intermitente/);
    expect(n.text).toMatch(/sem nenhuma venda em Semana 2/);
  });
  it('K=2: títulos sem "consistente"/"sem sinal"', () => {
    expect(narrateEntity(series('a', [m(1000), m(1300)], [3, 2]), ['J1', 'J2']).title).toBe('Crescimento de +30,0%');
    expect(narrateEntity(series('b', [m(1000), m(700)], [3, 5]), ['J1', 'J2']).title).toBe('Queda de 30,0%');
  });
  it('volátil detectado em qualquer ponto da série (K=5)', () => {
    const n = narrateEntity(series('v', [m(100, 1), m(500, 2), m(100, 1), m(100, 1), m(100, 1)], [9, 3, 9, 9, 9]), ['J1', 'J2', 'J3', 'J4', 'J5']);
    expect(n.tag).toBe('volatil');
    expect(n.title).toBe('Pico e queda');
  });
});

describe('transições e saúde', () => {
  const w1 = [{ key: 'a', name: 'A', revenue: 100, sales: 1 }, { key: 'b', name: 'B', revenue: 300, sales: 3 }, { key: 'c', name: 'C', revenue: 50, sales: 1 }];
  const w2 = [{ key: 'a', name: 'A', revenue: 60, sales: 1 }, { key: 'b', name: 'B', revenue: 200, sales: 2 }, { key: 'd', name: 'D', revenue: 120, sales: 1 }];
  it('retidos/novos/churn com receitas e nota "não é perda de afiliados"', () => {
    const t = transitionBetween(w1, w2, 0, 1);
    expect(t).toMatchObject({ retained: 2, newCount: 1, churnCount: 1, revenueNew: 120, revenueChurn: 50, revenueRetainedBefore: 400, revenueRetainedAfter: 260 });
    expect(t.retainedChangePct).toBe(-0.35);
    expect(t.note).toMatch(/não veio de perda de afiliados/);
    expect(t.topLosers[0].name).toBe('B');
  });
  it('causa compara magnitudes: retidos −$4.000 pesa mais que churn $1.000 vs novos $900', () => {
    const p = [{ key: 'r', name: 'R', revenue: 9000, sales: 9 }, { key: 'c', name: 'C', revenue: 1000, sales: 1 }];
    const c = [{ key: 'r', name: 'R', revenue: 5000, sales: 5 }, { key: 'n', name: 'N', revenue: 900, sales: 1 }];
    const t = transitionBetween(p, c, 0, 1);
    expect(t.note).toMatch(/não veio de perda de afiliados/);
    const g = transitionBetween(
      [{ key: 'r', name: 'R', revenue: 1000, sales: 1 }, { key: 'c', name: 'C', revenue: 490, sales: 1 }],
      [{ key: 'r', name: 'R', revenue: 1050, sales: 1 }, { key: 'n', name: 'N', revenue: 500, sales: 1 }], 0, 1);
    expect(g.note).toMatch(/Base estável|quem já estava ativo/); // saldo líquido de aquisição é só +$10
  });
  it('healthNote sem base anterior: "Início da série", não "subiu 0,0%"', () => {
    const totals = [
      { revenue: 0, sales: 0, active: 0, concentrationTop10: 0, topShare2: 0, topNames: [] },
      { revenue: 1000, sales: 3, active: 2, concentrationTop10: 1, topShare2: 1, topNames: ['A', 'B'] },
    ];
    expect(healthNote(0, totals, [], L).title).toBe('■ Sem vendas');
    const n = healthNote(1, totals, [], L);
    expect(n.title).toBe('▲ Início da série');
    expect(n.text).not.toMatch(/subiu 0,0%/);
    expect(riskText(totals, [])).toMatch(/Base pequena/);
  });
  it('healthNote: ponto de partida concentrado e queda explicada', () => {
    const totals = [
      { revenue: 450, sales: 5, active: 3, concentrationTop10: 1, topShare2: 0.89, topNames: ['B', 'A'] },
      { revenue: 380, sales: 4, active: 3, concentrationTop10: 1, topShare2: 0.84, topNames: ['B', 'D'] },
    ];
    const tr = [transitionBetween(w1, w2, 0, 1)];
    expect(healthNote(0, totals, tr, L).title).toMatch(/concentrado/);
    const n = healthNote(1, totals, tr, L);
    expect(n.tone).toBe('neg');
    expect(n.title).toMatch(/não é perda de afiliados/);
    expect(n.text).toMatch(/retração de 35,0%/);
    expect(riskText(totals, tr)).toMatch(/Base pequena/);
  });
  it('reactivationList: quem sumiu na última janela, morno primeiro, com pico', () => {
    const list = reactivationList([
      series('quente', [m(1000), m(8139), null], [3, 2, null]),
      series('frio', [m(3000), null, null], [1, null, null]),
      series('vivo', [m(100), m(100), m(100)], [5, 5, 5]),
      series('pequeno', [m(100), null, null], [9, null, null]),
    ]);
    expect(list.map((r) => r.name)).toEqual(['quente', 'frio']);
    expect(list[0]).toMatchObject({ windowsAgo: 1, peakRevenue: 8139, peakIndex: 1 });
  });
});
