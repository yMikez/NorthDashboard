import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from './chunk/markdown';
import { CHUNK_MAX_TOKENS } from './chunk/types';
import { parseFrontmatter, toSeedDoc } from './seed';
import { KB_SEED_DIR, SEED_DOCS } from './seedManifest';

const DIR = path.resolve(__dirname, '../..', KB_SEED_DIR);

// Padrões que NUNCA podem ir pra base (o conteúdo vai pro contexto do modelo
// e é citável): IP, chave/token, bearer, cabeçalho de segredo com valor,
// e-mail real. Exemplo "cliente@exemplo.com" é o único e-mail permitido.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'endereço IP'],
  [/\bsk-[A-Za-z0-9_-]{10,}/, 'chave de API'],
  [/Bearer\s+[A-Za-z0-9._-]{12,}/, 'bearer token'],
  [/(?:INGEST_SECRET|API_KEY|PASSWORD|TOKEN)\s*[=:]\s*\S{6,}/i, 'segredo com valor'],
  [/\bssh\s+\S+@/i, 'acesso SSH'],
];

describe('manifesto de docs/kb', () => {
  it('cada documento existe, tem frontmatter válido e fatia dentro do teto', () => {
    expect(new Set(SEED_DOCS).size).toBe(SEED_DOCS.length);
    for (const file of SEED_DOCS) {
      const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
      const doc = toSeedDoc(file, raw);
      expect(doc.effectiveDate, `${file}: effectiveDate`).not.toBeNull();
      expect(doc.description.length, `${file}: description curta pro índice`).toBeLessThanOrEqual(220);
      const chunks = chunkMarkdown(doc.body, { title: doc.title });
      expect(chunks.length, file).toBeGreaterThan(0);
      for (const c of chunks) expect(c.tokenCount, `${file} › ${c.headingPath}`).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    }
  });

  it('nenhum documento traz segredo, IP, acesso ou e-mail real', () => {
    for (const file of SEED_DOCS) {
      const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
      for (const [re, what] of FORBIDDEN) expect(re.test(raw), `${file}: ${what}`).toBe(false);
      const emails = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      expect(emails.filter((e) => !e.endsWith('@exemplo.com')), `${file}: e-mail`).toEqual([]);
    }
  });

  it('só entra o que está no manifesto (README e rascunhos ficam fora)', () => {
    expect(SEED_DOCS).not.toContain('README.md');
    expect(SEED_DOCS.every((f) => f.endsWith('.md') && !f.includes('/'))).toBe(true);
  });
});

describe('frontmatter', () => {
  it('lê chave: valor com e sem aspas e separa o corpo', () => {
    const { meta, body } = parseFrontmatter('---\ntitle: "Título: com dois pontos"\nkind: policy\n---\n# Corpo\n');
    expect(meta).toEqual({ title: 'Título: com dois pontos', kind: 'policy' });
    expect(body).toBe('# Corpo\n');
  });

  it('valida tipo, descrição e data', () => {
    const ok = '---\ntitle: T\nkind: reference\ndescription: d\neffectiveDate: 2026-09-30\n---\ntexto';
    expect(toSeedDoc('x.md', ok).effectiveDate?.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    expect(() => toSeedDoc('x.md', ok.replace('reference', 'memory'))).toThrow(/kind inválido/);
    expect(() => toSeedDoc('x.md', ok.replace('description: d\n', ''))).toThrow(/description/);
    expect(() => toSeedDoc('x.md', ok.replace('2026-09-30', '30/09/2026'))).toThrow(/effectiveDate/);
    expect(() => toSeedDoc('x.md', 'sem frontmatter')).toThrow(/title/);
  });
});
