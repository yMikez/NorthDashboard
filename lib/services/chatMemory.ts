// Memória automática do chat (v2). Depois de um turno de ADMIN, extrai 0–3
// fatos DURÁVEIS do que o USUÁRIO disse e grava como SUGESTÃO:
// KnowledgeEntry {source:'auto', status:'pending', pinned:false,
// enabled:false, evidence, confidence}. Só vira conhecimento depois que o
// admin aprova (aba de memórias da KB) — e aí entra na base PESQUISÁVEL como
// documento de menor autoridade, nunca no bloco fixo do prompt.
//
// Por que tão restrito (v1 gravava direto como "contexto autoritativo"):
// um palpite do assistente virava fato em todas as conversas de todo mundo,
// e se auto-reforçava. Agora, no servidor:
//   - fato só da fala do USUÁRIO: `evidence` tem de ser trecho LITERAL dela;
//   - número no fato tem de aparecer na fala (número de consulta não entra),
//     e número + período ("receita foi X em maio") é resultado, não regra;
//   - dado pessoal (e-mail, telefone, IP) recusa o fato;
//   - confiança < 0,7 ou parecido demais com memória existente = descarta.

import { ANTHROPIC_FAST_MODEL, getAnthropicClient } from './ai';
import { syncKnowledgeEntry } from './knowledge';
import { db } from '../db';
import { logger } from '../logger';
import { containsPii, foldForMatch } from '../rag/normalize';

const MAX_FACTS = 3;
const MAX_PENDING = 100;
const MAX_ACTIVE_AUTO = 200;
const MIN_CONFIDENCE = 0.7;
const DUPLICATE_SIMILARITY = 0.75;
const MIN_EVIDENCE_CHARS = 12;
const MIN_USER_CHARS = 15;

export const FACT_TYPES = ['rule', 'preference', 'definition', 'decision'] as const;
export const FACT_RELATIONS = ['new', 'duplicate_of', 'updates', 'contradicts'] as const;
export type FactType = (typeof FACT_TYPES)[number];
export type FactRelation = (typeof FACT_RELATIONS)[number];

export interface ExtractedFact {
  title: string;
  content: string;
  type: FactType;
  evidence: string;
  confidence: number;
  relation: FactRelation;
  target_id: string;
}

export interface MemoryLike {
  id: string;
  title: string;
  content: string;
}

export type RejectReason =
  | 'malformed'
  | 'low_confidence'
  | 'duplicate'
  | 'evidence_not_literal'
  | 'pii'
  | 'number_not_from_user'
  | 'query_result';

// ── Núcleo puro (testado) ────────────────────────────────────────────────

const STOPWORDS = new Set(
  'que para com uma por mais como mas dos das nos nas pelo pela isso esse essa este esta sao sempre quando onde muito tem ser ter foi vai ela ele eles elas voce nao sim the and for with from'.split(' '),
);

