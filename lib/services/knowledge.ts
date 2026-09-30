// Base de conhecimento do chat IA — o que vai FIXO no system prompt e o
// espelho das entradas do admin na base pesquisável.
//
// Bloco fixo (cacheado no prompt, só muda quando o admin edita):
//   1. entradas do admin pinned && enabled && status 'active', até ~24k
//      caracteres (≈ 6k tokens); o que passa do teto fica SÓ na busca;
//   2. "# Índice da base pesquisável": título + 1 linha de cada documento
//      GLOBAL ligado — o modelo sabe o que existe pra buscar (search_knowledge).
// Memória automática NUNCA entra aqui (decisão do dono): aprovada, vira
// documento pesquisável de menor autoridade.
//
// Cache em memória curto (60s); os endpoints admin invalidam após mutar.

import type { KbDocument, KnowledgeEntry } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { deleteGlobalDocument, upsertGlobalDocument } from '../rag/indexer';

export const PINNED_MAX_CHARS = Number(process.env.KB_PINNED_MAX_CHARS) > 0 ? Number(process.env.KB_PINNED_MAX_CHARS) : 24_000;
const INDEX_MAX_CHARS = 6_000;
const CACHE_TTL_MS = 60 * 1000;

interface KnowledgeCache {
  promptBlock: string;
  pinnedChars: number;
  overflowIds: string[];
  loadedAt: number;
}

let cache: KnowledgeCache | null = null;

export function invalidateKnowledgeCache(): void {
  cache = null;
}

export interface PinnedEntry {
  id: string;
  title: string;
  content: string;
}

export interface IndexDoc {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  sourceType: string;
  sourceRef: string | null;
}

const KIND_ORDER = ['policy', 'reference', 'playbook', 'snapshot', 'knowledge_entry'];
const KIND_TAG: Record<string, string> = {
  policy: 'política',
  reference: 'referência',
  playbook: 'playbook',
  snapshot: 'retrato datado',
  knowledge_entry: 'entrada do admin',
};

export interface KnowledgeBlock {
  text: string;
  pinnedChars: number;
  /** Entradas fixas que não couberam no teto (seguem pesquisáveis). */
  overflowIds: string[];
}

/** Puro: monta o bloco a partir das entradas fixas e do índice. */
export function buildKnowledgeBlock(
  entries: PinnedEntry[],
  docs: IndexDoc[],
  opts: { maxPinnedChars?: number; memoryCount?: number } = {},
): KnowledgeBlock {
  const max = opts.maxPinnedChars ?? PINNED_MAX_CHARS;
  const pinned: string[] = [];
  const included = new Set<string>();
  const overflow: PinnedEntry[] = [];
  let used = 0;
  for (const e of entries) {
    const piece = `## ${e.title.trim()}\n\n${e.content.trim()}`;
    const cost = piece.length + (pinned.length ? 7 : 0);
    // Não cabe: pula e segue (uma entrada pequena depois ainda pode caber);
    // a que ficou de fora continua achável pela busca.
    if (used + cost > max) {
      overflow.push(e);
      continue;
    }
    pinned.push(piece);
    included.add(e.id);
    used += cost;
  }

  const lines: string[] = [];
  const sorted = [...docs]
    // Entrada fixa que já está inteira no bloco não precisa aparecer no índice.
    .filter((d) => !(d.sourceType === 'knowledge_entry' && d.sourceRef && included.has(d.sourceRef)))
    .sort((a, b) => {
      const ka = KIND_ORDER.indexOf(a.kind);
      const kb = KIND_ORDER.indexOf(b.kind);
      return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb) || a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id);
    });
  let indexChars = 0;
  let hidden = 0;
  for (const d of sorted) {
    const desc = (d.description ?? '').replace(/\s+/g, ' ').trim();
    const line = `- ${d.title.trim()} (${KIND_TAG[d.kind] ?? d.kind})${desc ? ` — ${desc}` : ''}`;
    if (indexChars + line.length > INDEX_MAX_CHARS) {
      hidden++;
      continue;
    }
    lines.push(line);
    indexChars += line.length + 1;
  }
  if (hidden) lines.push(`- (+${hidden} documentos — use search_knowledge)`);
  if (opts.memoryCount) lines.push(`- Memórias aprovadas pelo admin: ${opts.memoryCount} (menor autoridade; aparecem na busca)`);

  const parts: string[] = [];
  if (pinned.length) parts.push(pinned.join('\n\n---\n\n'));
  if (overflow.length) {
    parts.push(`_(${overflow.length} entrada(s) fixa(s) passaram do teto do prompt e ficam só na busca: ${overflow.map((e) => `"${e.title}"`).join(', ')})_`);
  }
  if (lines.length) {
    parts.push(
      '# Índice da base pesquisável\n' +
        'Documentos que search_knowledge encontra — use para definição, regra, fórmula, metodologia e ressalva, e cite o trecho:\n' +
        lines.join('\n'),
    );
  }
  return { text: parts.join('\n\n'), pinnedChars: used, overflowIds: overflow.map((e) => e.id) };
}

