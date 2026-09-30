import { describe, expect, it } from 'vitest';
import { brtRangeForDays, brtRangeForPreset, csvList, rangeFromQuery, spaCustomRange } from './datePresets';

// 2026-09-29 22:30 BRT = 2026-09-30 01:30Z — depois das 21h BRT, o dia UTC já virou.
const LATE_EVENING = new Date('2026-09-30T01:30:00Z');

describe('brtRangeForPreset', () => {
  it('30d = D-29..D em dia civil BRT, mesmo depois das 21h', () => {
    const r = brtRangeForPreset('30d', LATE_EVENING);
    expect(r.start).toBe('2026-08-31');
    expect(r.end).toBe('2026-09-29');
    expect(r.startAt).toBe('2026-08-31T03:00:00.000Z');
    expect(r.endAt).toBe('2026-09-30T02:59:59.999Z');
  });

  it('hoje e ontem', () => {
    expect(brtRangeForPreset('today', LATE_EVENING)).toMatchObject({ start: '2026-09-29', end: '2026-09-29' });
    expect(brtRangeForPreset('yesterday', LATE_EVENING)).toMatchObject({ start: '2026-09-28', end: '2026-09-28' });
  });

  it('mês, trimestre e ano começam no dia 1', () => {
    expect(brtRangeForPreset('mtd', LATE_EVENING).start).toBe('2026-09-01');
    expect(brtRangeForPreset('qtd', LATE_EVENING).start).toBe('2026-07-01');
    expect(brtRangeForPreset('ytd', LATE_EVENING).start).toBe('2026-01-01');
  });

  it('7d atravessa virada de mês', () => {
    expect(brtRangeForPreset('7d', new Date('2026-10-03T15:00:00Z')).start).toBe('2026-09-27');
  });

  it('preset desconhecido vira 30d', () => {
    expect(brtRangeForPreset('14d', LATE_EVENING)).toMatchObject({ preset: '30d', start: '2026-08-31' });
  });
});

describe('rangeFromQuery', () => {
  it('custom válido usa os dias como BRT', () => {
    expect(rangeFromQuery({ range: 'custom', from: '2026-09-01', to: '2026-09-10' })).toEqual(
      brtRangeForDays('2026-09-01', '2026-09-10', 'custom'),
    );
  });
  it('custom invertido ou malformado volta pra 30d', () => {
    expect(rangeFromQuery({ range: 'custom', from: '2026-09-10', to: '2026-09-01' }, LATE_EVENING).preset).toBe('30d');
    expect(rangeFromQuery({ range: 'custom', from: 'x', to: '2026-09-01' }, LATE_EVENING).preset).toBe('30d');
  });
  it('sem range = 30d', () => {
    expect(rangeFromQuery({}, LATE_EVENING).preset).toBe('30d');
  });
  it('dia inexistente volta pra 30d (não normaliza pra março)', () => {
    expect(rangeFromQuery({ range: 'custom', from: '2026-02-30', to: '2026-03-01' }, LATE_EVENING).preset).toBe('30d');
    expect(rangeFromQuery({ range: 'custom', from: '2026-13-01', to: '2026-13-02' }, LATE_EVENING).preset).toBe('30d');
  });
});

describe('viradas de ano/trimestre em BRT', () => {
  it('ontem em 1º de janeiro é 31/12 do ano anterior', () => {
    expect(brtRangeForPreset('yesterday', new Date('2026-01-01T12:00:00Z')).start).toBe('2025-12-31');
  });
  it('às 23h BRT de 31/12 ainda é o ano/trimestre velho', () => {
    const newYearsEve = new Date('2026-01-01T02:00:00Z'); // 31/12 23:00 BRT
    expect(brtRangeForPreset('ytd', newYearsEve).start).toBe('2025-01-01');
    expect(brtRangeForPreset('qtd', newYearsEve).start).toBe('2025-10-01');
    expect(brtRangeForPreset('today', newYearsEve).start).toBe('2025-12-31');
  });
});

describe('spaCustomRange', () => {
  it('usa dias UTC, como o personalizado da SPA', () => {
    expect(spaCustomRange('2026-09-01', '2026-09-10')).toEqual({
      preset: 'custom',
      start: '2026-09-01',
      end: '2026-09-10',
      startAt: '2026-09-01T00:00:00.000Z',
      endAt: '2026-09-10T23:59:59.999Z',
    });
  });
});

describe('csvList', () => {
  it('quebra CSV e ignora vazios', () => {
    expect(csvList('clickbank,,buygoods ')).toEqual(['clickbank', 'buygoods']);
    expect(csvList(null)).toEqual([]);
  });
});
