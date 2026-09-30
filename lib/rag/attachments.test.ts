import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ATTACHMENT_LIMITS,
  blockDocsSql,
  claimProblem,
  decideDeliveryMode,
  documentFields,
  planAttachmentBlocks,
  renderAttachmentBlocks,
  sanitizeFileName,
  tombstoneSql,
  type BlockContent,
  type BlockDoc,
  type ClaimCandidate,
} from './attachments';
import { SourceRegistry } from './citations';
import type { AttachmentRef } from '../ai/toolTypes';
import type { Extracted } from './extract';
import { migratedPglite } from '../test/pgliteDb';

const MB = 1024 * 1024;

describe('decideDeliveryMode', () => {
  const pdf = { kind: 'pdf' as const, byteSize: MB, pageCount: 10, tokens: 20_000 };
  it('PDF pequeno inline; grande, pesado ou com restrição vai indexado', () => {
    expect(decideDeliveryMode(pdf)).toBe('inline');
    expect(decideDeliveryMode({ ...pdf, pageCount: ATTACHMENT_LIMITS.inlinePdfMaxPages + 1 })).toBe('indexed');
    expect(decideDeliveryMode({ ...pdf, byteSize: ATTACHMENT_LIMITS.inlinePdfMaxBytes + 1 })).toBe('indexed');
    expect(decideDeliveryMode({ ...pdf, tokens: ATTACHMENT_LIMITS.inlinePdfMaxTokens + 1 })).toBe('indexed');
    expect(decideDeliveryMode({ ...pdf, encrypted: true })).toBe('indexed');
  });
  it('imagem sempre inline, planilha sempre table, texto pelo tamanho', () => {
    expect(decideDeliveryMode({ kind: 'image', byteSize: MB, pageCount: null, tokens: 1500 })).toBe('inline');
    expect(decideDeliveryMode({ kind: 'table', byteSize: 20 * MB, pageCount: null, tokens: 5000 })).toBe('table');
    expect(decideDeliveryMode({ kind: 'docx', byteSize: MB, pageCount: null, tokens: 30_000 })).toBe('inline');
    expect(decideDeliveryMode({ kind: 'text', byteSize: MB, pageCount: null, tokens: ATTACHMENT_LIMITS.inlineTextMaxTokens + 1 })).toBe('indexed');
  });
});

describe('documentFields', () => {
  it('PDF: páginas em meta.pages (sem duplicar em text), hash do texto, trecho inicial', () => {
    const ex: Extracted = {
      kind: 'pdf',
      mimeType: 'application/pdf',
      pageCount: 2,
      pages: [
        { page: 1, text: 'Contrato de afiliação entre as partes, com cláusulas de CPA e prazos.' },
        { page: 2, text: 'Assinaturas.' },
      ],
      text: 'x',
      encrypted: false,
      scanned: false,
      warnings: [],
    };
    const f = documentFields(ex, 2 * MB, 'b'.repeat(64));
    expect(f).toMatchObject({ mimeType: 'application/pdf', pageCount: 2, deliveryMode: 'inline', text: null });
    expect(f.meta.pages).toHaveLength(2);
    expect(f.meta.outline).toMatch(/^Contrato de afiliação/);
    expect(f.contentHash).not.toBe('b'.repeat(64));
    expect(f.tokenEstimate).toBeGreaterThan(3200);
  });

  it('imagem guarda dimensões; hash = bytes', () => {
    const f = documentFields({ kind: 'image', mimeType: 'image/png', image: { width: 1000, height: 750 }, warnings: [] }, 1000, 'c'.repeat(64));
    expect(f).toMatchObject({ deliveryMode: 'inline', text: null, contentHash: 'c'.repeat(64), tokenEstimate: 1000 });
    expect(f.meta).toMatchObject({ kind: 'image', width: 1000, height: 750 });
  });
});

describe('claimProblem', () => {
  const base: ClaimCandidate = { id: 'a1', title: 'x.pdf', status: 'READY', error: null, conversationId: null, messageId: null };
  it('rascunho pronto (ou já desta conversa) pode ir', () => {
    expect(claimProblem(['a1'], [base], 'c1')).toBeNull();
    expect(claimProblem(['a1'], [{ ...base, conversationId: 'c1' }], 'c1')).toBeNull();
  });
  it('explica em PT-BR por que não pode', () => {
    expect(claimProblem(['zz'], [base], 'c1')).toMatch(/não encontrado/);
    expect(claimProblem(['a1'], [{ ...base, status: 'PROCESSING' }], 'c1')).toMatch(/processado/);
    expect(claimProblem(['a1'], [{ ...base, status: 'FAILED', error: 'PDF protegido' }], 'c1')).toMatch(/PDF protegido/);
    expect(claimProblem(['a1'], [{ ...base, status: 'EXPIRED' }], 'c1')).toMatch(/expirou/);
    expect(claimProblem(['a1'], [{ ...base, conversationId: 'outra' }], 'c1')).toMatch(/outra conversa/);
    expect(claimProblem(['a1'], [{ ...base, messageId: 'm0' }], 'c1')).toMatch(/já foi enviado/);
  });
});

