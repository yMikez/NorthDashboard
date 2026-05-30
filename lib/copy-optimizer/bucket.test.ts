import { describe, it, expect } from 'vitest';
import { hashToBucket } from './bucket';

describe('hashToBucket (djb2)', () => {
  // ───────────────────────────────────────────────────────────────────
  // VETORES PINADOS — paridade OBRIGATÓRIA com funnel-renderer/src/bucket.js
  // (e com o js/utm-webhook.js antigo). Conjunto compartilhado entre os dois
  // repos: se algum falhar de um lado, a decisão divergiria entre dashboard e
  // renderer. SEMPRE atualizar nos DOIS lados juntos.
  // Confirmado idêntico nos dois projetos em 2026-05-30.
  // ───────────────────────────────────────────────────────────────────
  const VECTORS: Array<[string, number]> = [
    ['', -1],
    ['A', 38],
    ['AB', 20],
    ['A9UZ4VNM', 75], // ← caso usado nos testes de boundary (pct 75 vs 76)
    ['A9UZ49FW', 40],
    ['A9UZ4V5G', 44],
    ['A9UZ4VIH', 5],
    ['A9UZ4VNQ', 79],
    ['test', 97],
    ['12345', 16],
    ['Matheus Petersen', 82],
  ];

  it.each(VECTORS)('hashes %j → %i (parity lock)', (input, expected) => {
    expect(hashToBucket(input)).toBe(expected);
  });

  it('returns -1 for empty/nullish', () => {
    expect(hashToBucket('')).toBe(-1);
    expect(hashToBucket(null)).toBe(-1);
    expect(hashToBucket(undefined)).toBe(-1);
  });

  it('always lands in 0..99', () => {
    for (let i = 0; i < 500; i++) {
      const b = hashToBucket(`order-${i}-xyz`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is deterministic / sticky (same input → same bucket)', () => {
    const a = hashToBucket('A9UZ4VNM');
    const b = hashToBucket('A9UZ4VNM');
    expect(a).toBe(b);
  });
});
