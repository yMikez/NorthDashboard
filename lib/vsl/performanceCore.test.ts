import { describe, expect, it } from 'vitest';
import { exclusiveVslForDay, reducePerformance, type ChangeRow, type VisitAggRow } from './performanceCore';

const at = (iso: string) => new Date(iso);
// Dia BRT 2026-10-05 = 05/10 03:00Z até 06/10 03:00Z.
const changes: ChangeRow[] = [
  { pageId: 'p1', kind: 'page_created', toVslId: 'v1', createdAt: at('2026-10-01T15:00:00Z') },
  { pageId: 'p1', kind: 'vsl_assigned', toVslId: 'v2', createdAt: at('2026-10-05T18:00:00Z') }, // meio do dia 05
  { pageId: 'p1', kind: 'test_started', toVslId: null, createdAt: at('2026-10-08T12:00:00Z') },
  { pageId: 'p1', kind: 'test_finished', toVslId: 'v3', createdAt: at('2026-10-10T12:00:00Z') },
  { pageId: 'p1', kind: 'page_disabled', toVslId: null, createdAt: at('2026-10-12T10:00:00Z') },
];

describe('VSL exclusiva do dia', () => {
  it('antes da instalação não atribui', () => {
    expect(exclusiveVslForDay(changes, '2026-10-02', '2026-10-03', 'v1')).toBeNull();
    // o próprio dia da instalação também fica de fora (parte rodou o embed antigo)
    expect(exclusiveVslForDay(changes, '2026-10-03', '2026-10-03', 'v1')).toBeNull();
  });
  it('dia inteiro com uma VSL atribui; dia de troca não', () => {
    expect(exclusiveVslForDay(changes, '2026-10-04', '2026-10-03', 'v1')).toBe('v1');
    expect(exclusiveVslForDay(changes, '2026-10-05', '2026-10-03', 'v1')).toBeNull();
    expect(exclusiveVslForDay(changes, '2026-10-06', '2026-10-03', 'v1')).toBe('v2');
  });
  it('teste rodando não atribui; vencedor aplicado volta a atribuir', () => {
    expect(exclusiveVslForDay(changes, '2026-10-09', '2026-10-03', 'v1')).toBeNull();
    expect(exclusiveVslForDay(changes, '2026-10-11', '2026-10-03', 'v1')).toBe('v3');
  });
  it('página desligada atribui à reserva do snippet', () => {
    expect(exclusiveVslForDay(changes, '2026-10-13', '2026-10-03', 'v1')).toBe('v1');
  });
});

describe('regra por afiliado no dia exclusivo', () => {
  const withRule: ChangeRow[] = [
    { pageId: 'p1', kind: 'page_created', toVslId: 'v1', createdAt: at('2026-10-01T15:00:00Z') },
    { pageId: 'p1', kind: 'aff_rule_created', toVslId: 'v9', ruleId: 'r1', createdAt: at('2026-10-05T18:00:00Z') },
    { pageId: 'p1', kind: 'aff_rule_created', toVslId: 'v8', ruleId: 'r2', createdAt: at('2026-10-06T18:00:00Z') },
    { pageId: 'p1', kind: 'aff_rule_disabled', toVslId: null, ruleId: 'r1', createdAt: at('2026-10-08T12:00:00Z') },
    { pageId: 'p1', kind: 'aff_rule_deleted', toVslId: null, ruleId: 'r2', createdAt: at('2026-10-11T12:00:00Z') },
  ];
  it('com regra ativa o dia é misto (não atribui); sem nenhuma regra volta a atribuir', () => {
    expect(exclusiveVslForDay(withRule, '2026-10-04', '2026-10-03', 'v1')).toBe('v1');
    expect(exclusiveVslForDay(withRule, '2026-10-07', '2026-10-03', 'v1')).toBeNull();
    // r1 desligada, r2 ainda ativa: segue misto
    expect(exclusiveVslForDay(withRule, '2026-10-09', '2026-10-03', 'v1')).toBeNull();
    expect(exclusiveVslForDay(withRule, '2026-10-12', '2026-10-03', 'v1')).toBe('v1');
  });
});

