import { describe, expect, it } from 'vitest';
import { buildShifts, cleanExpectations, correlationNarrative, correlationWindows } from './core';
import { cleanContent, threadHash } from '../clickup/sync';

const NOW = new Date('2026-11-24T18:00:00Z'); // 24/11 15h BRT

describe('decisões — janelas', () => {
  it('depois = do dia da decisão até ontem; antes = os mesmos tantos dias', () => {
    const w = correlationWindows(new Date('2026-11-12T13:00:00Z'), NOW);
    expect([w.after.from, w.after.to, w.after.days]).toEqual(['2026-11-12', '2026-11-23', 12]);
    expect([w.before.from, w.before.to, w.before.days]).toEqual(['2026-10-31', '2026-11-11', 12]);
    expect(w.early).toBe(false);
  });
  it('teto de 30 dias; menos de 3 dias = cedo', () => {
    expect(correlationWindows(new Date('2026-08-01T12:00:00Z'), NOW).after.days).toBe(30);
    expect(correlationWindows(new Date('2026-11-23T12:00:00Z'), NOW).early).toBe(true);
  });
});

describe('decisões — veredito e texto', () => {
  const w = correlationWindows(new Date('2026-11-12T13:00:00Z'), NOW);
  const shifts = buildShifts(
    [{ metric: 'faturamento', expected: 'subir' }, { metric: 'aov', expected: 'subir' }, { metric: 'reembolso', expected: 'cair' }],
    { faturamento: 120_000, aov: 80, reembolso: 6_000 },
    { faturamento: 144_000, aov: 78, reembolso: 4_800 },
    { before: 12, after: 12 },
  );

  it('fluxo por dia, taxa como está; direção esperada × contrária', () => {
    expect(shifts.map((s) => [s.metric, s.beforeFmt, s.afterFmt, s.deltaFmt, s.verdict])).toEqual([
      ['faturamento', '$10,000', '$12,000', '+20.0%', 'esperado'],
      ['aov', '$80.00', '$78.00', '-2.5%', 'contrario'],
      ['reembolso', '$500', '$400', '-20.0%', 'esperado'],
    ]);
  });

  it('o texto conta desde quando, quantas métricas e o placar — sem chamar de causa', () => {
    const t = correlationNarrative({ title: 'Subir preço do 6 potes' }, w, shifts);
    expect(t).toMatch(/^Desde 12\/11 foi decidido "Subir preço do 6 potes", com potencial de mexer em 3 métricas\./);
    expect(t).toContain('Nos 12 dias seguintes, contra os 12 anteriores');
    expect(t).toContain('2 de 3 andaram na direção esperada.');
    expect(t).not.toMatch(/caus/);
    expect(correlationNarrative({ title: 'X' }, correlationWindows(new Date('2026-11-23T12:00:00Z'), NOW), [])).toMatch(/cedo/);
  });

  it('só métricas conhecidas, sem repetir; direção desconhecida vira incerto', () => {
    expect(cleanExpectations([
      { metric: 'faturamento', expected: 'subir' }, { metric: 'faturamento', expected: 'cair' },
      { metric: 'ltv', expected: 'subir' }, { metric: 'aov', expected: 'talvez' },
    ])).toEqual([{ metric: 'faturamento', expected: 'subir' }, { metric: 'aov', expected: 'incerto' }]);
  });
});

describe('ClickUp — conteúdo e impressão da thread', () => {
  it('tira o escape do markdown e a impressão muda com resposta nova', () => {
    expect(cleanContent('**\\[RESUMO\\] PRIORIDADES**')).toBe('**[RESUMO] PRIORIDADES**');
    const root = { id: 'r', content: 'Título' };
    const a = threadHash(root, [{ id: '2', content: 'b' }, { id: '1', content: 'a' }]);
    expect(threadHash(root, [{ id: '1', content: 'a' }, { id: '2', content: 'b' }])).toBe(a); // ordem não importa
    expect(threadHash(root, [{ id: '1', content: 'a' }, { id: '2', content: 'b' }, { id: '3', content: 'c' }])).not.toBe(a);
  });
});
