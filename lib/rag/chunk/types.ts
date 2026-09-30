// Tipos e parâmetros comuns dos fatiadores (markdown, páginas, planilha).
//
// Tamanhos em tokens estimados (chars/3,6): alvo 450 pra um trecho caber
// folgado num search_result e ainda carregar contexto; mínimo 120 (trecho
// menor que isso quase nunca responde sozinho); máximo 800 (acima disso o
// rerank e a citação perdem precisão). Sobreposição de 60 tokens só quando
// uma MESMA seção é partida — nunca atravessa título.

export const CHUNK_TARGET_TOKENS = 450;
export const CHUNK_MIN_TOKENS = 120;
export const CHUNK_MAX_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 60;

export const LABEL_SEP = ' › ';

export interface ChunkDraft {
  /** "Título › H1 › H2" — peso A na busca e alvo do trigram. */
  label: string;
  /** Só o caminho de títulos (sem o título do documento). */
  headingPath: string;
  content: string;
  tokenCount: number;
  pageStart?: number | null;
  pageEnd?: number | null;
}

export function labelFor(title: string, headingPath: string): string {
  const t = title.trim();
  return headingPath ? `${t}${LABEL_SEP}${headingPath}` : t;
}
