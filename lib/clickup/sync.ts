// Leitura do chat do ClickUp pro banco do dash (ClickUpChannel/ClickUpMessage).
//
// Canais: só CHANNEL liga por padrão. DM, grupo de DM e "Ask AI" ficam
// desligados — são conversas pessoais de quem gerou o token. Canal com nome
// de liderança/gestão/diretoria/decisão já entra marcado como liderança
// (lido primeiro na extração de decisões). O admin muda isso na aba Decisões.
//
// Mensagens: a raiz do canal costuma ser só o título ("[PROJETO] NOVO
// ALINHAMENTO") e a conversa — e a decisão — mora na THREAD. Por isso toda
// raiz com resposta nova tem a thread inteira relida.
//   - Histórico: em partes (PAGES_PER_RUN páginas de 100 por canal por
//     rodada), até HISTORY_DAYS para trás, retomando do cursor guardado.
//   - Rodadas seguintes: relê os últimos RECENT_DAYS dias de cada canal com
//     atividade nova — resposta nova em thread antiga dentro dessa janela
//     aparece no replies_count da raiz.
// Teto de chamadas por rodada (MAX_CALLS): o resto fica pra próxima.

import { createHash } from 'node:crypto';
import { db } from '../db';
import { logger } from '../logger';
import { getSetting, setSetting, INTERNAL_SETTING_KEYS, SETTING_KEYS } from '../services/integrationSettings';
import {
  clickupConfig, ClickUpNotConfiguredError, listChannels, listMessages, listReplies, listWorkspaces, toDate,
  type CuMessage,
} from './client';

export const HISTORY_DAYS = 365;
export const RECENT_DAYS = 30;
const PAGES_PER_RUN = 10;
const MAX_CALLS = 450;
const DAY_MS = 86_400_000;
const LEADERSHIP_RE = /lideran|gest[aã]o|diretoria|decis|board|c-level/i;

export class ClickUpSyncBusyError extends Error {
  constructor() { super('leitura do ClickUp já em andamento'); this.name = 'ClickUpSyncBusyError'; }
}

export interface ClickUpSyncSummary {
  at: string;
  source: string;
  workspaceId: string;
  channels: number;
  enabled: number;
  messages: number;
  replies: number;
  threads: number;
  calls: number;
  historyPending: number;
  stoppedByBudget: boolean;
  errors: string[];
  ms: number;
}

