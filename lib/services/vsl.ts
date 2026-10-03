// Aba VSLs — biblioteca, páginas do funil, testes A/B, histórico, a config
// que o script da página lê (/api/vsl/p/<chave>.js) e o beacon das visitas
// (/api/vsl/e). Desempenho em ./vslPerformance.ts.
//
// Regra de ouro: nada aqui pode derrubar a página de venda. O script da
// página tem reserva (snippet) e o beacon é fire-and-forget.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { clearResponseCache } from '../cache/responseCache';
import { getFilterOptions } from './filterOptions';
import { VSL_STAGES, FE_BOTTLE_OPTIONS, isVslStage, pageKeyFor, parsePitch, formatPitch, PAGE_KEY_RE, type VslStage } from '../vsl/catalog';
import { parseVturbEmbed } from '../vsl/embed';
import { buildAffiliateMemorySnippet, buildVslSnippet } from '../vsl/snippet';
import { AFFILIATE_KEY_RE, AFFILIATE_MEMORY_HOURS, affRuleHash, affiliateKeyReadable, affiliateSourceFor } from '../vsl/affiliate';
import { buildLoaderScript, type LoaderConfig, type LoaderVsl } from '../vsl/loader';

export function publicOrigin(): string {
  return (process.env.DASHBOARD_URL || 'https://dash.thenorthscales.com').replace(/\/+$/, '');
}

export const PREVIEW_MINUTES = 15;
const ARM_LABELS = ['A', 'B', 'C', 'D'];

type VslRow = Awaited<ReturnType<typeof db.vsl.findMany>>[number];

function toLoaderVsl(v: VslRow): LoaderVsl {
  return {
    id: v.id,
    p: v.playerId,
    s: v.scriptUrl,
    a: v.aspectPct != null ? Number(v.aspectPct) : null,
    t: v.pitchSeconds,
  };
}

// ── Índice do script da página + validação do beacon (cache curto) ──────

interface PageIndexEntry {
  pageId: string;
  platform: string;
  cfg: LoaderConfig;
  /** testes ABERTOS (rodando/pausado): armId → vslId */
  openTests: Map<string, Map<string, string>>;
}

interface PageIndex { at: number; byKey: Map<string, PageIndexEntry>; vslByPlayer: Map<string, string> }

const INDEX_TTL_MS = 30_000;
let indexCache: PageIndex | null = null;
let indexInFlight: Promise<PageIndex> | null = null;
/** Sobe a cada alteração: reconstrução que começou antes não vale como nova. */
let indexGen = 0;

export function invalidateVslCaches(): void {
  indexGen += 1;
  if (indexCache) indexCache.at = 0;
  clearResponseCache();
}

async function buildIndex(): Promise<PageIndex> {
  const [pages, vsls] = await Promise.all([
    db.vslPage.findMany({
      include: {
        tests: { where: { status: { in: ['running', 'paused'] } }, include: { arms: true } },
        affRules: { where: { enabled: true } },
      },
    }),
    db.vsl.findMany(),
  ]);
  const vslById = new Map(vsls.map((v) => [v.id, v]));
  const now = Date.now();
  const endpoint = `${publicOrigin()}/api/vsl/e`;
  const byKey = new Map<string, PageIndexEntry>();
  for (const p of pages) {
    const running = p.tests.find((t) => t.status === 'running');
    const arms = running
      ? running.arms
          .filter((a) => vslById.has(a.vslId))
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((a) => ({ id: a.id, w: a.weight, v: toLoaderVsl(vslById.get(a.vslId)!) }))
      : [];
    const pv = p.previewVslId && p.previewUntil && p.previewUntil.getTime() > now ? vslById.get(p.previewVslId) : undefined;
    const cur = p.vslId ? vslById.get(p.vslId) : undefined;
    byKey.set(p.key, {
      pageId: p.id,
      platform: p.platform,
      openTests: new Map(p.tests.map((t) => [t.id, new Map(t.arms.map((a) => [a.id, a.vslId]))])),
      cfg: {
        k: p.key,
        on: p.enabled,
        v: cur ? toLoaderVsl(cur) : null,
        t: running && arms.length >= 2 ? { id: running.id, arms } : null,
        pv: pv ? toLoaderVsl(pv) : null,
        af: affiliateSourceFor(p.platform),
        ar: rulesFor(p.key, p.platform, p.affRules, vslById),
        am: AFFILIATE_MEMORY_HOURS,
        e: endpoint,
      },
    });
  }
  return { at: Date.now(), byKey, vslByPlayer: new Map(vsls.map((v) => [v.playerId, v.id])) };
}

