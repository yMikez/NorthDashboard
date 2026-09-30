import { afterEach, describe, expect, it, vi } from 'vitest';
import { dot, embedTexts, fromEmbeddingBytes, isDenseEnabled, l2normalize, toEmbeddingBytes, tryEmbedDocuments } from './embed';

describe('embeddings (Voyage opcional)', () => {
  const key = process.env.VOYAGE_API_KEY;
  afterEach(() => {
    process.env.VOYAGE_API_KEY = key;
    vi.unstubAllGlobals();
  });

  it('Float32 LE ida e volta e cosseno de vetores normalizados', () => {
    const v = l2normalize(Float32Array.from([3, 4]));
    expect(Array.from(v)).toEqual([0.6000000238418579, 0.800000011920929]);
    const back = fromEmbeddingBytes(toEmbeddingBytes(v));
    expect(Array.from(back)).toEqual(Array.from(v));
    expect(dot(v, v)).toBeCloseTo(1, 6);
    // Buffer fatiado de um pool (byteOffset ≠ 0) também lê certo.
    const pooled = Buffer.concat([Buffer.alloc(3), toEmbeddingBytes(v)]).subarray(3);
    expect(Array.from(fromEmbeddingBytes(pooled))).toEqual(Array.from(v));
  });

  it('sem chave: desligado, e a indexação segue sem denso', async () => {
    delete process.env.VOYAGE_API_KEY;
    expect(isDenseEnabled()).toBe(false);
    expect(await tryEmbedDocuments(['a'])).toBeNull();
  });

  it('monta a chamada, reordena pelo index e normaliza', async () => {
    process.env.VOYAGE_API_KEY = 'vk';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [2, 0] }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await embedTexts(['a', 'b'], 'query');
    expect(Array.from(out[0])).toEqual([1, 0]);
    expect(Array.from(out[1])).toEqual([0, 1]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ input: ['a', 'b'], input_type: 'query', output_dimension: 1024 });
  });

  it('erro HTTP da Voyage vira null na indexação (não derruba)', async () => {
    process.env.VOYAGE_API_KEY = 'vk';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('limite', { status: 429 })));
    expect(await tryEmbedDocuments(['a'])).toBeNull();
  });
});