export function tokenSet(s: string): Set<string> {
  return new Set(
    foldForMatch(s)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/** Jaccard dos termos (sem acento/stopword). */
export function similarity(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function mostSimilar<T extends MemoryLike>(text: string, pool: T[], k = 5): Array<T & { score: number }> {
  return pool
    .map((m) => ({ ...m, score: similarity(text, `${m.title} ${m.content}`) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Números como sequência de dígitos (1.500 = 1,500 = 1500; 8,5 = 8.5). */
export function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, '')).filter(Boolean);
}

const PERIOD_RE =
  /\b(hoje|ontem|anteontem|semana|semanal|mes|mensal|trimestre|ano passado|este ano|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|ultimos? \d+ dias|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|20\d{2}-\d{2})\b/;

export function validateFact(raw: unknown, userText: string, existing: MemoryLike[]): { ok: true; fact: ExtractedFact } | { ok: false; reason: RejectReason } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'malformed' };
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 120) : '';
  const content = typeof r.content === 'string' ? r.content.trim().slice(0, 1000) : '';
  const evidence = typeof r.evidence === 'string' ? r.evidence.trim().slice(0, 500) : '';
  const confidence = Number(r.confidence);
  const type = (FACT_TYPES as readonly string[]).includes(r.type as string) ? (r.type as FactType) : null;
  const relation = (FACT_RELATIONS as readonly string[]).includes(r.relation as string) ? (r.relation as FactRelation) : 'new';
  if (!title || !content || !type || !Number.isFinite(confidence)) return { ok: false, reason: 'malformed' };
  if (confidence < MIN_CONFIDENCE) return { ok: false, reason: 'low_confidence' };
  if (relation === 'duplicate_of') return { ok: false, reason: 'duplicate' };

  const foldedUser = foldForMatch(userText);
  const foldedEvidence = foldForMatch(evidence).replace(/^"+|"+$/g, '').trim();
  if (foldedEvidence.length < MIN_EVIDENCE_CHARS || !foldedUser.includes(foldedEvidence)) return { ok: false, reason: 'evidence_not_literal' };
  if (containsPii(title) || containsPii(content) || containsPii(evidence)) return { ok: false, reason: 'pii' };

  const userNumbers = new Set(numbersIn(userText));
  const factNumbers = numbersIn(`${title} ${content}`);
  if (factNumbers.some((n) => !userNumbers.has(n))) return { ok: false, reason: 'number_not_from_user' };
  if (factNumbers.length && PERIOD_RE.test(foldForMatch(content))) return { ok: false, reason: 'query_result' };

  if (existing.some((m) => similarity(`${title} ${content}`, `${m.title} ${m.content}`) >= DUPLICATE_SIMILARITY)) {
    return { ok: false, reason: 'duplicate' };
  }
  return {
    ok: true,
    fact: { title, content, type, evidence, confidence, relation, target_id: typeof r.target_id === 'string' ? r.target_id : '' },
  };
}

/** Valida o lote (inclusive duplicata DENTRO do lote). */
export function validateFacts(raw: unknown[], userText: string, existing: MemoryLike[]) {
  const accepted: ExtractedFact[] = [];
  const rejected: Array<{ title: string; reason: RejectReason }> = [];
  for (const f of raw.slice(0, MAX_FACTS)) {
    const pool = [...existing, ...accepted.map((a, i) => ({ id: `new${i}`, title: a.title, content: a.content }))];
    const v = validateFact(f, userText, pool);
    if (v.ok) accepted.push(v.fact);
    else rejected.push({ title: String((f as { title?: unknown })?.title ?? ''), reason: v.reason });
  }
  return { accepted, rejected };
}

// ── Extração (modelo rápido, JSON por schema) ─────────────────────────────

const SYSTEM = `Você extrai MEMÓRIA DURÁVEL do que o USUÁRIO (operador de uma operação de marketing nutra com afiliados) disse numa conversa com um assistente de analytics.

A resposta do assistente é só CONTEXTO para entender a fala — NUNCA extraia fato dela.

Salve APENAS o que vale lembrar permanentemente e que o usuário AFIRMOU:
- rule: regra de negócio ("CPA válido é entre $200 e $290", "frete é por sessão, não por pedido")
- preference: como ele quer as respostas ("sempre mostrar a margem de contribuição junto")
- definition: definição/convenção da operação
- decision: decisão estratégica declarada ("vamos pausar afiliado com reembolso acima de 8%")

NÃO salve: resultado de consulta ou número do período, perguntas, pedidos pontuais, o óbvio de um dashboard de vendas, dado pessoal (nome de cliente, e-mail, telefone).

Para cada fato:
- title: 3–6 palavras; content: o fato em 1–2 frases autossuficientes;
- evidence: trecho COPIADO LITERALMENTE da fala do usuário que sustenta o fato (sem parafrasear);
- confidence: 0–1 (quão certo é que é durável e dito pelo usuário);
- relation com as memórias existentes listadas: new | duplicate_of | updates | contradicts, e target_id = id da memória relacionada ("" se new).
No máximo 3 fatos. Nada durável → facts: [].`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'content', 'type', 'evidence', 'confidence', 'relation', 'target_id'],
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          type: { type: 'string', enum: [...FACT_TYPES] },
          evidence: { type: 'string' },
          confidence: { type: 'number' },
          relation: { type: 'string', enum: [...FACT_RELATIONS] },
          target_id: { type: 'string' },
        },
      },
    },
  },
};

