// Embeddings densos OPCIONAIS (Voyage AI) — decisão do dono: só liga com
// VOYAGE_API_KEY. Sem a chave o pipeline roda com FTS + trigram + rerank e
// nada aqui é chamado.
//
// Guardamos Float32 little-endian L2-normalizado em KbChunk.embedding
// (bytea, 4 KB por trecho a 1024d): Buffer → Float32Array sem conversão de
// texto, e com vetor normalizado o cosseno é só o produto escalar.
// Sem SDK: é um POST simples e a dependência não se paga.

import { logger } from '../logger';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
export const EMBEDDING_MODEL = process.env.VOYAGE_EMBED_MODEL?.trim() || 'voyage-3.5';
export const EMBEDDING_DIM = 1024;
const BATCH = 128;
const TIMEOUT_MS = 30_000;

export function isDenseEnabled(): boolean {
  return !!process.env.VOYAGE_API_KEY?.trim();
}

export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s);
  if (!n) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Produto escalar = cosseno entre vetores já normalizados. */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function toEmbeddingBytes(v: Float32Array): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i], i * 4);
  return buf;
}

export function fromEmbeddingBytes(b: Uint8Array): Float32Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Float32Array(Math.floor(b.byteLength / 4));
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

interface VoyageResponse {
  data?: Array<{ embedding: number[]; index: number }>;
}

/**
 * Embeda em lotes de 128. `document` pros trechos, `query` pras consultas
 * (a Voyage otimiza os dois lados de forma assimétrica).
 */
export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query',
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) throw new Error('VOYAGE_API_KEY não configurada');
  const out: Float32Array[] = new Array(texts.length);
  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: batch, model: EMBEDDING_MODEL, input_type: inputType, output_dimension: EMBEDDING_DIM }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Voyage HTTP ${res.status}: ${body}`);
    }
    const json = (await res.json()) as VoyageResponse;
    for (const row of json.data ?? []) out[start + row.index] = l2normalize(Float32Array.from(row.embedding));
  }
  const missing = out.findIndex((v) => !v);
  if (missing >= 0) throw new Error(`Voyage não devolveu embedding do item ${missing}`);
  return out;
}

/** Texto embedado de um trecho: rótulo + contexto + corpo (mesmo peso semântico do FTS). */
export function embeddingInput(label: string, context: string | null, content: string): string {
  return `${label}\n${context ?? ''}\n\n${content}`.slice(0, 16_000);
}

/** Versão tolerante pra indexação: falha vira null (o trecho só fica sem denso). */
export async function tryEmbedDocuments(texts: string[]): Promise<Float32Array[] | null> {
  if (!isDenseEnabled() || !texts.length) return null;
  try {
    return await embedTexts(texts, 'document');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), n: texts.length }, '[rag] embeddings falharam — trechos ficam só com FTS');
    return null;
  }
}
