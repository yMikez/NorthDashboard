// Contratos tipados do chat redesign.
//
// Mensagens podem ter content em formato livre (markdown) OU blocos
// estruturados (Phase 2 — SummaryBlock, InsightsBlock, etc).
// Phase 1: só markdown. Block types já definidos mas usados a partir
// de Phase 2 quando o backend ganhar a tool `respond_with_blocks`.

export type Role = 'user' | 'assistant';

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  pinned?: boolean;        // Phase 1+ — persistido no DB futuro
  folderId: string | null; // pasta/projeto; null = raiz
}

// Pasta/projeto de conversas (GET /api/chat/folders).
export interface ChatFolder {
  id: string;
  name: string;
  createdAt: string;
  conversationCount: number;
}

export interface ToolUseRecord {
  name: string;
  input?: unknown;
  /** Persistido pelo motor: {ok?, bytes?, error?, truncated?, ref?} — `error` pinta o chip. */
  result?: unknown;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  toolUses?: ToolUseRecord[] | null;
  blocks?: Block[];
  createdAt: string;
  truncated?: boolean;   // resposta cortada por max_tokens (evento SSE `truncated`)
  /** Anexos que a mensagem do usuário levou (GET da conversa / chips enviados). */
  attachments?: AttachmentDTO[];
  /** Fontes da resposta — os marcadores ` [[cite:n]]` do content apontam pra cá. */
  citations?: Citation[] | null;
  /** Voto do usuário atual nesta resposta (GET da conversa). */
  feedback?: MessageFeedback | null;
}

// ---------------- Citações (RAG / anexos) ----------------

/**
 * Fonte citada numa resposta. O número `n` é estável dentro da mensagem: o
 * texto traz ` [[cite:n]]` e a UI troca pelo chip. `citedText` é snapshot do
 * trecho — continua legível mesmo se o documento mudar depois.
 */
export interface Citation {
  n: number;
  /** `kb:<docId>@v<ver>#<ordinal>` | `anexo:<docId>` | `anexo:<docId>#p<page>`. */
  source: string;
  kind: 'kb' | 'attachment';
  title: string;
  /** Rótulo curto: "Cohort.md › Censura" / "extrato.pdf, p. 3". */
  label?: string;
  documentId?: string;
  chunkId?: string;
  page?: number | null;
  citedText: string[];
  updatedAt?: string;
}

// ---------------- Anexos ----------------

// EXPIRED existe no banco (KbDocStatus): retenção venceu ou o anexo foi
// removido — a UI mostra o chip esmaecido em vez de um link que daria 404.
export type AttachmentStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';
export type AttachmentKind = 'pdf' | 'image' | 'table' | 'text' | 'docx';
export type AttachmentDeliveryMode = 'inline' | 'indexed' | 'table';

/** Metadados de um anexo (POST/GET /api/chat/attachments e GET da conversa). */
export interface AttachmentDTO {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  pageCount: number | null;
  status: AttachmentStatus;
  /** Mensagem PT-BR quando FAILED. */
  error: string | null;
  kind: AttachmentKind;
  deliveryMode: AttachmentDeliveryMode;
  /** null = rascunho (enviado antes da 1ª mensagem da conversa). */
  conversationId: string | null;
  messageId: string | null;
  createdAt: string;
  meta?: {
    rows?: number;
    sheets?: string[];
    columns?: string[];
    width?: number;
    height?: number;
  };
}

// ---------------- Feedback (👍/👎) ----------------

export type FeedbackRating = 1 | -1;

export type FeedbackReason =
  | 'numero_errado'
  | 'periodo_errado'
  | 'filtro_errado'
  | 'nao_respondeu'
  | 'inventou'
  | 'lento'
  | 'formato'
  | 'outro';

/** O que o GET da conversa devolve do voto do usuário atual. */
export interface MessageFeedback {
  rating: FeedbackRating;
  reasons: FeedbackReason[];
  comment: string | null;
}