async function extractFacts(userText: string, assistantText: string, similar: MemoryLike[]): Promise<unknown[]> {
  const client = getAnthropicClient();
  const existing = similar.length ? similar.map((m) => `- [${m.id}] ${m.title}: ${m.content.slice(0, 300)}`).join('\n') : '(nenhuma parecida)';
  const resp = await client.messages.create(
    {
      model: ANTHROPIC_FAST_MODEL,
      max_tokens: 800,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `<memorias_existentes>\n${existing}\n</memorias_existentes>\n` +
            `<fala_do_usuario>\n${userText.slice(0, 4000)}\n</fala_do_usuario>\n` +
            `<resposta_do_assistente_so_contexto>\n${assistantText.slice(0, 1500)}\n</resposta_do_assistente_so_contexto>`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    },
    { timeout: 30_000, maxRetries: 1 },
  );
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const parsed = JSON.parse(text) as { facts?: unknown };
  return Array.isArray(parsed.facts) ? parsed.facts : [];
}

/**
 * Fire-and-forget após salvar a resposta (só turnos de ADMIN, sem anexos —
 * a rota decide). Erros são logados e engolidos: memória nunca quebra o chat.
 */
export async function extractAndSaveMemory(userText: string, assistantText: string): Promise<void> {
  try {
    if (userText.trim().length < MIN_USER_CHARS) return;
    const pool = await db.knowledgeEntry.findMany({
      where: { status: { in: ['active', 'pending'] } },
      select: { id: true, title: true, content: true },
    });
    const similar = mostSimilar(userText, pool, 5);
    const raw = await extractFacts(userText, assistantText ?? '', similar);
    if (!raw.length) return;
    const { accepted, rejected } = validateFacts(raw, userText, pool);
    if (rejected.length) logger.info({ rejected }, 'chatMemory: fatos recusados na validação');
    for (const f of accepted) {
      await db.knowledgeEntry.create({
        data: {
          title: f.title,
          content: f.content,
          source: 'auto',
          status: 'pending',
          pinned: false,
          enabled: false,
          evidence: f.evidence,
          confidence: f.confidence,
          sortOrder: 1000,
        },
      });
    }
    if (accepted.length) {
      await trimPending();
      logger.info({ created: accepted.length }, 'chatMemory: memórias sugeridas aguardando revisão');
    }
  } catch (err) {
    logger.error({ err }, 'chatMemory: extraction failed (non-fatal)');
  }
}

