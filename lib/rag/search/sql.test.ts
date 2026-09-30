import type { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { migratedPglite } from '../../test/pgliteDb';
import { chunkMarkdown } from '../chunk/markdown';
import { expandQueries } from '../synonyms';
import { RANKER_WEIGHT, rrfFuse, type RankedList } from './fuse';
import { lexicalSql, scopeWhere, trigramAvailableSql, trigramSql, tsvUpdateSql, wantsTrigram, type ScopeFilter } from './sql';

const run = <T,>(db: PGlite, sql: Prisma.Sql) => db.query<T>(sql.text, sql.values as unknown[]);

interface Doc {
  id: string;
  title: string;
  kind: string;
  scope?: 'GLOBAL' | 'CONVERSATION';
  conversationId?: string | null;
  messageId?: string | null;
  enabled?: boolean;
  version?: number;
  body: string;
}

const DOCS: Doc[] = [
  {
    id: 'doc_ressalvas',
    title: 'Ressalvas de dados',
    kind: 'policy',
    body: `# Ressalvas de dados

## Digistore24: estornos sem IPN

Cerca de 28% dos reembolsos da Digistore24 (os executados pelas contas Tauk1Affilliate a Tauk4Affilliate) nunca disparam IPN.
Eles só entram no dashboard pela reconciliação com o CSV exportado do painel, dias depois. Até o reconcile, a taxa de estorno da D24 fica subcontada.

## Fusos por plataforma

ClickBank manda horário do Pacífico, Digistore24 em Berlim, BuyGoods e JVZoo em Eastern. O dashboard agrupa tudo em dia BRT.`,
  },
  {
    id: 'doc_crm',
    title: 'CRM de afiliados',
    kind: 'reference',
    body: `# CRM de afiliados

## Segmentos

Dormente é quem passou do limiar de dias sem vender do tier (Base 7, Ascendente 5, North 3). Frio passa de 30 dias.

## Fila

A fila ordena por valor do afiliado, não por dias parados.`,
  },
  {
    id: 'doc_cohort',
    title: 'Coorte de reembolso',
    kind: 'policy',
    body: `# Coorte de reembolso

## Regra central

O reembolso é atribuído ao dia da venda original. A matriz é censurada: coorte que ainda não viveu o dia N fica em branco.`,
  },
  {
    id: 'doc_old',
    title: 'Versão antiga',
    kind: 'reference',
    version: 2,
    body: `# Versão antiga\n\n## Estorno\n\nTexto da versão 1 sobre estorno Digistore que não pode aparecer.`,
  },
  {
    id: 'doc_off',
    title: 'Desligado',
    kind: 'reference',
    enabled: false,
    body: `# Desligado\n\n## Estorno\n\nDocumento desligado falando de estorno Digistore.`,
  },
  {
    id: 'att_conv1',
    title: 'extrato-digistore.pdf',
    kind: 'attachment',
    scope: 'CONVERSATION',
    conversationId: 'conv1',
    messageId: 'msg1',
    body: 'Extrato do mês: 52 estornos na Digistore, 16 executados pela conta Tauk.',
  },
  {
    id: 'att_conv2',
    title: 'outra-conversa.pdf',
    kind: 'attachment',
    scope: 'CONVERSATION',
    conversationId: 'conv2',
    messageId: 'msg2',
    body: 'Estornos da Digistore de outra pessoa.',
  },
];

async function seed(db: PGlite) {
  // Conversa/mensagem dos anexos não interessam aqui: desliga as FKs.
  await db.exec('SET session_replication_role = replica');
  for (const d of DOCS) {
    const version = d.version ?? 1;
    await db.query(
      `INSERT INTO "KbDocument" (id, scope, "conversationId", "messageId", kind, "sourceType", title, "mimeType", "contentHash", version, status, enabled, "updatedAt")
       VALUES ($1, $2::"KbScope", $3, $4, $5, 'test', $6, 'text/markdown', 'h', $7, 'READY', $8, now())`,
      [d.id, d.scope ?? 'GLOBAL', d.conversationId ?? null, d.messageId ?? null, d.kind, d.title, version, d.enabled ?? true],
    );
    // doc_old: os trechos gravados são da versão 1 (o documento já está na 2).
    const chunkVersion = d.id === 'doc_old' ? 1 : version;
    const chunks = chunkMarkdown(d.body, { title: d.title });
    for (const [i, c] of chunks.entries()) {
      await db.query(
        `INSERT INTO "KbChunk" (id, "documentId", "docVersion", ordinal, scope, label, "headingPath", content, "tokenCount")
         VALUES ($1, $2, $3, $4, $5::"KbScope", $6, $7, $8, $9)`,
        [`${d.id}#${i}`, d.id, chunkVersion, i, d.scope ?? 'GLOBAL', c.label, c.headingPath, c.content, c.tokenCount],
      );
    }
    await run(db, tsvUpdateSql(d.id, chunkVersion));
  }
}

async function search(db: PGlite, queries: string[], f: ScopeFilter): Promise<string[]> {
  const lists: RankedList[] = [];
  for (const q of expandQueries(queries)) {
    const res = await run<{ id: string; r_pt: number; r_simple: number; all_terms: boolean }>(db, lexicalSql(q.text, f));
    const rows = res.rows;
    lists.push({ ranker: 'pt', weight: RANKER_WEIGHT.pt * q.weight, ids: rows.filter((r) => r.r_pt > 0).sort((a, b) => b.r_pt - a.r_pt).map((r) => r.id) });
    lists.push({ ranker: 'simple', weight: RANKER_WEIGHT.simple * q.weight, ids: rows.filter((r) => r.r_simple > 0).sort((a, b) => b.r_simple - a.r_simple).map((r) => r.id) });
    if (q.original) lists.push({ ranker: 'allTerms', weight: RANKER_WEIGHT.allTerms, ids: rows.filter((r) => r.all_terms).map((r) => r.id) });
  }
  return [...rrfFuse(lists)].sort((a, b) => b[1].score - a[1].score).map(([id]) => id);
}

describe('busca lexical no Postgres (PGlite com todas as migrações)', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await migratedPglite();
    await seed(db);
  }, 60_000);

  it('"estorno Digistore" traz a ressalva de reembolso da D24 primeiro', async () => {
    const ids = await search(db, ['estorno Digistore'], { scope: 'knowledge' });
    expect(ids[0]).toBe('doc_ressalvas#0');
  });

  it('sinônimo em inglês e abreviação também acham (refund D24)', async () => {
    const ids = await search(db, ['refund D24'], { scope: 'knowledge' });
    expect(ids[0]).toBe('doc_ressalvas#0');
  });

  it('acento e caixa não importam (unaccent no ns_pt)', async () => {
    const ids = await search(db, ['FUSOS POR PLATAFORMA berlim'], { scope: 'knowledge' });
    expect(ids[0]?.startsWith('doc_ressalvas')).toBe(true);
  });

  it('versão antiga e documento desligado nunca aparecem', async () => {
    const ids = await search(db, ['estorno Digistore versão desligado'], { scope: 'knowledge' });
    expect(ids.some((id) => id.startsWith('doc_old'))).toBe(false);
    expect(ids.some((id) => id.startsWith('doc_off'))).toBe(false);
  });

  it('anexo só aparece na PRÓPRIA conversa e nunca sem conversa', async () => {
    const semConversa = await search(db, ['estornos Digistore Tauk'], { scope: 'all' });
    expect(semConversa.some((id) => id.startsWith('att_'))).toBe(false);
    const conv1 = await search(db, ['estornos Digistore Tauk'], { scope: 'all', conversationId: 'conv1' });
    expect(conv1).toContain('att_conv1#0');
    expect(conv1.some((id) => id.startsWith('att_conv2'))).toBe(false);
    const soAnexos = await search(db, ['estornos Digistore'], { scope: 'attachments', conversationId: 'conv1' });
    expect(soAnexos).toEqual(['att_conv1#0']);
  });

  it('filtro por document_ids', async () => {
    const ids = await search(db, ['reembolso'], { scope: 'knowledge', documentIds: ['doc_cohort'] });
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith('doc_cohort'))).toBe(true);
  });

  it('pergunta só de stopwords não quebra (lista vazia)', async () => {
    const ids = await search(db, ['de o a'], { scope: 'knowledge' });
    expect(ids).toEqual([]);
  });

  it('trigram acha nome com erro de digitação no rótulo', async () => {
    const ok = await run(db, trigramAvailableSql);
    expect(ok.rows.length).toBe(1);
    const res = await run<{ id: string; sim: number }>(db, trigramSql('Cohrte de reembolso', { scope: 'knowledge' }));
    expect(res.rows[0]?.id).toBe('doc_cohort#0');
  });

  it('scopeWhere sempre filtra ligado + READY', () => {
    expect(scopeWhere({ scope: 'all' }).text).toContain(`d.enabled AND d.status = 'READY'`);
  });

  it('trigram só roda em consulta curta (nome/código), não em pergunta longa', () => {
    expect(wantsTrigram('NeuroMnidPro')).toBe(true);
    expect(wantsTrigram('Cohrte de reembolso')).toBe(true);
    expect(wantsTrigram('afiliado dormente tier North')).toBe(false);
    expect(wantsTrigram('  ')).toBe(false);
  });
});

describe('sem as extensões contrib (produção sem pg_trgm)', () => {
  it('detecta ausência do trigram e a busca lexical segue funcionando', async () => {
    const db = await migratedPglite({ extensions: false });
    await seed(db);
    expect((await run(db, trigramAvailableSql)).rows.length).toBe(0);
    const ids = await search(db, ['estorno Digistore'], { scope: 'knowledge' });
    expect(ids[0]).toBe('doc_ressalvas#0');
  }, 60_000);
});
