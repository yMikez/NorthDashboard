// Indexação de um KbDocument: texto → trechos (KbChunk) + tsvector
// (ns_pt/ns_simple) + contexto (Contextual Retrieval, só GLOBAL) + embedding
// opcional. Usado pelo seed da base, pelo upload do admin E pelos anexos.
// ESQUELETO da fundação — preenchido pela unidade de RAG.
//
// Contrato: lê KbDocument.text (e KbDocument.meta.pages = [{page, text}]
// quando for PDF/paginado; meta.sheets pra planilha), gera os chunks da
// versão ATUAL (doc.version) numa transação que apaga os da versão anterior,
// marca status READY (ou FAILED com error) e devolve quantos trechos.

export interface IndexOptions {
  /** Gera o contexto de cada trecho com o modelo rápido (default: só GLOBAL). */
  contextualize?: boolean;
}

export async function indexDocument(_documentId: string, _opts: IndexOptions = {}): Promise<{ chunks: number }> {
  return { chunks: 0 };
}
