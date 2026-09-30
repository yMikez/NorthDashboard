// Seed da base GLOBAL a partir de docs/kb (lista em seedManifest.ts).
//
// Roda em SEGUNDO PLANO depois do boot (instrumentation.ts) — nunca segura a
// subida do servidor — e também sob demanda (POST /api/admin/kb/seed).
// Idempotente por sha256: arquivo igual = nada acontece; mudou = version+1
// e reindexação transacional; saiu do manifesto = sai da base.
// De carona: espelha as entradas do admin na base pesquisável (backfill das
// que existiam antes do RAG) e manda as memórias automáticas da v1 pra
// revisão.

import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db';
import { logger } from '../logger';
import { demoteLegacyAutoMemories } from '../services/chatMemory';
import { invalidateKnowledgeCache, syncAllKnowledgeEntries } from '../services/knowledge';
import { upsertGlobalDocument, type UpsertAction } from './indexer';
import { bumpKbVersion } from './search/state';
import { KB_DOC_KINDS, KB_SEED_DIR, SEED_DOCS, type KbDocKind } from './seedManifest';

export interface SeedDoc {
  file: string;
  title: string;
  kind: KbDocKind;
  description: string;
  effectiveDate: Date | null;
  body: string;
}

/** Frontmatter mínimo `chave: valor` entre `---` (sem YAML aninhado). */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    meta[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Lê e valida um documento do manifesto (lança com mensagem clara). */
export function toSeedDoc(file: string, raw: string): SeedDoc {
  const { meta, body } = parseFrontmatter(raw);
  const kind = meta.kind as KbDocKind;
  if (!meta.title) throw new Error(`${file}: frontmatter sem title`);
  if (!(KB_DOC_KINDS as readonly string[]).includes(kind)) throw new Error(`${file}: kind inválido (${meta.kind ?? 'vazio'})`);
  if (!meta.description) throw new Error(`${file}: frontmatter sem description`);
  let effectiveDate: Date | null = null;
  if (meta.effectiveDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.effectiveDate) || Number.isNaN(Date.parse(meta.effectiveDate))) {
      throw new Error(`${file}: effectiveDate deve ser YYYY-MM-DD`);
    }
    effectiveDate = new Date(`${meta.effectiveDate}T12:00:00.000Z`);
  }
  if (!body.trim()) throw new Error(`${file}: corpo vazio`);
  return { file, title: meta.title, kind, description: meta.description, effectiveDate, body };
}

export interface SeedReportItem {
  file: string;
  action: UpsertAction | 'removed' | 'failed';
  chunks?: number;
  error?: string;
}

export interface SeedStatus {
  running: boolean;
  lastSeedAt: string | null;
  lastResults: SeedReportItem[];
  lastError: string | null;
}

const status: SeedStatus = { running: false, lastSeedAt: null, lastResults: [], lastError: null };
let inFlight: Promise<SeedReportItem[]> | null = null;

export function getSeedStatus(): SeedStatus {
  return { ...status, lastResults: [...status.lastResults] };
}

async function runSeed(dir: string): Promise<SeedReportItem[]> {
  const results: SeedReportItem[] = [];
  await demoteLegacyAutoMemories();
  for (const file of SEED_DOCS) {
    try {
      const doc = toSeedDoc(file, await fs.readFile(path.join(dir, file), 'utf8'));
      const r = await upsertGlobalDocument({
        sourceType: 'repo_md',
        sourceRef: `${KB_SEED_DIR}/${file}`,
        kind: doc.kind,
        title: doc.title,
        description: doc.description,
        text: doc.body,
        mimeType: 'text/markdown',
        fileName: file,
        effectiveDate: doc.effectiveDate,
      });
      results.push({ file, action: r.error ? 'failed' : r.action, chunks: r.chunks, ...(r.error ? { error: r.error } : {}) });
    } catch (err) {
      results.push({ file, action: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }
  const keep = SEED_DOCS.map((f) => `${KB_SEED_DIR}/${f}`);
  const gone = await db.kbDocument.findMany({
    where: { scope: 'GLOBAL', sourceType: 'repo_md', sourceRef: { notIn: keep } },
    select: { id: true, sourceRef: true },
  });
  if (gone.length) {
    await db.kbDocument.deleteMany({ where: { id: { in: gone.map((g) => g.id) } } });
    for (const g of gone) results.push({ file: g.sourceRef ?? g.id, action: 'removed' });
    bumpKbVersion();
  }
  await syncAllKnowledgeEntries();
  invalidateKnowledgeCache();
  return results;
}

/** Roda o seed (um por vez: chamada concorrente reaproveita a que está rodando). */
export function seedKnowledgeBase(dir = path.join(process.cwd(), KB_SEED_DIR)): Promise<SeedReportItem[]> {
  if (inFlight) return inFlight;
  status.running = true;
  inFlight = runSeed(dir)
    .then((results) => {
      status.lastResults = results;
      status.lastSeedAt = new Date().toISOString();
      status.lastError = null;
      const changed = results.filter((r) => r.action !== 'unchanged');
      const failed = results.filter((r) => r.action === 'failed');
      if (failed.length) logger.warn({ failed }, '[kb-seed] documentos com falha');
      logger.info({ total: results.length, changed: changed.length }, '[kb-seed] base de conhecimento sincronizada');
      return results;
    })
    .catch((err) => {
      status.lastError = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[kb-seed] seed falhou');
      throw err;
    })
    .finally(() => {
      status.running = false;
      inFlight = null;
    });
  return inFlight;
}

let scheduled = false;

/**
 * Armado no boot: espera o servidor subir (migrate deploy já rodou no CMD)
 * e sincroniza em segundo plano. Erro só vai pro log.
 */
export function scheduleKnowledgeSeed(delayMs = 20_000): void {
  if (scheduled) return;
  scheduled = true;
  const t = setTimeout(() => {
    seedKnowledgeBase().catch(() => undefined);
  }, delayMs);
  t.unref?.();
}