async function load(): Promise<KnowledgeCache> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const [entries, docs, memoryCount] = await Promise.all([
    db.knowledgeEntry.findMany({
      where: { pinned: true, enabled: true, status: 'active', NOT: { source: 'auto' } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, content: true },
    }),
    db.kbDocument.findMany({
      where: { scope: 'GLOBAL', enabled: true, status: 'READY', kind: { not: 'memory' } },
      select: { id: true, title: true, description: true, kind: true, sourceType: true, sourceRef: true },
    }),
    db.kbDocument.count({ where: { scope: 'GLOBAL', enabled: true, status: 'READY', kind: 'memory' } }),
  ]);
  const block = buildKnowledgeBlock(entries, docs, { memoryCount });
  cache = { promptBlock: block.text, pinnedChars: block.pinnedChars, overflowIds: block.overflowIds, loadedAt: Date.now() };
  return cache;
}

/**
 * Bloco markdown do system (entradas fixas + índice). Vazio quando não há
 * nada — quem chama decide se injeta a seção.
 */
export async function getKnowledgePromptBlock(): Promise<string> {
  return (await load()).promptBlock;
}

/** Medidor do teto das fixas (aba de admin). */
export async function getPinnedUsage(): Promise<{ pinnedChars: number; pinnedMaxChars: number; overflowIds: string[] }> {
  const c = await load();
  return { pinnedChars: c.pinnedChars, pinnedMaxChars: PINNED_MAX_CHARS, overflowIds: c.overflowIds };
}

// ── Espelho KnowledgeEntry → KbDocument pesquisável ──────────────────────

const MIRROR_TYPES = ['knowledge_entry', 'chat_memory'] as const;

