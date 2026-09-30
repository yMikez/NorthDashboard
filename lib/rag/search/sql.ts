// SQL cru da base de conhecimento (FTS ns_pt/ns_simple, trigram, tsvector).
// Só construtores (Prisma.sql) — testáveis no Postgres embutido (PGlite) com
// `.text/.values`, sem depender do Prisma client.
//
// Escopo SEMPRE pelo documento (d.scope/d."conversationId"), não pela cópia
// desnormalizada no trecho: um anexo é indexado como rascunho (sem conversa)
// e só ganha conversationId quando a mensagem é enviada.

import { Prisma } from '@prisma/client';
import type { SearchScope } from './types';

export interface ScopeFilter {
  scope: SearchScope;
  conversationId?: string | null;
  documentIds?: string[];
}

export function scopeWhere(f: ScopeFilter): Prisma.Sql {
  const global = Prisma.sql`d.scope = 'GLOBAL'`;
  const conv = f.conversationId
    ? Prisma.sql`(d.scope = 'CONVERSATION' AND d."conversationId" = ${f.conversationId} AND d."messageId" IS NOT NULL)`
    : null;
  let where: Prisma.Sql;
  if (f.scope === 'knowledge') where = global;
  else if (f.scope === 'attachments') where = conv ?? Prisma.sql`FALSE`;
  else where = conv ? Prisma.sql`(${global} OR ${conv})` : global;
  if (f.documentIds?.length) where = Prisma.sql`${where} AND d.id = ANY(${f.documentIds}::text[])`;
  return Prisma.sql`d.enabled AND d.status = 'READY' AND ${where}`;
}

/**
 * Uma ida ao banco por consulta, três sinais por trecho:
 *   r_pt      — soma, por termo da consulta (lexemas do ns_pt, com stemming e
 *               sem acento), de idf × ts_rank do termo no trecho. OR dos
 *               termos, não AND: pergunta natural nunca casa todos;
 *   r_simple  — idem no ns_simple (códigos, IDs, inglês que o stemmer
 *               português estraga: NSNMP6, take rate, D24). Stopword
 *               portuguesa ("de", "o", "como") sai: o simple não tem
 *               stopwords e ela casaria todos os trechos;
 *   all_terms — casou TODOS os termos do ns_pt (lista-bônus na fusão).
 *
 * Por que idf: ts_rank_cd do Postgres não pondera raridade — numa base onde
 * "afiliado" e "reembolso" aparecem em todo documento, o termo que decide
 * ("dormente", "censurada") pesava igual aos comuns e perdia pra quem
 * repetia a palavra comum. idf no estilo BM25 (ln(1 + (N − df + ½)/(df + ½)))
 * calculado NO ESCOPO da busca resolve sem índice novo.
 * Pesos {D,C,B,A} = {0.1, 0.2, 0.4, 1.0}: rótulo (A) > contexto (B) > corpo (C);
 * normalização 1 (÷ 1 + log do tamanho) não deixa trecho longo ganhar por volume.
 */
export function lexicalSql(query: string, f: ScopeFilter, limit = 80): Prisma.Sql {
  return Prisma.sql`
    WITH sc AS MATERIALIZED (
      SELECT c.id, c."documentId", c."tsvPt", c."tsvSimple"
      FROM "KbChunk" c
      JOIN "KbDocument" d ON d.id = c."documentId" AND d.version = c."docVersion"
      WHERE ${scopeWhere(f)}
    ),
    n AS (SELECT count(*)::float8 AS n FROM sc),
    -- Stopwords da pergunta. O ns_pt aplica unaccent ANTES do stemmer, então
    -- "não/você/já/só/até" deixam de ser reconhecidas como stopword e viram
    -- termo — e o all_terms passava a exigir "nao" no trecho. Aqui elas saem
    -- da CONSULTA (no documento o idf delas já é quase zero).
    stop AS (
      SELECT DISTINCT l
        FROM ts_debug('pg_catalog.portuguese'::regconfig, ${query}) d,
             unnest(
               tsvector_to_array(to_tsvector('public.ns_pt'::regconfig, d.token))
               || tsvector_to_array(to_tsvector('public.ns_simple'::regconfig, d.token))
             ) l
       WHERE d.lexemes = '{}'::text[]
    ),
    terms AS (
      SELECT 'pt'::text AS cfg, l
        FROM unnest(tsvector_to_array(to_tsvector('public.ns_pt'::regconfig, ${query}))) l
       WHERE length(l) > 1 AND l NOT IN (SELECT l FROM stop)
      UNION ALL
      SELECT 'simple'::text, l
        FROM unnest(tsvector_to_array(to_tsvector('public.ns_simple'::regconfig, ${query}))) l
       WHERE length(l) > 1 AND length(to_tsvector('public.ns_pt'::regconfig, l)) > 0 AND l NOT IN (SELECT l FROM stop)
    ),
    tq AS (SELECT cfg, l, to_tsquery('simple', quote_literal(l)) AS t FROM terms),
    df AS (
      SELECT tq.cfg, tq.l, count(sc.id)::float8 AS df
        FROM tq
        LEFT JOIN sc ON (CASE WHEN tq.cfg = 'pt' THEN sc."tsvPt" ELSE sc."tsvSimple" END) @@ tq.t
       GROUP BY tq.cfg, tq.l
    ),
    w AS (
      SELECT tq.cfg, tq.t, ln(1 + (n.n - df.df + 0.5) / (df.df + 0.5)) AS idf
        FROM tq JOIN df ON df.cfg = tq.cfg AND df.l = tq.l CROSS JOIN n
    ),
    scored AS (
      SELECT sc.id, sc."documentId",
        coalesce(sum(w.idf * ts_rank('{0.1,0.2,0.4,1.0}', sc."tsvPt", w.t, 1)) FILTER (WHERE w.cfg = 'pt'), 0)::float8 AS r_pt,
        coalesce(sum(w.idf * ts_rank('{0.1,0.2,0.4,1.0}', sc."tsvSimple", w.t, 1)) FILTER (WHERE w.cfg = 'simple'), 0)::float8 AS r_simple,
        count(*) FILTER (WHERE w.cfg = 'pt') AS pt_hits
      FROM sc
      JOIN w ON (CASE WHEN w.cfg = 'pt' THEN sc."tsvPt" ELSE sc."tsvSimple" END) @@ w.t
      GROUP BY sc.id, sc."documentId"
    )
    SELECT s.id, s."documentId", s.r_pt, s.r_simple,
           (s.pt_hits > 0 AND s.pt_hits >= (SELECT count(*) FROM terms WHERE cfg = 'pt')) AS all_terms
    FROM scored s
    ORDER BY greatest(s.r_pt, s.r_simple) DESC, s.id
    LIMIT ${limit}`;
}

