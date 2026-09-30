// PDF: texto por página (unpdf = build serverless do pdf.js, sem canvas nem
// worker) e recorte de páginas (@cantoo/pdf-lib) pro read_attachment.
//
// Criptografia: PDF com senha de ABERTURA é recusado (a API da Anthropic
// também não lê). PDF só com senha de PERMISSÃO (abre sem senha, "proibido
// imprimir") tem o texto extraído, mas não pode ir como documento pro
// modelo nem ser recortado — fica só no modo texto (indexado).

import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ExtractError } from './errors';
import { normalizeText } from '../normalize';

export interface PdfPage {
  page: number;
  text: string;
}

export interface PdfExtraction {
  pageCount: number;
  pages: PdfPage[];
  /** Tem dicionário de criptografia (mesmo abrindo sem senha). */
  encrypted: boolean;
  /** Quase sem texto: provável digitalização — só a leitura visual resolve. */
  scanned: boolean;
  warnings: string[];
}

/** Abaixo disso (média de caracteres por página) o PDF é tratado como escaneado. */
const SCANNED_CHARS_PER_PAGE = 100;

function isPasswordError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'PasswordException';
}

export async function extractPdf(bytes: Buffer, maxPages: number): Promise<PdfExtraction> {
  // Cópia: o pdf.js pode transferir (desanexar) o buffer que recebe — o
  // original ainda vai pro KbFile. (O pdf.js do unpdf 1.8 já não tem o
  // caminho de eval de fonte da CVE-2024-4367; e aqui só se extrai texto.)
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    if (isPasswordError(err)) {
      throw new ExtractError(
        'encrypted',
        'PDF protegido por senha: abra, remova a senha (ou "Imprimir → Salvar como PDF") e envie de novo.',
      );
    }
    throw new ExtractError('corrupt', 'Não foi possível ler este PDF (arquivo corrompido ou fora do padrão).');
  }
  try {
    const warnings: string[] = [];
    const { info } = await getMeta(doc);
    const encrypted = !!(info as { EncryptFilterName?: string | null }).EncryptFilterName;
    const pageCount = doc.numPages;
    // Página a página e SÓ até o teto: o extractText do unpdf abre TODAS as
    // páginas de uma vez (Promise.all) antes de qualquer corte — um PDF de
    // 3 MB com 30 mil páginas vazias estourou o heap (4 GB) e derrubou o
    // processo. Mesmo texto por página que o extractText montava.
    const text: string[] = [];
    for (let i = 1; i <= Math.min(pageCount, maxPages); i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
    }
    const limit = Math.min(pageCount, maxPages);
    if (pageCount > limit) warnings.push(`Texto extraído só das primeiras ${limit} de ${pageCount} páginas.`);
    const pages = text.slice(0, limit).map((t, i) => ({ page: i + 1, text: normalizeText(t, { prose: true }) }));
    const chars = pages.reduce((n, p) => n + p.text.length, 0);
    const scanned = pageCount > 0 && chars / Math.max(1, pages.length) < SCANNED_CHARS_PER_PAGE;
    if (scanned) warnings.push('PDF com pouco ou nenhum texto (provavelmente digitalizado): a leitura depende das páginas como imagem.');
    if (encrypted) warnings.push('PDF com restrição de segurança: só o texto extraído pode ser usado (sem leitura visual das páginas).');
    return { pageCount, pages, encrypted, scanned, warnings };
  } finally {
    // Libera o documento e o transporte interno do pdf.js (memória do PDF inteiro).
    await doc.loadingTask.destroy();
  }
}

/**
 * Novo PDF só com as páginas pedidas (1-based, na ordem dada). Usado pra
 * mandar ao modelo páginas REAIS (texto + imagem) de um PDF grande.
 */
export async function slicePdf(bytes: Buffer, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = await PDFDocument.create({ updateMetadata: false });
  const copied = await out.copyPages(
    src,
    pages.map((p) => p - 1),
  );
  for (const page of copied) out.addPage(page);
  return out.save({ useObjectStreams: true });
}
