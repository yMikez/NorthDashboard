import { describe, expect, it } from 'vitest';
import { isoWeekKey, crmOptionsFromQuery, sanitizeConfigPatch } from './affiliateCrm';

// A semana ISO ancora os toques que repetem por semana (risco, upgrade,
// top 10). Se ela escorregar no meio da semana, o mesmo afiliado recebe o
// check-in duas vezes.
describe('isoWeekKey', () => {
  it('segunda a domingo da mesma semana dão a mesma chave', () => {
    const dias = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
    const chaves = new Set(dias.map((d) => isoWeekKey(new Date(`${d}T00:00:00Z`))));
    expect(chaves.size).toBe(1);
    expect([...chaves][0]).toMatch(/^\d{4}-W\d{2}$/);
  });
  it('a segunda seguinte já é outra semana', () => {
    expect(isoWeekKey(new Date('2026-09-28T00:00:00Z'))).not.toBe(isoWeekKey(new Date('2026-09-27T00:00:00Z')));
  });
});

describe('crmOptionsFromQuery', () => {
  it('lê os filtros da aba', () => {
    const o = crmOptionsFromQuery(new URLSearchParams('segment=dormente&tier=NORTH&pending=1&phone=0&q=silva'));
    expect(o).toMatchObject({ segment: 'dormente', tier: 'NORTH', pendingOnly: true, withPhone: false, search: 'silva' });
  });
  it('segmento ou tier inventado na URL não filtra nada (em vez de listar vazio)', () => {
    const o = crmOptionsFromQuery(new URLSearchParams('segment=qualquer&tier=OURO'));
    expect(o.segment).toBeNull();
    expect(o.tier).toBeNull();
  });
  it('sem phone na query, não filtra por telefone', () => {
    expect(crmOptionsFromQuery(new URLSearchParams('')).withPhone).toBeNull();
  });
});

describe('sanitizeConfigPatch', () => {
  it('aceita número plausível e ignora o resto', () => {
    const out = sanitizeConfigPatch({ dormantDaysBase: 7, coldDays: 30, atRiskDropPct: 35.456 } as never);
    expect(out).toEqual({ dormantDaysBase: 7, coldDays: 30, atRiskDropPct: 35.46 });
  });
  it('trava parâmetro fora de faixa em vez de quebrar a régua inteira', () => {
    const out = sanitizeConfigPatch({ dormantDaysBase: 0, coldDays: 9999, atRiskDropPct: 500 } as never);
    expect(out).toEqual({ dormantDaysBase: 1, coldDays: 365, atRiskDropPct: 99 });
  });
  it('lixo não vira parâmetro', () => {
    expect(sanitizeConfigPatch({ dormantDaysBase: 'sete', coldDays: null } as never)).toEqual({});
  });
  it('escada de toques sai ordenada e sem repetição', () => {
    expect(sanitizeConfigPatch({ ladderOffsets: [7, 0, 4, 4] } as never)).toEqual({ ladderOffsets: [0, 4, 7] });
  });
});
