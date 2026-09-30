// Núcleo puro do painel admin da IA (KnowledgeSheet): tipos das APIs admin,
// formatação, mensagens de erro em PT-BR e normalização das respostas.
//
// Sem React e sem fetch — roda no vitest (ambiente node). As APIs admin
// (base de conhecimento, qualidade, avaliação) são escritas por outras
// unidades; os normalizadores daqui aceitam as variações de forma que o
// contrato deixa em aberto (trace, checks, summary) e devolvem "—" em vez
// de um número chutado quando o campo não vem — DS1 "dado com contexto":
// nunca um número que parece certo e não está.
//
// Unidade (mesmo contrato de lib/chat/format.ts): campo `*Pct` = PONTOS
// PERCENTUAIS (12.3 → "12.3%"); `*Rate`/`*Ratio`/`confidence` = FRAÇÃO 0–1.
// Nada de heurística "≤ 1 então ×100" — foi ela que transformou 0.8% em 80%.
//
// Números no padrão americano (decisão do dono): $1,234.56 · 12.3%.

import type { Block } from '@/types/chat';
import { stripCiteMarkers } from '../../../lib/rag/citations';

// ── Tipos das APIs admin (CONTRACTS §4) ───────────────────────────────────

export interface KnowledgeEntryDTO {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  /** 'manual' (admin) | 'auto' (memória aprovada). */
  source: string;
  sortOrder: number;
  /** true = vai inteira no system; false = só pela busca. */
  pinned?: boolean;
  /** active | pending | rejected — ausente em linhas antigas = active. */
  status?: string;
  evidence?: string | null;
  confidence?: number | null;
  hitCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface KbStats {
  pinnedChars: number;
  pinnedMaxChars: number;
  documents: number;
  chunks: number;
  lastSeedAt: string | null;
  trigram: boolean;
  dense: boolean;
}

export type KbDocStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';

export interface KbDocumentDTO {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  sourceType: string;
  sourceRef: string | null;
  mimeType: string;
  fileName: string | null;
  status: KbDocStatus;
  error: string | null;
  enabled: boolean;
  chunks: number;
  version: number;
  effectiveDate: string | null;
  updatedAt: string;
  hitCount: number;
}

export type MemoryStatus = 'pending' | 'active' | 'rejected';

export interface MemoryDTO {
  id: string;
  title: string;
  content: string;
  evidence: string | null;
  confidence: number | null;
  status: string;
  createdAt: string;
}

export interface PassageDTO {
  documentId: string;
  chunkIds: string[];
  docTitle: string;
  headingPath: string;
  label: string;
  text: string;
  page?: number | null;
  pageEnd?: number | null;
  kind: string;
  scope: string;
  updatedAt: string;
  effectiveDate?: string | null;
  docVersion?: number;
  score: number;
  ranks?: Record<string, unknown> | null;
}

/** Diagnóstico da busca (só no "Testar busca"): expansão e contagens. */
export interface SearchDebugDTO {
  queries?: Array<{ text: string; weight: number; original: boolean }>;
  candidates?: number;
  reranked?: boolean;
  trigram?: boolean;
  dense?: boolean;
  ms?: number;
}

/** "p. 3" ou "p. 3–5" (passagem que junta trechos de páginas vizinhas). */
export function pageRange(page: number | null | undefined, pageEnd?: number | null): string | null {
  if (!finite(page)) return null;
  return finite(pageEnd) && pageEnd > page ? `p. ${fmtInt(page)}–${fmtInt(pageEnd)}` : `p. ${fmtInt(page)}`;
}

export interface QualitySummary {
  turns: number;
  thumbsUp: number;
  thumbsDown: number;
  latencyP50: number | null;
  latencyP95: number | null;
  ttftP50: number | null;
  costUsd: number | null;
  /** Leitura de cache / entrada total (fração). */
  cacheHitRatio: number | null;
  /** Mesma razão só na 1ª rodada — mede o cache ENTRE turnos. */
  cacheHitRatioFirstRound?: number | null;
  /** Turnos com algum resultado de tool cortado pelo teto (pp). */
  truncatedPct: number | null;
  /** Turnos cuja RESPOSTA parou no limite de saída (pp). */
  outputTruncatedPct?: number | null;
  forcedFinalPct: number | null;
  toolErrorRate: number | null;
  ungroundedPct: number | null;
  byTool: Array<{ name: string; calls: number; errors: number; avgBytes: number | null; avgMs: number | null }>;
  byDay: Array<{ day: string; turns: number; costUsd: number | null; thumbsDown: number; thumbsUp?: number }>;
  byPromptVersion?: Array<{ promptVersion: string; turns: number; costUsd: number | null; thumbsDown: number; firstSeen: string }>;
}

export interface FeedbackItem {
  id: string;
  rating: number;
  reasons: string[];
  comment: string | null;
  expected: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  question: string | null;
  /** Contexto do turno gravado na pergunta (agora BRT + estado da UI). */
  questionContext?: string | null;
  /** Texto da resposta (ou `{content, blocks}`). */
  answer: unknown;
  /** Blocos da resposta, quando a rota manda à parte. */
  answerBlocks?: unknown;
  trace: unknown;
}

/** Resposta do feedback no formato do ReadOnlyAnswer (texto + blocos à parte). */
export function feedbackAnswer(item: Pick<FeedbackItem, 'answer' | 'answerBlocks'>): unknown {
  if (typeof item.answer === 'string' && item.answerBlocks !== undefined) {
    return { content: item.answer, blocks: item.answerBlocks };
  }
  return item.answer;
}

export interface EvalRunDTO {
  id: string;
  status: string;
  trigger?: string | null;
  createdBy?: string | null;
  config: unknown;
  summary: unknown;
  costUsd: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface EvalResultDTO {
  id: string;
  caseSlug: string;
  rep: number;
  status: string;
  score: number | null;
  checks: unknown;
  answer: string | null;
  trace?: unknown;
  usage?: unknown;
  latencyMs?: number | null;
}

// ── Rótulos ───────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export const DOC_STATUS: Record<KbDocStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Na fila', tone: 'neutral' },
  PROCESSING: { label: 'Indexando', tone: 'neutral' },
  READY: { label: 'Pronto', tone: 'success' },
  FAILED: { label: 'Falhou', tone: 'danger' },
  EXPIRED: { label: 'Expirado', tone: 'warning' },
};

/** Estados em que o documento ainda vai mudar sozinho (a lista acompanha). */
export function isDocInFlight(status: string): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}

