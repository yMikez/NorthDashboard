// Cliente da API do ClickUp (chat v3 + workspace v2), só leitura.
//
// Auth: token pessoal (pk_…) no header Authorization. O dash enxerga o que
// o dono do token enxerga — por isso o token precisa ser de alguém que está
// nos canais de liderança. Env CLICKUP_API_TOKEN > IntegrationSetting.
//
// Ritmo: o ClickUp limita por minuto por token (100/min nos planos comuns).
// Uma chamada por vez com folga de 700 ms (~85/min) e, no 429, espera o que
// o header manda (X-RateLimit-Reset / Retry-After) e tenta de novo.
//
// Endpoints (developer.clickup.com, conferidos em 2026-11-24):
//   GET /api/v3/workspaces/{ws}/chat/channels               (cursor, limit ≤100)
//   GET /api/v3/workspaces/{ws}/chat/channels/{id}/messages  (mais recente primeiro)
//   GET /api/v3/workspaces/{ws}/chat/messages/{id}/replies   (mais recente primeiro)
//   GET /api/v2/team                                          (workspaces + membros)

import { getSetting, SETTING_KEYS } from '../services/integrationSettings';

const BASE = 'https://api.clickup.com';
const GAP_MS = 700;
const TIMEOUT_MS = 20_000;
const MAX_TRIES = 4;

export class ClickUpNotConfiguredError extends Error {
  constructor() { super('token do ClickUp não configurado'); this.name = 'ClickUpNotConfiguredError'; }
}
export class ClickUpApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ClickUpApiError'; }
}

export interface ClickUpConfig { token: string; workspaceId: string | null }

export async function clickupConfig(): Promise<ClickUpConfig | null> {
  const token = process.env.CLICKUP_API_TOKEN?.trim() || (await getSetting(SETTING_KEYS.clickupApiToken));
  if (!token) return null;
  const ws = process.env.CLICKUP_WORKSPACE_ID?.trim() || (await getSetting(SETTING_KEYS.clickupWorkspaceId));
  return { token, workspaceId: ws || null };
}

let lastCall = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cuGet<T>(token: string, path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const q = qs.toString();
  const url = `${BASE}${path}${q ? `?${q}` : ''}`;
  for (let attempt = 1; ; attempt++) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: token, Accept: 'application/json' }, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= MAX_TRIES) throw err;
      await sleep(2_000 * attempt);
      continue;
    }
    clearTimeout(timer);
    if (res.status === 429 && attempt < MAX_TRIES) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const retryAfter = Number(res.headers.get('retry-after'));
      const ms = Number.isFinite(reset) && reset > 0
        ? Math.max(1_000, reset * 1000 - Date.now())
        : Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000;
      await sleep(Math.min(ms, 65_000));
      continue;
    }
    if (res.status >= 500 && attempt < MAX_TRIES) { await sleep(3_000 * attempt); continue; }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new ClickUpApiError(res.status, `ClickUp ${res.status} em ${path}: ${body}`);
    }
    return (await res.json()) as T;
  }
}

export interface CuWorkspace { id: string; name: string; members: Array<{ id: string; name: string }> }

/** Workspaces do token, com os membros (id → nome). */
export async function listWorkspaces(token: string): Promise<CuWorkspace[]> {
  const r = await cuGet<{ teams?: Array<{ id: string | number; name?: string; members?: Array<{ user?: { id?: number | string; username?: string | null; email?: string | null } }> }> }>(token, '/api/v2/team');
  return (r.teams ?? []).map((t) => ({
    id: String(t.id),
    name: t.name ?? String(t.id),
    members: (t.members ?? [])
      .filter((m) => m.user?.id != null)
      .map((m) => ({ id: String(m.user!.id), name: m.user!.username?.trim() || m.user!.email || String(m.user!.id) })),
  }));
}

export interface CuChannel {
  id: string;
  name?: string | null;
  type: string;
  visibility?: string | null;
  archived?: boolean;
  latest_comment_at?: number | string | null;
}

export async function listChannels(token: string, ws: string): Promise<CuChannel[]> {
  const out: CuChannel[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const r = await cuGet<{ data?: CuChannel[]; next_cursor?: string }>(token, `/api/v3/workspaces/${ws}/chat/channels`, {
      limit: 100, cursor, include_closed: 'false',
    });
    out.push(...(r.data ?? []));
    if (!r.next_cursor || !r.data?.length) break;
    cursor = r.next_cursor;
  }
  return out;
}

export interface CuMessage {
  id: string;
  content?: string | null;
  date: number | string;
  user_id?: string | number | null;
  type?: string;
  replies_count?: number | null;
  parent_message?: string | null;
  post_data?: { title?: string | null; subtype?: unknown } | null;
}

export async function listMessages(token: string, ws: string, channelId: string, cursor?: string): Promise<{ data: CuMessage[]; next: string | null }> {
  const r = await cuGet<{ data?: CuMessage[]; next_cursor?: string }>(token, `/api/v3/workspaces/${ws}/chat/channels/${encodeURIComponent(channelId)}/messages`, {
    limit: 100, cursor, content_format: 'text/md',
  });
  return { data: r.data ?? [], next: r.next_cursor || null };
}

export async function listReplies(token: string, ws: string, messageId: string, cursor?: string): Promise<{ data: CuMessage[]; next: string | null }> {
  const r = await cuGet<{ data?: CuMessage[]; next_cursor?: string }>(token, `/api/v3/workspaces/${ws}/chat/messages/${encodeURIComponent(messageId)}/replies`, {
    limit: 100, cursor, content_format: 'text/md',
  });
  return { data: r.data ?? [], next: r.next_cursor || null };
}

export const toDate = (v: number | string | null | undefined): Date | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return n != null && Number.isFinite(n) && n > 0 ? new Date(n) : null;
};
