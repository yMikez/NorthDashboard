// Sanidade do ranking com a base REAL (docs/kb inteira indexada no Postgres
// embutido, sem rerank nem contexto do modelo): perguntas típicas do chat
// têm de trazer o documento certo no topo só com FTS + sinônimos + RRF.
// É a rede de proteção de quem mexer no fatiador, nos sinônimos ou na SQL.

import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { migratedPglite } from '../../test/pgliteDb';
import { chunkMarkdown } from '../chunk/markdown';
import { toSeedDoc } from '../seed';
import { KB_SEED_DIR, SEED_DOCS } from '../seedManifest';
import { expandQueries } from '../synonyms';
import { RANKER_WEIGHT, rrfFuse, type RankedList } from './fuse';
import { lexicalSql, trigramSql, tsvUpdateSql, wantsTrigram } from './sql';

const run = <T,>(db: PGlite, sql: Prisma.Sql) => db.query<T>(sql.text, sql.values as unknown[]);

async function topDocs(db: PGlite, queries: string[]): Promise<string[]> {
  const lists: RankedList[] = [];
  for (const q of expandQueries(queries)) {
    const { rows } = await run<{ id: string; r_pt: number; r_simple: number; all_terms: boolean }>(db, lexicalSql(q.text, { scope: 'knowledge' }));
    lists.push({ ranker: 'pt', weight: RANKER_WEIGHT.pt * q.weight, ids: rows.filter((r) => r.r_pt > 0).sort((a, b) => b.r_pt - a.r_pt).map((r) => r.id) });
    lists.push({ ranker: 'simple', weight: RANKER_WEIGHT.simple * q.weight, ids: rows.filter((r) => r.r_simple > 0).sort((a, b) => b.r_simple - a.r_simple).map((r) => r.id) });
    if (q.original) lists.push({ ranker: 'allTerms', weight: RANKER_WEIGHT.allTerms, ids: rows.filter((r) => r.all_terms).sort((a, b) => b.r_pt - a.r_pt).map((r) => r.id) });
  }
  for (const q of queries.filter(wantsTrigram)) {
    const { rows } = await run<{ id: string }>(db, trigramSql(q, { scope: 'knowledge' }));
    lists.push({ ranker: 'trigram', weight: RANKER_WEIGHT.trigram, ids: rows.map((r) => r.id) });
  }
  const ranked = [...rrfFuse(lists)].sort((a, b) => b[1].score - a[1].score).map(([id]) => id.split('#')[0]);
  return [...new Set(ranked)];
}

describe('ranking com a base real de docs/kb', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await migratedPglite();
    const dir = path.resolve(__dirname, '../../..', KB_SEED_DIR);
    for (const file of SEED_DOCS) {
      const doc = toSeedDoc(file, fs.readFileSync(path.join(dir, file), 'utf8'));
      const id = file.replace(/\.md$/, '');
      await db.query(
        `INSERT INTO "KbDocument" (id, scope, kind, "sourceType", title, "mimeType", "contentHash", version, status, enabled, "updatedAt")
         VALUES ($1, 'GLOBAL', $2, 'repo_md', $3, 'text/markdown', 'h', 1, 'READY', true, now())`,
        [id, doc.kind, doc.title],
      );
      for (const [i, c] of chunkMarkdown(doc.body, { title: doc.title }).entries()) {
        await db.query(
          `INSERT INTO "KbChunk" (id, "documentId", "docVersion", ordinal, scope, label, "headingPath", content, "tokenCount")
           VALUES ($1, $2, 1, $3, 'GLOBAL', $4, $5, $6, $7)`,
          [`${id}#${i}`, id, i, c.label, c.headingPath, c.content, c.tokenCount],
        );
      }
      await run(db, tsvUpdateSql(id, 1));
    }
  }, 120_000);

  // Mais de um documento certo = a base cobre por dois lados; o rerank do
  // modelo escolhe entre eles em produção.
  const cases: Array<[string[], string | string[]]> = [
    [['estorno Digistore'], 'ressalvas-de-dados'],
    [['refund da BuyGoods zerado'], 'ressalvas-de-dados'],
    [['como é calculado o NET AOV com a reserva'], 'modelo-cpa-net-aov'],
    [['matriz censurada de coorte'], 'coorte-de-reembolso'],
    [['margem de contribuição receita econômica'], 'margem-de-contribuicao'],
    [['qual lucro usar', 'lentes de lucro net after cpa'], 'lucro-front-back'],
    [['afiliado dormente tier North'], 'crm-afiliados'],
    [['comissão da Logicall assumida'], 'call-center'],
    [['take rate do upsell sessão órfã'], 'funil-e-etapas'],
    [['fatura do fornecedor RedRock terça'], 'fulfillment'],
    [['commissionPct é fração ou percentual'], ['dicionario-campos', 'afiliados-recuperacao']],
    [['lusk1nha comissão recuperação'], 'afiliados-recuperacao'],
    [['refundModel extra-row updated_since'], 'dados-e-api'],
    [['affiliate_id mapeamento external_id'], 'integracao-afiliados'],
  ];

  for (const [queries, expected] of cases) {
    it(`"${queries[0]}" → ${expected}`, async () => {
      const docs = await topDocs(db, queries);
      expect([expected].flat()).toContain(docs[0]);
    });
  }
});