export const KIND_LABEL: Record<string, string> = {
  policy: 'Política',
  reference: 'Referência',
  snapshot: 'Retrato datado',
  playbook: 'Playbook',
  memory: 'Memória',
  knowledge_entry: 'Entrada fixa',
  attachment: 'Anexo',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Tipos que o admin escolhe no upload (os demais nascem de outras abas). */
export const UPLOAD_KINDS = [
  { id: 'policy', label: 'Política', hint: 'Regra ou definição oficial da operação' },
  { id: 'reference', label: 'Referência', hint: 'Material de consulta' },
  { id: 'snapshot', label: 'Retrato datado', hint: 'Fatos válidos numa data — informe a vigência' },
  { id: 'playbook', label: 'Playbook', hint: 'Passo a passo de análise' },
] as const;

export type UploadKind = (typeof UPLOAD_KINDS)[number]['id'];

export function isUploadKind(kind: string): kind is UploadKind {
  return UPLOAD_KINDS.some((k) => k.id === kind);
}

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  repo_md: 'Repositório',
  upload: 'Upload',
  knowledge_entry: 'Espelho de entrada fixa',
  chat_memory: 'Memória aprovada',
};

/**
 * Documento que nasce de outra aba (entrada fixa, memória) é gerido lá:
 * excluir o espelho aqui deixaria a entrada e o documento dessincronizados.
 */
export function docManagedElsewhere(sourceType: string): 'fixas' | 'memorias' | null {
  if (sourceType === 'knowledge_entry') return 'fixas';
  if (sourceType === 'chat_memory') return 'memorias';
  return null;
}

export const FEEDBACK_REASON_LABEL: Record<string, string> = {
  numero_errado: 'Número errado',
  periodo_errado: 'Período errado',
  filtro_errado: 'Filtro errado',
  nao_respondeu: 'Não respondeu',
  inventou: 'Inventou dado',
  lento: 'Lento',
  formato: 'Formato',
  outro: 'Outro',
};

export function reasonLabel(reason: string): string {
  return FEEDBACK_REASON_LABEL[reason] ?? reason;
}

export const FEEDBACK_STATUSES = [
  { id: 'open', label: 'Aberto', tone: 'warning' },
  { id: 'triaged', label: 'Em análise', tone: 'accent' },
  { id: 'golden', label: 'Virou caso de teste', tone: 'accent' },
  { id: 'fixed', label: 'Corrigido', tone: 'success' },
  { id: 'wontfix', label: 'Não será corrigido', tone: 'neutral' },
] as const satisfies ReadonlyArray<{ id: string; label: string; tone: Tone }>;

export function feedbackStatus(id: string): { label: string; tone: Tone } {
  return FEEDBACK_STATUSES.find((s) => s.id === id) ?? { label: id, tone: 'neutral' };
}

const EVAL_RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  running: { label: 'Rodando', tone: 'accent' },
  done: { label: 'Concluída', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
};

export function evalRunStatus(status: string): { label: string; tone: Tone } {
  return EVAL_RUN_STATUS[status] ?? { label: status, tone: 'neutral' };
}

export const EVAL_RESULT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pass: { label: 'Passou', tone: 'success' },
  fail: { label: 'Falhou', tone: 'danger' },
  partial: { label: 'Parcial', tone: 'warning' },
  inconclusive: { label: 'Inconclusivo', tone: 'neutral' },
  truncated: { label: 'Cortada', tone: 'warning' },
  refusal: { label: 'Recusa', tone: 'danger' },
  error: { label: 'Erro', tone: 'danger' },
};

export function evalResultStatus(status: string): { label: string; tone: Tone } {
  return EVAL_RESULT_STATUS[status] ?? { label: status, tone: 'neutral' };
}

