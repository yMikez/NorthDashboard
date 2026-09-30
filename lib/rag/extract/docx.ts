// DOCX → markdown. mammoth ≥ 1.11 (CVE-2025-11849: docx com imagem de link
// externo lia arquivo local) com acesso externo DESLIGADO explicitamente e
// imagens descartadas sem nem ler os bytes — o anexo vira só texto
// estruturado (títulos, listas, tabelas).

import mammoth from 'mammoth';
import { htmlToMarkdown } from './markdown';

export interface DocxExtraction {
  markdown: string;
  warnings: string[];
}

export async function docxToMarkdown(bytes: Buffer): Promise<DocxExtraction> {
  const result = await mammoth.convertToHtml(
    { buffer: bytes },
    {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    },
  );
  const warnings: string[] = [];
  const skipped = result.messages.filter((m) => m.type === 'warning').length;
  if (skipped) warnings.push(`${skipped} elemento(s) de formatação do DOCX não foram convertidos (o texto foi mantido).`);
  return { markdown: htmlToMarkdown(result.value), warnings };
}
