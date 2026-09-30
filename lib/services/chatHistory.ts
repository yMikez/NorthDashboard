// Remonta o histórico de uma conversa no formato da API da Anthropic.
//
// Regras (todas por precisão ou por prompt cache):
//   - mensagem do usuário = [anexos] + <contexto_do_turno> + texto — sempre
//     os MESMOS bytes, na mesma ordem, em todo turno (o cache cobre a
//     conversa inteira, inclusive PDFs inline);
//   - resposta = texto (sem os marcadores [[cite:n]]) + os blocos exibidos
//     em texto compacto (o modelo lembra da tabela que respondeu) + o
//     registro das consultas feitas (follow-up consulta o MESMO período);
//   - orçamento de caracteres corta do início, mas anexo nunca some: se a
//     mensagem que o trouxe sair da janela, os blocos voltam na primeira
//     mensagem do usuário que ficou;
//   - breakpoint de cache no último bloco da última mensagem do usuário.

import type Anthropic from '@anthropic-ai/sdk';
import type { AttachmentRef } from '../ai/toolTypes';
import type { SourceRegistry } from '../rag/citations';
import { stripCiteMarkers } from '../rag/citations';
import { buildAttachmentBlocks } from '../rag/attachments';
import { renderBlocksToText } from '../chat/format';

export interface HistoryRow {
  id: string;
  role: string;
  content: string;
  blocks: unknown;
  toolUses: unknown;
  turnContext: string | null;
  createdAt: Date;
}

export interface HistoryOptions {
  maxMessages: number;
  maxChars: number;
  /** Orçamento de tokens de anexos inline por conversa. */
  inlineBudgetTokens: number;
  sources?: SourceRegistry;
  /**
   * Anexos de mensagens que ficaram FORA da janela de mensagens (conversa
   * longa). Voltam no início do histórico — anexo nunca some da conversa.
   */
  olderAttachments?: AttachmentRef[];
}

export interface BuiltHistory {
  messages: Anthropic.MessageParam[];
  /** Chars de texto (sem anexos) — base do orçamento de contexto do turno. */
  chars: number;
  attachmentTokens: number;
}

/** Linha "[consultas: …]" a partir das tool calls persistidas. */
export function queryLedger(toolUses: unknown): string {
  if (!Array.isArray(toolUses) || toolUses.length === 0) return '';
  const parts: string[] = [];
  for (const t of toolUses as Array<{ name?: string; input?: unknown }>) {
    if (!t?.name || t.name === 'respond_with_blocks' || t.name === 'load_skill') continue;
    let args = '';
    try {
      args = JSON.stringify(t.input ?? {});
    } catch {
      args = '';
    }
    if (args.length > 240) args = args.slice(0, 237) + '…';
    parts.push(`${t.name}(${args === '{}' ? '' : args})`);
    if (parts.join(' · ').length > 1500) break;
  }
  return parts.length ? `[consultas desta resposta: ${parts.join(' · ')}]` : '';
}

function assistantText(row: HistoryRow): string {
  const pieces: string[] = [];
  const text = stripCiteMarkers((row.content ?? '').trim());
  if (text) pieces.push(text);
  let blocks = '';
  try {
    blocks = renderBlocksToText(row.blocks);
  } catch {
    // Bloco malformado persistido (input da tool sem validação estrita) não
    // pode derrubar o histórico — senão a conversa inteira passa a dar 500.
    blocks = JSON.stringify(row.blocks ?? null).slice(0, 12_000);
  }
  if (blocks) pieces.push(`[blocos exibidos ao usuário]\n${blocks}`);
  const ledger = queryLedger(row.toolUses);
  if (ledger) pieces.push(ledger);
  return pieces.join('\n\n');
}

interface Draft {
  role: 'user' | 'assistant';
  attach: Anthropic.ContentBlockParam[];
  text: Anthropic.TextBlockParam[];
  chars: number;
  createdAt: Date;
}