export const EVAL_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (padrão)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
] as const;

export const EVAL_EFFORTS = [
  { id: 'medium', label: 'Médio' },
  { id: 'high', label: 'Alto (padrão do chat)' },
  { id: 'xhigh', label: 'Muito alto' },
] as const;

export const EVAL_MAX_REPS = 5;

// ── Formatação (padrão americano) ─────────────────────────────────────────

const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const USD2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY_LONG = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
const DAY_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export const DASH = '—';

export function fmtInt(n: number | null | undefined): string {
  return finite(n) ? INT.format(Math.round(n)) : DASH;
}

/** Custo em USD; abaixo de 1 centavo diz "<$0.01" em vez de "$0.00". */
export function fmtUsd(n: number | null | undefined): string {
  if (!finite(n)) return DASH;
  if (n > 0 && n < 0.005) return '<$0.01';
  return USD2.format(n);
}

/** Pontos percentuais → "12.3%" (0.45 → "0.45%": pequeno pede mais casa). */
export function fmtPct(pp: number | null | undefined): string {
  if (!finite(pp)) return DASH;
  const a = Math.abs(pp);
  const digits = a === 0 ? 0 : a < 1 ? 2 : 1;
  return `${pp.toFixed(digits)}%`;
}

/** Fração 0–1 → "12.3%". */
export function fmtFraction(f: number | null | undefined): string {
  return finite(f) ? fmtPct(f * 100) : DASH;
}

