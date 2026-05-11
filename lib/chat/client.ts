// Client helpers pra UI nova de chat (Phase 1+).
// Tipados, isolados do api.js da SPA legacy.

import type { Block, Conversation, Message, StreamEvent } from '@/types/chat';

export async function listConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/chat/conversations', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`listConversations ${res.status}`);
  const data = (await res.json()) as { conversations: Conversation[] };
  return data.conversations;
}

export async function getConversation(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`getConversation ${res.status}`);
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`deleteConversation ${res.status}`);
}

export interface StreamCallbacks {
  onConversation?: (e: { id: string }) => void;
  onToken?: (e: { text: string }) => void;
  onToolUseStart?: (e: { name: string; id: string }) => void;
  onToolUseResult?: (e: { name: string; id: string }) => void;
  onBlocks?: (e: { blocks: Block[] }) => void;
  onDone?: (e: { conversationId: string }) => void;
  onError?: (e: { message: string }) => void;
  onRateLimited?: (e: { message: string; retryAfterSeconds: number }) => void;
}

/**
 * Envia mensagem ao /api/chat e consome SSE stream. Detecta 429 rate
 * limit pra exibir UI específica. Suporta abort via AbortController.
 */
export async function sendMessage(
  input: { conversationId?: string | null; message: string },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ conversationId: input.conversationId, message: input.message }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    callbacks.onError?.({ message: (err as Error).message });
    return;
  }

  if (res.status === 429) {
    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      retryAfterSeconds?: number;
    };
    callbacks.onRateLimited?.({
      message: data.message || 'Rate limit atingido',
      retryAfterSeconds: data.retryAfterSeconds ?? 3600,
    });
    return;
  }

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    callbacks.onError?.({ message: data.error || `HTTP ${res.status}` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const evt = parseSSE(part);
        if (!evt) continue;
        dispatch(evt, callbacks);
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      callbacks.onError?.({ message: (err as Error).message });
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSE(chunk: string): StreamEvent | null {
  const lines = chunk.split('\n');
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) data += line.slice(6);
  }
  if (!data) return null;
  try {
    const payload = JSON.parse(data) as Record<string, unknown>;
    switch (event) {
      case 'conversation':
        return { type: 'conversation', id: payload.id as string };
      case 'token':
        return { type: 'token', text: payload.text as string };
      case 'tool_use_start':
        return { type: 'tool_use_start', name: payload.name as string, id: payload.id as string };
      case 'tool_use_result':
        return { type: 'tool_use_result', name: payload.name as string, id: payload.id as string };
      case 'blocks':
        return { type: 'blocks', blocks: payload.blocks as Block[] };
      case 'done':
        return { type: 'done', conversationId: payload.conversationId as string };
      case 'error':
        return { type: 'error', message: payload.message as string };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function dispatch(evt: StreamEvent, cb: StreamCallbacks): void {
  switch (evt.type) {
    case 'conversation':
      cb.onConversation?.({ id: evt.id });
      break;
    case 'token':
      cb.onToken?.({ text: evt.text });
      break;
    case 'tool_use_start':
      cb.onToolUseStart?.({ name: evt.name, id: evt.id });
      break;
    case 'tool_use_result':
      cb.onToolUseResult?.({ name: evt.name, id: evt.id });
      break;
    case 'blocks':
      cb.onBlocks?.({ blocks: evt.blocks });
      break;
    case 'done':
      cb.onDone?.({ conversationId: evt.conversationId });
      break;
    case 'error':
      cb.onError?.({ message: evt.message });
      break;
  }
}

// ---------------- Date grouping helpers ----------------

export function groupByDate(conversations: Conversation[]): Array<{
  label: string;
  items: Conversation[];
}> {
  const groups = new Map<string, Conversation[]>();
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const tToday = startOfToday.getTime();
  const tYesterday = tToday - dayMs;
  const t7d = tToday - 7 * dayMs;
  const t30d = tToday - 30 * dayMs;

  const pinned: Conversation[] = [];
  for (const c of conversations) {
    if (c.pinned) {
      pinned.push(c);
      continue;
    }
    const t = new Date(c.updatedAt).getTime();
    let label: string;
    if (t >= tToday) label = 'Hoje';
    else if (t >= tYesterday) label = 'Ontem';
    else if (t >= t7d) label = 'Últimos 7 dias';
    else if (t >= t30d) label = 'Este mês';
    else label = 'Mais antigas';
    const arr = groups.get(label) ?? [];
    arr.push(c);
    groups.set(label, arr);
  }

  const order = ['Hoje', 'Ontem', 'Últimos 7 dias', 'Este mês', 'Mais antigas'];
  const out: Array<{ label: string; items: Conversation[] }> = [];
  if (pinned.length > 0) out.push({ label: 'Fixadas', items: pinned });
  for (const label of order) {
    const items = groups.get(label);
    if (items && items.length > 0) out.push({ label, items });
  }
  void now;
  return out;
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'agora';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