/** O que o dash guarda de uma mensagem (menções viram @Nome na leitura da IA). */
export function cleanContent(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\\([[\]_*#])/g, '$1').trim();
}

/** Impressão da thread: muda quando entra/edita resposta. */
export function threadHash(root: { id: string; content: string }, replies: Array<{ id: string; content: string }>): string {
  const h = createHash('sha1');
  h.update(`${root.id}:${root.content}`);
  for (const r of [...replies].sort((a, b) => a.id.localeCompare(b.id))) h.update(`|${r.id}:${r.content}`);
  return h.digest('hex');
}

let running = false;

export async function syncClickUp(opts: { source: string }): Promise<ClickUpSyncSummary> {
  if (running) throw new ClickUpSyncBusyError();
  running = true;
  const t0 = Date.now();
  const errors: string[] = [];
  let calls = 0;
  let messages = 0;
  let replies = 0;
  let threads = 0;
  let stoppedByBudget = false;
  try {
    const cfg = await clickupConfig();
    if (!cfg) throw new ClickUpNotConfiguredError();
    const { token } = cfg;

    // Workspace + nomes dos membros (1 chamada).
    const workspaces = await listWorkspaces(token); calls++;
    let ws = cfg.workspaceId;
    if (!ws) {
      if (workspaces.length !== 1) throw new Error(`o token enxerga ${workspaces.length} workspaces — informe qual na aba Decisões`);
      ws = workspaces[0].id;
      await setSetting(SETTING_KEYS.clickupWorkspaceId, ws);
    }
    const team = workspaces.find((w) => w.id === ws);
    const names = new Map((team?.members ?? []).map((m) => [m.id, m.name]));
    if (names.size) await setSetting(INTERNAL_SETTING_KEYS.clickupMembers, JSON.stringify(Object.fromEntries(names)));

    // Canais.
    const remote = await listChannels(token, ws); calls += Math.max(1, Math.ceil(remote.length / 100));
    const known = new Map((await db.clickUpChannel.findMany()).map((c) => [c.id, c]));
    for (const c of remote) {
      const isChannel = c.type === 'CHANNEL';
      const data = {
        name: c.name ?? null, type: c.type, visibility: c.visibility ?? null,
        latestMessageAt: toDate(c.latest_comment_at ?? null),
      };
      if (known.has(c.id)) await db.clickUpChannel.update({ where: { id: c.id }, data });
      else {
        await db.clickUpChannel.create({
          data: { id: c.id, ...data, enabled: isChannel && !c.archived, leadership: isChannel && LEADERSHIP_RE.test(c.name ?? '') },
        });
      }
    }
    const channels = await db.clickUpChannel.findMany({
      where: { enabled: true },
      orderBy: [{ leadership: 'desc' }, { latestMessageAt: { sort: 'desc', nulls: 'last' } }],
    });

    const horizon = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
    const recentFrom = new Date(Date.now() - RECENT_DAYS * DAY_MS);

    const saveRoot = async (channelId: string, m: CuMessage) => {
      const postedAt = toDate(m.date);
      if (!postedAt) return null;
      const content = cleanContent(m.content);
      const row = {
        channelId, parentId: null, userId: m.user_id != null ? String(m.user_id) : null,
        userName: m.user_id != null ? names.get(String(m.user_id)) ?? null : null,
        type: m.type ?? 'message', title: m.post_data?.title ?? null, content, postedAt,
        repliesCount: m.replies_count ?? 0,
      };
      await db.clickUpMessage.upsert({ where: { id: m.id }, create: { id: m.id, ...row }, update: row });
      messages++;
      return row;
    };

    const readThread = async (channelId: string, rootId: string) => {
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        if (calls >= MAX_CALLS) { stoppedByBudget = true; return; }
        const r = await listReplies(token, ws!, rootId, cursor); calls++;
        for (const m of r.data) {
          const postedAt = toDate(m.date);
          if (!postedAt) continue;
          const row = {
            channelId, parentId: rootId, userId: m.user_id != null ? String(m.user_id) : null,
            userName: m.user_id != null ? names.get(String(m.user_id)) ?? null : null,
            type: m.type ?? 'message', title: m.post_data?.title ?? null, content: cleanContent(m.content), postedAt, repliesCount: 0,
          };
          await db.clickUpMessage.upsert({ where: { id: m.id }, create: { id: m.id, ...row }, update: row });
          replies++;
        }
        if (!r.next || !r.data.length) break;
        cursor = r.next;
      }
      threads++;
    };

    /** Lê páginas do canal; devolve o cursor onde parou (null = acabou). */
    const readPages = async (channelId: string, startCursor: string | undefined, stopBefore: Date): Promise<{ cursor: string | null; reachedEnd: boolean }> => {
      let cursor = startCursor;
      for (let page = 0; page < PAGES_PER_RUN; page++) {
        if (calls >= MAX_CALLS) { stoppedByBudget = true; return { cursor: cursor ?? null, reachedEnd: false }; }
        const r = await listMessages(token, ws!, channelId, cursor); calls++;
        if (!r.data.length) return { cursor: null, reachedEnd: true };
        // Respostas que o dash já tem por raiz (pra saber se a thread mudou).
        const ids = r.data.map((m) => m.id);
        const stored = await db.clickUpMessage.groupBy({ by: ['parentId'], where: { parentId: { in: ids } }, _count: { _all: true } });
        const have = new Map(stored.map((s) => [s.parentId as string, s._count._all]));
        let oldest: Date | null = null;
        for (const m of r.data) {
          const saved = await saveRoot(channelId, m);
          if (!saved) continue;
          oldest = saved.postedAt;
          const want = m.replies_count ?? 0;
          if (want > (have.get(m.id) ?? 0)) await readThread(channelId, m.id);
          if (stoppedByBudget) return { cursor: cursor ?? null, reachedEnd: false };
        }
        if (!r.next) return { cursor: null, reachedEnd: true };
        cursor = r.next;
        if (oldest && oldest < stopBefore) return { cursor, reachedEnd: true };
      }
      return { cursor: cursor ?? null, reachedEnd: false };
    };

    let historyPending = 0;
    for (const ch of channels) {
      if (stoppedByBudget) { historyPending++; continue; }
      try {
        const startedAt = new Date();
        const saveHistory = async (r: { cursor: string | null; reachedEnd: boolean }) => {
          await db.clickUpChannel.update({
            where: { id: ch.id },
            data: { backfillCursor: r.reachedEnd ? null : r.cursor, backfillDone: r.reachedEnd },
          });
          if (!r.reachedEnd) historyPending++;
        };
        if (!ch.lastSyncedAt) {
          // 1ª leitura: do mais novo pra trás — é o começo do histórico.
          await saveHistory(await readPages(ch.id, undefined, horizon));
        } else {
          // Atividade nova (mensagem ou resposta) desde a última leitura:
          // relê a janela recente — thread antiga com resposta nova aparece aqui.
          const hasNews = !ch.latestMessageAt || ch.latestMessageAt > ch.lastSyncedAt;
          if (hasNews) await readPages(ch.id, undefined, recentFrom);
          // Histórico em partes, de onde parou.
          if (!ch.backfillDone && !stoppedByBudget) await saveHistory(await readPages(ch.id, ch.backfillCursor ?? undefined, horizon));
        }
        // Cortado pelo teto no meio da janela recente: não marca como lido
        // (a próxima rodada relê). A 1ª leitura marca — o cursor do histórico já ficou.
        if (!stoppedByBudget || !ch.lastSyncedAt) {
          await db.clickUpChannel.update({ where: { id: ch.id }, data: { lastSyncedAt: startedAt } });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ch.name ?? ch.id}: ${msg}`);
        logger.warn({ err, channel: ch.id }, '[clickup] canal falhou');
      }
    }

    const summary: ClickUpSyncSummary = {
      at: new Date().toISOString(), source: opts.source, workspaceId: ws, channels: remote.length, enabled: channels.length,
      messages, replies, threads, calls, historyPending, stoppedByBudget, errors: errors.slice(0, 10), ms: Date.now() - t0,
    };
    await setSetting(INTERNAL_SETTING_KEYS.clickupSyncStatus, JSON.stringify(summary));
    logger.info(summary, '[clickup] leitura concluída');
    return summary;
  } finally {
    running = false;
  }
}

export async function lastClickUpSync(): Promise<ClickUpSyncSummary | null> {
  const raw = await getSetting(INTERNAL_SETTING_KEYS.clickupSyncStatus);
  try { return raw ? (JSON.parse(raw) as ClickUpSyncSummary) : null; } catch { return null; }
}

/** id → nome dos membros (gravado na última leitura). */
export async function clickupMemberNames(): Promise<Map<string, string>> {
  const raw = await getSetting(INTERNAL_SETTING_KEYS.clickupMembers);
  try { return new Map(Object.entries(raw ? (JSON.parse(raw) as Record<string, string>) : {})); } catch { return new Map(); }
}
