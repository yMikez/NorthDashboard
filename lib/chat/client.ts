// Client helpers pra UI nova de chat (Phase 1+).
// Tipados, isolados do api.js da SPA legacy.

import type {
  AttachmentDTO,
  Block,
  ChatFolder,
  Citation,
  Conversation,
  FeedbackInput,
  Message,
  MessageFeedback,
  StreamEvent,
  ToolUseResultEvent,
} from '../../types/chat';
import { uploadErrorMessage } from './attachmentRules';

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

// ---------------- Pastas/Projetos ----------------

export async function listFolders(): Promise<ChatFolder[]> {
  const res = await fetch('/api/chat/folders', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`listFolders ${res.status}`);
  const data = (await res.json()) as { folders: ChatFolder[] };
  return data.folders;
}

export async function createFolder(name: string): Promise<{ id: string; name: string }> {
  const res = await fetch('/api/chat/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createFolder ${res.status}`);
  const data = (await res.json()) as { folder: { id: string; name: string } };
  return data.folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/chat/folders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`renameFolder ${res.status}`);
}

/** As conversas da pasta voltam pra raiz — nada é apagado. */
export async function deleteFolder(id: string): Promise<void> {
  const res = await fetch(`/api/chat/folders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`deleteFolder ${res.status}`);
}

/** Move conversa pra pasta (folderId) ou pra raiz (null). */
export async function moveConversation(id: string, folderId: string | null): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ folderId }),
  });
  if (!res.ok) throw new Error(`moveConversation ${res.status}`);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`renameConversation ${res.status}`);
}

// ---------------- Anexos ----------------

/** Falha de upload com mensagem PT-BR pronta pro chip (status 0 = rede). */
export class AttachmentUploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AttachmentUploadError';
    this.status = status;
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Mensagem que o servidor mandou (`message` legível vence o código em `error`). */
function serverMessage(data: Record<string, unknown> | null): string | null {
  const m = data?.message ?? data?.error;
  return typeof m === 'string' ? m : null;
}

/**
 * Upload multipart de UM arquivo. XMLHttpRequest (e não fetch) porque só ele
 * reporta progresso do upload. `onProgress` recebe a fração 0–1 dos bytes
 * enviados; chegar a 1 não significa pronto — o servidor ainda extrai o
 * conteúdo antes de responder. Abort pelo `signal` rejeita com AbortError.
 */
export function uploadAttachment(
  file: File,
  opts: { conversationId?: string | null; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<AttachmentDTO> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException('upload cancelado', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file, file.name);
    if (opts.conversationId) form.append('conversationId', opts.conversationId);

    const onAbort = () => xhr.abort();
    const cleanup = () => opts.signal?.removeEventListener('abort', onAbort);
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.open('POST', '/api/chat/attachments');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      cleanup();
      const data = parseJson(xhr.responseText);
      const attachment = data?.attachment as AttachmentDTO | undefined;
      if (xhr.status >= 200 && xhr.status < 300 && attachment?.id) resolve(attachment);
      else reject(new AttachmentUploadError(uploadErrorMessage(xhr.status, serverMessage(data)), xhr.status));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new AttachmentUploadError(uploadErrorMessage(0), 0));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('upload cancelado', 'AbortError'));
    };
    xhr.send(form);
  });
}

/** Estado atual de um anexo — o composer consulta enquanto está PROCESSING. */
export async function getAttachment(id: string, signal?: AbortSignal): Promise<AttachmentDTO> {
  const res = await fetch(`/api/chat/attachments/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new AttachmentUploadError(uploadErrorMessage(res.status, serverMessage(data)), res.status);
  }
  const data = (await res.json()) as { attachment: AttachmentDTO };
  return data.attachment;
}

