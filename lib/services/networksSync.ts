// Conferência das redes (contrato docs/integracoes/redes.md §5.4/§6): o dash
// LÊ do NorthAffiliates GET {API}/api/integrations/networks/{directory,
// conversions,checkouts} com a mesma URL e a mesma chave do mapping de
// afiliados (X-Api-Key = INTEGRATION_API_KEY / affiliates.integrationApiKey).
//
//   rápida (a cada 15 min e na subida): diretório + vendas de hoje +
//     checkouts de ontem e hoje;
//   completa (1x por dia, a primeira rodada do dia BRT): diretório + vendas e
//     checkouts dos últimos 45 dias — pega reembolso, retenção e pagamento ao
//     integrante, que o evento do n8n não repete.
//
// A leitura vence o evento quando divergem (mergeNetworkSale com 'read').
// Uma rodada de cada vez (mutex). O resumo da última rodada fica em
// IntegrationSetting (networks.sync.status) — 96 rodadas/dia não poluem o
// IngestLog.

import { db } from '../db';
import { logger } from '../logger';
import { clearResponseCache } from '../cache/responseCache';
import {
  getAffiliatesApiUrl, getAffiliatesOutboundKey, getSetting, setSetting, INTERNAL_SETTING_KEYS,
} from './integrationSettings';
import { brtDay, brtDayOffset, parseMemberRef, parseNetworkRef, parseNetworkSale, str } from './networksCore';
import { applyNetworkSale, markNetworkOrders, syncNetworkAccounts, upsertMemberRef, upsertNetworkRef } from './networks';

const REQUEST_TIMEOUT_MS = 20_000;
export const FULL_WINDOW_DAYS = 45;

export class NetworksNotConfiguredError extends Error {
  constructor() {
    super('Redes: chave de saída do NorthAffiliates não configurada (INTEGRATION_API_KEY ou setting affiliates.integrationApiKey)');
    this.name = 'NetworksNotConfiguredError';
  }
}
export class NetworksSyncBusyError extends Error {
  constructor() {
    super('Redes: já existe uma conferência em andamento');
    this.name = 'NetworksSyncBusyError';
  }
}

type NetworksResource = 'directory' | 'conversions' | 'checkouts';