export function fmtMs(ms: number | null | undefined): string {
  if (!finite(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function fmtBytes(b: number | null | undefined): string {
  if (!finite(b)) return DASH;
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // Dia civil ('2026-09-29') é lido em UTC: formatar no fuso local (BRT)
  // voltaria um dia — mesmo cuidado do fmtDateShort da SPA.
  const d = new Date(ISO_DAY.test(iso) ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Data de calendário: "Sep 29, 2026". Timestamp é lido no dia UTC. */
export function fmtDay(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? DAY_LONG.format(d) : DASH;
}

/** Rótulo curto de eixo/lista: "Sep 29". */
export function fmtDayShort(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? DAY_SHORT.format(d) : DASH;
}

/** Momento real (upload, execução): no fuso de quem olha, como a SPA. */
export function fmtDateTime(iso: string | null | undefined, timeZone?: string): string {
  const d = toDate(iso);
  if (!d) return DASH;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}

/** Valor do <input type="date"> a partir de um ISO (dia UTC). */
export function isoToDateInput(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? d.toISOString().slice(0, 10) : '';
}

export function durationMs(startIso: string | null | undefined, endIso: string | null | undefined): number | null {
  const a = toDate(startIso);
  const b = toDate(endIso);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return ms >= 0 ? ms : null;
}

export function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

// ── Erros das APIs → PT-BR ────────────────────────────────────────────────

function detailOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const raw = typeof b.error === 'string' ? b.error : typeof b.message === 'string' ? b.message : null;
  const t = raw?.trim();
  if (!t) return null;
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

/**
 * Mensagem de falha para o admin. O status diz o que fazer; o detalhe do
 * servidor (muitas vezes em inglês, ex.: "title required") vai entre
 * parênteses porque é o que permite corrigir o pedido.
 */
export function apiErrorMessage(status: number, body?: unknown): string {
  const detail = detailOf(body);
  let base: string;
  if (status === 0) base = 'Sem conexão com o servidor. Verifique a rede e tente de novo.';
  else if (status === 400 || status === 422) base = 'Pedido recusado pelo servidor.';
  else if (status === 401) return 'Sessão expirada. Entre de novo para continuar.';
  else if (status === 403) return 'Acesso restrito a administradores.';
  else if (status === 404) base = 'Não encontrado — o item foi removido ou a rota ainda não existe neste servidor.';
  else if (status === 409) base = 'Conflito com o estado atual.';
  else if (status === 413) base = 'Arquivo grande demais para o envio.';
  else if (status === 415) base = 'Tipo de arquivo não suportado.';
  else if (status === 429) base = 'Muitas requisições seguidas. Aguarde um pouco e tente de novo.';
  else if (status >= 500) base = `Erro no servidor (${status}). Tente de novo em instantes.`;
  else base = `Falha na requisição (${status}).`;
  return detail ? `${base} (${detail})` : base;
}

// ── Paginação ─────────────────────────────────────────────────────────────

export const PAGE_SIZES = [10, 25, 50] as const;

/** Janela de páginas com reticências: 1 … 4 [5] 6 … 48 (mesma da SPA). */
export function pageWindow(page: number, totalPages: number): Array<number | 'gap-l' | 'gap-r'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: Array<number | 'gap-l' | 'gap-r'> = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(totalPages - 1, page + 1);
  if (lo > 2) out.push('gap-l');
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < totalPages - 1) out.push('gap-r');
  out.push(totalPages);
  return out;
}

/**
 * A lista virou OUTRA lista (filtro, recarga) ou só perdeu/ganhou um punhado
 * de itens? Fila que encolhe a cada ação (aprovar memória, triar feedback)
 * fica na página atual — mesma regra do usePaged da SPA.
 */
export function listChangedEnough(before: readonly string[], after: readonly string[]): boolean {
  const a = new Set(before);
  const b = new Set(after);
  let changed = 0;
  for (const k of b) if (!a.has(k)) changed++;
  for (const k of a) if (!b.has(k)) changed++;
  return changed > 5 || changed > before.length * 0.2;
}

// ── Medidor do bloco fixo ─────────────────────────────────────────────────

export interface MeterState {
  ratio: number | null;
  level: 'ok' | 'warn' | 'over' | 'unknown';
}

/** ≥ 85% do teto avisa; acima do teto, o excedente não cabe no prompt. */
export function meterState(chars: number | null | undefined, max: number | null | undefined): MeterState {
  if (!finite(chars) || !finite(max) || max <= 0) return { ratio: null, level: 'unknown' };
  const ratio = chars / max;
  return { ratio, level: ratio > 1 ? 'over' : ratio >= 0.85 ? 'warn' : 'ok' };
}

/**
 * Tamanho do bloco fixo se o rascunho for salvo. Aproximado: o servidor
 * soma o conteúdo das entradas fixas ativas; título e separadores ficam de
 * fora da conta — daí o "≈" na tela.
 */
export function projectedPinnedChars(
  currentTotal: number,
  before: { pinned: boolean; enabled: boolean; chars: number } | null,
  after: { pinned: boolean; enabled: boolean; chars: number },
): number {
  const was = before && before.pinned && before.enabled ? before.chars : 0;
  const will = after.pinned && after.enabled ? after.chars : 0;
  return Math.max(0, currentTotal - was + will);
}

/** Entrada ainda sem status (linha antiga) conta como ativa. */
export function isActiveEntry(e: Pick<KnowledgeEntryDTO, 'status'>): boolean {
  return !e.status || e.status === 'active';
}

/** Memória aprovada nunca vira fixa (decisão do dono) — só entra pela busca. */
export function canPin(e: Pick<KnowledgeEntryDTO, 'source'>): boolean {
  return e.source !== 'auto';
}

// ── Testar busca: notas por ranqueador ────────────────────────────────────

const RANK_ALIASES: Record<string, string> = {
  pt: 'pt', ptor: 'pt', lexicalpt: 'pt',
  simple: 'simple', simpleor: 'simple', lexicalsimple: 'simple',
  allterms: 'allTerms',
  trigram: 'trigram', trgm: 'trigram',
  dense: 'dense', embedding: 'dense',
  rrf: 'rrf', fused: 'rrf', fusion: 'rrf',
  rerank: 'rerank', reranker: 'rerank',
};

const RANK_ORDER: Array<{ key: string; label: string; always: boolean }> = [
  { key: 'pt', label: 'Português', always: true },
  { key: 'simple', label: 'Simples', always: true },
  { key: 'allTerms', label: 'Todos os termos', always: false },
  { key: 'trigram', label: 'Trigram', always: true },
  { key: 'dense', label: 'Denso', always: true },
  { key: 'rrf', label: 'RRF', always: true },
  { key: 'rerank', label: 'Rerank', always: true },
];

export interface RankCell {
  key: string;
  label: string;
  value: string;
  present: boolean;
}

function fmtRankValue(key: string, v: unknown): string | null {
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (!finite(v)) return null;
  // RRF é soma de 1/(60+posição): só faz sentido com 4 casas.
  if (key === 'rrf') return v.toFixed(4);
  // Rerank devolve nota 0–3 (3 = responde direto).
  if (key === 'rerank') return Number.isInteger(v) && v >= 0 && v <= 3 ? `${v}/3` : v.toFixed(2);
  // Ranqueadores de lista devolvem a posição do trecho nela.
  return Number.isInteger(v) ? `#${v}` : v.toFixed(3);
}

/**
 * Notas de cada ranqueador num formato estável pra tela: os seis do
 * contrato sempre aparecem (ausente = "—", o trecho não veio daquela
 * lista), chaves extras que o servidor mandar entram no fim.
 */
export function rankCells(ranks: unknown): RankCell[] {
  const src: Record<string, unknown> = {};
  const extras: Array<[string, unknown]> = [];
  if (ranks && typeof ranks === 'object' && !Array.isArray(ranks)) {
    for (const [k, v] of Object.entries(ranks as Record<string, unknown>)) {
      const canon = RANK_ALIASES[k.toLowerCase().replace(/[^a-z]/g, '')];
      if (canon) src[canon] = v;
      else extras.push([k, v]);
    }
  }
  const out: RankCell[] = [];
  for (const r of RANK_ORDER) {
    const value = fmtRankValue(r.key, src[r.key]);
    if (value == null && !r.always) continue;
    out.push({ key: r.key, label: r.label, value: value ?? DASH, present: value != null });
  }
  for (const [k, v] of extras) {
    const value = fmtRankValue(k, v);
    if (value != null) out.push({ key: k, label: k, value, present: true });
  }
  return out;
}

// ── Qualidade: cartões do resumo ──────────────────────────────────────────

export interface QualityCard {
  key: string;
  label: string;
  value: string;
  hint?: string;
  money?: boolean;
}

export function qualityCards(s: QualitySummary): QualityCard[] {
  const rated = (s.thumbsUp ?? 0) + (s.thumbsDown ?? 0);
  const costPerTurn = finite(s.costUsd) && s.turns > 0 ? s.costUsd / s.turns : null;
  return [
    { key: 'turns', label: 'Turnos', value: fmtInt(s.turns) },
    {
      key: 'rating',
      label: 'Avaliações',
      value: `${fmtInt(s.thumbsUp)} / ${fmtInt(s.thumbsDown)}`,
      hint: rated > 0 ? `${fmtFraction(s.thumbsDown / rated)} negativas` : 'Nenhuma avaliação no período',
    },
    { key: 'latency', label: 'Latência p50', value: fmtMs(s.latencyP50), hint: `p95 ${fmtMs(s.latencyP95)}` },
    { key: 'ttft', label: 'Primeiro token p50', value: fmtMs(s.ttftP50) },
    {
      key: 'cost',
      label: 'Custo',
      value: fmtUsd(s.costUsd),
      hint: costPerTurn != null ? `${fmtUsd(costPerTurn)} por turno` : undefined,
      money: true,
    },
    {
      key: 'cache',
      label: 'Acerto de cache',
      value: fmtFraction(s.cacheHitRatio),
      hint: finite(s.cacheHitRatioFirstRound)
        ? `1ª rodada ${fmtFraction(s.cacheHitRatioFirstRound)} (entre turnos)`
        : 'Entrada lida do cache',
    },
    ...(s.outputTruncatedPct !== undefined
      ? [{ key: 'outputTruncated', label: 'Respostas cortadas', value: fmtPct(s.outputTruncatedPct), hint: 'Limite de tamanho da saída' }]
      : []),
    { key: 'truncated', label: 'Resultados de tool cortados', value: fmtPct(s.truncatedPct), hint: 'Turnos com resultado acima do teto' },
    { key: 'forced', label: 'Fechamento forçado', value: fmtPct(s.forcedFinalPct), hint: 'Limite de rodadas de tools' },
    { key: 'toolErrors', label: 'Erro de tool', value: fmtFraction(s.toolErrorRate), hint: 'Chamadas com erro' },
    { key: 'ungrounded', label: 'Números sem fonte', value: fmtPct(s.ungroundedPct), hint: 'Turnos com número fora dos dados' },
  ];
}

export type DayMetric = 'turns' | 'costUsd' | 'thumbsDown';

export const DAY_METRICS: Array<{ id: DayMetric; label: string }> = [
  { id: 'turns', label: 'Turnos' },
  { id: 'costUsd', label: 'Custo' },
  { id: 'thumbsDown', label: 'Avaliações negativas' },
];

export function fmtDayMetric(metric: DayMetric, v: number | null | undefined): string {
  return metric === 'costUsd' ? fmtUsd(v) : fmtInt(v);
}

// ── Qualidade: resposta e trace ───────────────────────────────────────────

const BLOCK_SHAPES: Record<string, (b: Record<string, unknown>) => boolean> = {
  summary: (b) => Array.isArray(b.kpis),
  insights: (b) => Array.isArray(b.insights),
  table: (b) => Array.isArray(b.columns) && Array.isArray(b.rows),
  markdown: (b) => typeof b.content === 'string',
  chart: (b) => Array.isArray(b.series),
};

/** Só blocos com a forma mínima que o BlockRenderer percorre (senão quebra o .map). */
export function safeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is Block => {
    if (!b || typeof b !== 'object') return false;
    const t = (b as { type?: unknown }).type;
    const check = typeof t === 'string' ? BLOCK_SHAPES[t] : undefined;
    return !!check && check(b as Record<string, unknown>);
  });
}

/**
 * Resposta gravada → o que a tela mostra. Aceita texto puro ou
 * `{content|text, blocks}`; tira os marcadores [[cite:n]] (o chip de
 * citação não existe fora do stream).
 */
export function normalizeAnswer(answer: unknown): { content: string; blocks: Block[] } {
  if (typeof answer === 'string') return { content: stripCiteMarkers(answer).trim(), blocks: [] };
  if (!answer || typeof answer !== 'object') return { content: '', blocks: [] };
  const a = answer as Record<string, unknown>;
  const text = typeof a.content === 'string' ? a.content : typeof a.text === 'string' ? a.text : '';
  return { content: stripCiteMarkers(text).trim(), blocks: safeBlocks(a.blocks) };
}

export interface TraceTool {
  name: string;
  round: number | null;
  ms: number | null;
  bytes: number | null;
  error: string | null;
  truncated: boolean;
}

export interface TraceSummary {
  model: string | null;
  effort: string | null;
  status: string | null;
  /** sha do prompt estável + tools — correlaciona qualidade com a versão. */
  promptVersion: string | null;
  rounds: number | null;
  toolCalls: number | null;
  toolErrors: number | null;
  latencyMs: number | null;
  ttftMs: number | null;
  costUsd: number | null;
  forcedFinal: boolean;
  truncatedResults: number | null;
  ungrounded: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  tools: TraceTool[];
}

function num(v: unknown): number | null {
  return finite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function toolsOf(list: unknown, round: number | null): TraceTool[] {
  if (!Array.isArray(list)) return [];
  const out: TraceTool[] = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    const name = str(o.name) ?? str(o.tool);
    if (!name) continue;
    out.push({
      name,
      round: num(o.round) ?? round,
      ms: num(o.ms),
      bytes: num(o.bytes),
      error: str(o.error),
      truncated: o.truncated === true,
    });
  }
  return out;
}

/**
 * Trace do turno (ChatTurnLog) em forma de leitura. O contrato só diz
 * "trace": pode vir a lista de rodadas do motor (RoundTrace[]) ou o resumo
 * do log com a lista dentro (`roundsTrace`/`trace`/`rounds`). Sem nada
 * reconhecível → null.
 */
export function summarizeTrace(trace: unknown): TraceSummary | null {
  if (trace == null) return null;
  const log: Record<string, unknown> = Array.isArray(trace) ? {} : typeof trace === 'object' ? (trace as Record<string, unknown>) : {};
  const roundList: unknown[] = Array.isArray(trace)
    ? trace
    : ([log.roundsTrace, log.trace, log.rounds].find(Array.isArray) as unknown[] | undefined) ?? [];

  const tools: TraceTool[] = [];
  let inTok = 0;
  let outTok = 0;
  let cacheTok = 0;
  let sawUsage = false;
  let firstModel: string | null = null;
  let firstTtft: number | null = null;
  let modelMs = 0;
  for (let i = 0; i < roundList.length; i++) {
    const r = roundList[i];
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    tools.push(...toolsOf(o.tools, num(o.round) ?? i));
    firstModel ??= str(o.model);
    firstTtft ??= num(o.ttftMs);
    modelMs += num(o.modelMs) ?? 0;
    const u = o.usage;
    if (u && typeof u === 'object') {
      const usage = u as Record<string, unknown>;
      sawUsage = true;
      inTok += num(usage.input_tokens) ?? 0;
      outTok += num(usage.output_tokens) ?? 0;
      cacheTok += num(usage.cache_read_input_tokens) ?? 0;
    }
  }
  if (!tools.length) tools.push(...toolsOf(log.tools, null));

  const summary: TraceSummary = {
    model: str(log.model) ?? firstModel,
    effort: str(log.effort),
    status: str(log.status),
    promptVersion: str(log.promptVersion),
    rounds: num(log.rounds) ?? (roundList.length ? roundList.length : null),
    toolCalls: num(log.toolCalls) ?? (tools.length ? tools.length : null),
    toolErrors: num(log.toolErrors) ?? (tools.length ? tools.filter((t) => t.error).length : null),
    latencyMs: num(log.latencyMs) ?? (modelMs > 0 ? modelMs : null),
    ttftMs: num(log.ttftMs) ?? firstTtft,
    costUsd: num(log.costUsd),
    forcedFinal: log.forcedFinal === true,
    truncatedResults: num(log.truncatedResults),
    ungrounded: num(log.ungroundedNumbers) ?? (Array.isArray(log.ungrounded) ? log.ungrounded.length : null),
    inputTokens: num(log.inputTokens) ?? (sawUsage ? inTok : null),
    outputTokens: num(log.outputTokens) ?? (sawUsage ? outTok : null),
    cacheReadTokens: num(log.cacheReadTokens) ?? (sawUsage ? cacheTok : null),
    tools,
  };
  const empty =
    !summary.model && !summary.status && summary.rounds == null && summary.latencyMs == null && !tools.length;
  return empty ? null : summary;
}

// ── Avaliação ─────────────────────────────────────────────────────────────

export interface CheckRow {
  name: string;
  /** null = sem veredito (inconclusivo, não se aplica, métrica suave). */
  pass: boolean | null;
  detail: string | null;
  /** Check crítico do grader: falhar derruba o caso inteiro. */
  critical: boolean;
  /** Rótulo quando o status não é só passou/falhou. */
  note: string | null;
}

// Status do grader (lib/chat/eval/grader.ts CheckStatus) além de pass/fail.
const CHECK_NOTE: Record<string, string> = {
  lens_mismatch: 'número certo, lente não nomeada',
  inconclusive: 'inconclusivo',
  skip: 'não se aplica',
};

function passOf(v: Record<string, unknown>): boolean | null {
  for (const k of ['pass', 'ok', 'passed']) if (typeof v[k] === 'boolean') return v[k] as boolean;
  if (typeof v.status === 'string') {
    if (v.status === 'pass' || v.status === 'ok') return true;
    // Lente trocada reprova: o número bate, mas com a definição errada.
    if (v.status === 'fail' || v.status === 'error' || v.status === 'lens_mismatch') return false;
  }
  if (finite(v.score)) return v.score >= 1 ? true : v.score <= 0 ? false : null;
  return null;
}

function checkRow(name: string, v: Record<string, unknown>): CheckRow {
  return {
    name,
    pass: passOf(v),
    detail: detailOfCheck(v),
    critical: v.critical === true,
    note: typeof v.status === 'string' ? CHECK_NOTE[v.status] ?? null : null,
  };
}

function detailOfCheck(v: Record<string, unknown>): string | null {
  const direct = str(v.detail) ?? str(v.note) ?? str(v.message) ?? str(v.reason);
  if (direct) return direct;
  const exp = v.expected;
  const got = v.got ?? v.actual ?? v.found;
  const parts: string[] = [];
  if (exp !== undefined && exp !== null) parts.push(`esperado ${short(exp)}`);
  if (got !== undefined && got !== null) parts.push(`obtido ${short(got)}`);
  return parts.length ? parts.join(' · ') : null;
}

function short(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

/**
 * Checks do grader em linhas. Aceita lista (`[{name, pass, detail}]`) ou
 * mapa (`{ "fact:gross": true | {pass, expected, got} }`).
 */
export function normalizeChecks(checks: unknown): CheckRow[] {
  if (Array.isArray(checks)) {
    return checks.flatMap((c, i): CheckRow[] => {
      if (!c || typeof c !== 'object') return [];
      const o = c as Record<string, unknown>;
      const name = str(o.name) ?? str(o.id) ?? str(o.check) ?? str(o.label) ?? `check ${i + 1}`;
      return [checkRow(name, o)];
    });
  }
  if (checks && typeof checks === 'object') {
    return Object.entries(checks as Record<string, unknown>).map(([name, v]): CheckRow => {
      const bare = { critical: false, note: null };
      if (typeof v === 'boolean') return { name, pass: v, detail: null, ...bare };
      if (finite(v)) return { name, pass: v >= 1 ? true : v <= 0 ? false : null, detail: null, ...bare };
      if (v && typeof v === 'object') return checkRow(name, v as Record<string, unknown>);
      return { name, pass: null, detail: v == null ? null : short(v), ...bare };
    });
  }
  return [];
}

/**
 * Status que entram na taxa — mesma regra do resumo do eval
 * (lib/chat/eval/summary.ts): só respostas AVALIADAS. Erro de infra,
 * truncamento, recusa e inconclusivo (dado mexeu) contam à parte, nunca como 0.
 */
const GRADED = new Set(['pass', 'partial', 'fail']);

export function passRateFromResults(results: ReadonlyArray<Pick<EvalResultDTO, 'status'>>): { rate: number | null; pass: number; graded: number } {
  let pass = 0;
  let graded = 0;
  for (const r of results) {
    if (!GRADED.has(r.status)) continue;
    graded++;
    if (r.status === 'pass') pass++;
  }
  return { rate: graded > 0 ? pass / graded : null, pass, graded };
}

export interface RateView {
  rate: number | null;
  /** Intervalo de Wilson 95% (frações). */
  ci: [number, number] | null;
  n: number | null;
  pass: number | null;
}

function fraction01(v: unknown): number | null {
  return finite(v) && v >= 0 && v <= 1 ? v : null;
}

function ciOf(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const lo = fraction01(v[0]);
  const hi = fraction01(v[1]);
  return lo != null && hi != null && lo <= hi ? [lo, hi] : null;
}

/** `{n, pass, rate, ci}` do resumo (RateWithCi); taxa só como fração 0–1. */
function rateView(v: unknown): RateView | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const n = num(o.n);
  const pass = num(o.pass);
  const rate = fraction01(o.rate) ?? (n != null && pass != null && n > 0 && pass <= n ? pass / n : null);
  return { rate, ci: ciOf(o.ci), n, pass };
}

/**
 * Taxa de aprovação (fração 0–1) do resumo da execução. Forma do runner:
 * `passRate: {n, pass, rate, ci}`. Aceita também contagens soltas e
 * `passRate` numérico SÓ como fração (`passPct` = pontos percentuais) —
 * valor fora da faixa vira null em vez de um número adivinhado.
 */
export function evalPassRate(summary: unknown): number | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as Record<string, unknown>;
  const obj = rateView(s.passRate);
  if (obj) return obj.rate;
  const pass = num(s.pass) ?? num(s.passed) ?? num(s.passCount);
  const total = num(s.graded) ?? num(s.total) ?? num(s.cases) ?? num(s.count);
  if (pass != null && total != null && total > 0 && pass <= total) return pass / total;
  const rate = fraction01(s.passRate);
  if (rate != null) return rate;
  const pct = num(s.passPct);
  if (pct != null && pct >= 0 && pct <= 100) return pct / 100;
  return null;
}

