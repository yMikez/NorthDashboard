// Passagens da busca → blocos `search_result` com citação nativa.
//
// O vínculo da citação de volta pra fonte é o `source` (estável:
// kb:<doc>@v<versão>#<ordinal> | anexo:<doc>#p<página>), registrado no
// SourceRegistry do turno — nunca o search_result_index, que conta todos os
// search_result do request e muda entre rodadas.
//
// O conteúdo vai em parágrafos de até ~500 caracteres: cada text block é a
// unidade de citação, então pedaço menor = trecho citado mais preciso.

import type Anthropic from '@anthropic-ai/sdk';
import type { SourceRegistry } from './citations';
import type { Passage } from './search/types';

export const KIND_LABEL: Record<string, string> = {
  policy: 'política',
  reference: 'referência',
  snapshot: 'retrato datado',
  playbook: 'playbook',
  memory: 'memória (menor autoridade)',
  knowledge_entry: 'base do admin',
  attachment: 'anexo',
};

const ymd = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export function passageSource(p: Passage): string {
  if (p.scope === 'CONVERSATION') return p.page != null ? `anexo:${p.documentId}#p${p.page}` : `anexo:${p.documentId}#t${p.ordinal}`;
  return `kb:${p.documentId}@v${p.docVersion}#${p.ordinal}`;
}

function pageLabel(p: Passage): string {
  if (p.page == null) return '';
  return p.pageEnd != null && p.pageEnd !== p.page ? `pp. ${p.page}–${p.pageEnd}` : `p. ${p.page}`;
}

/** Título visível pro modelo: onde está, que tipo de fonte é e de quando. */
export function passageTitle(p: Passage): string {
  if (p.scope === 'CONVERSATION') {
    const name = p.fileName || p.docTitle;
    const where = [pageLabel(p), p.page == null && p.headingPath ? p.headingPath : ''].filter(Boolean).join(' · ');
    return `${name}${where ? `, ${where}` : ''} · anexo desta conversa · enviado ${ymd(p.updatedAt)}`;
  }
  const where = p.headingPath ? ` › ${p.headingPath}` : '';
  const page = pageLabel(p) ? ` (${pageLabel(p)})` : '';
  const kind = KIND_LABEL[p.kind] ?? p.kind;
  const effective = p.effectiveDate ? ` · vigente em ${ymd(p.effectiveDate)}` : '';
  return `${p.docTitle}${where}${page} · ${kind} · atualizado ${ymd(p.updatedAt)}${effective}`;
}

/** Rótulo curto pro chip de citação na UI. */
export function passageLabel(p: Passage): string {
  if (p.scope === 'CONVERSATION') return [p.fileName || p.docTitle, pageLabel(p)].filter(Boolean).join(', ');
  return p.headingPath ? `${p.docTitle} › ${p.headingPath}` : p.docTitle;
}

/**
 * Parágrafos (linha em branco) agrupados até ~maxChars; parágrafo maior
 * que isso fica inteiro — tabela markdown é um parágrafo e não pode partir.
 */
export function splitParagraphs(text: string, maxChars = 500): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > maxChars) {
      out.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out.length ? out : [text.trim() || '(vazio)'];
}

export function toSearchResultBlocks(passages: Passage[], sources?: SourceRegistry): Anthropic.SearchResultBlockParam[] {
  return passages.map((p) => {
    const source = passageSource(p);
    const title = passageTitle(p);
    sources?.register(source, {
      kind: p.scope === 'CONVERSATION' ? 'attachment' : 'kb',
      title: p.scope === 'CONVERSATION' ? p.fileName || p.docTitle : p.docTitle,
      documentId: p.documentId,
      chunkId: p.chunkIds[0],
      docVersion: p.docVersion,
      page: p.page ?? null,
      label: passageLabel(p),
      updatedAt: p.updatedAt,
    });
    return {
      type: 'search_result',
      source,
      title,
      content: splitParagraphs(p.text).map((text) => ({ type: 'text', text })),
      citations: { enabled: true },
    };
  });
}