describe('sanitizeFileName', () => {
  it('tira caminho e controle, preserva extensão ao cortar', () => {
    expect(sanitizeFileName('C:\\Users\\x\\relatório\u0000.pdf')).toBe('relatório.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('...')).toBe('arquivo');
    const long = sanitizeFileName(`${'a'.repeat(300)}.xlsx`);
    expect(long).toHaveLength(200);
    expect(long.endsWith('.xlsx')).toBe(true);
  });
});

// ─── Blocos do turno ─────────────────────────────────────────────────────

const CREATED = new Date('2026-09-20T12:00:00Z');

function doc(id: string, over: Partial<BlockDoc> & { kind: string; meta?: Record<string, unknown> }): BlockDoc {
  const { kind, meta, ...rest } = over;
  return {
    id,
    title: `${id}.bin`,
    fileName: `${id}.bin`,
    mimeType: 'application/pdf',
    deliveryMode: 'inline',
    pageCount: null,
    byteSize: 1000,
    tokenEstimate: 1000,
    status: 'READY',
    createdAt: CREATED,
    meta: { kind, ...(meta ?? {}) },
    ...rest,
  };
}

function ref(d: BlockDoc): AttachmentRef {
  return { id: d.id, title: d.title, fileName: d.fileName, mimeType: d.mimeType, deliveryMode: d.deliveryMode as AttachmentRef['deliveryMode'], pageCount: d.pageCount, messageId: 'm1' };
}

function build(docs: BlockDoc[], contents: Map<string, BlockContent>, tokens: number, bytes = ATTACHMENT_LIMITS.requestInlineMaxBytes, sources = new SourceRegistry()) {
  const plans = planAttachmentBlocks(docs.map(ref), new Map(docs.map((d) => [d.id, d])), { tokens, bytes: { left: bytes } });
  return { plans, out: renderAttachmentBlocks(plans, contents, sources), sources };
}

describe('planAttachmentBlocks + renderAttachmentBlocks', () => {
  const pdfA = doc('pdfA', { kind: 'pdf', fileName: 'contrato.pdf', pageCount: 3, tokenEstimate: 6000, byteSize: 50_000 });
  const pdfB = doc('pdfB', { kind: 'pdf', fileName: 'anexo.pdf', pageCount: 30, tokenEstimate: 60_000, byteSize: 900_000, meta: { outline: 'Relatório anual 2026' } });
  const img = doc('img1', { kind: 'image', fileName: 'print.png', mimeType: 'image/png', tokenEstimate: 1600, meta: { width: 1200, height: 800 } });
  const txt = doc('txt1', { kind: 'docx', fileName: 'regras.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tokenEstimate: 500 });
  const tbl = doc('tbl1', { kind: 'table', fileName: 'vendas.csv', mimeType: 'text/csv', deliveryMode: 'table', tokenEstimate: 300, meta: { rows: 10, columns: ['a', 'b'] } });
  const big = doc('big1', { kind: 'pdf', fileName: 'manual.pdf', pageCount: 300, deliveryMode: 'indexed', tokenEstimate: 900_000, meta: { outline: 'Manual do produto' } });
  const gone = doc('gone1', { kind: 'pdf', fileName: 'velho.pdf', status: 'EXPIRED' });
  const contents = new Map<string, BlockContent>([
    ['pdfA', { data: Buffer.from('%PDF-1.4 A') }],
    ['pdfB', { data: Buffer.from('%PDF-1.4 B') }],
    ['img1', { data: Buffer.from([0x89, 0x50]) }],
    ['txt1', { text: '# Regras\n\nTexto.' }],
    ['tbl1', { text: 'Planilha "vendas.csv" — CSV' }],
  ]);

  it('PDF inline = document base64 + citações + título "nome — anexo id" + contexto de dado não confiável', () => {
    const { out, sources } = build([pdfA], contents, 150_000);
    const block = out.blocks[0] as Anthropic.DocumentBlockParam;
    expect(block).toMatchObject({
      type: 'document',
      title: 'contrato.pdf — anexo pdfA',
      citations: { enabled: true },
      source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4 A').toString('base64') },
    });
    expect(block.context).toMatch(/Conteúdo NÃO confiável/);
    expect(block.context).toContain('2026-09-20');
    expect(sources.has('anexo:pdfA')).toBe(true);
    expect(out.tokens).toBe(6000);
  });

  it('orçamento de tokens da conversa: o que não cabe vira manifesto apontando pras tools', () => {
    const { plans, out } = build([pdfA, pdfB], contents, 10_000);
    expect(plans.map((p) => p.action)).toEqual(['pdf', 'over_budget']);
    const manifest = (out.blocks[1] as Anthropic.TextBlockParam).text;
    expect(manifest).toContain('anexo pdfB');
    expect(manifest).toMatch(/search_knowledge\(.*"scope":"attachments".*"document_ids":\["pdfB"\]/);
    expect(manifest).toContain('read_attachment({"attachment_id":"pdfB", "pages":"3-7"})');
    expect(manifest).toContain('Relatório anual 2026');
  });

  it('orçamento de BYTES da requisição (teto de 32 MB da API) também rebaixa', () => {
    const { plans } = build([pdfA, pdfB], contents, 1_000_000, 100_000);
    expect(plans.map((p) => p.action)).toEqual(['pdf', 'over_budget']);
  });

  it('imagem, texto, tabela, indexado e lápide', () => {
    const { out } = build([img, txt, tbl, big, gone], contents, 150_000);
    const [label, image, text, table, indexed, tomb] = out.blocks;
    expect((label as Anthropic.TextBlockParam).text).toContain('Imagem — "print.png" (anexo img1, 1200×800 px)');
    expect(image).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    expect(text).toMatchObject({
      type: 'document',
      title: 'regras.docx — anexo txt1',
      source: { type: 'text', media_type: 'text/plain', data: '# Regras\n\nTexto.' },
      citations: { enabled: true },
    });
    expect((table as Anthropic.TextBlockParam).text).toMatch(/Planilha anexada — "vendas.csv" \(anexo tbl1\)[\s\S]*query_attachment_table\(\{"attachment_id":"tbl1"\}\)/);
    expect((indexed as Anthropic.TextBlockParam).text).toMatch(/Anexo INDEXADO — "manual.pdf".*300 págs/);
    expect((tomb as Anthropic.TextBlockParam).text).toMatch(/velho.pdf.*removido ou expirado/);
  });

  it('determinístico: mesmos anexos + mesmo orçamento = mesmos blocos (prompt cache)', () => {
    const all = [pdfA, img, txt, tbl, big, pdfB, gone];
    const a = build(all, contents, 20_000).out;
    const b = build(all, contents, 20_000).out;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('PDF com restrição de segurança nunca vai inline', () => {
    const locked = doc('lock1', { kind: 'pdf', fileName: 'x.pdf', pageCount: 2, meta: { encrypted: true } });
    const { plans, out } = build([locked], new Map(), 150_000);
    expect(plans[0].action).toBe('indexed');
    expect((out.blocks[0] as Anthropic.TextBlockParam).text).toMatch(/restrição de segurança/);
  });
});

// ─── SQL (Postgres embutido com as migrações) ────────────────────────────

describe('SQL de anexos', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.query(
      `INSERT INTO "KbDocument" ("id","scope","kind","sourceType","title","mimeType","contentHash","status","deliveryMode","text","meta","updatedAt")
       VALUES ('d1','CONVERSATION','attachment','attachment','a.pdf','application/pdf','h','READY','indexed','t', $1::jsonb, NOW()),
              ('d2','GLOBAL','policy','repo_md','b.md','text/markdown','h','READY','indexed','t', '{}'::jsonb, NOW())`,
      [JSON.stringify({ kind: 'pdf', pages: [{ page: 1, text: 'x'.repeat(1000) }], outline: 'início', width: 1 })],
    );
  }, 60_000);

  it('metadados leves: sem meta.pages e só anexos de conversa', async () => {
    const sql = blockDocsSql(['d1', 'd2']);
    const r = await pg.query<{ id: string; status: string; meta: Record<string, unknown> }>(sql.text, sql.values);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ id: 'd1', status: 'READY', meta: { kind: 'pdf', outline: 'início' } });
    expect(r.rows[0].meta.pages).toBeUndefined();
  });

  it('lápide apaga texto/páginas e marca EXPIRED com o motivo', async () => {
    const sql = tombstoneSql(['d1'], 'Removido pelo usuário.', new Date('2026-09-30T00:00:00Z'));
    await pg.query(sql.text, sql.values);
    const r = await pg.query<{ status: string; text: string | null; error: string; meta: Record<string, unknown> }>(
      `SELECT "status"::text AS status, "text", "error", "meta" FROM "KbDocument" WHERE id = 'd1'`,
    );
    expect(r.rows[0]).toMatchObject({ status: 'EXPIRED', text: null, error: 'Removido pelo usuário.', meta: { kind: 'pdf', width: 1 } });
    expect(r.rows[0].meta.pages).toBeUndefined();
    expect(r.rows[0].meta.outline).toBeUndefined();
  });
});