/** "83.0% (IC 95% 70.1%–91.2%)" — o intervalo diz se a diferença entre execuções é ruído. */
export function fmtRateCi(rate: number | null, ci: [number, number] | null): string {
  if (rate == null) return DASH;
  return ci ? `${fmtFraction(rate)} (IC 95% ${fmtFraction(ci[0])}–${fmtFraction(ci[1])})` : fmtFraction(rate);
}

export interface EvalSummaryView {
  passRate: RateView | null;
  /** (pass + partial) ÷ avaliadas — número certo com defeito de forma. */
  acceptableRate: RateView | null;
  meanScore: number | null;
  lensMismatchRate: number | null;
  unitFailRate: number | null;
  falseDenialRate: number | null;
  faithfulness: number | null;
  directness: number | null;
  costPerPass: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  flaky: string[];
  byCategory: Array<{ category: string; n: number; pass: number; partial: number; fail: number; rate: number | null; ci: [number, number] | null }>;
}

/** Resumo da execução (EvalSummary do runner) com cada campo conferido. */
export function evalSummaryView(summary: unknown): EvalSummaryView {
  const s = summary && typeof summary === 'object' ? (summary as Record<string, unknown>) : {};
  const cats = s.byCategory && typeof s.byCategory === 'object' ? (s.byCategory as Record<string, unknown>) : {};
  const byCategory = Object.entries(cats)
    .flatMap(([category, v]) => {
      const r = rateView(v);
      if (!r || r.n == null) return [];
      const o = v as Record<string, unknown>;
      return [{ category, n: r.n, pass: r.pass ?? 0, partial: num(o.partial) ?? 0, fail: num(o.fail) ?? 0, rate: r.rate, ci: r.ci }];
    })
    .sort((a, b) => a.category.localeCompare(b.category));
  return {
    passRate: rateView(s.passRate),
    acceptableRate: rateView(s.acceptableRate),
    meanScore: num(s.meanScore),
    lensMismatchRate: fraction01(s.lensMismatchRate),
    unitFailRate: fraction01(s.unitFailRate),
    falseDenialRate: fraction01(s.falseDenialRate),
    faithfulness: fraction01(s.faithfulness),
    directness: fraction01(s.directness),
    costPerPass: num(s.costPerPass),
    latencyP50: num(s.latencyP50),
    latencyP95: num(s.latencyP95),
    flaky: Array.isArray(s.flaky) ? s.flaky.filter((x): x is string => typeof x === 'string') : [],
    byCategory,
  };
}

