// Tipos da busca da base (search_knowledge + "Testar busca" do admin).

export type SearchScope = 'all' | 'knowledge' | 'attachments';
export type KbScopeName = 'GLOBAL' | 'CONVERSATION';
export type RankerName = 'pt' | 'simple' | 'allTerms' | 'trigram' | 'dense';

/** Melhor posição (1 = topo) do trecho em cada ranqueador + fusão + rerank. */
export interface PassageRanks {
  pt?: number;
  simple?: number;
  allTerms?: number;
  trigram?: number;
  dense?: number;
  /** Nota RRF (já com o multiplicador de tipo de documento). */
  rrf: number;
  /** Nota do rerank 0–3 (ausente = rerank não rodou). */
  rerank?: number;
}

export interface Passage {
  documentId: string;
  /** Um ou mais trechos vizinhos fundidos (ordem do documento). */
  chunkIds: string[];
  docTitle: string;
  headingPath: string;
  label: string;
  text: string;
  page?: number | null;
  pageEnd?: number | null;
  kind: string;
  scope: KbScopeName;
  /** ISO. */
  updatedAt: string;
  /** ISO ("fatos válidos em"), quando o documento declara. */
  effectiveDate?: string | null;
  docVersion: number;
  /** Ordinal do primeiro trecho — compõe o `source` estável da citação. */
  ordinal: number;
  fileName?: string | null;
  score: number;
  ranks: PassageRanks;
}

export interface SearchInput {
  /** 1–4 formulações da pergunta (o modelo escreve; o servidor expande sinônimos). */
  queries: string[];
  scope?: SearchScope;
  /** Conversa do turno: libera os anexos DELA (nunca de outra). */
  conversationId?: string | null;
  documentIds?: string[];
  maxResults?: number;
  /** Devolve `debug` (admin "Testar busca"). */
  debug?: boolean;
  /** Conta hitCount/lastRetrievedAt (default true; o admin testando não conta). */
  trackHits?: boolean;
  signal?: AbortSignal;
}

export interface SearchDebug {
  queries: Array<{ text: string; weight: number; original: boolean }>;
  candidates: number;
  reranked: boolean;
  trigram: boolean;
  dense: boolean;
  ms: number;
}

export interface SearchResult {
  passages: Passage[];
  /** A base não cobre bem a pergunta — o modelo deve dizer isso, não supor. */
  lowConfidence: boolean;
  debug?: SearchDebug;
}
