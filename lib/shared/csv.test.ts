import { describe, it, expect } from 'vitest';
import { csvCell, buildCsv } from './csv';

describe('csvCell', () => {
  it('número: inteiro cru, float com vírgula decimal (Excel pt-BR)', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(1234.5)).toBe('1234,50');
    expect(csvCell(-3.456)).toBe('-3,46');
    expect(csvCell(NaN)).toBe('');
  });

  it('null/undefined viram vazio', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('string com ; aspas ou quebra de linha é quotada e escapada', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
    expect(csvCell('normal')).toBe('normal');
  });

  it('guarda contra formula injection (=, +, -, @ no início)', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@evil')).toBe("'@evil");
    expect(csvCell('-negativo-string')).toBe("'-negativo-string");
    // número negativo NÃO ganha apóstrofo (é number, não string)
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('buildCsv', () => {
  it('BOM + CRLF + separador ;', () => {
    const csv = buildCsv(['a', 'b'], [['x', 1], ['y', 2.5]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿a;b\r\nx;1\r\ny;2,50\r\n');
  });
});
