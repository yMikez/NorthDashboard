import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { extractFile } from './index';
import { slicePdf } from './pdf';
import { ExtractError } from './errors';
import { buildDocx, buildXlsx } from './__fixtures__/zipWriter';

async function makePdf(pages: string[], encrypt?: { userPassword?: string; ownerPassword: string }): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([320, 320]);
    if (text) page.drawText(text, { x: 20, y: 280, size: 11, font, maxWidth: 280, lineHeight: 14 });
  }
  if (encrypt) doc.encrypt(encrypt);
  return Buffer.from(await doc.save());
}

/** Cabeçalho PNG mínimo (assinatura + IHDR) — image-size só lê isto. */
function pngHeader(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(16)]);
}

async function rejection(p: Promise<unknown>): Promise<ExtractError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ExtractError) return err;
    throw err;
  }
  throw new Error('esperava ExtractError');
}

const LONG = 'Fatura de fornecedor com total de 1234 dolares e 12 potes enviados no periodo de setembro, conforme pedido';

describe('extractFile', () => {
  it('PDF: texto por página e contagem; recorte mantém as páginas pedidas', async () => {
    const pdf = await makePdf([`Pagina um. ${LONG}`, `Pagina dois. ${LONG}`, `Pagina tres. ${LONG}`]);
    const ex = await extractFile(pdf, 'fatura.pdf', 'application/pdf');
    expect(ex).toMatchObject({ kind: 'pdf', mimeType: 'application/pdf', pageCount: 3, encrypted: false, scanned: false });
    expect(ex.pages?.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(ex.pages?.[1].text).toContain('Pagina dois');
    const slice = await slicePdf(pdf, [2, 3]);
    const back = await extractFile(Buffer.from(slice), 'recorte.pdf');
    expect(back.pageCount).toBe(2);
    expect(back.pages?.[0].text).toContain('Pagina dois');
  });

  it('PDF sem texto é marcado como escaneado', async () => {
    const ex = await extractFile(await makePdf(['', '']), 'scan.pdf');
    expect(ex).toMatchObject({ kind: 'pdf', scanned: true });
    expect(ex.warnings.join(' ')).toMatch(/digitalizado/);
  });

  it('PDF com senha de abertura: erro PT-BR 422', async () => {
    const pdf = await makePdf([LONG], { userPassword: 'abc', ownerPassword: 'dono' });
    const err = await rejection(extractFile(pdf, 'secreto.pdf'));
    expect(err).toMatchObject({ code: 'encrypted', status: 422 });
    expect(err.message).toMatch(/senha/);
  });

  it('DOCX vira markdown com títulos e tabela', async () => {
    const docx = buildDocx([
      { heading: 1, text: 'Contrato de CPA' },
      { text: 'O afiliado recebe por venda aprovada.' },
      { heading: 2, text: 'Tabela de valores' },
      { table: [['Produto', 'CPA'], ['NeuroX', '$120']] },
    ]);
    const ex = await extractFile(docx, 'contrato.docx');
    expect(ex.kind).toBe('docx');
    expect(ex.text).toContain('# Contrato de CPA');
    expect(ex.text).toContain('## Tabela de valores');
    expect(ex.text).toMatch(/\| Produto \| CPA \|\n\| --- \| --- \|\n\| NeuroX \| \$120 \|/);
  });

  it('XLSX: abas tipadas + cartão de esquema', async () => {
    const xlsx = buildXlsx('Vendas', [
      ['Relatório de vendas', null, null],
      ['produto', 'qtd', 'valor'],
      ['A', 2, 10.5],
      ['B', 1, 20],
    ]);
    const ex = await extractFile(xlsx, 'vendas.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(ex.kind).toBe('table');
    const sheet = ex.table!.sheets[0];
    expect(sheet).toMatchObject({ name: 'Vendas', headerRow: 2, rowCount: 2, preamble: ['Relatório de vendas'] });
    expect(sheet.columns.find((c) => c.label === 'valor')).toMatchObject({ type: 'currency' });
    expect(ex.text).toContain('Aba "Vendas"');
  });

  it('CSV em windows-1252 com ";" e decimal pt-BR', async () => {
    const csv = Buffer.from('Produto;Preço;Qtd\nPoção;"1.234,56";2\nChá;"10,00";1\n', 'latin1');
    const ex = await extractFile(csv, 'lista.csv', 'application/vnd.ms-excel');
    expect(ex).toMatchObject({ kind: 'table', mimeType: 'text/csv' });
    const t = ex.table!;
    expect(t).toMatchObject({ encoding: 'windows-1252', delimiter: ';' });
    const preco = t.sheets[0].columns.find((c) => c.label === 'Preço')!;
    expect(preco).toMatchObject({ type: 'currency', numberLocale: 'pt-BR' });
    expect(preco.stats.sum).toBe(1244.56);
  });

  it('JSON: lista de objetos vira tabela; objeto vira texto', async () => {
    const list = await extractFile(Buffer.from(JSON.stringify([{ sku: 'A1', v: 1 }, { sku: 'B2', v: 2 }])), 'x.json');
    expect(list.kind).toBe('table');
    expect(list.table!.sheets[0].columns.map((c) => c.label)).toEqual(['sku', 'v']);
    const obj = await extractFile(Buffer.from('{"a":{"b":1}}'), 'cfg.json');
    expect(obj).toMatchObject({ kind: 'text', mimeType: 'application/json' });
    expect(obj.text).toContain('"b": 1');
  });

  it('HTML vira markdown sem script/imagem', async () => {
    const html = '<!doctype html><html><head><title>t</title><script>alert(1)</script></head><body><h1>Relatório</h1><p>Texto <img src="https://x.test/p.png"> fim</p></body></html>';
    const ex = await extractFile(Buffer.from(html), 'pagina.html');
    expect(ex).toMatchObject({ kind: 'text', mimeType: 'text/html' });
    expect(ex.text).toContain('# Relatório');
    expect(ex.text).not.toMatch(/alert|x\.test/);
  });

  it('texto/markdown normalizado', async () => {
    const ex = await extractFile(Buffer.from('# Notas\r\n\r\n\r\n\r\nItem\u200b um\r\n'), 'notas.md');
    expect(ex).toMatchObject({ kind: 'text', mimeType: 'text/markdown', text: '# Notas\n\nItem um' });
  });

  it('imagem: só dimensões do cabeçalho; acima de 8000 px é recusada', async () => {
    const ok = await extractFile(pngHeader(1200, 800), 'print.png', 'image/png');
    expect(ok).toMatchObject({ kind: 'image', mimeType: 'image/png', image: { width: 1200, height: 800 } });
    const big = await rejection(extractFile(pngHeader(9000, 10), 'grande.png'));
    expect(big).toMatchObject({ code: 'too_large', status: 413 });
  });

  it('bytes mandam, não a extensão: PNG chamado .pdf é imagem (com aviso do MIME declarado)', async () => {
    const ex = await extractFile(pngHeader(10, 10), 'relatorio.pdf', 'application/pdf');
    expect(ex.kind).toBe('image');
    expect(ex.warnings.join(' ')).toMatch(/lido pelo conteúdo/);
  });

  it('SVG é recusado', async () => {
    const err = await rejection(extractFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'logo.svg'));
    expect(err.code).toBe('unsupported_type');
  });
});
