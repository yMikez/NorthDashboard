import { describe, expect, it } from 'vitest';
import { retentionUrl, RETENTION_PAGE_LIMIT } from './retentionSync';

// A base vem de config escrita à mão (setting ou env) — aceita as formas
// prováveis sem virar URL inválida ou caminho duplicado.
describe('retentionUrl', () => {
  it('monta a partir da base', () => {
    expect(retentionUrl('https://sendtrace.exemplo.com', null))
      .toBe(`https://sendtrace.exemplo.com/api/retencao?limit=${RETENTION_PAGE_LIMIT}`);
  });
  it('não duplica o caminho quando a base já vem completa', () => {
    expect(retentionUrl('https://sendtrace.exemplo.com/api/retencao', null))
      .toBe(`https://sendtrace.exemplo.com/api/retencao?limit=${RETENTION_PAGE_LIMIT}`);
  });
  it('ignora barra sobrando no fim', () => {
    expect(retentionUrl('https://sendtrace.exemplo.com///', null))
      .toContain('https://sendtrace.exemplo.com/api/retencao?');
  });
  it('passa o marcador incremental', () => {
    const u = retentionUrl('http://10.0.0.5:4400', '2026-09-22T14:05:00.000Z');
    expect(u).toContain('updated_since=2026-09-22T14%3A05%3A00.000Z');
    expect(u).toContain('limit=');
  });
});
