import { describe, expect, it } from 'vitest';
import { pricingFor, roundsCostUsd, usageCostUsd } from './chatPricing';

const u = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});

describe('pricingFor', () => {
  it('resolve por prefixo, com sufixo de data, e não confunde 5.5 com 5', () => {
    expect(pricingFor('claude-opus-5')).toEqual({ inputPerMTok: 5, outputPerMTok: 25 });
    expect(pricingFor('claude-opus-5-5')).toEqual({ inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 });
    expect(pricingFor('claude-sonnet-5')).toEqual({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(pricingFor('claude-haiku-4-5-20251001')).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
  });

  it('modelo desconhecido não tem preço (custo fica null, nunca chutado)', () => {
    expect(pricingFor('claude-opus-50')).toBeNull();
    expect(pricingFor('gpt-x')).toBeNull();
    expect(pricingFor('')).toBeNull();
    expect(usageCostUsd('modelo-novo', u(1000, 1000))).toBeNull();
  });
});

describe('usageCostUsd', () => {
  it('entrada + saída pelo preço cheio', () => {
    // 1M in × $5 + 1M out × $25
    expect(usageCostUsd('claude-opus-5', u(1_000_000, 1_000_000))).toBeCloseTo(30, 10);
  });

  it('cache: leitura 0,1× e escrita 1,25× do preço de entrada', () => {
    expect(usageCostUsd('claude-opus-5', u(0, 0, 1_000_000, 0))).toBeCloseTo(0.5, 10);
    expect(usageCostUsd('claude-opus-5', u(0, 0, 0, 1_000_000))).toBeCloseTo(6.25, 10);
    // Opus 5.5: leitura de cache com preço próprio ($0,20/MTok), escrita segue 1,25×
    expect(usageCostUsd('claude-opus-5-5', u(0, 0, 0, 1_000_000))).toBeCloseTo(5, 10);
    expect(usageCostUsd('claude-opus-5-5', u(0, 0, 1_000_000, 0))).toBeCloseTo(0.2, 10);
  });

  it('turno típico do chat', () => {
    // 2.000 sem cache + 40.000 lidos do cache + 3.000 escritos + 1.500 de saída no Opus 5
    const expected = (2_000 * 5 + 40_000 * 0.5 + 3_000 * 6.25 + 1_500 * 25) / 1_000_000;
    expect(usageCostUsd('claude-opus-5', u(2_000, 1_500, 40_000, 3_000))).toBeCloseTo(expected, 12);
  });
});

describe('roundsCostUsd', () => {
  it('soma as rodadas no modelo que SERVIU cada uma', () => {
    const cost = roundsCostUsd(
      [
        { model: 'claude-opus-5', usage: u(1_000_000, 0) },
        { model: 'claude-sonnet-5', usage: u(1_000_000, 0) },
      ],
      'claude-opus-5',
    );
    expect(cost).toBeCloseTo(7, 6);
  });

  it('rodada sem modelo usa o pedido; qualquer rodada sem preço anula o total', () => {
    expect(roundsCostUsd([{ model: '', usage: u(1_000_000, 0) }], 'claude-haiku-4-5')).toBeCloseTo(1, 6);
    expect(roundsCostUsd([{ model: 'x', usage: u(10, 10) }, { model: 'claude-opus-5', usage: u(10, 10) }])).toBeNull();
  });
});