/**
 * Trigram só pra consulta CURTA (nome, código, termo com erro de digitação:
 * "NeuroMnidPro", "cohrot"). Em pergunta longa a similaridade com os rótulos
 * vira ruído — "afiliado dormente tier North" casava "NorthScale Afiliados".
 */
export function wantsTrigram(query: string): boolean {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 1);
  return words.length > 0 && words.length <= 3;
}

/**
 * Trigram no RÓTULO. Sem o operador <% (limiar por sessão exigiria
 * transação interativa): o volume de trechos no escopo é pequeno e a função
 * direto resolve.
 */
export function trigramSql(query: string, f: ScopeFilter, limit = 20, threshold = 0.35): Prisma.Sql {
  return Prisma.sql`
    SELECT s.id, s."documentId", s.sim FROM (
      SELECT c.id, c."documentId", word_similarity(${query}, c.label)::float8 AS sim
      FROM "KbChunk" c
      JOIN "KbDocument" d ON d.id = c."documentId" AND d.version = c."docVersion"
      WHERE ${scopeWhere(f)}
    ) s
    WHERE s.sim >= ${threshold}
    ORDER BY s.sim DESC, s.id
    LIMIT ${limit}`;
}

/** tsvector dos trechos de UMA versão (preenchido na mesma transação da indexação). */
export function tsvUpdateSql(documentId: string, version: number): Prisma.Sql {
  return Prisma.sql`
    UPDATE "KbChunk" SET
      "tsvPt" = setweight(to_tsvector('public.ns_pt'::regconfig, "label"), 'A')
             || setweight(to_tsvector('public.ns_pt'::regconfig, coalesce("context", '')), 'B')
             || setweight(to_tsvector('public.ns_pt'::regconfig, "content"), 'C'),
      "tsvSimple" = setweight(to_tsvector('public.ns_simple'::regconfig, "label"), 'A')
                 || setweight(to_tsvector('public.ns_simple'::regconfig, "content"), 'C')
    WHERE "documentId" = ${documentId} AND "docVersion" = ${version}`;
}

/**
 * Conta a recuperação por SQL cru de propósito: via Prisma o @updatedAt
 * mudaria, e updatedAt é o "atualizado em" das citações e a versão dos
 * caches da busca — não pode andar a cada consulta.
 */
export function hitTrackingSql(documentIds: string[]): Prisma.Sql {
  return Prisma.sql`
    UPDATE "KbDocument" SET "hitCount" = "hitCount" + 1, "lastRetrievedAt" = now()
    WHERE id = ANY(${documentIds}::text[])`;
}

export function knowledgeEntryHitSql(entryIds: string[]): Prisma.Sql {
  return Prisma.sql`UPDATE "KnowledgeEntry" SET "hitCount" = "hitCount" + 1 WHERE id = ANY(${entryIds}::text[])`;
}

/** Versão da base GLOBAL (invalida caches de denso/rerank quando algo muda). */
export const kbVersionSql = Prisma.sql`
  SELECT coalesce(max("updatedAt"), 'epoch'::timestamp)::text AS v, count(*)::int AS n
  FROM "KbDocument" WHERE scope = 'GLOBAL'`;

export const trigramAvailableSql = Prisma.sql`SELECT 1 AS ok FROM pg_extension WHERE extname = 'pg_trgm'`;
