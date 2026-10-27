import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined; prismaRead: PrismaClient | undefined };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

// ---------- Fonte das métricas (dados oficiais) ----------
//
// METRICS_SOURCE=public (padrão): tudo lê o schema public, como sempre.
// METRICS_SOURCE=oficial: as telas de métricas leem o schema `painel`, que
// junta o dado validado do time de dados (schema dados_oficiais: JVZoo,
// Logicall, Tauk, SalesBound) com o resto do public (lib/painel/ddl.ts).
// Voltar atrás = trocar a variável e reiniciar o container.
//
// Escrita (ingest, conectores, cadastros) SEMPRE usa `db`. `dbRead` é só
// pra leitura de métrica — com a flag desligada ele É o `db`.

export type MetricsSource = 'public' | 'oficial';

/**
 * Gravado pelo passo de boot (scripts/painelSchema.ts --boot) quando o
 * schema painel ficou montado. Sem ele a flag não liga: se o painel falhar
 * no boot, as telas seguem no public em vez de cair.
 */
export const PAINEL_READY_FILE = process.env.PAINEL_READY_FILE ?? '/tmp/painel-pronto';

let warnedNotReady = false;

export function metricsSource(): MetricsSource {
  if (process.env.METRICS_SOURCE !== 'oficial') return 'public';
  if (existsSync(PAINEL_READY_FILE)) return 'oficial';
  // Só avisa no servidor: os scripts do boot (backfill, seedAdmin) rodam antes
  // do painel ficar pronto e não leem métrica.
  if (!warnedNotReady && process.env.NEXT_RUNTIME) {
    warnedNotReady = true;
    console.error(`[db] METRICS_SOURCE=oficial mas o painel não ficou pronto no boot (${PAINEL_READY_FILE}) — lendo do public.`);
  }
  return 'public';
}

/** DATABASE_URL apontando pro schema `painel` (o Prisma põe o search_path nele). */
export function painelDatabaseUrl(url = process.env.DATABASE_URL ?? ''): string {
  if (!url) return url;
  const u = new URL(url);
  u.searchParams.set('schema', 'painel');
  return u.toString();
}

export const dbRead: PrismaClient =
  metricsSource() === 'oficial'
    ? (globalForPrisma.prismaRead ??= new PrismaClient({
        datasources: { db: { url: painelDatabaseUrl() } },
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      }))
    : db;
