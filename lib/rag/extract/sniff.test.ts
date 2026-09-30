import { describe, expect, it } from 'vitest';
import { sniff } from './sniff';
import { assertSafeZip, checkZipBudget, readZipDirectory } from './zip';
import { EXTRACT_LIMITS } from './limits';
import { ExtractError } from './errors';
import { buildDocx, buildXlsx, buildZip } from './__fixtures__/zipWriter';

const bytes = (...b: number[]) => Buffer.from(b);
const errorOf = (fn: () => unknown): ExtractError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ExtractError) return err;
    throw err;
  }
  throw new Error('esperava ExtractError');
};

describe('sniff (magic bytes)', () => {
  it('reconhece PDF, PNG, JPEG, GIF e WebP pelos bytes', () => {
    expect(sniff(Buffer.from('%PDF-1.7\n...')).type).toBe('pdf');
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toEqual({ type: 'image', mimeType: 'image/png' });
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toEqual({ type: 'image', mimeType: 'image/jpeg' });
    expect(sniff(Buffer.from('GIF89a......'))).toEqual({ type: 'image', mimeType: 'image/gif' });
    expect(sniff(Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WEBPVP8 ')]))).toEqual({ type: 'image', mimeType: 'image/webp' });
  });

  it('ignora a extensão: texto que só cita "%PDF-" no meio não vira PDF', () => {
    expect(sniff(Buffer.from('# Nota\nO arquivo começa com %PDF-1.4 quando é PDF.\n')).type).toBe('text');
  });

  it('aceita PDF com lixo antes do cabeçalho quando termina em %%EOF', () => {
    expect(sniff(Buffer.from('\x00\x01lixo%PDF-1.4\n1 0 obj\nendobj\n%%EOF')).type).toBe('pdf');
  });

  it('classifica ZIP pelo conteúdo: docx × xlsx; pptx/zip genérico recusados com dica', () => {
    expect(sniff(buildDocx([{ text: 'oi' }])).type).toBe('docx');
    expect(sniff(buildXlsx('A', [['x']])).type).toBe('xlsx');
    const pptx = buildZip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'ppt/presentation.xml', data: '<x/>' }]);
    expect(errorOf(() => sniff(pptx)).message).toMatch(/PowerPoint.*PDF/);
    expect(errorOf(() => sniff(buildZip([{ name: 'a.txt', data: 'a' }]))).status).toBe(415);
  });

  it('recusa Office antigo/com senha (OLE), HEIC e compactados com mensagem de conversão', () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0);
    expect(errorOf(() => sniff(ole)).message).toMatch(/\.xlsx\/\.docx/);
    const heic = Buffer.concat([bytes(0, 0, 0, 0x18), Buffer.from('ftypheic'), Buffer.alloc(8)]);
    expect(errorOf(() => sniff(heic)).message).toMatch(/JPG/);
    expect(errorOf(() => sniff(bytes(0x1f, 0x8b, 8, 0, 0))).code).toBe('unsupported_type');
  });

  it('binário desconhecido é recusado; vazio vira erro próprio', () => {
    expect(errorOf(() => sniff(bytes(1, 2, 0, 4, 5, 0, 7)))).toMatchObject({ code: 'unsupported_type', status: 415 });
    expect(errorOf(() => sniff(Buffer.alloc(0)))).toMatchObject({ code: 'empty' });
  });
});

describe('guarda de ZIP (zip-bomb)', () => {
  it('lê o diretório central (nomes e tamanhos declarados)', () => {
    const zip = buildZip([{ name: 'a.xml', data: 'x'.repeat(1000) }, { name: 'b.xml', data: 'y', store: true }]);
    const entries = readZipDirectory(zip);
    expect(entries.map((e) => [e.name, e.uncompressedSize, e.method])).toEqual([
      ['a.xml', 1000, 8],
      ['b.xml', 1, 0],
    ]);
  });

  it('recusa total descompactado acima do teto', () => {
    const zip = buildZip([{ name: 'big.xml', data: 'a'.repeat(4096) }]);
    const limits = { ...EXTRACT_LIMITS, zipMaxUncompressedBytes: 1024 };
    expect(errorOf(() => checkZipBudget(readZipDirectory(zip), limits))).toMatchObject({ code: 'unsafe_archive' });
  });

  it('recusa taxa de compressão anormal', () => {
    const zip = buildZip([{ name: 'bomb.xml', data: Buffer.alloc(3 * 1024 * 1024) }]);
    expect(errorOf(() => checkZipBudget(readZipDirectory(zip)))).toMatchObject({ code: 'unsafe_archive' });
  });

  it('recusa header forjado (declara pouco, descompacta muito)', async () => {
    const zip = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: 'z'.repeat(50_000), declaredSize: 100 }]);
    await expect(assertSafeZip(zip, readZipDirectory(zip))).rejects.toMatchObject({ code: 'unsafe_archive' });
  });

  it('recusa entrada criptografada e aceita pacote normal', async () => {
    const enc = buildZip([{ name: 'word/document.xml', data: '<x/>', flags: 1 }]);
    expect(errorOf(() => checkZipBudget(readZipDirectory(enc)))).toMatchObject({ code: 'unsafe_archive' });
    const ok = buildDocx([{ heading: 1, text: 'Título' }, { text: 'corpo' }]);
    await expect(assertSafeZip(ok, readZipDirectory(ok))).resolves.toBeUndefined();
  });

  it('ZIP truncado é corrompido, não travamento', () => {
    const zip = buildDocx([{ text: 'x' }]);
    expect(errorOf(() => readZipDirectory(zip.subarray(0, zip.length - 30)))).toMatchObject({ code: 'corrupt' });
  });
});
