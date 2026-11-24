// Aba Decisões: lista, revisão e registro manual de decisões + a
// configuração do ClickUp (admin).

import { Prisma, type DecisionStatus } from '@prisma/client';
import { db } from '../db';
import { getSetting, maskSecret, setSetting, deleteSetting, SETTING_KEYS } from '../services/integrationSettings';
import { clickupConfig, listWorkspaces } from '../clickup/client';
import { lastClickUpSync, type ClickUpSyncSummary } from '../clickup/sync';
import { correlateDecision, type CorrelationSnapshot } from './correlate';
import { cleanExpectations, CORRELATION_DISCLAIMER, type MetricExpectation } from './core';

export interface DecisionView {
  id: string;
  decidedAt: string;
  title: string;
  summary: string;
  decidedBy: string | null;
  channel: { id: string; name: string | null } | null;
  link: string | null;
  metrics: MetricExpectation[];
  scope: { platforms: string[]; families: string[]; note: string | null };
  confidence: string;
  status: DecisionStatus;
  edited: boolean;
  reviewedBy: string | null;
  manual: boolean;
  correlation: CorrelationSnapshot | null;
  sources: Array<{ id: string; userName: string | null; postedAt: string; excerpt: string }>;
}

export interface DecisionsResponse {
  decisions: DecisionView[];
  counts: { detected: number; confirmed: number; discarded: number };
  channels: Array<{ id: string; name: string | null }>;
  configured: boolean;
  sync: ClickUpSyncSummary | null;
  queue: { threadsToRead: number };
  disclaimer: string;
}

const threadLink = (ws: string | null, channelId: string | null, rootId: string | null) =>
  ws && channelId && rootId ? `https://app.clickup.com/${ws}/chat/r/${encodeURIComponent(channelId)}/t/${encodeURIComponent(rootId)}` : null;