export interface EvalConfigView {
  model: string | null;
  effort: string | null;
  reps: number | null;
  cases: number | null;
  knowledge: string | null;
}

export function evalConfig(config: unknown): EvalConfigView {
  const c = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  return {
    model: str(c.model),
    effort: str(c.effort),
    reps: num(c.reps),
    cases: Array.isArray(c.cases) ? c.cases.length : num(c.cases),
    knowledge: str(c.knowledge),
  };
}

export function evalConfigText(config: unknown): string {
  const c = evalConfig(config);
  const parts: string[] = [];
  if (c.model) parts.push(c.model);
  if (c.effort) parts.push(`esforço ${c.effort}`);
  if (c.reps != null) parts.push(`${fmtInt(c.reps)}×`);
  if (c.cases != null && c.cases > 0) parts.push(plural(c.cases, 'caso', 'casos'));
  if (c.knowledge) parts.push(`base ${c.knowledge}`);
  return parts.length ? parts.join(' · ') : DASH;
}

/** "G01, g13 ,G20" → ['G01','g13','G20'] (sem vazios nem repetidos). */
export function parseCaseList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const t = part.trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

// ── Recarga da base do repositório ────────────────────────────────────────

const SEED_KEYS: Array<[string, string, string]> = [
  ['created', 'novo', 'novos'],
  ['updated', 'atualizado', 'atualizados'],
  ['reindexed', 'reindexado', 'reindexados'],
  ['unchanged', 'sem mudança', 'sem mudança'],
  ['skipped', 'ignorado', 'ignorados'],
  ['removed', 'removido', 'removidos'],
  ['failed', 'com falha', 'com falha'],
];

