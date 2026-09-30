// Registro de fontes citáveis de um turno do chat.
//
// As tools de busca/anexo REGISTRAM cada fonte que devolvem (search_result
// com `source` estável; documento inline com título "… — anexo <id>"). Quando
// o modelo cita (citations_delta no stream), o motor resolve a citação aqui
// e ganha um número estável [n] pra resposta — o mesmo n pra mesma fonte.
//
// O vínculo é SEMPRE pelo `source` (ou pelo id no título do documento),
// nunca por search_result_index/document_index, que contam todos os blocos
// do request e mudam entre rodadas.

import type Anthropic from '@anthropic-ai/sdk';

export interface SourceMeta {
  /** 'kb' = base de conhecimento; 'attachment' = anexo da conversa. */
  kind: 'kb' | 'attachment';
  title: string;
  documentId?: string;
  chunkId?: string;
  docVersion?: number;
  page?: number | null;
  /** Rótulo curto pra UI: "Cohort.md › Censura" / "extrato.pdf, p. 3". */
  label?: string;
  updatedAt?: string;
}

export interface Citation extends SourceMeta {
  n: number;
  source: string;
  /** Trechos literais citados (snapshot — continua legível se o doc mudar). */
  citedText: string[];
}

/** Título do documento inline de anexo: "<nome> — anexo <id>". */
export const ATTACHMENT_TITLE_RE = /— anexo ([A-Za-z0-9_-]+)$/;

export function attachmentDocTitle(name: string, id: string): string {
  return `${name} — anexo ${id}`;
}

export class SourceRegistry {
  private known = new Map<string, SourceMeta>();
  private cited = new Map<string, Citation>();

  /** Chamado pelas tools ao devolver uma fonte. */
  register(source: string, meta: SourceMeta): void {
    this.known.set(source, meta);
  }

  /** Anexos inline (document block) — registrados pelo montador do turno. */
  registerAttachment(id: string, title: string, label?: string): void {
    this.known.set(`anexo:${id}`, { kind: 'attachment', title, documentId: id, label: label ?? title });
  }

  /**
   * Resolve uma citação do stream pra um número [n]. Mesma fonte = mesmo n;
   * o trecho citado é acumulado (sem duplicar).
   */
  resolve(c: Anthropic.TextCitation): Citation | null {
    let source: string;
    let meta: SourceMeta | undefined;
    let page: number | null = null;
    switch (c.type) {
      case 'search_result_location': {
        source = c.source;
        meta = this.known.get(source) ?? { kind: 'kb', title: c.title ?? source };
        break;
      }
      case 'page_location':
      case 'char_location':
      case 'content_block_location': {
        const title = c.document_title ?? '';
        const m = title.match(ATTACHMENT_TITLE_RE);
        source = m ? `anexo:${m[1]}` : `doc:${title || c.document_index}`;
        meta = this.known.get(source) ?? { kind: 'attachment', title: title || 'documento', documentId: m?.[1] };
        if (c.type === 'page_location') {
          // Recorte de páginas (read_attachment visual) vem titulado
          // "<nome> (p. A–B) — anexo <id>" e o modelo cita a página RELATIVA
          // ao recorte: soma o deslocamento pra mostrar a página do original.
          const slice = title.match(/\(p\. (\d+)(?:[–-]\d+)?\) — anexo /);
          page = c.start_page_number + (slice ? Number(slice[1]) - 1 : 0);
        }
        break;
      }
      default:
        return null; // web search — não usamos
    }
    // Página diferente do mesmo PDF = citação distinta (o chip mostra a página).
    const key = page != null ? `${source}#p${page}` : source;
    const existing = this.cited.get(key);
    const text = (c.cited_text ?? '').trim();
    if (existing) {
      if (text && !existing.citedText.includes(text)) existing.citedText.push(text);
      return existing;
    }
    const created: Citation = {
      ...meta!,
      page: page ?? meta!.page ?? null,
      n: this.cited.size + 1,
      source,
      citedText: text ? [text] : [],
    };
    this.cited.set(key, created);
    return created;
  }

  /**
   * Fonte declarada em respond_with_blocks.sources (os blocos não carregam
   * citação nativa). Só aceita fonte que uma tool devolveu NESTE turno.
   */
  markConsulted(source: string): Citation | null {
    const meta = this.known.get(source);
    if (!meta) return null;
    const existing = this.cited.get(source);
    if (existing) return existing;
    const created: Citation = { ...meta, page: meta.page ?? null, n: this.cited.size + 1, source, citedText: [] };
    this.cited.set(source, created);
    return created;
  }

  /** Fontes efetivamente citadas, na ordem do número. */
  citations(): Citation[] {
    return [...this.cited.values()].sort((a, b) => a.n - b.n);
  }

  /** Fontes devolvidas pelas tools (citadas ou não) — valida `sources` dos blocos. */
  knownSources(): string[] {
    return [...this.known.keys()];
  }

  has(source: string): boolean {
    return this.known.has(source);
  }
}

/** Marcador que vai no texto da resposta — a UI troca por um chip [n]. */
export function citeMarker(n: number): string {
  return ` [[cite:${n}]]`;
}

/**
 * Remove marcadores de citação ao remontar o histórico: o modelo não pode
 * aprender a forjá-los (a citação real vem do stream, não do texto).
 */
export function stripCiteMarkers(text: string): string {
  return text.replace(/\s?\[\[cite:\d+\]\]/g, '');
}
