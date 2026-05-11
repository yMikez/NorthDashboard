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
}

export interface ToolUseRecord {
  name: string;
  input?: unknown;
  result?: unknown;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  toolUses?: ToolUseRecord[] | null;
  blocks?: Block[];
  createdAt: string;
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
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center'; format?: 'currency' | 'percent' | 'number' | 'text' }>;
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

export interface FilterState {
  period: { preset: string; start: string; end: string };
  platforms: string[];        // 'clickbank' | 'digistore24'
  products: string[];         // externalIds
  countries: string[];        // ISO codes
  families: string[];         // NeuroMindPro, GlycoPulse, etc
}

// ---------------- SSE events do /api/chat ----------------

export type StreamEvent =
  | { type: 'conversation'; id: string }
  | { type: 'token'; text: string }
  | { type: 'tool_use_start'; name: string; id: string }
  | { type: 'tool_use_result'; name: string; id: string }
  | { type: 'blocks'; blocks: Block[] }       // Phase 2
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string }
  | { type: 'rate_limited'; message: string; retryAfterSeconds: number };

export interface ChatUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}