/** Regras ativas da página no formato do script: hash(chave|afiliado) → VSL. */
function rulesFor(
  pageKey: string,
  platform: string,
  rules: Array<{ affiliateExternalId: string; vslId: string }>,
  vslById: Map<string, VslRow>,
): Record<string, LoaderVsl> | null {
  if (!affiliateSourceFor(platform) || !rules.length) return null;
  const out: Record<string, LoaderVsl> = {};
  for (const r of rules) {
    const v = vslById.get(r.vslId);
    if (v && !v.archived) out[affRuleHash(pageKey, r.affiliateExternalId)] = toLoaderVsl(v);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Nunca deixa a página esperando o banco: com índice em memória (mesmo
 * vencido), devolve ele na hora e reconstrói em segundo plano.
 */
async function getIndex(): Promise<PageIndex> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache;
  if (!indexInFlight) {
    const startGen = indexGen;
    indexInFlight = buildIndex()
      .then((r) => {
        if (startGen !== indexGen) r.at = 0; // mudou algo durante a leitura: vale só até a próxima
        indexCache = r;
        return r;
      })
      .catch((err) => {
        logger.warn({ err }, 'vsl index rebuild failed');
        if (indexCache) return indexCache;
        throw err;
      })
      .finally(() => { indexInFlight = null; });
  }
  return indexCache ?? indexInFlight;
}

/** JS servido em /api/vsl/p/<chave>.js. Chave desconhecida → só a reserva. */
export async function loaderScriptFor(key: string): Promise<string> {
  const idx = await getIndex();
  const entry = idx.byKey.get(key);
  const cfg: LoaderConfig = entry?.cfg ?? { k: key, on: false, v: null, t: null, pv: null, e: null };
  return buildLoaderScript(cfg);
}

// ── Beacon ───────────────────────────────────────────────────────────────

const EVENT_TYPES = new Set(['view', 'play', 'pitch', 'progress', 'accept', 'decline']);
const VISIT_ID_RE = /^[a-z0-9]{8,40}$/;
const PLAYER_RE = /^[0-9a-f]{24}$/;
const SESSION_RE = /^(sessid2|cbreceipt|order):[A-Za-z0-9._-]{1,150}$/;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|preview|pingdom|uptime/i;
const lastSeenWrite = new Map<string, number>();

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function hostOf(u: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u.includes('://') ? u : `https://${u}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function recordVslEvent(
  raw: unknown,
  meta: { userAgent: string | null; origin: string | null },
): Promise<{ ok: boolean; reason?: string }> {
  if (meta.userAgent && BOT_RE.test(meta.userAgent)) return { ok: false, reason: 'bot' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'body' };
  const b = raw as Record<string, unknown>;
  const key = str(b.k, 100);
  const visitId = str(b.v, 40);
  const type = str(b.e, 12);
  if (!key || !PAGE_KEY_RE.test(key) || !visitId || !VISIT_ID_RE.test(visitId) || !type || !EVENT_TYPES.has(type)) {
    return { ok: false, reason: 'campos' };
  }
  const idx = await getIndex();
  const page = idx.byKey.get(key);
  if (!page) return { ok: false, reason: 'pagina' };

  // A VSL vem do player que TOCOU (não do que o banco acha que está no ar):
  // reserva antiga no snippet, player carregado por outro script, tudo cai certo.
  const afRaw = str(b.af, 40);
  const affiliateKey = afRaw && AFFILIATE_KEY_RE.test(afRaw) ? afRaw : null;
  const player = str(b.pl, 24);
  const vslId = player && PLAYER_RE.test(player) ? idx.vslByPlayer.get(player) ?? null : null;
  // Braço só conta em teste aberto e quando o player é o do braço.
  let testId = str(b.t, 40);
  let armId = str(b.a, 40);
  const arms = testId ? page.openTests.get(testId) : undefined;
  if (!arms || !armId || !arms.has(armId) || arms.get(armId) !== vslId) { testId = null; armId = null; }
  const sec = typeof b.s === 'number' && Number.isFinite(b.s) ? Math.max(0, Math.min(6 * 3600, Math.floor(b.s))) : 0;
  const skRaw = str(b.sk, 160);
  const sessionKey = skRaw && SESSION_RE.test(skRaw) ? skRaw : null;
  const urlRaw = str(b.u, 200);
  const urlClean = urlRaw ? urlRaw.split(/[?#]/)[0] : null;
  // Endereço só vale se bater com o Origin do navegador (o beacon sai da própria página).
  const originHost = hostOf(meta.origin);
  const pageUrl = urlClean && originHost && hostOf(urlClean) === originHost ? urlClean : null;

  await db.$executeRaw(visitUpsertSql({ visitId, pageId: page.pageId, vslId, testId, armId, platform: page.platform, sessionKey, affiliateKey, pageUrl, type, second: sec }));

  // "Visto em" da página — no máximo uma escrita por minuto por página. O
  // endereço só é gravado na primeira vez (ninguém troca o link da página
  // mandando beacon de outro site depois).
  const last = lastSeenWrite.get(page.pageId) ?? 0;
  if (Date.now() - last > 60_000) {
    lastSeenWrite.set(page.pageId, Date.now());
    await db.$executeRaw`
      UPDATE "VslPage" SET "lastSeenAt" = now(),
             "lastSeenUrl" = COALESCE("lastSeenUrl", ${pageUrl}),
             "installedAt" = COALESCE("installedAt", now())
      WHERE id = ${page.pageId}`;
  }
  return { ok: true };
}

/** Upsert da visita: cada evento só preenche o que ainda está vazio. */
export function visitUpsertSql(e: {
  visitId: string; pageId: string; vslId: string | null; testId: string | null; armId: string | null;
  platform: string; sessionKey: string | null; affiliateKey?: string | null; pageUrl: string | null; type: string; second: number;
}): Prisma.Sql {
  const { visitId, vslId, testId, armId, sessionKey, pageUrl, type } = e;
  const affiliateKey = e.affiliateKey ?? null;
  const now = Prisma.sql`now()`;
  const at = (t: string) => (type === t ? now : Prisma.sql`NULL`);
  const playAt = type === 'play' || type === 'pitch' ? now : Prisma.sql`NULL`;
  return Prisma.sql`
    INSERT INTO "VslVisit" (id, "pageId", "vslId", "testId", "armId", platform, "sessionKey", "affiliateKey", "pageUrl",
                            "firstAt", "lastAt", "playAt", "pitchAt", "acceptAt", "declineAt", "maxSecond")
    VALUES (${visitId}, ${e.pageId}, ${vslId}, ${testId}, ${armId}, ${e.platform}, ${sessionKey}, ${affiliateKey}, ${pageUrl},
            now(), now(), ${playAt}, ${at('pitch')}, ${at('accept')}, ${at('decline')}, ${e.second})
    ON CONFLICT (id) DO UPDATE SET
      "lastAt" = now(),
      "playAt" = COALESCE("VslVisit"."playAt", EXCLUDED."playAt"),
      "pitchAt" = COALESCE("VslVisit"."pitchAt", EXCLUDED."pitchAt"),
      "acceptAt" = COALESCE("VslVisit"."acceptAt", EXCLUDED."acceptAt"),
      "declineAt" = COALESCE("VslVisit"."declineAt", EXCLUDED."declineAt"),
      "maxSecond" = GREATEST("VslVisit"."maxSecond", EXCLUDED."maxSecond"),
      "sessionKey" = COALESCE("VslVisit"."sessionKey", EXCLUDED."sessionKey"),
      "affiliateKey" = COALESCE("VslVisit"."affiliateKey", EXCLUDED."affiliateKey")
    WHERE "VslVisit"."pageId" = EXCLUDED."pageId"`;
}

// ── Estado da aba ────────────────────────────────────────────────────────

export interface VslActor {
  id: string;
  name: string;
}

function vslDto(v: VslRow) {
  return {
    id: v.id,
    name: v.name,
    accountId: v.accountId,
    playerId: v.playerId,
    scriptUrl: v.scriptUrl,
    aspectPct: v.aspectPct != null ? Number(v.aspectPct) : null,
    pitchSeconds: v.pitchSeconds,
    notes: v.notes,
    archived: v.archived,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

export async function getVslState() {
  const [vsls, pages, tests, changes, options, recent, rules, coverage] = await Promise.all([
    db.vsl.findMany({ orderBy: [{ archived: 'asc' }, { name: 'asc' }] }),
    db.vslPage.findMany({ orderBy: [{ family: 'asc' }, { stage: 'asc' }, { platform: 'asc' }, { variant: 'asc' }] }),
    db.vslTest.findMany({ include: { arms: true }, orderBy: { startedAt: 'desc' } }),
    db.vslChange.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
    getFilterOptions(),
    db.$queryRaw<Array<{ pageId: string; n: number }>>`
      SELECT "pageId", COUNT(*)::int AS n FROM "VslVisit"
      WHERE "firstAt" > now() - interval '24 hours' GROUP BY 1`,
    db.vslAffiliateRule.findMany({ orderBy: { createdAt: 'asc' } }),
    db.$queryRaw<Array<{ pageId: string; n: number; withAff: number }>>`
      SELECT "pageId", COUNT(*)::int AS n, COUNT("affiliateKey")::int AS "withAff" FROM "VslVisit"
      WHERE "firstAt" > now() - interval '7 days' GROUP BY 1`,
  ]);
  const ruleAffs = rules.length
    ? await db.affiliate.findMany({ where: { id: { in: [...new Set(rules.map((r) => r.affiliateId))] } }, select: { id: true, nickname: true, externalId: true } })
    : [];
  const affById = new Map(ruleAffs.map((a) => [a.id, a]));
  const coverageByPage = new Map(coverage.map((c) => [c.pageId, c]));
  const vslById = new Map(vsls.map((v) => [v.id, v]));
  const visits24 = new Map(recent.map((r) => [r.pageId, r.n]));
  const origin = publicOrigin();

  // fallbacks = páginas cujo snippet tem esta VSL como reserva (impede arquivar).
  const usage = new Map<string, { pages: number; tests: number; fallbacks: number; rules: number }>();
  const use = (id: string | null | undefined, k: 'pages' | 'tests' | 'fallbacks' | 'rules') => {
    if (!id) return;
    const u = usage.get(id) ?? { pages: 0, tests: 0, fallbacks: 0, rules: 0 };
    u[k] += 1;
    usage.set(id, u);
  };
  for (const p of pages) { use(p.vslId, 'pages'); use(p.fallbackVslId, 'fallbacks'); }
  for (const r of rules) use(r.vslId, 'rules');
  for (const t of tests) if (t.status !== 'finished') for (const a of t.arms) use(a.vslId, 'tests');

  const testDto = (t: (typeof tests)[number]) => ({
    id: t.id,
    pageId: t.pageId,
    name: t.name,
    status: t.status,
    startedAt: t.startedAt.toISOString(),
    endedAt: t.endedAt?.toISOString() ?? null,
    winnerVslId: t.winnerVslId,
    arms: [...t.arms].sort((a, b) => a.label.localeCompare(b.label)).map((a) => ({ id: a.id, label: a.label, vslId: a.vslId, weight: a.weight })),
  });

  return {
    origin,
    now: new Date().toISOString(),
    previewMinutes: PREVIEW_MINUTES,
    affiliateMemoryHours: AFFILIATE_MEMORY_HOURS,
    affiliateMemorySnippet: buildAffiliateMemorySnippet(),
    options: {
      families: options.families.map((f) => f.id),
      platforms: options.platforms.map((p) => ({ id: p.id, label: p.label })),
      stages: VSL_STAGES.map((s) => ({ id: s.id, label: s.label })),
      feBottles: FE_BOTTLE_OPTIONS,
    },
    vsls: vsls.map((v) => ({ ...vslDto(v), usage: usage.get(v.id) ?? { pages: 0, tests: 0, fallbacks: 0, rules: 0 } })),
    pages: pages.map((p) => {
      const fb = p.fallbackVslId ? vslById.get(p.fallbackVslId) : undefined;
      const open = tests.find((t) => t.pageId === p.id && t.status !== 'finished');
      return {
        id: p.id,
        key: p.key,
        family: p.family,
        stage: p.stage,
        variant: p.variant,
        feBottles: p.feBottles ?? [],
        platform: p.platform,
        vslId: p.vslId,
        fallbackVslId: p.fallbackVslId,
        enabled: p.enabled,
        installedAt: p.installedAt?.toISOString() ?? null,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
        lastSeenUrl: p.lastSeenUrl,
        visits24h: visits24.get(p.id) ?? 0,
        previewVslId: p.previewVslId,
        previewUntil: p.previewUntil?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        test: open ? testDto(open) : null,
        affiliateSource: affiliateSourceFor(p.platform),
        affiliateCoverage7d: { visits: coverageByPage.get(p.id)?.n ?? 0, withAffiliate: coverageByPage.get(p.id)?.withAff ?? 0 },
        affRules: rules.filter((r) => r.pageId === p.id).map((r) => ({
          id: r.id,
          affiliateId: r.affiliateId,
          affiliateExternalId: r.affiliateExternalId,
          affiliateName: affById.get(r.affiliateId)?.nickname ?? null,
          vslId: r.vslId,
          enabled: r.enabled,
          createdAt: r.createdAt.toISOString(),
        })),
        scriptUrl: `${origin}/api/vsl/p/${p.key}.js`,
        snippet: fb
          ? buildVslSnippet({
              key: p.key,
              origin,
              fallback: { name: fb.name, playerId: fb.playerId, scriptUrl: fb.scriptUrl, aspectPct: fb.aspectPct != null ? Number(fb.aspectPct) : null, pitchSeconds: fb.pitchSeconds },
            })
          : null,
      };
    }),
    tests: tests.map(testDto),
    changes: changes.map((c) => ({
      id: c.id,
      pageId: c.pageId,
      pageKey: c.pageKey,
      vslId: c.vslId,
      testId: c.testId,
      kind: c.kind,
      fromVslId: c.fromVslId,
      toVslId: c.toVslId,
      detail: c.detail,
      actorName: c.actorName,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

// ── Afiliados pra regra (seletor da gaveta da página) ───────────────────

export interface AffiliateCandidate {
  id: string;
  externalId: string;
  nickname: string | null;
  /** visitas desta página nos últimos 30 dias com esse afiliado */
  visits30d: number;
  lastOrderAt: string | null;
}

/**
 * Candidatos a regra numa página: primeiro quem já passou pela página (o ID
 * que a página leu é garantidamente o que a regra vai comparar), depois a
 * busca nas contas da plataforma por nome ou ID.
 */
export async function affiliateCandidates(pageId: string, q: string): Promise<{ platform: string; seen: AffiliateCandidate[]; results: AffiliateCandidate[] }> {
  const page = await db.vslPage.findUnique({ where: { id: pageId }, select: { platform: true } });
  if (!page) throw new VslActionError('Página não encontrada.', 404);
  const platform = await db.platform.findUnique({ where: { slug: page.platform }, select: { id: true } });
  if (!platform) return { platform: page.platform, seen: [], results: [] };

  const seenRows = await db.$queryRaw<Array<{ key: string; n: number }>>`
    SELECT "affiliateKey" AS key, COUNT(*)::int AS n FROM "VslVisit"
    WHERE "pageId" = ${pageId} AND "affiliateKey" IS NOT NULL AND "firstAt" > now() - interval '30 days'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 30`;
  const seenCount = new Map(seenRows.map((r) => [r.key, r.n]));
  const select = { id: true, externalId: true, nickname: true, lastOrderAt: true } as const;
  const toDto = (a: { id: string; externalId: string; nickname: string | null; lastOrderAt: Date | null }): AffiliateCandidate => ({
    id: a.id, externalId: a.externalId, nickname: a.nickname,
    visits30d: seenCount.get(a.externalId) ?? 0, lastOrderAt: a.lastOrderAt?.toISOString() ?? null,
  });

  const seenAffs = seenRows.length
    ? await db.affiliate.findMany({ where: { platformId: platform.id, externalId: { in: seenRows.map((r) => r.key) } }, select })
    : [];
  const seen = seenAffs.map(toDto).sort((a, b) => b.visits30d - a.visits30d);

  const term = q.trim().slice(0, 60);
  const results = (await db.affiliate.findMany({
    where: {
      platformId: platform.id,
      ...(term ? { OR: [{ nickname: { contains: term, mode: 'insensitive' as const } }, { externalId: { startsWith: term } }] } : {}),
    },
    orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } },
    take: 40,
    select,
  }))
    .filter((a) => affiliateKeyReadable(page.platform, a.externalId))
    .slice(0, 20)
    .map(toDto);
  return { platform: page.platform, seen, results };
}

// ── Ações ────────────────────────────────────────────────────────────────

export class VslActionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

async function log(
  tx: Tx,
  actor: VslActor,
  c: { kind: string; detail: string; pageId?: string | null; pageKey?: string | null; vslId?: string | null; testId?: string | null; ruleId?: string | null; fromVslId?: string | null; toVslId?: string | null },
) {
  await tx.vslChange.create({
    data: {
      kind: c.kind,
      detail: c.detail.slice(0, 500),
      pageId: c.pageId ?? null,
      pageKey: c.pageKey ?? null,
      vslId: c.vslId ?? null,
      testId: c.testId ?? null,
      ruleId: c.ruleId ?? null,
      fromVslId: c.fromVslId ?? null,
      toVslId: c.toVslId ?? null,
      actorId: actor.id,
      actorName: actor.name,
    },
  });
}

function text(v: unknown, field: string, max: number, required = true): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    if (required) throw new VslActionError(`${field} é obrigatório.`);
    return null;
  }
  if (s.length > max) throw new VslActionError(`${field}: no máximo ${max} caracteres.`);
  return s;
}

function pitchOf(v: unknown): number {
  const p = parsePitch(v);
  if (p == null) throw new VslActionError('Tempo do pitch inválido — use minutos:segundos (ex.: 5:27).');
  return p;
}

const pageLabel = (p: { family: string; stage: string; platform: string; variant?: string | null }) =>
  `${p.family} · ${p.stage}${p.variant ? ` (${p.variant})` : ''} · ${p.platform}`;

/** Potes do FE: inteiros 1–6, sem repetição, em ordem. */
function bottlesOf(v: unknown): number[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new VslActionError('Potes do front: lista de números.');
  const out = [...new Set(v.map(Number))].sort((a, b) => a - b);
  if (out.some((n) => !FE_BOTTLE_OPTIONS.includes(n))) throw new VslActionError(`Potes do front: só ${FE_BOTTLE_OPTIONS.join(', ')}.`);
  return out;
}

async function vslOrThrow(tx: Tx, id: unknown, opts: { allowArchived?: boolean } = {}) {
  const v = typeof id === 'string' ? await tx.vsl.findUnique({ where: { id } }) : null;
  if (!v) throw new VslActionError('VSL não encontrada.', 404);
  if (v.archived && !opts.allowArchived) throw new VslActionError(`"${v.name}" está arquivada — restaure antes de usar.`);
  return v;
}

async function pageOrThrow(tx: Tx, id: unknown) {
  const p = typeof id === 'string' ? await tx.vslPage.findUnique({ where: { id } }) : null;
  if (!p) throw new VslActionError('Página não encontrada.', 404);
  return p;
}

async function openTest(tx: Tx, pageId: string) {
  return tx.vslTest.findFirst({ where: { pageId, status: { in: ['running', 'paused'] } }, include: { arms: true } });
}

/** Violação de unicidade (dois cliques, duas abas) vira mensagem, não 500. */
function conflictToActionError(err: unknown): never {
  const code = (err as { code?: string; meta?: { code?: string } })?.code;
  const raw = String((err as { message?: string })?.message ?? '');
  if (code === 'P2002' || raw.includes('23505') || raw.includes('VslTest_one_open_per_page')) {
    throw new VslActionError('Conflito: alguém acabou de mexer nisto (ex.: teste já aberto nesta página). Recarregue e tente de novo.', 409);
  }
  throw err;
}

export async function vslAction(body: Record<string, unknown>, actor: VslActor): Promise<{ ok: true; id?: string; message: string }> {
  const action = typeof body.action === 'string' ? body.action : '';
  const result = await db.$transaction(async (tx) => {
    switch (action) {
      case 'create_vsl': {
        const name = text(body.name, 'Nome', 80)!;
        const parsed = parseVturbEmbed(body.code);
        if (!parsed.ok) throw new VslActionError(parsed.error);
        const dup = await tx.vsl.findFirst({ where: { playerId: parsed.embed.playerId } });
        if (dup) throw new VslActionError(`Esse player já está na biblioteca como "${dup.name}".`);
        const pitch = pitchOf(body.pitch);
        const v = await tx.vsl.create({
          data: {
            name,
            accountId: parsed.embed.accountId,
            playerId: parsed.embed.playerId,
            scriptUrl: parsed.embed.scriptUrl,
            aspectPct: parsed.embed.aspectPct,
            pitchSeconds: pitch,
            notes: text(body.notes, 'Notas', 500, false),
            createdById: actor.id,
          },
        });
        await log(tx, actor, { kind: 'vsl_created', vslId: v.id, toVslId: v.id, detail: `VSL "${name}" cadastrada (pitch ${formatPitch(pitch)}).` });
        return { id: v.id, message: `"${name}" entrou na biblioteca.` };
      }

      case 'update_vsl': {
        const v = await vslOrThrow(tx, body.id, { allowArchived: true });
        const data: Prisma.VslUpdateInput = {};
        const changes: string[] = [];
        if (body.name !== undefined) {
          const name = text(body.name, 'Nome', 80)!;
          if (name !== v.name) { data.name = name; changes.push(`nome "${v.name}" → "${name}"`); }
        }
        if (body.pitch !== undefined) {
          const pitch = pitchOf(body.pitch);
          if (pitch !== v.pitchSeconds) { data.pitchSeconds = pitch; changes.push(`pitch ${formatPitch(v.pitchSeconds)} → ${formatPitch(pitch)}`); }
        }
        if (body.code !== undefined && String(body.code).trim()) {
          const parsed = parseVturbEmbed(body.code);
          if (!parsed.ok) throw new VslActionError(parsed.error);
          if (parsed.embed.playerId !== v.playerId) {
            // Um vídeo = uma VSL: trocar o player de uma VSL em uso misturaria
            // a métrica de dois vídeos (e a reserva do snippet tem o antigo).
            const [inPages, inTests] = await Promise.all([
              tx.vslPage.count({ where: { OR: [{ vslId: v.id }, { fallbackVslId: v.id }] } }),
              tx.vslTestArm.count({ where: { vslId: v.id } }),
            ]);
            const inRules = await tx.vslAffiliateRule.count({ where: { vslId: v.id } });
            if (inPages || inTests || inRules) {
              throw new VslActionError(`"${v.name}" já está em uso — para outro vídeo, cadastre uma VSL nova (assim a métrica de cada vídeo fica separada).`);
            }
            const dup = await tx.vsl.findFirst({ where: { playerId: parsed.embed.playerId, id: { not: v.id } } });
            if (dup) throw new VslActionError(`Esse player já está na biblioteca como "${dup.name}".`);
            changes.push(`player ${v.playerId} → ${parsed.embed.playerId}`);
          }
          Object.assign(data, { accountId: parsed.embed.accountId, playerId: parsed.embed.playerId, scriptUrl: parsed.embed.scriptUrl, aspectPct: parsed.embed.aspectPct });
        }
        if (body.notes !== undefined) data.notes = text(body.notes, 'Notas', 500, false);
        await tx.vsl.update({ where: { id: v.id }, data });
        if (changes.length) {
          await log(tx, actor, { kind: 'vsl_updated', vslId: v.id, detail: `VSL "${v.name}": ${changes.join(' · ')}.` });
        }
        return { id: v.id, message: changes.length ? `"${data.name ?? v.name}" atualizada — as páginas que usam essa VSL já recebem a mudança.` : 'Nada mudou.' };
      }

      case 'archive_vsl':
      case 'restore_vsl': {
        const v = await vslOrThrow(tx, body.id, { allowArchived: true });
        const archive = action === 'archive_vsl';
        if (archive) {
          const [pagesUsing, armsUsing, rulesUsing] = await Promise.all([
            tx.vslPage.findMany({ where: { OR: [{ vslId: v.id }, { fallbackVslId: v.id }] } }),
            tx.vslTestArm.findMany({ where: { vslId: v.id, test: { status: { in: ['running', 'paused'] } } }, include: { test: { include: { page: true } } } }),
            tx.vslAffiliateRule.findMany({ where: { vslId: v.id }, include: { page: true } }),
          ]);
          if (pagesUsing.length || armsUsing.length || rulesUsing.length) {
            const where = [
              ...pagesUsing.map(pageLabel),
              ...armsUsing.map((a) => `teste em ${pageLabel(a.test.page)}`),
              ...rulesUsing.map((r) => `regra de afiliado em ${pageLabel(r.page)}`),
            ];
            throw new VslActionError(`"${v.name}" ainda está em uso (${[...new Set(where)].join('; ')}). Troque antes de arquivar.`);
          }
        }
        await tx.vsl.update({ where: { id: v.id }, data: { archived: archive } });
        await log(tx, actor, { kind: archive ? 'vsl_archived' : 'vsl_restored', vslId: v.id, detail: `VSL "${v.name}" ${archive ? 'arquivada' : 'restaurada'}.` });
        return { id: v.id, message: `"${v.name}" ${archive ? 'arquivada' : 'restaurada'}.` };
      }

      case 'create_page': {
        const family = text(body.family, 'Família', 80)!;
        const platform = text(body.platform, 'Plataforma', 40)!;
        if (!isVslStage(body.stage)) throw new VslActionError('Escolha a etapa (UP01…DOWN03).');
        const stage = body.stage as VslStage;
        const v = await vslOrThrow(tx, body.vslId);
        const variant = text(body.variant, 'Variante', 40, false) ?? '';
        const feBottles = bottlesOf(body.feBottles);
        const exists = await tx.vslPage.findUnique({ where: { family_stage_platform_variant: { family, stage, platform, variant } } });
        if (exists) {
          throw new VslActionError(variant
            ? `A variante "${variant}" de ${family} · ${stage} · ${platform} já existe.`
            : `${family} · ${stage} · ${platform} já tem uma página. Para outra página na mesma etapa, dê um nome de variante (ex.: 2–3 potes).`);
        }
        let key = pageKeyFor(family, stage, platform, variant);
        if (await tx.vslPage.findUnique({ where: { key } })) key = `${key}${Date.now().toString(36).slice(-3)}`;
        const p = await tx.vslPage.create({
          data: { key, family, stage, platform, variant, feBottles, vslId: v.id, fallbackVslId: v.id, createdById: actor.id },
        });
        await log(tx, actor, { kind: 'page_created', pageId: p.id, pageKey: key, toVslId: v.id, vslId: v.id, detail: `Página ${pageLabel(p)} criada com "${v.name}" (também é a reserva do snippet).` });
        return { id: p.id, message: `Página criada. Copie o snippet e cole no lugar do player.` };
      }

      case 'create_aff_rule': {
        const p = await pageOrThrow(tx, body.pageId);
        if (!affiliateSourceFor(p.platform)) {
          throw new VslActionError(`Regra por afiliado ainda não existe pra ${p.platform}: a página não recebe o afiliado.`);
        }
        const v = await vslOrThrow(tx, body.vslId);
        const aff = typeof body.affiliateId === 'string'
          ? await tx.affiliate.findUnique({ where: { id: body.affiliateId }, include: { platform: true } })
          : null;
        if (!aff || aff.platform.slug !== p.platform) throw new VslActionError('Afiliado não encontrado nesta plataforma.', 404);
        const dup = await tx.vslAffiliateRule.findUnique({ where: { pageId_affiliateId: { pageId: p.id, affiliateId: aff.id } } });
        if (dup) throw new VslActionError('Esse afiliado já tem regra nesta página — troque a VSL na regra que já existe.');
        if (!affiliateKeyReadable(p.platform, aff.externalId)) {
          throw new VslActionError(`A conta ${aff.externalId} não tem o formato que a página lê${p.platform === 'buygoods' ? ' (BuyGoods: aff_id@loja)' : ''}.`);
        }
        const r = await tx.vslAffiliateRule.create({
          data: { pageId: p.id, affiliateId: aff.id, affiliateExternalId: aff.externalId, vslId: v.id, createdById: actor.id },
        });
        await log(tx, actor, { kind: 'aff_rule_created', pageId: p.id, pageKey: p.key, ruleId: r.id, vslId: v.id, toVslId: v.id,
          detail: `${pageLabel(p)}: afiliado ${aff.nickname ?? aff.externalId} (${aff.externalId}) passa a ver "${v.name}".` });
        return { id: r.id, message: `Regra criada: ${aff.nickname ?? aff.externalId} vê "${v.name}" — entra na página em até 1 minuto.` };
      }

      case 'update_aff_rule':
      case 'delete_aff_rule': {
        const r = typeof body.ruleId === 'string'
          ? await tx.vslAffiliateRule.findUnique({ where: { id: body.ruleId }, include: { page: true, vsl: true } })
          : null;
        if (!r) throw new VslActionError('Regra não encontrada.', 404);
        const aff = await tx.affiliate.findUnique({ where: { id: r.affiliateId }, select: { nickname: true, externalId: true } });
        const who = aff?.nickname ?? r.affiliateExternalId;
        if (action === 'delete_aff_rule') {
          await tx.vslAffiliateRule.delete({ where: { id: r.id } });
          await log(tx, actor, { kind: 'aff_rule_deleted', pageId: r.pageId, pageKey: r.page.key, ruleId: r.id,
            detail: `${pageLabel(r.page)}: regra do afiliado ${who} removida (volta pra VSL da página / teste).` });
          return { id: r.id, message: 'Regra removida.' };
        }
        const data: Prisma.VslAffiliateRuleUpdateInput = {};
        const changes: string[] = [];
        if (typeof body.vslId === 'string' && body.vslId !== r.vslId) {
          const v = await vslOrThrow(tx, body.vslId);
          data.vsl = { connect: { id: v.id } };
          changes.push(`"${r.vsl.name}" → "${v.name}"`);
        }
        if (typeof body.enabled === 'boolean' && body.enabled !== r.enabled) {
          data.enabled = body.enabled;
          changes.push(body.enabled ? 'religada' : 'desligada');
        }
        if (!changes.length) return { id: r.id, message: 'Nada mudou.' };
        await tx.vslAffiliateRule.update({ where: { id: r.id }, data });
        const kind = typeof data.enabled === 'boolean' && !data.vsl ? (data.enabled ? 'aff_rule_enabled' : 'aff_rule_disabled') : 'aff_rule_updated';
        await log(tx, actor, { kind, pageId: r.pageId, pageKey: r.page.key, ruleId: r.id,
          detail: `${pageLabel(r.page)}: regra do afiliado ${who} — ${changes.join(' · ')}.` });
        return { id: r.id, message: 'Regra atualizada.' };
      }

      case 'update_variant': {
        // Rótulo e potes do FE mudam; a chave (snippet) fica a da criação.
        const p = await pageOrThrow(tx, body.pageId);
        const variant = text(body.variant, 'Variante', 40, false) ?? '';
        const feBottles = bottlesOf(body.feBottles);
        if (variant !== p.variant) {
          const clash = await tx.vslPage.findUnique({ where: { family_stage_platform_variant: { family: p.family, stage: p.stage, platform: p.platform, variant } } });
          if (clash) throw new VslActionError(variant ? `Já existe a variante "${variant}" nesta etapa.` : 'Esta etapa já tem uma página sem variante.');
        }
        await tx.vslPage.update({ where: { id: p.id }, data: { variant, feBottles } });
        const potes = feBottles.length ? `front com ${feBottles.join('/')} pote${feBottles.length === 1 && feBottles[0] === 1 ? '' : 's'}` : 'qualquer front';
        await log(tx, actor, { kind: 'page_variant', pageId: p.id, pageKey: p.key, detail: `${pageLabel(p)} → variante "${variant || 'sem nome'}", ${potes}.` });
        return { id: p.id, message: 'Variante salva. O snippet não muda.' };
      }

      case 'assign_vsl': {
        const p = await pageOrThrow(tx, body.pageId);
        const v = await vslOrThrow(tx, body.vslId);
        if (await openTest(tx, p.id)) throw new VslActionError('Há um teste A/B aberto nesta página — encerre o teste para fixar uma VSL.');
        if (p.vslId === v.id) return { id: p.id, message: 'Essa VSL já está no ar.' };
        const prev = p.vslId ? await tx.vsl.findUnique({ where: { id: p.vslId } }) : null;
        await tx.vslPage.update({ where: { id: p.id }, data: { vslId: v.id } });
        await log(tx, actor, { kind: 'vsl_assigned', pageId: p.id, pageKey: p.key, vslId: v.id, fromVslId: p.vslId, toVslId: v.id, detail: `${pageLabel(p)}: "${prev?.name ?? 'reserva'}" → "${v.name}".` });
        return { id: p.id, message: `"${v.name}" no ar em ${pageLabel(p)} — entra na página em até 1 minuto.` };
      }

      case 'set_enabled': {
        const p = await pageOrThrow(tx, body.pageId);
        const enabled = body.enabled === true;
        if (p.enabled === enabled) return { id: p.id, message: 'Nada mudou.' };
        await tx.vslPage.update({ where: { id: p.id }, data: { enabled } });
        await log(tx, actor, { kind: enabled ? 'page_enabled' : 'page_disabled', pageId: p.id, pageKey: p.key, detail: `${pageLabel(p)} ${enabled ? 'religada — volta a seguir o dash' : 'desligada — toca a reserva do snippet'}.` });
        return { id: p.id, message: enabled ? 'Página religada.' : 'Página desligada: ela toca a reserva do snippet.' };
      }

      case 'set_fallback': {
        const p = await pageOrThrow(tx, body.pageId);
        const v = await vslOrThrow(tx, body.vslId);
        await tx.vslPage.update({ where: { id: p.id }, data: { fallbackVslId: v.id } });
        await log(tx, actor, { kind: 'fallback_set', pageId: p.id, pageKey: p.key, vslId: v.id, fromVslId: p.fallbackVslId, toVslId: v.id, detail: `${pageLabel(p)}: reserva do snippet agora é "${v.name}" (cole o snippet novo na página).` });
        return { id: p.id, message: 'Reserva trocada — o snippet mudou: cole a versão nova na página.' };
      }

      case 'reset_page_url': {
        const p = await pageOrThrow(tx, body.pageId);
        await tx.vslPage.update({ where: { id: p.id }, data: { lastSeenUrl: null } });
        await log(tx, actor, { kind: 'page_url_reset', pageId: p.id, pageKey: p.key, detail: `${pageLabel(p)}: endereço da página redefinido (o próximo acesso grava o novo).` });
        return { id: p.id, message: 'Endereço redefinido — o próximo acesso à página grava o novo.' };
      }

      case 'delete_page': {
        const p = await pageOrThrow(tx, body.pageId);
        if (await openTest(tx, p.id)) throw new VslActionError('Encerre o teste A/B desta página antes de excluir.');
        await tx.vslPage.delete({ where: { id: p.id } });
        await log(tx, actor, { kind: 'page_deleted', pageId: p.id, pageKey: p.key, detail: `Página ${pageLabel(p)} excluída (a página real passa a tocar a reserva do snippet).` });
        return { message: 'Página excluída. Se o snippet continuar na página, ela toca a reserva.' };
      }

      case 'preview': {
        const p = await pageOrThrow(tx, body.pageId);
        const v = await vslOrThrow(tx, body.vslId);
        const until = new Date(Date.now() + PREVIEW_MINUTES * 60_000);
        await tx.vslPage.update({ where: { id: p.id }, data: { previewVslId: v.id, previewUntil: until } });
        await log(tx, actor, { kind: 'preview_started', pageId: p.id, pageKey: p.key, vslId: v.id, detail: `Pré-visualização de "${v.name}" em ${pageLabel(p)} por ${PREVIEW_MINUTES} min.` });
        return { id: p.id, message: `Pré-visualização liberada por ${PREVIEW_MINUTES} min.` };
      }

      case 'start_test': {
        const p = await pageOrThrow(tx, body.pageId);
        // Trava a linha da página: dois "começar teste" ao mesmo tempo não
        // abrem dois testes (o índice parcial do banco é a segunda trava).
        await tx.$queryRaw`SELECT id FROM "VslPage" WHERE id = ${p.id} FOR UPDATE`;
        if (await openTest(tx, p.id)) throw new VslActionError('Esta página já tem um teste aberto.');
        const rawArms = Array.isArray(body.arms) ? body.arms : [];
        if (rawArms.length < 2 || rawArms.length > 4) throw new VslActionError('Um teste tem de 2 a 4 VSLs.');
        const arms: Array<{ vsl: VslRow; weight: number }> = [];
        for (const a of rawArms as Array<Record<string, unknown>>) {
          const v = await vslOrThrow(tx, a?.vslId);
          const w = Number(a?.weight);
          if (!Number.isInteger(w) || w < 0 || w > 100) throw new VslActionError('Peso de cada VSL: número inteiro de 0 a 100.');
          if (arms.some((x) => x.vsl.id === v.id)) throw new VslActionError(`"${v.name}" aparece duas vezes no teste.`);
          arms.push({ vsl: v, weight: w });
        }
        if (arms.reduce((s, a) => s + a.weight, 0) !== 100) throw new VslActionError('Os pesos precisam somar 100%.');
        if (arms.filter((a) => a.weight > 0).length < 2) throw new VslActionError('Pelo menos duas VSLs precisam receber tráfego.');
        const name = text(body.name, 'Nome do teste', 80, false) ?? `${arms.map((a) => a.vsl.name).join(' × ')}`.slice(0, 80);
        const t = await tx.vslTest.create({
          data: {
            pageId: p.id,
            name,
            status: 'running',
            createdById: actor.id,
            arms: { create: arms.map((a, i) => ({ vslId: a.vsl.id, weight: a.weight, label: ARM_LABELS[i] })) },
          },
        });
        await log(tx, actor, { kind: 'test_started', pageId: p.id, pageKey: p.key, testId: t.id, detail: `Teste "${name}" em ${pageLabel(p)}: ${arms.map((a, i) => `${ARM_LABELS[i]} ${a.vsl.name} ${a.weight}%`).join(' · ')}.` });
        return { id: t.id, message: 'Teste no ar — cada visitante fica sempre na mesma VSL.' };
      }

      case 'pause_test':
      case 'resume_test': {
        const t = typeof body.testId === 'string' ? await tx.vslTest.findUnique({ where: { id: body.testId }, include: { page: true } }) : null;
        if (!t) throw new VslActionError('Teste não encontrado.', 404);
        const pause = action === 'pause_test';
        if (t.status === 'finished') throw new VslActionError('O teste já foi encerrado.');
        if ((pause && t.status === 'paused') || (!pause && t.status === 'running')) return { id: t.id, message: 'Nada mudou.' };
        await tx.vslTest.update({ where: { id: t.id }, data: { status: pause ? 'paused' : 'running' } });
        await log(tx, actor, { kind: pause ? 'test_paused' : 'test_resumed', pageId: t.pageId, pageKey: t.page.key, testId: t.id, detail: `Teste "${t.name}" ${pause ? 'pausado — a página volta pra VSL fixa' : 'retomado'}.` });
        return { id: t.id, message: pause ? 'Teste pausado: a página toca a VSL fixa até retomar.' : 'Teste retomado.' };
      }

      case 'update_weights': {
        const t = typeof body.testId === 'string' ? await tx.vslTest.findUnique({ where: { id: body.testId }, include: { arms: true, page: true } }) : null;
        if (!t) throw new VslActionError('Teste não encontrado.', 404);
        if (t.status === 'finished') throw new VslActionError('O teste já foi encerrado.');
        const weights = (Array.isArray(body.weights) ? body.weights : []) as Array<Record<string, unknown>>;
        const map = new Map(weights.map((w) => [String(w?.armId), Number(w?.weight)]));
        const next = t.arms.map((a) => ({ a, w: map.has(a.id) ? map.get(a.id)! : a.weight }));
        if (next.some((x) => !Number.isInteger(x.w) || x.w < 0 || x.w > 100)) throw new VslActionError('Peso: número inteiro de 0 a 100.');
        if (next.reduce((s, x) => s + x.w, 0) !== 100) throw new VslActionError('Os pesos precisam somar 100%.');
        if (next.filter((x) => x.w > 0).length < 2) throw new VslActionError('Pelo menos duas VSLs precisam receber tráfego.');
        for (const x of next) await tx.vslTestArm.update({ where: { id: x.a.id }, data: { weight: x.w } });
        await log(tx, actor, { kind: 'test_weights', pageId: t.pageId, pageKey: t.page.key, testId: t.id, detail: `Teste "${t.name}": pesos ${next.sort((p, q) => p.a.label.localeCompare(q.a.label)).map((x) => `${x.a.label} ${x.w}%`).join(' · ')} (visitante antigo continua na VSL que já viu).` });
        return { id: t.id, message: 'Pesos atualizados para novos visitantes.' };
      }

      case 'finish_test': {
        const t = typeof body.testId === 'string' ? await tx.vslTest.findUnique({ where: { id: body.testId }, include: { arms: true, page: true } }) : null;
        if (!t) throw new VslActionError('Teste não encontrado.', 404);
        if (t.status === 'finished') throw new VslActionError('O teste já foi encerrado.');
        const winnerId = typeof body.winnerVslId === 'string' && body.winnerVslId ? body.winnerVslId : null;
        if (winnerId && !t.arms.some((a) => a.vslId === winnerId)) throw new VslActionError('O vencedor precisa ser uma das VSLs do teste.');
        const winner = winnerId ? await vslOrThrow(tx, winnerId) : null;
        await tx.vslTest.update({ where: { id: t.id }, data: { status: 'finished', endedAt: new Date(), winnerVslId: winnerId } });
        if (winner) await tx.vslPage.update({ where: { id: t.pageId }, data: { vslId: winner.id } });
        await log(tx, actor, {
          kind: 'test_finished', pageId: t.pageId, pageKey: t.page.key, testId: t.id, toVslId: winner?.id ?? null, vslId: winner?.id ?? null,
          detail: `Teste "${t.name}" encerrado${winner ? ` — "${winner.name}" fica no ar` : ' sem aplicar vencedor (a página continua na VSL fixa)'}.`,
        });
        return { id: t.id, message: winner ? `Teste encerrado: "${winner.name}" no ar.` : 'Teste encerrado.' };
      }

      default:
        throw new VslActionError('Ação desconhecida.');
    }
  }).catch(conflictToActionError);
  invalidateVslCaches();
  logger.info({ action, actor: actor.id }, 'vsl.action');
  return { ok: true, ...result };
}