export async function listDecisions(opts: { status?: DecisionStatus | 'ALL'; channelId?: string } = {}): Promise<DecisionsResponse> {
  const cfg = await clickupConfig();
  const where: Prisma.DecisionWhereInput = {
    ...(opts.status && opts.status !== 'ALL' ? { status: opts.status } : opts.status === 'ALL' ? {} : { status: { not: 'DISCARDED' } }),
    ...(opts.channelId ? { channelId: opts.channelId } : {}),
  };
  const [rows, grouped, channels, sync, queue] = await Promise.all([
    db.decision.findMany({ where, orderBy: { decidedAt: 'desc' }, take: 500 }),
    db.decision.groupBy({ by: ['status'], _count: { _all: true } }),
    db.clickUpChannel.findMany({ where: { enabled: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    lastClickUpSync(),
    db.clickUpMessage.count({ where: { parentId: null, extractedAt: null, OR: [{ repliesCount: { gt: 0 } }] } }),
  ]);
  const names = new Map(channels.map((c) => [c.id, c.name]));
  const sourceIds = [...new Set(rows.flatMap((r) => r.sourceMessageIds))];
  const sources = sourceIds.length
    ? await db.clickUpMessage.findMany({ where: { id: { in: sourceIds } }, select: { id: true, userName: true, postedAt: true, content: true } })
    : [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const count = (s: DecisionStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  return {
    decisions: rows.map((d) => ({
      id: d.id,
      decidedAt: d.decidedAt.toISOString(),
      title: d.title,
      summary: d.summary,
      decidedBy: d.decidedBy,
      channel: d.channelId ? { id: d.channelId, name: names.get(d.channelId) ?? null } : null,
      link: threadLink(cfg?.workspaceId ?? null, d.channelId, d.threadRootId),
      metrics: (Array.isArray(d.metrics) ? d.metrics : []) as unknown as MetricExpectation[],
      scope: { platforms: [], families: [], note: null, ...((d.scope ?? {}) as object) } as DecisionView['scope'],
      confidence: d.confidence,
      status: d.status,
      edited: d.edited,
      reviewedBy: d.reviewedBy,
      manual: !d.threadRootId,
      correlation: (d.correlation ?? null) as CorrelationSnapshot | null,
      sources: d.sourceMessageIds
        .map((id) => byId.get(id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({
          id: s.id, userName: s.userName, postedAt: s.postedAt.toISOString(),
          excerpt: s.content.replace(/\[@([^\]]+)\]\(#user_mention#\d+\)/g, '@$1').slice(0, 280),
        })),
    })),
    counts: { detected: count('DETECTED'), confirmed: count('CONFIRMED'), discarded: count('DISCARDED') },
    channels,
    configured: !!cfg,
    sync,
    queue: { threadsToRead: queue },
    disclaimer: CORRELATION_DISCLAIMER,
  };
}

export class DecisionInputError extends Error {}

interface EditInput {
  title?: unknown; summary?: unknown; decidedAt?: unknown; metrics?: unknown;
  platforms?: unknown; families?: unknown; note?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : undefined);
const day = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T12:00:00-03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

function editData(b: EditInput): Prisma.DecisionUpdateInput {
  const data: Prisma.DecisionUpdateInput = {};
  const title = str(b.title, 200); if (title) data.title = title;
  const summary = str(b.summary, 2000); if (summary) data.summary = summary;
  const decidedAt = day(b.decidedAt); if (decidedAt) data.decidedAt = decidedAt;
  if (Array.isArray(b.metrics)) {
    data.metrics = cleanExpectations(b.metrics.filter((m): m is { metric: string; expected: string } =>
      !!m && typeof m === 'object' && typeof (m as { metric?: unknown }).metric === 'string')) as unknown as Prisma.InputJsonValue;
  }
  const platforms = list(b.platforms); const families = list(b.families);
  if (platforms || families || b.note !== undefined) {
    data.scope = { platforms: platforms ?? [], families: families ?? [], note: str(b.note, 300) ?? null };
  }
  return data;
}

export async function decisionAction(
  who: string,
  body: { action?: unknown; id?: unknown } & EditInput,
): Promise<{ ok: true; id?: string }> {
  const id = str(body.id, 64);
  switch (body.action) {
    case 'confirm':
    case 'discard':
    case 'restore': {
      if (!id) throw new DecisionInputError('id obrigatório');
      const status: DecisionStatus = body.action === 'confirm' ? 'CONFIRMED' : body.action === 'discard' ? 'DISCARDED' : 'DETECTED';
      await db.decision.update({ where: { id }, data: { status, reviewedBy: who } });
      return { ok: true, id };
    }
    case 'edit': {
      if (!id) throw new DecisionInputError('id obrigatório');
      const data = editData(body);
      if (!Object.keys(data).length) throw new DecisionInputError('nada pra mudar');
      await db.decision.update({ where: { id }, data: { ...data, edited: true, reviewedBy: who, status: 'CONFIRMED' } });
      await correlateDecision(id);
      return { ok: true, id };
    }
    case 'create': {
      const title = str(body.title, 200);
      const decidedAt = day(body.decidedAt);
      if (!title || !decidedAt) throw new DecisionInputError('título e data (AAAA-MM-DD) obrigatórios');
      const data = editData(body);
      const created = await db.decision.create({
        data: {
          title, decidedAt,
          summary: str(body.summary, 2000) ?? title,
          metrics: (data.metrics ?? []) as Prisma.InputJsonValue,
          scope: (data.scope ?? { platforms: [], families: [], note: null }) as Prisma.InputJsonValue,
          confidence: 'alta', sourceMessageIds: [], status: 'CONFIRMED', edited: true, reviewedBy: who, decidedBy: who,
        },
        select: { id: true },
      });
      await correlateDecision(created.id);
      return { ok: true, id: created.id };
    }
    case 'recompute': {
      if (!id) throw new DecisionInputError('id obrigatório');
      await correlateDecision(id);
      return { ok: true, id };
    }
    default:
      throw new DecisionInputError('ação inválida');
  }
}

// ---------- Configuração do ClickUp (admin) ----------

export interface ClickUpAdminView {
  configured: boolean;
  tokenFromEnv: boolean;
  tokenMasked: string | null;
  workspaceId: string | null;
  workspaces: Array<{ id: string; name: string }>;
  workspaceError: string | null;
  channels: Array<{
    id: string; name: string | null; type: string; visibility: string | null; enabled: boolean; leadership: boolean;
    lastSyncedAt: string | null; historyDone: boolean; messages: number; decisions: number;
  }>;
  sync: ClickUpSyncSummary | null;
}

export async function clickupAdminView(): Promise<ClickUpAdminView> {
  const cfg = await clickupConfig();
  const stored = await getSetting(SETTING_KEYS.clickupApiToken);
  let workspaces: Array<{ id: string; name: string }> = [];
  let workspaceError: string | null = null;
  if (cfg) {
    try { workspaces = (await listWorkspaces(cfg.token)).map((w) => ({ id: w.id, name: w.name })); } catch (err) {
      workspaceError = err instanceof Error ? err.message : 'falhou';
    }
  }
  const [channels, counts, decisions, sync] = await Promise.all([
    db.clickUpChannel.findMany({ orderBy: [{ enabled: 'desc' }, { leadership: 'desc' }, { name: 'asc' }] }),
    db.clickUpMessage.groupBy({ by: ['channelId'], _count: { _all: true } }),
    db.decision.groupBy({ by: ['channelId'], where: { status: { not: 'DISCARDED' } }, _count: { _all: true } }),
    lastClickUpSync(),
  ]);
  const msgs = new Map(counts.map((c) => [c.channelId, c._count._all]));
  const decs = new Map(decisions.map((c) => [c.channelId, c._count._all]));
  return {
    configured: !!cfg,
    tokenFromEnv: !!process.env.CLICKUP_API_TOKEN?.trim(),
    tokenMasked: stored ? maskSecret(stored) : null,
    workspaceId: cfg?.workspaceId ?? null,
    workspaces,
    workspaceError,
    channels: channels.map((c) => ({
      id: c.id, name: c.name, type: c.type, visibility: c.visibility, enabled: c.enabled, leadership: c.leadership,
      lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null, historyDone: c.backfillDone,
      messages: msgs.get(c.id) ?? 0, decisions: decs.get(c.id) ?? 0,
    })),
    sync,
  };
}

export async function saveClickUpSettings(b: { token?: unknown; workspaceId?: unknown; clearToken?: unknown }): Promise<void> {
  if (b.clearToken === true) await deleteSetting(SETTING_KEYS.clickupApiToken);
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (token) {
    // Confere antes de gravar: token errado vira mensagem clara, não falha silenciosa no agendador.
    await listWorkspaces(token);
    await setSetting(SETTING_KEYS.clickupApiToken, token);
  }
  if (typeof b.workspaceId === 'string') {
    const ws = b.workspaceId.trim();
    if (ws && !/^\d+$/.test(ws)) throw new DecisionInputError('workspace = número');
    if (ws) await setSetting(SETTING_KEYS.clickupWorkspaceId, ws); else await deleteSetting(SETTING_KEYS.clickupWorkspaceId);
  }
}

export async function updateChannels(updates: unknown): Promise<number> {
  if (!Array.isArray(updates)) throw new DecisionInputError('updates deve ser lista');
  let n = 0;
  for (const u of updates.slice(0, 200)) {
    if (!u || typeof u !== 'object') continue;
    const { id, enabled, leadership } = u as { id?: unknown; enabled?: unknown; leadership?: unknown };
    if (typeof id !== 'string') continue;
    const data: { enabled?: boolean; leadership?: boolean } = {};
    if (typeof enabled === 'boolean') data.enabled = enabled;
    if (typeof leadership === 'boolean') data.leadership = leadership;
    if (!Object.keys(data).length) continue;
    await db.clickUpChannel.update({ where: { id }, data });
    n++;
  }
  return n;
}