/** Remove um rascunho (anexo ainda não enviado numa mensagem). */
export async function deleteAttachment(id: string): Promise<void> {
  const res = await fetch(`/api/chat/attachments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  // 404 = já não existe (limpeza do servidor chegou antes): objetivo cumprido.
  if (!res.ok && res.status !== 404) throw new Error(`deleteAttachment ${res.status}`);
}

/** Bytes originais (só o dono baixa; o servidor responde como download). */
export function attachmentFileUrl(id: string): string {
  return `/api/chat/attachments/${encodeURIComponent(id)}/file`;
}

// ---------------- Feedback (👍/👎) ----------------

/**
 * Ids locais (antes do `done` trazer o id persistido, ou avisos de erro e
 * limite gerados no cliente) não existem no banco — voto neles daria 404.
 */
export function isPersistedMessageId(id: string): boolean {
  return !!id && !/^(temp|asst|err|rl)-/.test(id);
}

export async function sendFeedback(messageId: string, input: FeedbackInput): Promise<MessageFeedback> {
  const res = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`sendFeedback ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { feedback?: Partial<MessageFeedback> };
  // Servidor devolve o registro salvo; sem corpo, o que foi enviado é a verdade.
  return {
    rating: data.feedback?.rating ?? input.rating,
    reasons: data.feedback?.reasons ?? input.reasons ?? [],
    comment: data.feedback?.comment ?? input.comment ?? null,
  };
}

export async function clearFeedback(messageId: string): Promise<void> {
  const res = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/feedback`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok && res.status !== 404) throw new Error(`clearFeedback ${res.status}`);
}

// ---------------- Stream do /api/chat ----------------

export interface StreamCallbacks {
  onConversation?: (e: { id: string }) => void;
  onToken?: (e: { text: string }) => void;
  onToolUseStart?: (e: { name: string; id: string }) => void;
  onToolUseResult?: (e: ToolUseResultEvent) => void;
  /** Fonte citada — chega antes do marcador ` [[cite:n]]` no texto; o mesmo n pode repetir (atualizado). */
  onCitation?: (e: Citation) => void;
  onBlocks?: (e: { blocks: Block[] }) => void;
  onTruncated?: (e: { reason: string }) => void;
  onDone?: (e: { conversationId: string; messageId?: string }) => void;
  onError?: (e: { message: string }) => void;
  onRateLimited?: (e: { message: string; retryAfterSeconds: number }) => void;
}

export interface SendMessageInput {
  conversationId?: string | null;
  /** Pode ser vazio quando há anexos (o servidor põe "Analise o(s) anexo(s)."). */
  message: string;
  uiState?: unknown;
  folderId?: string | null;
  /** Anexos READY do composer (POST /api/chat/attachments). */
  attachmentIds?: string[];
}

/**
 * Envia mensagem ao /api/chat e consome SSE stream. Detecta 429 rate
 * limit pra exibir UI específica. Suporta abort via AbortController.
 */
export async function sendMessage(
  input: SendMessageInput,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        conversationId: input.conversationId,
        message: input.message,
        uiState: input.uiState,
        // Só relevante quando conversationId é null — conversa NOVA nasce na pasta.
        folderId: input.folderId,
        attachmentIds: input.attachmentIds?.length ? input.attachmentIds : undefined,
      }),
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
    // Último evento sem a linha em branco final (proxy que corta o \n\n).
    const tail = parseSSE(buffer + decoder.decode());
    if (tail) dispatch(tail, callbacks);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      callbacks.onError?.({ message: (err as Error).message });
    }
  } finally {
    reader.releaseLock();
  }
}

function optNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Um evento SSE (bloco entre linhas em branco) → evento tipado; null = ping/desconhecido. */
export function parseSSE(chunk: string): StreamEvent | null {
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
        return {
          type: 'tool_use_result',
          name: payload.name as string,
          id: payload.id as string,
          ok: typeof payload.ok === 'boolean' ? payload.ok : undefined,
          bytes: optNumber(payload.bytes),
          truncated: typeof payload.truncated === 'boolean' ? payload.truncated : undefined,
          ms: optNumber(payload.ms),
        };
      case 'citation': {
        // Citação sem número não tem onde ancorar no texto — descarta.
        if (typeof payload.n !== 'number') return null;
        const citation: Citation = {
          ...(payload as unknown as Citation),
          citedText: Array.isArray(payload.citedText)
            ? payload.citedText.filter((t): t is string => typeof t === 'string')
            : [],
        };
        return { type: 'citation', citation };
      }
      case 'blocks':
        return { type: 'blocks', blocks: payload.blocks as Block[] };
      case 'truncated':
        return { type: 'truncated', reason: payload.reason as string };
      case 'done':
        return {
          type: 'done',
          conversationId: payload.conversationId as string,
          messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
        };
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
    case 'tool_use_result': {
      const { type: _type, ...rest } = evt;
      cb.onToolUseResult?.(rest);
      break;
    }
    case 'citation':
      cb.onCitation?.(evt.citation);
      break;
    case 'blocks':
      cb.onBlocks?.({ blocks: evt.blocks });
      break;
    case 'truncated':
      cb.onTruncated?.({ reason: evt.reason });
      break;
    case 'done':
      cb.onDone?.({ conversationId: evt.conversationId, messageId: evt.messageId });
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