export async function buildApiHistory(
  rowsNewestFirst: HistoryRow[],
  attachmentsByMessage: Map<string, AttachmentRef[]>,
  opts: HistoryOptions,
): Promise<BuiltHistory> {
  const rows = rowsNewestFirst.slice(0, opts.maxMessages).reverse();

  // Anexos primeiro, em ordem cronológica — o orçamento inline é gasto pelos
  // mais antigos (a mesma decisão em todo turno ⇒ bytes estáveis).
  let budget = opts.inlineBudgetTokens;
  let attachmentTokens = 0;
  const drafts: Draft[] = [];
  // Os mais antigos de todos (fora da janela) gastam o orçamento primeiro.
  const orphanAttach: Anthropic.ContentBlockParam[] = [];
  if (opts.olderAttachments?.length) {
    const built = await buildAttachmentBlocks(opts.olderAttachments, { inlineBudgetTokens: budget, sources: opts.sources });
    orphanAttach.push(...built.blocks);
    budget = Math.max(0, budget - built.tokens);
    attachmentTokens += built.tokens;
  }
  for (const row of rows) {
    if (row.role === 'user') {
      const refs = attachmentsByMessage.get(row.id) ?? [];
      let attach: Anthropic.ContentBlockParam[] = [];
      if (refs.length) {
        const built = await buildAttachmentBlocks(refs, { inlineBudgetTokens: budget, sources: opts.sources });
        attach = built.blocks;
        budget = Math.max(0, budget - built.tokens);
        attachmentTokens += built.tokens;
      }
      const text: Anthropic.TextBlockParam[] = [];
      if (row.turnContext) text.push({ type: 'text', text: row.turnContext });
      const body = (row.content ?? '').trim() || (refs.length ? '(sem texto — veja os anexos)' : '');
      if (body) text.push({ type: 'text', text: body });
      if (!text.length && !attach.length) continue;
      drafts.push({ role: 'user', attach, text, chars: text.reduce((n, b) => n + b.text.length, 0), createdAt: row.createdAt });
    } else if (row.role === 'assistant') {
      const t = assistantText(row);
      if (!t) continue;
      drafts.push({ role: 'assistant', attach: [], text: [{ type: 'text', text: t }], chars: t.length, createdAt: row.createdAt });
    }
  }

  // Orçamento de texto: corta do início; anexos das mensagens cortadas
  // migram pra primeira mensagem do usuário que ficou.
  let chars = drafts.reduce((n, d) => n + d.chars, 0);
  while (drafts.length > 1 && chars > opts.maxChars) {
    const gone = drafts.shift()!;
    chars -= gone.chars;
    if (gone.attach.length) orphanAttach.push(...gone.attach);
  }
  while (drafts.length > 1 && drafts[0].role !== 'user') {
    const gone = drafts.shift()!;
    chars -= gone.chars;
  }
  if (orphanAttach.length && drafts.length && drafts[0].role === 'user') {
    const when = drafts[0].createdAt.toISOString().slice(0, 10);
    drafts[0].attach = [
      ...orphanAttach,
      { type: 'text', text: `(os anexos acima vieram em mensagens anteriores desta conversa, antes de ${when})` },
      ...drafts[0].attach,
    ];
  }

  // Mensagens seguidas do mesmo papel viram uma só (ex.: turno sem resposta
  // persistida) — a API exige alternância limpa.
  const messages: Anthropic.MessageParam[] = [];
  for (const d of drafts) {
    const content: Anthropic.ContentBlockParam[] = [...d.attach, ...d.text];
    const last = messages[messages.length - 1];
    if (last && last.role === d.role) {
      (last.content as Anthropic.ContentBlockParam[]).push(...content);
    } else {
      messages.push({ role: d.role, content });
    }
  }

  // Breakpoint de cache: último bloco da última mensagem do usuário.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUser) {
    const blocks = lastUser.content as Anthropic.ContentBlockParam[];
    const tail = blocks[blocks.length - 1] as Anthropic.TextBlockParam;
    if (tail && 'type' in tail) (tail as { cache_control?: Anthropic.CacheControlEphemeral }).cache_control = { type: 'ephemeral' };
  }

  return { messages, chars, attachmentTokens };
}