describe('redução do desempenho', () => {
  const v = (o: Partial<VisitAggRow>): VisitAggRow => ({
    pageId: 'p1', vslId: 'v1', testId: null, armId: null, day: '2026-10-04',
    visits: 0, plays: 0, pitch: 0, accepts: 0, acceptsAfterPitch: 0, declines: 0, watchSum: 0, ...o,
  });
  const out = reducePerformance({
    visits: [
      v({ visits: 100, plays: 60, pitch: 30, accepts: 12, declines: 40, watchSum: 60 * 200 }),
      v({ day: '2026-10-06', vslId: 'v2', visits: 50, plays: 30, pitch: 20, accepts: 10, declines: 15, watchSum: 30 * 300 }),
      v({ pageId: 'p2', vslId: 'v1', visits: 40, plays: 10, pitch: 4, accepts: 2, acceptsAfterPitch: 1, declines: 20, watchSum: 10 * 100 }),
    ],
    linked: [{ pageId: 'p2', vslId: 'v1', testId: null, armId: null, day: '2026-10-04', soldVisits: 2, revenue: 197.8 }],
    real: [
      { pageId: 'p1', day: '2026-10-04', feSessions: 200, sales: 30, revenue: 3000 },
      { pageId: 'p1', day: '2026-10-05', feSessions: 210, sales: 35, revenue: 3500 },
      { pageId: 'p1', day: '2026-10-06', feSessions: 190, sales: 40, revenue: 4000 },
    ],
    changes,
    pages: [{ id: 'p1', platform: 'jvzoo', fallbackVslId: 'v1' }, { id: 'p2', platform: 'buygoods', fallbackVslId: 'v1' }],
    installDayByPage: new Map([['p1', '2026-10-03'], ['p2', '2026-10-03']]),
  });

  it('totais e taxas do rastreio', () => {
    expect(out.totals.visits).toBe(190);
    expect(out.totals.acceptRate).toBeCloseTo(24 / 190, 4);
    expect(out.totals.avgWatchSeconds).toBe(Math.round((12000 + 9000 + 1000) / 100));
    expect(out.totals.sales).toBe(2);
    // taxa de venda confirmada só sobre visitas BuyGoods (p2), não sobre as 190
    expect(out.totals.linkableVisits).toBe(40);
    expect(out.totals.saleRate).toBeCloseTo(2 / 40, 4);
    expect(out.totals.acceptAfterPitch).toBeCloseTo(1 / 54, 4);
  });

  it('venda confirmada só onde a plataforma permite (BuyGoods)', () => {
    const p1 = out.byPage.find((p) => p.pageId === 'p1')!;
    const p2 = out.byPage.find((p) => p.pageId === 'p2')!;
    expect(p1.linkable).toBe(false);
    expect(p1.sales).toBeNull();
    expect(p2.sales).toBe(2);
    expect(p2.revenuePerVisit).toBeCloseTo(197.8 / 40, 2);
  });

  it('venda real: total por página e só dias exclusivos por VSL', () => {
    const p1 = out.byPage.find((p) => p.pageId === 'p1')!;
    expect(p1.real).toMatchObject({ days: 3, feSessions: 600, sales: 105 });
    const v1 = out.byVsl.find((x) => x.vslId === 'v1')!;
    const v2 = out.byVsl.find((x) => x.vslId === 'v2')!;
    expect(v1.real).toMatchObject({ days: 1, feSessions: 200, sales: 30, takeRate: 0.15 });
    expect(v2.real).toMatchObject({ days: 1, feSessions: 190, sales: 40 });
    expect(v1.pages).toBe(2);
  });

  it('série diária por VSL', () => {
    expect(out.daily.map((d) => [d.day, d.vslId, d.visits])).toEqual([
      ['2026-10-04', 'v1', 140],
      ['2026-10-06', 'v2', 50],
    ]);
  });
});