/** Uma leitura. Exportado pra teste/diagnóstico; `fetchImpl` injetável. */
export async function fetchNetworksResource(
  resource: NetworksResource,
  params: { apiUrl: string; apiKey: string; from?: string; to?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[]> {
  const url = new URL(`${params.apiUrl}/api/integrations/networks/${resource}`);
  if (params.from) url.searchParams.set('from', params.from);
  if (params.to) url.searchParams.set('to', params.to);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url.toString(), {
      headers: { Accept: 'application/json', 'X-Api-Key': params.apiKey, 'User-Agent': 'NorthScale-Dashboard/1.0' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${resource} HTTP ${res.status}: ${text.slice(0, 300)}`);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new Error(`${resource}: resposta não é JSON (${text.slice(0, 120)})`); }
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new Error(`${resource}: formato inesperado (esperado {data: []})`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export interface NetworksSyncStats {
  mode: 'quick' | 'full';
  directory: { networks: number; members: number; accountsChanged: boolean } | null;
  conversions: { from: string; to: string; items: number; created: number; updated: number; invalid: number } | null;
  checkouts: { from: string; to: string; rows: number; checkouts: number } | null;
  accounts: { marked: number; cleared: number; dequeued: number } | null;
  orders: { byAccount: number; byMark: number; byFunnel: number } | null;
  errors: string[];
  durationMs: number;
}

interface Ctx { apiUrl: string; apiKey: string; fetchImpl: typeof fetch; now: Date }

async function syncDirectory(ctx: Ctx): Promise<NonNullable<NetworksSyncStats['directory']>> {
  const data = await fetchNetworksResource('directory', ctx, ctx.fetchImpl);
  let networks = 0;
  let members = 0;
  let accountsChanged = false;
  for (const item of data) {
    const ref = parseNetworkRef(item);
    if (!ref) continue;
    // O diretório traz a lista COMPLETA de contas da rede.
    if (await upsertNetworkRef(ref, { replaceIds: true, deferAccountSync: true, now: ctx.now })) accountsChanged = true;
    networks++;
    const list = (item as { members?: unknown }).members;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      const member = parseMemberRef(m, ref.id);
      if (!member) continue;
      await upsertMemberRef(member, ctx.now);
      members++;
    }
  }
  return { networks, members, accountsChanged };
}

async function syncConversions(ctx: Ctx, from: string, to: string): Promise<{ stats: NonNullable<NetworksSyncStats['conversions']>; transactionIds: string[] }> {
  const data = await fetchNetworksResource('conversions', { ...ctx, from, to }, ctx.fetchImpl);
  const stats = { from, to, items: data.length, created: 0, updated: 0, invalid: 0 };
  // Rede que o diretório ainda não trouxe nasce aqui; a que já existe não tem
  // as contas mexidas (uma venda antiga não devolve conta que saiu da rede).
  const known = new Set((await db.affiliateNetwork.findMany({ select: { id: true } })).map((n) => n.id));
  const membersSeen = new Set<string>();
  const transactionIds: string[] = [];
  for (const item of data) {
    const parsed = parseNetworkSale(item);
    if ('error' in parsed) {
      stats.invalid++;
      continue;
    }
    if (!known.has(parsed.network.id)) {
      await upsertNetworkRef(parsed.network, { now: ctx.now });
      known.add(parsed.network.id);
    }
    if (parsed.member && !membersSeen.has(parsed.member.id)) {
      await upsertMemberRef(parsed.member, ctx.now);
      membersSeen.add(parsed.member.id);
    }
    const action = await applyNetworkSale(parsed, 'read', item);
    stats[action]++;
    transactionIds.push(parsed.transactionId);
  }
  return { stats, transactionIds };
}

/** Linhas de network_checkout_daily (soma chaves repetidas). Exportado pra teste. */
export function checkoutDailyRows(data: unknown[], now: Date): Array<{
  day: Date; networkId: string; memberKey: string; productKey: string; checkouts: number; syncedAt: Date;
}> {
  const acc = new Map<string, { day: string; networkId: string; memberKey: string; productKey: string; checkouts: number }>();
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    const day = str(r.day);
    const networkId = str(r.network_id);
    const n = Number(r.checkouts);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !networkId || !Number.isFinite(n)) continue;
    const memberKey = str(r.affiliate_id) ?? str(r.member_id) ?? '';
    const productKey = str(r.jvzoo_product_id) ?? '';
    const key = `${day}|${networkId}|${memberKey}|${productKey}`;
    const cur = acc.get(key);
    if (cur) cur.checkouts += Math.round(n);
    else acc.set(key, { day, networkId, memberKey, productKey, checkouts: Math.round(n) });
  }
  return [...acc.values()].map((r) => ({ ...r, day: new Date(`${r.day}T00:00:00Z`), syncedAt: now }));
}

async function syncCheckouts(ctx: Ctx, from: string, to: string): Promise<NonNullable<NetworksSyncStats['checkouts']>> {
  const data = await fetchNetworksResource('checkouts', { ...ctx, from, to }, ctx.fetchImpl);
  const rows = checkoutDailyRows(data, ctx.now);
  // A contagem do período é a foto atual: troca as linhas do intervalo inteiro.
  await db.$transaction([
    db.networkCheckoutDaily.deleteMany({ where: { day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } }),
    db.networkCheckoutDaily.createMany({ data: rows }),
  ]);
  return { from, to, rows: rows.length, checkouts: rows.reduce((s, r) => s + r.checkouts, 0) };
}

let running = false;
export function isNetworksSyncRunning(): boolean {
  return running;
}

export interface NetworksSyncOptions { mode?: 'quick' | 'full'; source?: string; fetchImpl?: typeof fetch; now?: Date }

export async function syncNetworks(opts: NetworksSyncOptions = {}): Promise<NetworksSyncStats> {
  const apiKey = await getAffiliatesOutboundKey();
  if (!apiKey) throw new NetworksNotConfiguredError();
  if (running) throw new NetworksSyncBusyError();
  running = true;
  try {
    return await runSync(opts, apiKey);
  } finally {
    running = false;
  }
}

async function runSync(opts: NetworksSyncOptions, apiKey: string): Promise<NetworksSyncStats> {
  const t0 = Date.now();
  const now = opts.now ?? new Date();
  const ctx: Ctx = { apiUrl: await getAffiliatesApiUrl(), apiKey, fetchImpl: opts.fetchImpl ?? fetch, now };
  const mode = opts.mode ?? 'quick';
  const today = brtDay(now);
  const salesFrom = mode === 'full' ? brtDayOffset(now, -(FULL_WINDOW_DAYS - 1)) : today;
  const checkoutsFrom = mode === 'full' ? salesFrom : brtDayOffset(now, -1);
  const stats: NetworksSyncStats = {
    mode, directory: null, conversions: null, checkouts: null, accounts: null, orders: null, errors: [], durationMs: 0,
  };
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.errors.push(`${name}: ${message}`);
      logger.warn({ err, step: name }, '[networks] conferência: passo falhou');
      return null;
    }
  };

  stats.directory = await step('directory', () => syncDirectory(ctx));
  // Sempre (barato): cura também uma rodada anterior que caiu no meio.
  stats.accounts = await step('accounts', () => syncNetworkAccounts());
  const conv = await step('conversions', () => syncConversions(ctx, salesFrom, today));
  stats.conversions = conv?.stats ?? null;
  stats.checkouts = await step('checkouts', () => syncCheckouts(ctx, checkoutsFrom, today));
  // Completa: varre tudo (cura pedido antigo, funil, conta nova). Rápida: só
  // as vendas lidas + contas (o passo da conta já é amplo).
  stats.orders = await step('orders', () => markNetworkOrders(mode === 'full' ? undefined : conv?.transactionIds ?? []));
  stats.durationMs = Date.now() - t0;

  const changed = Boolean(
    stats.directory?.accountsChanged || stats.conversions?.items || stats.checkouts?.rows
    || (stats.orders && stats.orders.byAccount + stats.orders.byMark + stats.orders.byFunnel > 0),
  );
  if (changed) clearResponseCache();
  await setSetting(INTERNAL_SETTING_KEYS.networksSyncStatus, JSON.stringify({
    at: now.toISOString(), source: opts.source ?? 'manual', ok: stats.errors.length === 0, ...stats,
  }));
  if (mode === 'full' && stats.errors.length === 0) await setSetting(INTERNAL_SETTING_KEYS.networksSyncFullDay, today);
  if (stats.errors.length) logger.warn({ mode, errors: stats.errors }, '[networks] conferência com erro');
  else logger.info({ mode, durationMs: stats.durationMs, sales: stats.conversions?.items, checkouts: stats.checkouts?.checkouts }, '[networks] conferência ok');
  return stats;
}

export interface NetworksSyncStatus {
  configured: boolean;
  apiUrl: string;
  running: boolean;
  lastRun: (Partial<NetworksSyncStats> & { at?: string; ok?: boolean; source?: string }) | null;
  lastFullDay: string | null;
  events24h: number;
  eventsFailed24h: number;
  lastEventAt: string | null;
  scheduler: { enabled: boolean; intervalMin: number };
}

export async function getNetworksSyncStatus(): Promise<NetworksSyncStatus> {
  const since24h = new Date(Date.now() - 86_400_000);
  const [key, apiUrl, last, fullDay, events24h, failed24h, lastEvent] = await Promise.all([
    getAffiliatesOutboundKey(),
    getAffiliatesApiUrl(),
    getSetting(INTERNAL_SETTING_KEYS.networksSyncStatus),
    getSetting(INTERNAL_SETTING_KEYS.networksSyncFullDay),
    db.ingestLog.count({ where: { source: 'n8n-jvzoo-redes', receivedAt: { gte: since24h } } }),
    db.ingestLog.count({ where: { source: 'n8n-jvzoo-redes', receivedAt: { gte: since24h }, processedOk: false } }),
    db.ingestLog.findFirst({ where: { source: 'n8n-jvzoo-redes' }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
  ]);
  let lastRun: NetworksSyncStatus['lastRun'] = null;
  try { lastRun = last ? JSON.parse(last) : null; } catch { lastRun = null; }
  return {
    configured: Boolean(key),
    apiUrl,
    running,
    lastRun,
    lastFullDay: fullDay,
    events24h,
    eventsFailed24h: failed24h,
    lastEventAt: lastEvent?.receivedAt.toISOString() ?? null,
    scheduler: { enabled: networksSchedulerEnabled(), intervalMin: QUICK_INTERVAL_MIN },
  };
}

// ---------------------------------------------------------------------
// Scheduler in-process (armado por instrumentation-node.ts)
// ---------------------------------------------------------------------
const FIRST_RUN_DELAY_MS = 60_000;
const QUICK_INTERVAL_MIN = 15;

export function networksSchedulerEnabled(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  const raw = process.env.NETWORKS_SYNC_ENABLED?.trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

let started = false;

async function tick(source: string): Promise<void> {
  try {
    // A primeira rodada do dia BRT é a completa (45 dias).
    const lastFull = await getSetting(INTERNAL_SETTING_KEYS.networksSyncFullDay);
    const mode = lastFull === brtDay(new Date()) ? 'quick' : 'full';
    await syncNetworks({ mode, source });
  } catch (err) {
    if (err instanceof NetworksNotConfiguredError || err instanceof NetworksSyncBusyError) return;
    logger.warn({ err }, '[networks] conferência falhou (tenta de novo no próximo tick)');
  }
}

export function startNetworksScheduler(): void {
  if (started || !networksSchedulerEnabled()) return;
  started = true;
  const first = setTimeout(() => {
    void tick('scheduler-networks-boot');
    const every = setInterval(() => { void tick('scheduler-networks'); }, QUICK_INTERVAL_MIN * 60_000);
    every.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();
  logger.info({ intervalMin: QUICK_INTERVAL_MIN }, '[networks] scheduler armado');
}
