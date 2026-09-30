import { describe, expect, it } from 'vitest';
import { detectDelimiter, isTabular, parseDelimited } from './csv';
import { decodeText, looksLikeText } from './decode';

describe('decodeText', () => {
  it('UTF-8 com BOM, UTF-16LE com BOM e CRLF', () => {
    expect(decodeText(Buffer.from('\uFEFFa;b\r\n1;2', 'utf8'))).toEqual({ text: 'a;b\n1;2', encoding: 'utf-8' });
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Preço;Qtd\n', 'utf16le')]);
    expect(decodeText(utf16)).toEqual({ text: 'Preço;Qtd\n', encoding: 'utf-16le' });
  });

  it('cai pra windows-1252 quando não é UTF-8 válido (export latin-1 da Digistore)', () => {
    const latin1 = Buffer.from('Endere\xe7o;Pa\xeds\n', 'latin1');
    expect(decodeText(latin1)).toEqual({ text: 'Endereço;País\n', encoding: 'windows-1252' });
  });

  it('looksLikeText recusa binário e aceita UTF-16 sem BOM', () => {
    expect(looksLikeText(Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]))).toBe(false);
    expect(looksLikeText(Buffer.from('coluna,valor\n', 'utf16le'))).toBe(true);
  });
});

describe('detectDelimiter', () => {
  it('vírgula, ponto e vírgula e TAB', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6')?.delimiter).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6')?.delimiter).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')?.delimiter).toBe('\t');
  });

  it('";" com vírgula decimal (Excel pt-BR) não vira ","', () => {
    const csv = 'produto;valor;taxa;qtd\nA;"1.234,56";2,5;3\nB;"10,00";1,5;1\nC;"7,90";0,5;2';
    expect(detectDelimiter(csv)).toMatchObject({ delimiter: ';', width: 4 });
  });

  it('preâmbulo sem delimitador não derruba a detecção (conta a partir da tabela)', () => {
    const csv = ['Relatório', 'Período: set/2026', '', 'a,b,c', '1,2,3', '4,5,6'].join('\n');
    const g = detectDelimiter(csv);
    expect(g).toMatchObject({ delimiter: ',', width: 3, share: 1 });
    expect(isTabular(g, 'txt')).toBe(true);
  });

  it('prosa não é tabela; .md nunca vira tabela', () => {
    const prose = 'Olá, tudo bem? Hoje vendemos bem.\nAmanhã vemos, com calma, o resto.\nFim';
    expect(isTabular(detectDelimiter(prose), 'txt')).toBe(false);
    expect(isTabular(detectDelimiter('a,b\n1,2\n3,4'), 'md')).toBe(false);
  });
});

describe('parseDelimited', () => {
  it('aspas RFC 4180 e célula-fórmula ="…" do Excel', () => {
    const { rows, errors } = parseDelimited('id;gross\n"A;1";="-144.00"\n"B ""x""";10', ';');
    expect(errors).toBe(0);
    expect(rows).toEqual([
      ['id', 'gross'],
      ['A;1', '-144.00'],
      ['B "x"', '10'],
    ]);
  });
});
