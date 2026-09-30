// Anexos do chat: posse/estado, montagem dos blocos que vão pro modelo.
// ESQUELETO da fundação — preenchido pela unidade de anexos.
//
// Contratos usados pelo motor (chatHistory/route):
//   claimAttachments   — valida ids enviados no POST /api/chat (dono,
//                        READY, sem conversa ou desta conversa) e liga à msg.
//   loadMessageAttachments — anexos de cada mensagem do histórico.
//   buildAttachmentBlocks  — blocos (document/image/text) de UMA mensagem,
//                        idênticos entre turnos (prompt cache).

import type Anthropic from '@anthropic-ai/sdk';
import type { AttachmentRef } from '../ai/toolTypes';
import type { SourceRegistry } from './citations';

export interface ClaimResult {
  ok: boolean;
  attachments: AttachmentRef[];
  /** Mensagem PT-BR pro usuário quando algum id não pode ser usado. */
  error?: string;
}

export async function claimAttachments(
  _userId: string,
  _conversationId: string,
  _messageId: string,
  ids: string[],
): Promise<ClaimResult> {
  if (!ids.length) return { ok: true, attachments: [] };
  return { ok: false, attachments: [], error: 'Anexos ainda não estão disponíveis neste servidor.' };
}

/** messageId → anexos (só do dono). */
export async function loadMessageAttachments(
  _userId: string,
  _conversationId: string,
  _messageIds: string[],
): Promise<Map<string, AttachmentRef[]>> {
  return new Map();
}

export interface AttachmentBlockOptions {
  /** Orçamento de tokens inline ainda disponível na conversa. */
  inlineBudgetTokens: number;
  sources?: SourceRegistry;
}

export interface AttachmentBlocks {
  blocks: Anthropic.ContentBlockParam[];
  /** Tokens estimados consumidos do orçamento inline. */
  tokens: number;
}

/** Blocos de conteúdo pra uma mensagem do usuário (antes do texto dela). */
export async function buildAttachmentBlocks(
  _attachments: AttachmentRef[],
  _opts: AttachmentBlockOptions,
): Promise<AttachmentBlocks> {
  return { blocks: [], tokens: 0 };
}

/** Apaga anexos vencidos (CHAT_ATTACHMENT_RETENTION_DAYS) e rascunhos órfãos (> 24h). */
export async function cleanupExpiredAttachments(): Promise<number> {
  return 0;
}