/** Fila de sugestões com teto: a mais antiga não revisada sai. */
async function trimPending(): Promise<void> {
  const n = await db.knowledgeEntry.count({ where: { source: 'auto', status: 'pending' } });
  if (n <= MAX_PENDING) return;
  const drop = await db.knowledgeEntry.findMany({
    where: { source: 'auto', status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: n - MAX_PENDING,
    select: { id: true },
  });
  await db.knowledgeEntry.deleteMany({ where: { id: { in: drop.map((d) => d.id) } } });
}

/**
 * Teto de memórias ATIVAS: sai a menos recuperada pela busca (hitCount) e,
 * no empate, a mais antiga — nunca "a mais antiga" pura (v1 derrubava regra
 * importante antiga antes de uma trivial nova).
 */
async function evictActive(): Promise<void> {
  const n = await db.knowledgeEntry.count({ where: { source: 'auto', status: 'active' } });
  if (n <= MAX_ACTIVE_AUTO) return;
  const drop = await db.knowledgeEntry.findMany({
    where: { source: 'auto', status: 'active' },
    orderBy: [{ hitCount: 'asc' }, { updatedAt: 'asc' }],
    take: n - MAX_ACTIVE_AUTO,
    select: { id: true },
  });
  for (const d of drop) {
    await db.knowledgeEntry.delete({ where: { id: d.id } });
    await syncKnowledgeEntry(d.id);
  }
}

/**
 * Memórias automáticas da v1 (gravadas ligadas e fixas, sem revisão) voltam
 * pra fila de revisão. Marca da v1: source 'auto' com pinned=true (a v2
 * nunca fixa, nem na aprovação) — então roda 1x e não desfaz aprovação.
 */
export async function demoteLegacyAutoMemories(): Promise<number> {
  const legacy = await db.knowledgeEntry.findMany({ where: { source: 'auto', pinned: true }, select: { id: true } });
  if (!legacy.length) return 0;
  await db.knowledgeEntry.updateMany({
    where: { id: { in: legacy.map((l) => l.id) } },
    data: { pinned: false, status: 'pending', enabled: false },
  });
  for (const l of legacy) await syncKnowledgeEntry(l.id);
  logger.info({ n: legacy.length }, 'chatMemory: memórias da v1 enviadas pra revisão do admin');
  return legacy.length;
}

// ── Revisão pelo admin ───────────────────────────────────────────────────

export type MemoryStatus = 'pending' | 'active' | 'rejected';

export interface MemoryDTO {
  id: string;
  title: string;
  content: string;
  evidence: string | null;
  confidence: number | null;
  status: string;
  createdAt: string;
  /** Entradas parecidas (pra decidir duplicata/atualização/contradição). */
  similar: Array<{ id: string; title: string; status: string; score: number }>;
}

export async function listMemories(status: MemoryStatus): Promise<MemoryDTO[]> {
  const [rows, pool] = await Promise.all([
    db.knowledgeEntry.findMany({ where: { source: 'auto', status }, orderBy: { createdAt: 'desc' }, take: 300 }),
    db.knowledgeEntry.findMany({ where: { status: { in: ['active', 'pending'] } }, select: { id: true, title: true, content: true, status: true } }),
  ]);
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    content: m.content,
    evidence: m.evidence,
    confidence: m.confidence,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    similar: mostSimilar(`${m.title} ${m.content}`, pool.filter((p) => p.id !== m.id), 3)
      .filter((s) => s.score >= 0.2)
      .map((s) => ({ id: s.id, title: s.title, status: s.status, score: Math.round(s.score * 100) / 100 })),
  }));
}

export class MemoryReviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Aprovar = ativa (pesquisável, nunca fixa); rejeitar = sai de tudo. */
export async function reviewMemory(id: string, patch: { status: 'active' | 'rejected'; title?: string; content?: string }): Promise<MemoryDTO> {
  const current = await db.knowledgeEntry.findUnique({ where: { id } });
  if (!current || current.source !== 'auto') throw new MemoryReviewError('memória não encontrada', 404);
  const title = patch.title?.trim();
  const content = patch.content?.trim();
  if (patch.title !== undefined && !title) throw new MemoryReviewError('title não pode ficar vazio', 400);
  if (patch.content !== undefined && !content) throw new MemoryReviewError('content não pode ficar vazio', 400);
  const updated = await db.knowledgeEntry.update({
    where: { id },
    data:
      patch.status === 'active'
        ? { status: 'active', enabled: true, pinned: false, ...(title ? { title } : {}), ...(content ? { content } : {}) }
        : { status: 'rejected', enabled: false, pinned: false },
  });
  await syncKnowledgeEntry(id);
  if (patch.status === 'active') await evictActive();
  return {
    id: updated.id,
    title: updated.title,
    content: updated.content,
    evidence: updated.evidence,
    confidence: updated.confidence,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
    similar: [],
  };
}