/** Resposta do seed → frase curta; contagens que o servidor não mandar somem. */
export function summarizeSeedResult(body: unknown): string {
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const inner = [root, root.result, root.summary].find(
    (o): o is Record<string, unknown> =>
      !!o && typeof o === 'object' && SEED_KEYS.some(([k]) => (o as Record<string, unknown>)[k] !== undefined),
  );
  if (!inner) return 'Recarga do repositório concluída.';
  const parts: string[] = [];
  for (const [k, one, many] of SEED_KEYS) {
    const v = inner[k];
    const n = Array.isArray(v) ? v.length : num(v);
    if (n != null && n > 0) parts.push(`${fmtInt(n)} ${n === 1 ? one : many}`);
  }
  return parts.length ? `Recarga do repositório concluída: ${parts.join(', ')}.` : 'Recarga do repositório concluída: nada mudou.';
}

// ── Upload ────────────────────────────────────────────────────────────────

export const KB_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const KB_UPLOAD_ACCEPT = '.md,.markdown,.txt,.pdf,.docx,.xlsx,.xls,.csv,.tsv,.html,.htm,.json';

/** Título sugerido a partir do nome do arquivo ("Cohort_v2.md" → "Cohort v2"). */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base || name;
}

/** Busca local sem acento e sem caixa (filtro das listas). */
export function matchesText(query: string, ...fields: Array<string | null | undefined>): boolean {
  const q = fold(query).trim();
  if (!q) return true;
  const hay = fields.map((f) => fold(f ?? '')).join(' ');
  return q.split(/\s+/).every((t) => hay.includes(t));
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