function firstLine(content: string): string {
  const line = content.split('\n').map((l) => l.replace(/^[#>\-*\s]+/, '').trim()).find(Boolean) ?? '';
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

type EntryForMirror = Pick<KnowledgeEntry, 'id' | 'title' | 'content' | 'source' | 'evidence' | 'createdAt'>;

/** Texto do documento espelhado (puro — o hash dele decide se reindexa). */
export function mirrorText(e: EntryForMirror): string {
  if (e.source !== 'auto') return `# ${e.title.trim()}\n\n${e.content.trim()}`;
  const evidence = e.evidence?.trim() ? `\n\n> Dito pelo usuário: "${e.evidence.trim()}"` : '';
  return `# Memória — ${e.title.trim()}\n\n${e.content.trim()}${evidence}\n\n_Memória aprovada pelo admin em conversa de ${e.createdAt.toISOString().slice(0, 10)}; menor autoridade que as políticas da base._`;
}

/**
 * Espelha UMA entrada na base pesquisável (e reindexa se mudou). Entrada
 * inexistente, desligada, pendente ou rejeitada sai da busca. Chamado por
 * POST/PATCH/DELETE de /api/admin/knowledge*, pelo seed do glossário e pela
 * revisão de memórias.
 */
export async function syncKnowledgeEntry(id: string): Promise<void> {
  const e = await db.knowledgeEntry.findUnique({
    where: { id },
    select: { id: true, title: true, content: true, source: true, evidence: true, createdAt: true, enabled: true, status: true },
  });
  if (!e || !e.enabled || e.status !== 'active') {
    await Promise.all(MIRROR_TYPES.map((t) => deleteGlobalDocument(t, id)));
  } else {
    const isMemory = e.source === 'auto';
    // Se a origem mudou de tipo (não deveria), o espelho do outro tipo some.
    await deleteGlobalDocument(isMemory ? 'knowledge_entry' : 'chat_memory', id);
    const r = await upsertGlobalDocument(
      {
        sourceType: isMemory ? 'chat_memory' : 'knowledge_entry',
        sourceRef: id,
        kind: isMemory ? 'memory' : 'knowledge_entry',
        title: isMemory ? `Memória — ${e.title.trim()}` : e.title.trim(),
        description: firstLine(e.content),
        text: mirrorText(e),
        mimeType: 'text/markdown',
        effectiveDate: isMemory ? e.createdAt : null,
        // Sem `enabled`: o espelho nasce ligado (entrada desligada/pendente
        // apaga o espelho acima), e o liga/desliga que o admin fizer na aba
        // Documentos sobrevive ao próximo sync/seed.
      },
      // Entrada curta: o rótulo já diz do que é — contexto do modelo não paga.
      { contextualize: false },
    );
    if (r.error) logger.warn({ id, err: r.error }, '[knowledge] espelho da entrada falhou na indexação');
  }
  invalidateKnowledgeCache();
}

/** Espelha todas as entradas (backfill idempotente: sem mudança = no-op). */
export async function syncAllKnowledgeEntries(): Promise<number> {
  const ids = await db.knowledgeEntry.findMany({ select: { id: true } });
  const orphan = await db.kbDocument.findMany({
    where: { scope: 'GLOBAL', sourceType: { in: [...MIRROR_TYPES] }, sourceRef: { notIn: ids.map((i) => i.id) } },
    select: { id: true },
  });
  if (orphan.length) await db.kbDocument.deleteMany({ where: { id: { in: orphan.map((o) => o.id) } } });
  for (const { id } of ids) await syncKnowledgeEntry(id);
  return ids.length;
}

// ── DTO dos documentos pra aba admin ─────────────────────────────────────

export interface KbDocumentDTO {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  sourceType: string;
  sourceRef: string | null;
  mimeType: string;
  fileName: string | null;
  status: string;
  error: string | null;
  enabled: boolean;
  chunks: number;
  version: number;
  effectiveDate: string | null;
  updatedAt: string;
  hitCount: number;
}

export type KbDocumentRow = Pick<
  KbDocument,
  'id' | 'title' | 'description' | 'kind' | 'sourceType' | 'sourceRef' | 'mimeType' | 'fileName' | 'status' | 'error' | 'enabled' | 'version' | 'effectiveDate' | 'updatedAt' | 'hitCount'
> & { _count?: { chunks: number } };

export const KB_DOCUMENT_SELECT = {
  id: true, title: true, description: true, kind: true, sourceType: true, sourceRef: true, mimeType: true, fileName: true,
  status: true, error: true, enabled: true, version: true, effectiveDate: true, updatedAt: true, hitCount: true,
  _count: { select: { chunks: true } },
} as const;

export function toKbDocumentDTO(d: KbDocumentRow): KbDocumentDTO {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    kind: d.kind,
    sourceType: d.sourceType,
    sourceRef: d.sourceRef,
    mimeType: d.mimeType,
    fileName: d.fileName,
    status: d.status,
    error: d.error,
    enabled: d.enabled,
    chunks: d._count?.chunks ?? 0,
    version: d.version,
    effectiveDate: d.effectiveDate ? d.effectiveDate.toISOString().slice(0, 10) : null,
    updatedAt: d.updatedAt.toISOString(),
    hitCount: d.hitCount,
  };
}

/** Documento que é espelho (entrada/memória) ou arquivo do repo: edita-se na origem. */
export function kbDocumentOrigin(sourceType: string): 'mirror' | 'repo' | 'upload' {
  if ((MIRROR_TYPES as readonly string[]).includes(sourceType)) return 'mirror';
  if (sourceType === 'repo_md') return 'repo';
  return 'upload';
}