/** Body do POST /api/chat/messages/[id]/feedback. */
export interface FeedbackInput {
  rating: FeedbackRating;
  reasons?: FeedbackReason[];
  comment?: string;
  /** "qual seria a resposta certa?" */
  expected?: string;
  /** Consentimento explícito: o admin pode ler pergunta + resposta. */
  shared?: boolean;
}

// ---------------- Blocks (Phase 2) ----------------

export type Block =
  | SummaryBlock
  | InsightsBlock
  | DataTableBlock
  | MarkdownBlock
  | ChartBlock;

export interface SummaryBlock {
  type: 'summary';
  title: string;
  kpis: Array<{
    label: string;
    value: string;
    delta?: { value: string; trend: 'up' | 'down' | 'neutral' };
    hint?: string;
  }>;
}

export interface InsightsBlock {
  type: 'insights';
  insights: Array<{
    id?: string;
    icon?: string;
    title: string;
    value: string;
    description: string;
    severity: 'positive' | 'warning' | 'negative' | 'neutral';
    entity?: EntityRef;
  }>;
}

export interface DataTableBlock {
  type: 'table';
  title?: string;
  // percent = PONTOS PERCENTUAIS (12.3 → "12.3%"); fraction = 0–1 (0.123 → "12.3%").
  // Contrato em lib/chat/format.ts (mesma função no servidor e na UI).
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center'; format?: 'currency' | 'percent' | 'fraction' | 'number' | 'text' }>;
  rows: Array<Record<string, unknown> & {
    _highlight?: 'success' | 'warning' | 'danger';
    _sparkline?: number[];
    _entity?: EntityRef;
  }>;
  exportable?: boolean;
}

export interface MarkdownBlock {
  type: 'markdown';
  content: string;
}

export interface ChartBlock {
  type: 'chart';
  title?: string;
  variant: 'line' | 'bar' | 'area';
  series: Array<{ name: string; data: Array<{ x: string | number; y: number }> }>;
}

// Entities clicáveis (Phase 3): afiliados, plataformas, valores
export type EntityKind = 'affiliate' | 'platform' | 'product' | 'country' | 'currency' | 'percent';

export interface EntityRef {
  kind: EntityKind;
  id: string;
  label: string;
  meta?: Record<string, string | number>;
}

// ---------------- Filters (top bar) ----------------

// Mesmos filtros (e mesma codificação na URL) da FilterBar da SPA.
export interface FilterState {
  /** Dias civis BRT, inclusivos (YYYY-MM-DD) — ver lib/shared/datePresets. */
  period: { preset: string; start: string; end: string };
  platforms: string[];        // slugs: clickbank, digistore24, buygoods…
  families: string[];         // NeuroMindPro, GlycoPulse, etc
  countries: string[];        // ISO codes
  stages: string[];           // front | upsell | downsell | recuperacao (ids da SPA)
  affiliates: string[];       // affiliate_id do NorthScale Afiliados
}

// ---------------- SSE events do /api/chat ----------------

/** Fim de uma tool (SSE `tool_use_result`): `ok=false` pinta o chip de erro. */
export interface ToolUseResultEvent {
  name: string;
  id: string;
  ok?: boolean;
  bytes?: number;
  truncated?: boolean;
  ms?: number;
}

export type StreamEvent =
  | { type: 'conversation'; id: string }
  | { type: 'token'; text: string }            // pode trazer ` [[cite:n]]`
  | { type: 'tool_use_start'; name: string; id: string }
  | ({ type: 'tool_use_result' } & ToolUseResultEvent)
  | { type: 'citation'; citation: Citation }   // chega ANTES do marcador no texto
  | { type: 'blocks'; blocks: Block[] }       // Phase 2
  | { type: 'truncated'; reason: string }     // resposta estourou max_tokens
  // messageId = resposta persistida (o 👍/👎 grava contra ele). Opcional só
  // por compatibilidade com servidor antigo — sem ele o voto fica desabilitado.
  | { type: 'done'; conversationId: string; messageId?: string }
  | { type: 'error'; message: string }
  | { type: 'rate_limited'; message: string; retryAfterSeconds: number };

export interface ChatUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  /** Abas liberadas (membro) — a nav esquerda mostra só essas, igual à SPA. */
  allowedTabs?: string[];
}
