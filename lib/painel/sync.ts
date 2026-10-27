// Monta/atualiza o schema `painel` a partir do retrato vivo do banco
// (lib/painel/ddl.ts tem as regras). Idempotente: o hash dos comandos fica
// no comentário do schema e, se nada mudou, não mexe em nada. Quando muda
// (migração nova no public, coluna nova no oficial, MV redefinida), monta
// tudo em `painel_novo` e troca pelo `painel` numa transação só — quem está
// lendo nunca vê um schema pela metade.

import { createHash } from 'node:crypto';
import {
  buildPainelDdl, swapSql, DEFAULT_PAINEL_OPTIONS,
  type Column, type PainelOptions, type PainelSnapshot,
} from './ddl';

/** O mínimo que o sync precisa do banco (Prisma em produção, PGlite nos testes). */
export interface SqlRunner {
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Roda os comandos em ordem numa transação só (mesma conexão — o SET LOCAL vale até o fim). */
  transaction(statements: string[]): Promise<void>;
}

const BUILD_SCHEMA = 'painel_novo';
const MERGED_OFICIAL = ['Order', 'CallCenterSale', 'SalesboundTransaction', 'Product', 'Affiliate', 'Platform'];

export async function introspectPainel(run: SqlRunner): Promise<PainelSnapshot> {
  // Tipo qualificado à mão: o format_type omitiria o "public." (está no
  // search_path) e, no schema novo, "OrderStatus" resolveria pro DOMAIN.
  const cols = await run.query<{ tbl: string; name: string; type: string }>(`
    SELECT c.relname AS tbl, a.attname AS name,
           CASE WHEN tn.nspname = 'public' THEN 'public.' || quote_ident(t.typname)
                ELSE format_type(a.atttypid, a.atttypmod) END AS type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = t.typnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
      AND c.relname <> '_prisma_migrations'
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`);
  const publicTables: Record<string, Column[]> = {};
  for (const r of cols) (publicTables[r.tbl] ??= []).push({ name: r.name, type: r.type });

  const ofi = await run.query<{ tbl: string; name: string }>(`
    SELECT c.relname AS tbl, a.attname AS name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'dados_oficiais' AND c.relkind IN ('r', 'p', 'v')
      AND c.relname IN (${MERGED_OFICIAL.map((t) => `'${t}'`).join(', ')})
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`);
  const oficialTables: Record<string, string[]> = {};
  for (const r of ofi) (oficialTables[r.tbl] ??= []).push(r.name);

  const enumRows = await run.query<{ name: string; label: string }>(`
    SELECT t.typname AS name, e.enumlabel AS label
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public' ORDER BY t.typname, e.enumsortorder`);
  const enums: Record<string, string[]> = {};
  for (const r of enumRows) (enums[r.name] ??= []).push(r.label);

  // Definição sem schema: só é verdade com o public no search_path (padrão
  // de qualquer conexão do app). Ordem: daily_metrics antes de lead_summary
  // (nenhuma depende da outra hoje; alfabética deixa o hash estável).
  const mvs = await run.query<{ name: string; definition: string }>(`
    SELECT c.relname AS name, pg_get_viewdef(c.oid, true) AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'm' ORDER BY 1`);
  const idx = await run.query<{ tbl: string; def: string }>(`
    SELECT tablename AS tbl, indexdef AS def FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN (SELECT matviewname FROM pg_matviews WHERE schemaname = 'public')
    ORDER BY tablename, indexname`);
  const matviews = mvs.map((m) => ({
    name: m.name,
    definition: m.definition,
    indexes: idx.filter((i) => i.tbl === m.name).map((i) => i.def),
  }));

  return { publicTables, oficialTables, enums, matviews };
}

export function ddlHash(statements: string[]): string {
  return createHash('sha256').update(statements.join(';\n')).digest('hex').slice(0, 16);
}

export interface PainelSyncResult { changed: boolean; hash: string; statements: number; ms: number }

/** Comandos que montariam o painel hoje (pra revisar antes de aplicar). */
export async function planPainel(run: SqlRunner, opts: PainelOptions = DEFAULT_PAINEL_OPTIONS) {
  const snap = await introspectPainel(run);
  if (!snap.oficialTables.Order) throw new Error('schema dados_oficiais sem a tabela Order — nada pra montar');
  const statements = buildPainelDdl(snap, BUILD_SCHEMA, opts);
  return { snap, statements, hash: ddlHash(statements) };
}

export async function currentPainelHash(run: SqlRunner): Promise<string | null> {
  const r = await run.query<{ c: string | null }>(
    `SELECT obj_description(oid, 'pg_namespace') AS c FROM pg_namespace WHERE nspname = 'painel'`,
  );
  const c = r[0]?.c ?? null;
  return c?.startsWith('ddl:') ? c.slice(4) : null;
}

export async function syncPainel(
  run: SqlRunner,
  { force = false, opts = DEFAULT_PAINEL_OPTIONS }: { force?: boolean; opts?: PainelOptions } = {},
): Promise<PainelSyncResult> {
  const t0 = Date.now();
  const { statements, hash } = await planPainel(run, opts);
  if (!force && (await currentPainelHash(run)) === hash) {
    return { changed: false, hash, statements: statements.length, ms: Date.now() - t0 };
  }
  await run.transaction([...statements, ...swapSql(BUILD_SCHEMA, hash)]);
  return { changed: true, hash, statements: statements.length, ms: Date.now() - t0 };
}

/** Opções vindas do ambiente (PAINEL_SESSAO=oficial, PAINEL_TEMPO_REAL=0). */
export function painelOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): PainelOptions {
  return {
    sessao: env.PAINEL_SESSAO === 'oficial' ? 'oficial' : 'painel',
    tempoReal: env.PAINEL_TEMPO_REAL !== '0',
  };
}
