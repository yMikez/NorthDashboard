// Tipos compartilhados das tools do chat IA.
//
// Vivem fora de aiTools.ts pra que os módulos de tools (skills, RAG, anexos)
// importem só tipos — sem import circular em runtime.

import type Anthropic from '@anthropic-ai/sdk';
import type { ResultStore } from './resultStore';
import type { SourceRegistry } from '../rag/citations';

/** Quem está perguntando (a permissão fica como está — só contexto). */
export interface ToolUser {
  id: string;
  role: string;
  allowedTabs: string[];
}

/** Anexo desta conversa que as tools de anexo podem ler (montado no servidor). */
export interface AttachmentRef {
  id: string;
  title: string;
  fileName: string | null;
  mimeType: string;
  deliveryMode: 'inline' | 'indexed' | 'table';
  pageCount: number | null;
  messageId: string | null;
}

/**
 * Contexto por request. `defaultStart/defaultEnd` = período que o usuário
 * está vendo na UI (default quando o modelo omite datas). O resto só existe
 * dentro de um turno do chat (o eval também monta).
 */
export interface ToolContext {
  defaultStart?: Date;
  defaultEnd?: Date;
  user?: ToolUser;
  conversationId?: string;
  /** Resultados completos (pré-truncamento) desta rodada — $rN nas tools de cálculo. */
  results?: ResultStore;
  /** Fontes citáveis devolvidas nesta rodada (search_result/document). */
  sources?: SourceRegistry;
  /** Anexos da conversa — tools de anexo só aceitam ids daqui. */
  attachments?: AttachmentRef[];
  now?: Date;
  signal?: AbortSignal;
}

/**
 * Resultado de tool que vai pro modelo como BLOCOS (search_result, document,
 * text) em vez de JSON serializado — é o que liga a citação nativa.
 * `summary` é o que se guarda na telemetria/histórico.
 */
export interface ContentToolResult {
  __content: Array<
    | Anthropic.TextBlockParam
    | Anthropic.SearchResultBlockParam
    | Anthropic.DocumentBlockParam
    | Anthropic.ImageBlockParam
  >;
  summary?: unknown;
}

export function isContentResult(v: unknown): v is ContentToolResult {
  return !!v && typeof v === 'object' && Array.isArray((v as { __content?: unknown }).__content);
}

export type ModuleHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

/** Um pacote de tools plugável em aiTools.ts (skills, RAG, anexos). */
export interface ToolModule {
  tools: Anthropic.Tool[];
  handlers: Record<string, ModuleHandler>;
}
