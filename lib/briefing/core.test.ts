import { describe, expect, it } from 'vitest';
import { briefingWindows, extremes, fmtValue, greetingFor, metricPair, topMovers } from './core';

describe('briefing — janelas', () => {
  it('7 dias fechando ONTEM (Brasília) contra os 7 anteriores', () => {
    // 24/11 15:00 BRT
    const w = briefingWindows(new Date('2026-11-24T18:00:00Z'));
    expect([w.cur.from, w.cur.to, w.prev.from, w.prev.to]).toEqual(['2026-11-17', '2026-11-23', '2026-11-10', '2026-11-16']);
    expect(w.cur.start.toISOString()).toBe('2026-11-17T03:00:00.000Z');
    expect(w.cur.end.toISOString()).toBe('2026-11-24T02:59:59.999Z');
    expect(w.prev.end.getTime() + 1).toBe(w.cur.start.getTime());
    // 01:00 BRT do dia 25 ainda é dia 25: a janela já inclui o 24.
    expect(briefingWindows(new Date('2026-11-25T04:00:00Z')).cur.to).toBe('2026-11-24');
  });
});

describe('briefing — métricas', () => {
  it('variação relativa; taxa em pontos; bom/ruim pelo sentido; estável abaixo de 0,5%', () => {
    expect(metricPair('faturamento', 'F', 'money', 'higher', 112_000, 100_000)).toMatchObject({ delta: 0.12, good: true, deltaFmt: '+12.0%', curFmt: '$112,000' });
    expect(metricPair('reembolso', 'R', 'money', 'lower', 5_500, 5_000)).toMatchObject({ good: false, deltaFmt: '+10.0%' });
    expect(metricPair('chargeback', 'C', 'pct', 'lower', 0.012, 0.008)).toMatchObject({ deltaKind: 'pp', deltaFmt: '+0.4 pp', good: false, curFmt: '1.2%' });
    expect(metricPair('pedidos', 'P', 'int', 'higher', 1003, 1000).good).toBeNull();
    expect(metricPair('pedidos', 'P', 'int', 'higher', 10, 0)).toMatchObject({ delta: null, deltaFmt: 'novo', good: null });
    expect(fmtValue(-1234.5, 'money')).toBe('-$1,235');
    expect(fmtValue(87.456, 'money2')).toBe('$87.46');
  });

  it('maiores altas e quedas acima do piso de ruído', () => {
    const m = topMovers([
      { dimension: 'família', name: 'NeuroRecall', cur: 50_000, prev: 30_000 },
      { dimension: 'plataforma', name: 'jvzoo', cur: 20_000, prev: 35_000 },
      { dimension: 'afiliado', name: 'Ana', cur: 1_100, prev: 1_000 }, // abaixo do piso
    ], 100_000);
    expect(m.up.map((x) => [x.name, x.deltaFmt])).toEqual([['NeuroRecall', '+$20,000']]);
    expect(m.down.map((x) => [x.name, x.deltaFmt])).toEqual([['jvzoo', '-$15,000']]);
  });

  it('melhor e pior dia; saudação pelo horário de Brasília', () => {
    const e = extremes([{ date: 'a', cur: 5, prev: 0 }, { date: 'b', cur: 9, prev: 0 }, { date: 'c', cur: 1, prev: 0 }]);
    expect([e.best?.date, e.worst?.date]).toEqual(['b', 'c']);
    expect(greetingFor(new Date('2026-11-24T11:00:00Z'))).toBe('Bom dia');   // 08h BRT
    expect(greetingFor(new Date('2026-11-24T18:00:00Z'))).toBe('Boa tarde'); // 15h
    expect(greetingFor(new Date('2026-11-25T01:00:00Z'))).toBe('Boa noite'); // 22h
  });
});
