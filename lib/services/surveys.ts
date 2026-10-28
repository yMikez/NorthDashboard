// Pesquisas / quiz pós-compra: convite, página pública, respostas e a aba
// Pesquisas do dash. Regra e texto em lib/surveys/fimTratamento.ts; HTML em
// lib/surveys/render.ts.
//
// Escrita sempre no `db` (public). A lista de elegíveis lê a lead_summary pelo
// `dbRead` — a mesma conta de estoque da aba Leads (30 dias por frasco).

import { randomBytes } from 'node:crypto';
import {
  Prisma, type SurveyExperiment, type SurveyInvite, type SurveyResponse, type SurveyVariant,
} from '@prisma/client';
import { db, dbRead } from '../db';
import {
  DEFAULT_COPY, FIM_TRATAMENTO, SURVEY_TRACKING_PREFIX, availableOffers, checkoutUrl, cleanAnswer, decideOutcome,
  firstNameOf, kitSizeFor, q4Options, segmentOf,
  type CheckoutKind, type OutcomeDecision, type SurveyAnswers, type SurveyVariantConfig,
} from '../surveys/fimTratamento';
import {
  CONTROL_ARM, armConfig, armsOf, configDiff, pickArm, proportionTest, sanitizeArms,
  type ExperimentArm, type ProportionTest,
} from '../surveys/experiments';
import { renderSurveyInvalid, renderSurveyPage } from '../surveys/render';
import { sanitizeVariantConfig } from '../surveys/variantConfig';

export const SURVEY_PUBLIC_URL = (process.env.SURVEY_PUBLIC_URL ?? 'https://checkin.healthnwellnes.com').replace(/\/+$/, '');
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CS_DEADLINE_MS = 24 * 3600 * 1000;
export const CS_STATUSES = ['aberto', 'ligado', 'resolvido'] as const;
export type CsStatus = (typeof CS_STATUSES)[number];

export const surveyLink = (slug: string, token: string) => `${SURVEY_PUBLIC_URL}/${slug}/${token}`;
const newToken = () => randomBytes(18).toString('base64url');
const cfgOf = (v: SurveyVariant) => v.config as unknown as SurveyVariantConfig;
const answersOf = (r: SurveyResponse | null | undefined) => (r?.answers ?? {}) as SurveyAnswers;
/** Kit oferecido e ofertas disponíveis pra quem comprou `bottles` frascos. */
function offerContext(cfg: SurveyVariantConfig, bottles: number) {
  const kit = kitSizeFor(cfg, segmentOf(cfg, bottles), bottles);
  return { kit, av: availableOffers(cfg, kit) };
}

type InviteFull = SurveyInvite & {
  variant: SurveyVariant; response: SurveyResponse | null; experiment: SurveyExperiment | null;
};

async function loadInvite(token: string): Promise<InviteFull | null> {
  if (!TOKEN_RE.test(token)) return null;
  const inv = await db.surveyInvite.findUnique({ where: { token }, include: { variant: true, response: true, experiment: true } });
  return inv && inv.variant.active ? inv : null;
}

const runningExperiment = (variantId: string) =>
  db.surveyExperiment.findFirst({ where: { variantId, status: 'running' }, orderBy: { startedAt: 'desc' } });

/**
 * O que a pessoa vê: a versão do teste A/B em que caiu enquanto o teste roda;
 * depois de encerrado, só quem já tinha começado segue nela (a oferta que viu
 * continua a mesma) — o resto volta pra pesquisa como está.
 */
function inviteConfig(inv: InviteFull): SurveyVariantConfig {
  const base = cfgOf(inv.variant);
  const exp = inv.experiment;
  if (!exp || !inv.arm) return base;
  if (exp.status !== 'running' && !inv.response) return base;
  return armConfig(base, armsOf(exp.arms).find((a) => a.key === inv.arm));
}

// ---------- página pública ----------

export async function surveyPageHtml(slug: string, token: string): Promise<{ status: number; html: string }> {
  const inv = await loadInvite(token);
  if (!inv || inv.variant.slug !== slug) {
    const variant = await db.surveyVariant.findUnique({ where: { slug } }).catch(() => null);
    return { status: 404, html: renderSurveyInvalid(variant ? cfgOf(variant) : null) };
  }
  const data: Prisma.SurveyInviteUpdateInput = {};
  if (!inv.openedAt) data.openedAt = new Date();
  // Sorteio do teste A/B: só quem nunca caiu em teste e ainda não começou a responder.
  if (!inv.response && !inv.experimentId) {
    const exp = await runningExperiment(inv.variantId);
    if (exp) {
      const arm = pickArm(armsOf(exp.arms), `${exp.id}:${inv.id}`);
      data.experiment = { connect: { id: exp.id } };
      data.arm = arm;
      Object.assign(inv, { experiment: exp, experimentId: exp.id, arm });
    }
  }
  if (Object.keys(data).length) await db.surveyInvite.update({ where: { id: inv.id }, data });
  const html = renderSurveyPage({
    cfg: inviteConfig(inv),
    ctx: { firstName: inv.firstName, bottles: inv.bottles },
    slug, token, preview: false,
    answers: answersOf(inv.response),
    outcome: (inv.response?.completedAt ? inv.response.outcome : null) as OutcomeDecision['outcome'] | null,
    couponPct: inv.response?.couponPct ?? null,
    followUp: inv.response?.followUp ?? false,
  });
  return { status: 200, html };
}

/** Frascos válidos na pré-visualização (2, 3, 6…); o padrão é o último do plano incompleto. */
function previewBottles(cfg: SurveyVariantConfig, raw: unknown): number {
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 24) return n;
  return cfg.eligibleBottles?.[cfg.eligibleBottles.length - 1] ?? 3;
}

/** Versão de um teste A/B pra pré-visualizar (exp + arm); sem isso, a pesquisa como está. */
export interface PreviewArm { exp?: unknown; arm?: unknown }

async function previewConfig(variant: SurveyVariant, p?: PreviewArm): Promise<{ cfg: SurveyVariantConfig; exp: string | null; arm: string | null }> {
  const base = cfgOf(variant);
  if (typeof p?.exp !== 'string' || typeof p.arm !== 'string' || !p.exp || !p.arm) return { cfg: base, exp: null, arm: null };
  const exp = await db.surveyExperiment.findFirst({ where: { id: p.exp, variantId: variant.id } });
  const arm = exp ? armsOf(exp.arms).find((a) => a.key === p.arm) : undefined;
  return arm && exp ? { cfg: armConfig(base, arm), exp: exp.id, arm: arm.key } : { cfg: base, exp: null, arm: null };
}

/** Pré-visualização pro dash: dados de exemplo, nada é gravado. ?bottles=6 mostra o público completo. */
export async function surveyPreviewHtml(slug: string, bottles?: unknown, p?: PreviewArm): Promise<string | null> {
  const variant = await db.surveyVariant.findUnique({ where: { slug } });
  if (!variant) return null;
  const { cfg, exp, arm } = await previewConfig(variant, p);
  return renderSurveyPage({
    cfg, ctx: { firstName: 'John', bottles: previewBottles(cfg, bottles) },
    slug, token: '', preview: true, answers: {}, outcome: null, couponPct: null, followUp: false,
    previewArm: exp && arm ? { exp, arm } : null,
  });
}

export async function previewOutcome(slug: string, raw: unknown, bottles?: unknown, p?: PreviewArm): Promise<OutcomeDecision | null> {
  const variant = await db.surveyVariant.findUnique({ where: { slug } });
  if (!variant) return null;
  const { cfg } = await previewConfig(variant, p);
  return decideOutcome(cleanAll(cfg, raw), offerContext(cfg, previewBottles(cfg, bottles)).av);
}

function cleanAll(cfg: SurveyVariantConfig, raw: unknown): SurveyAnswers {
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const c = cleanAnswer(cfg, k, v);
      if (c) out[c.key] = c.value;
    }
  }
  return out as SurveyAnswers;
}

// ---------- respostas ----------

export type SaveResult = { ok: true } | { ok: false; status: 400 | 404 };

export async function saveSurveyAnswer(token: string, key: string, value: unknown): Promise<SaveResult> {
  const inv = await loadInvite(token);
  if (!inv) return { ok: false, status: 404 };
  const clean = cleanAnswer(inviteConfig(inv), key, value);
  if (!clean) return { ok: false, status: 400 };
  // Concluída: só o "Not now" ainda conta (a resposta que decidiu fica como foi).
  if (inv.response?.completedAt && clean.key !== 'dispensou') return { ok: true };
  const answers = { ...answersOf(inv.response), [clean.key]: clean.value } as Prisma.InputJsonObject;
  await db.surveyResponse.upsert({
    where: { inviteId: inv.id },
    create: { inviteId: inv.id, variantId: inv.variantId, variantVersion: inv.variant.version, answers },
    update: { answers },
  });
  return { ok: true };
}

/** Conclui: junta o que já foi gravado com o que a página manda e decide a tela final. */
export async function finishSurvey(token: string, raw: unknown): Promise<OutcomeDecision | null> {
  const inv = await loadInvite(token);
  if (!inv) return null;
  if (inv.response?.completedAt && inv.response.outcome) {
    return {
      outcome: inv.response.outcome as OutcomeDecision['outcome'],
      csReason: (inv.response.csReason ?? null) as OutcomeDecision['csReason'],
      couponPct: inv.response.couponPct,
      followUp: inv.response.followUp,
    };
  }
  const cfg = inviteConfig(inv);
  const answers = { ...answersOf(inv.response), ...cleanAll(cfg, raw) };
  const d = decideOutcome(answers, offerContext(cfg, inv.bottles).av);
  const now = new Date();
  const data = {
    answers: answers as Prisma.InputJsonObject,
    outcome: d.outcome,
    couponPct: d.couponPct,
    followUp: d.followUp,
    completedAt: now,
    csReason: d.csReason,
    csStatus: d.outcome === 'cs' ? 'aberto' : null,
    csDueAt: d.outcome === 'cs' ? new Date(now.getTime() + CS_DEADLINE_MS) : null,
  };
  await db.surveyResponse.upsert({
    where: { inviteId: inv.id },
    create: { inviteId: inv.id, variantId: inv.variantId, variantVersion: inv.variant.version, ...data },
    update: data,
  });
  return d;
}

const CHECKOUT_KINDS: readonly CheckoutKind[] = ['assinatura', 'kit', 'cupom'];

/**
 * Clique no botão do checkout: registra e devolve o link com o rastreio. O
 * preço do cupom fica reservado por couponValidDays depois da pesquisa (é o
 * que a página promete); depois disso o botão leva ao kit no preço de recompra.
 */
export async function surveyCheckoutRedirect(token: string, kind: string, size?: string | null): Promise<string | null> {
  if (!(CHECKOUT_KINDS as readonly string[]).includes(kind)) return null;
  const inv = await loadInvite(token);
  if (!inv?.response) return null;
  const cfg = inviteConfig(inv);
  // "See all plans": o cliente escolheu outro kit; só vale tamanho que existe na variante.
  const chosen = kind === 'kit' && size && cfg.offers?.kits?.[size]?.url ? Number(size) : null;
  const kit = chosen ?? offerContext(cfg, inv.bottles).kit;
  let k = kind as CheckoutKind;
  const done = inv.response.completedAt;
  if (k === 'cupom' && done && Date.now() - done.getTime() > (cfg.couponValidDays ?? 7) * 86400000) k = 'kit';
  const url = checkoutUrl(cfg, k, inv.response.id, { kit, couponPct: inv.response.couponPct });
  if (!url) return null;
  await db.surveyResponse.update({
    where: { id: inv.response.id },
    data: { checkoutAt: new Date(), checkoutOutcome: k === 'kit' && kit != null ? `kit:${kit}` : k },
  });
  return url;
}

// ---------- convites (lista de quem está com o estoque acabando) ----------
//
// A lista mora AQUI (SurveyInvite): o dash decide quem entra (regra de estoque
// da aba Leads), não repete a mesma pessoa pro mesmo estoque e guarda o link
// pessoal. O n8n só puxa (POST cria os novos, GET relê os pendentes) e quem
// dispara marca o envio (markSurveyInvitesSent).

export type InviteStatus = 'pendente' | 'enviado' | 'abriu' | 'respondeu' | 'concluiu';

export interface SurveyInviteOut {
  id: string;
  variant: string;
  product: string;
  /** parcial = comprou 2–3 frascos; completo = 6+. */
  segment: 'parcial' | 'completo';
  email: string;
  firstName: string | null;
  phone: string | null;
  bottles: number;
  stockUntil: string;
  /** Dias até o produto acabar (negativo = já acabou). */
  daysLeft: number;
  link: string;
  status: InviteStatus;
  channel: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface CreateInvitesResult {
  variant: string;
  eligible: number;
  created: number;
  invites: SurveyInviteOut[];
}

type InviteRow = SurveyInvite & { variant: SurveyVariant; response?: SurveyResponse | null };

function inviteStatus(i: InviteRow): InviteStatus {
  if (i.response?.completedAt) return 'concluiu';
  if (i.response) return 'respondeu';
  if (i.openedAt) return 'abriu';
  return i.sentAt ? 'enviado' : 'pendente';
}

export function inviteOut(i: InviteRow, now = Date.now()): SurveyInviteOut {
  const cfg = cfgOf(i.variant);
  return {
    id: i.id,
    variant: i.variant.slug,
    product: cfg.productName,
    segment: segmentOf(cfg, i.bottles),
    email: i.email,
    firstName: i.firstName,
    phone: i.phone,
    bottles: i.bottles,
    stockUntil: i.stockUntil.toISOString(),
    daysLeft: Math.ceil((i.stockUntil.getTime() - now) / 86400000),
    link: surveyLink(i.variant.slug, i.token),
    status: inviteStatus(i),
    channel: i.channel,
    sentAt: i.sentAt ? i.sentAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
  };
}

/** Pesquisas que geram convite: a pedida, ou todas as ativas com produto. */
export async function activeSurveySlugs(slug?: string | null): Promise<string[]> {
  if (slug && slug !== 'all') return [slug];
  const rows = await db.surveyVariant.findMany({ where: { active: true, family: { not: null } }, select: { slug: true }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => r.slug);
}

/**
 * Quem recebe: o último produto da pessoa é o da variante, comprou 2 ou 3
 * frascos (config.eligibleBottles) ou o plano inteiro e mais (≥
 * config.fullPlanFrom), sem estorno, e o estoque acaba nos próximos
 * `withinDays` dias. Quem já tem convite pra esse mesmo estoque não
 * ganha outro. `channel` marca como enviado agora.
 */
export async function createSurveyInvites(opts: {
  slug: string;
  withinDays?: number;
  limit?: number;
  dryRun?: boolean;
  channel?: string | null;
}): Promise<CreateInvitesResult | null> {
  const variant = await db.surveyVariant.findUnique({ where: { slug: opts.slug } });
  if (!variant || !variant.active || !variant.family) return null;
  const cfg = cfgOf(variant);
  const days = Math.min(Math.max(Math.trunc(opts.withinDays ?? 7), 1), 60);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 500), 1), 5000);
  const bottles = cfg.eligibleBottles?.length ? cfg.eligibleBottles : [2, 3];
  // Sem fullPlanFrom o público completo fica de fora (nenhum lead tem 1e9 frascos).
  const fullFrom = cfg.fullPlanFrom ?? 1_000_000_000;

  const rows = await dbRead.$queryRaw<Array<{
    email: string; name: string | null; phone: string | null; bottles: number; stock_until: Date; origin_platform: string | null;
  }>>(Prisma.sql`
    SELECT ls.email, ls.name, ls.phone, ls.bottles, ls.stock_until, ls.origin_platform
    FROM lead_summary ls
    WHERE ls.stock_family = ${variant.family}
      AND (ls.bottles = ANY(${bottles}::int[]) OR ls.bottles >= ${fullFrom}::int)
      AND COALESCE(ls.refunded_usd, 0) = 0
      AND ls.email IS NOT NULL
      AND ls.stock_until >= now() AND ls.stock_until < now() + make_interval(days => ${days}::int)
    ORDER BY ls.stock_until
    LIMIT ${limit}`);

  const existing = new Set(
    (await db.surveyInvite.findMany({
      where: { variantId: variant.id, email: { in: rows.map((r) => r.email) } },
      select: { email: true, stockUntil: true },
    })).map((i) => `${i.email}|${i.stockUntil.getTime()}`),
  );
  const fresh = rows.filter((r) => !existing.has(`${r.email}|${r.stock_until.getTime()}`));
  if (opts.dryRun) {
    return { variant: variant.slug, eligible: rows.length, created: 0, invites: [] };
  }

  const now = new Date();
  const data = fresh.map((r) => ({
    token: newToken(),
    variantId: variant.id,
    email: r.email,
    firstName: firstNameOf(r.name),
    phone: r.phone?.replace(/\D/g, '') || null,
    bottles: r.bottles,
    stockUntil: r.stock_until,
    originPlatform: r.origin_platform,
    channel: opts.channel ?? null,
    sentAt: opts.channel ? now : null,
  }));
  await db.surveyInvite.createMany({ data, skipDuplicates: true });
  const created = await db.surveyInvite.findMany({
    where: { token: { in: data.map((d) => d.token) } },
    include: { variant: true },
    orderBy: { stockUntil: 'asc' },
  });
  return {
    variant: variant.slug,
    eligible: rows.length,
    created: created.length,
    invites: created.map((i) => inviteOut(i)),
  };
}

/**
 * Lista atual (sem criar nada): convites das pesquisas ativas cujo estoque
 * acaba em até `withinDays` dias — inclusive quem já ficou sem produto, que
 * ainda é público da recompra. `onlyUnsent` = só os que ninguém disparou.
 */
export async function listSurveyInvites(opts: {
  slug?: string | null; withinDays?: number; onlyUnsent?: boolean; limit?: number;
}): Promise<SurveyInviteOut[]> {
  const days = Math.min(Math.max(Math.trunc(opts.withinDays ?? 7), 1), 60);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 2000), 1), 10000);
  const rows = await db.surveyInvite.findMany({
    where: {
      isTest: false,
      variant: { active: true, ...(opts.slug && opts.slug !== 'all' ? { slug: opts.slug } : {}) },
      stockUntil: { lt: new Date(Date.now() + days * 86400000) },
      ...(opts.onlyUnsent ? { sentAt: null } : {}),
    },
    include: { variant: true, response: true },
    orderBy: { stockUntil: 'asc' },
    take: limit,
  });
  const now = Date.now();
  return rows.map((i) => inviteOut(i, now));
}

/** Quem dispara marca o envio (e-mail, SMS…). Só conta o primeiro envio. */
export async function markSurveyInvitesSent(ids: string[], channel: string): Promise<number> {
  const clean = [...new Set(ids.filter((x) => typeof x === 'string' && x.length <= 40))].slice(0, 5000);
  if (!clean.length) return 0;
  const res = await db.surveyInvite.updateMany({
    where: { id: { in: clean }, sentAt: null },
    data: { sentAt: new Date(), channel: channel.slice(0, 20) || null },
  });
  return res.count;
}

/**
 * Convite de teste pra um e-mail qualquer (admin). Fica fora dos números da
 * aba. `arm` força a versão do teste A/B no ar (sem isso, sorteia ao abrir).
 */
export async function createSurveyTestInvite(opts: {
  slug: string; email: string; firstName?: string | null; bottles?: number; arm?: string | null;
}): Promise<(SurveyInviteOut & { arm: string | null }) | null> {
  const variant = await db.surveyVariant.findUnique({ where: { slug: opts.slug } });
  if (!variant) return null;
  const bottles = [2, 3, 6].includes(Number(opts.bottles)) ? Number(opts.bottles) : 3;
  const exp = opts.arm ? await runningExperiment(variant.id) : null;
  const arm = exp && armsOf(exp.arms).some((a) => a.key === opts.arm) ? opts.arm! : null;
  const inv = await db.surveyInvite.create({
    data: {
      token: newToken(), variantId: variant.id, email: opts.email.trim().toLowerCase(),
      firstName: opts.firstName?.trim() || null, bottles,
      stockUntil: new Date(Date.now() + 7 * 86400000), channel: 'manual', isTest: true,
      ...(exp && arm ? { experimentId: exp.id, arm } : {}),
    },
    include: { variant: true },
  });
  return { ...inviteOut(inv), arm: inv.arm };
}

// ---------- cadastro das variantes (aba Pesquisas, admin) ----------

export interface SurveyVariantAdmin {
  slug: string; name: string; family: string | null; active: boolean; version: number;
  config: SurveyVariantConfig; updatedAt: string;
}

type AdminResult<T> = ({ ok: true } & T) | { ok: false; status: 400 | 404 | 409; error: string };

const variantAdminOut = (v: SurveyVariant): SurveyVariantAdmin => ({
  slug: v.slug, name: v.name, family: v.family, active: v.active, version: v.version,
  config: cfgOf(v), updatedAt: v.updatedAt.toISOString(),
});

export async function listSurveyVariantsAdmin(): Promise<SurveyVariantAdmin[]> {
  const rows = await db.surveyVariant.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(variantAdminOut);
}

/** Texto padrão da página (as chaves que dá pra reescrever por pesquisa ou versão). */
export const surveyCopyDefaults = (): Record<string, string> => DEFAULT_COPY;

/**
 * Duas pesquisas no ar pro mesmo produto = a mesma pessoa em duas listas, com
 * dois links. Pra comparar textos/ofertas no mesmo produto existe o teste A/B.
 */
async function activeFamilyConflict(family: string | null, exceptId?: string): Promise<string | null> {
  if (!family) return null;
  const other = await db.surveyVariant.findFirst({
    where: { family, active: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { name: true },
  });
  return other ? `Já tem uma pesquisa no ar pra ${family} ("${other.name}"). Desligue a outra ou use um teste A/B.` : null;
}

async function familyExists(family: string): Promise<boolean> {
  return (await db.product.count({ where: { family } })) > 0;
}

function nameOf(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name && name.length <= 120 ? name : null;
}

/**
 * Salva o que veio do formulário. O texto/oferta muda → versão + 1 (cada
 * resposta guarda a versão que viu, pra comparar antes × depois).
 */
export async function updateSurveyVariant(
  slug: string,
  patch: { active?: unknown; name?: unknown; family?: unknown; config?: unknown },
): Promise<AdminResult<{ variant: SurveyVariantAdmin }>> {
  const current = await db.surveyVariant.findUnique({ where: { slug } });
  if (!current) return { ok: false, status: 404, error: 'pesquisa não encontrada' };
  const data: Prisma.SurveyVariantUpdateInput = {};
  if (patch.active !== undefined) data.active = patch.active === true;
  if (patch.name !== undefined) {
    const name = nameOf(patch.name);
    if (!name) return { ok: false, status: 400, error: 'Nome da pesquisa: obrigatório (até 120)' };
    data.name = name;
  }
  let family = current.family;
  if (patch.family !== undefined && patch.family !== current.family) {
    if (typeof patch.family !== 'string' || !(await familyExists(patch.family))) {
      return { ok: false, status: 400, error: 'Produto: escolha um produto do catálogo' };
    }
    family = data.family = patch.family;
  }
  const active = patch.active !== undefined ? patch.active === true : current.active;
  if (active && (!current.active || family !== current.family)) {
    const conflict = await activeFamilyConflict(family, current.id);
    if (conflict) return { ok: false, status: 409, error: conflict };
  }
  if (patch.config !== undefined) {
    const res = sanitizeVariantConfig(patch.config);
    if (!res.ok) return { ok: false, status: 400, error: res.error };
    if (JSON.stringify(res.config) !== JSON.stringify(current.config)) {
      data.config = res.config as unknown as Prisma.InputJsonObject;
      data.version = { increment: 1 };
    }
  }
  const v = await db.surveyVariant.update({ where: { slug }, data });
  return { ok: true, variant: variantAdminOut(v) };
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['api', 'survey-assets', '_next', 'login', 'admin', 'static', 'assets']);

/**
 * Pesquisa nova a partir de outra (as perguntas são as mesmas; muda produto,
 * ofertas, foto e textos). Nasce DESLIGADA. Produto diferente do da origem:
 * links de checkout, códigos de cupom e foto não vêm junto — são de outro
 * produto e mandariam o cliente pro checkout errado.
 */
export async function createSurveyVariant(input: {
  slug?: unknown; name?: unknown; family?: unknown; productName?: unknown; from?: unknown;
}): Promise<AdminResult<{ variant: SurveyVariantAdmin }>> {
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    return { ok: false, status: 400, error: 'Endereço: só letras minúsculas, números e hífen (ex.: neurorecall-2)' };
  }
  if (await db.surveyVariant.findUnique({ where: { slug }, select: { id: true } })) {
    return { ok: false, status: 409, error: `Já existe uma pesquisa em /${slug}` };
  }
  const name = nameOf(input.name);
  if (!name) return { ok: false, status: 400, error: 'Nome da pesquisa: obrigatório (até 120)' };
  const family = typeof input.family === 'string' ? input.family : '';
  if (!family || !(await familyExists(family))) return { ok: false, status: 400, error: 'Produto: escolha um produto do catálogo' };

  const fromSlug = typeof input.from === 'string' && input.from ? input.from : null;
  const source = fromSlug
    ? await db.surveyVariant.findUnique({ where: { slug: fromSlug } })
    : await db.surveyVariant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (fromSlug && !source) return { ok: false, status: 404, error: 'pesquisa de origem não encontrada' };
  const cfg: SurveyVariantConfig = structuredClone(source ? cfgOf(source) : { productName: family });
  cfg.productName = typeof input.productName === 'string' && input.productName.trim() ? input.productName.trim() : family;
  if (!source || source.family !== family) {
    cfg.image = null;
    if (cfg.offers?.assinatura) cfg.offers.assinatura.url = null;
    for (const k of Object.values(cfg.offers?.kits ?? {})) k.url = null;
    cfg.coupons = (cfg.coupons ?? []).map((c) => ({ pct: c.pct, code: null }));
  }
  const res = sanitizeVariantConfig(cfg);
  if (!res.ok) return { ok: false, status: 400, error: res.error };
  const v = await db.surveyVariant.create({
    data: {
      slug, template: FIM_TRATAMENTO, name, family, active: false,
      config: res.config as unknown as Prisma.InputJsonObject,
    },
  });
  return { ok: true, variant: variantAdminOut(v) };
}

// ---------- teste A/B (aba Pesquisas, admin) ----------

export interface SurveyExperimentAdmin {
  id: string; name: string; status: string; winner: string | null; createdBy: string | null;
  startedAt: string; endedAt: string | null;
  /** Versões com a config efetiva e o que muda em relação à A. */
  arms: (ExperimentArm & { changes: string[] })[];
}

function experimentOut(e: SurveyExperiment, live: SurveyVariantConfig): SurveyExperimentAdmin {
  const base = diffBase(e, live);
  return {
    id: e.id, name: e.name, status: e.status, winner: e.winner, createdBy: e.createdBy,
    startedAt: e.startedAt.toISOString(), endedAt: e.endedAt ? e.endedAt.toISOString() : null,
    arms: armsOf(e.arms).map(({ snapshot: _s, ...a }) => ({ ...a, changes: a.config ? configDiff(base, armConfig(base, a)) : [] })),
  };
}

export async function listSurveyExperiments(slug: string): Promise<SurveyExperimentAdmin[] | null> {
  const variant = await db.surveyVariant.findUnique({
    where: { slug }, include: { experiments: { orderBy: { startedAt: 'desc' }, take: 20 } },
  });
  if (!variant) return null;
  return variant.experiments.map((e) => experimentOut(e, cfgOf(variant)));
}

function checkArms(raw: unknown, base: SurveyVariantConfig): { ok: true; arms: ExperimentArm[] } | { ok: false; error: string } {
  const res = sanitizeArms(raw);
  if (!res.ok) return res;
  const same = res.arms.find((a) => a.config && !configDiff(base, armConfig(base, a)).length);
  if (same) return { ok: false, error: `A versão ${same.key} está igual à atual — mude o que quer testar` };
  return res;
}

/** Começa um teste. Um por vez no ar por pesquisa. */
export async function createSurveyExperiment(
  slug: string, input: { name?: unknown; arms?: unknown }, by: string | null,
): Promise<AdminResult<{ experiment: SurveyExperimentAdmin }>> {
  const variant = await db.surveyVariant.findUnique({ where: { slug } });
  if (!variant) return { ok: false, status: 404, error: 'pesquisa não encontrada' };
  if (await runningExperiment(variant.id)) {
    return { ok: false, status: 409, error: 'Já tem um teste no ar nesta pesquisa — encerre antes de começar outro' };
  }
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!name) return { ok: false, status: 400, error: 'Nome do teste: obrigatório' };
  const base = cfgOf(variant);
  const res = checkArms(input.arms, base);
  if (!res.ok) return { ok: false, status: 400, error: res.error };
  const e = await db.surveyExperiment.create({
    data: { variantId: variant.id, name, arms: res.arms as unknown as Prisma.InputJsonArray, createdBy: by },
  });
  return { ok: true, experiment: experimentOut(e, base) };
}

/**
 * Edita um teste no ar (nome, pesos, versões — mesma quantidade de versões;
 * quem já foi sorteado continua na sua) ou encerra. Encerrar com `winner`
 * B/C/D publica a config daquela versão na pesquisa (versão + 1); A = fica
 * como está.
 */
export async function updateSurveyExperiment(
  id: string,
  patch: { name?: unknown; arms?: unknown; action?: unknown; winner?: unknown },
): Promise<AdminResult<{ experiment: SurveyExperimentAdmin }>> {
  const e = await db.surveyExperiment.findUnique({ where: { id }, include: { variant: true } });
  if (!e) return { ok: false, status: 404, error: 'teste não encontrado' };
  if (e.status !== 'running') return { ok: false, status: 409, error: 'Este teste já foi encerrado' };
  const base = cfgOf(e.variant);

  if (patch.action === 'stop') {
    const winner = typeof patch.winner === 'string' && patch.winner ? patch.winner : null;
    const arm = winner ? armsOf(e.arms).find((a) => a.key === winner) : null;
    if (winner && !arm) return { ok: false, status: 400, error: `Versão ${winner} não existe neste teste` };
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (arm?.config) {
      const res = sanitizeVariantConfig(armConfig(base, arm));
      if (!res.ok) return { ok: false, status: 400, error: res.error };
      ops.push(db.surveyVariant.update({
        where: { id: e.variantId },
        data: { config: res.config as unknown as Prisma.InputJsonObject, version: { increment: 1 } },
      }));
    }
    // A guarda a pesquisa como estava: o histórico segue mostrando o que cada versão mudou.
    const arms = armsOf(e.arms).map((a, i) => (i === 0 ? { ...a, snapshot: base } : a));
    ops.push(db.surveyExperiment.update({
      where: { id },
      data: { status: 'stopped', endedAt: new Date(), winner, arms: arms as unknown as Prisma.InputJsonArray },
    }));
    await db.$transaction(ops);
    const fresh = await db.surveyExperiment.findUniqueOrThrow({ where: { id }, include: { variant: true } });
    return { ok: true, experiment: experimentOut(fresh, cfgOf(fresh.variant)) };
  }

  const data: Prisma.SurveyExperimentUpdateInput = {};
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim().slice(0, 80) : '';
    if (!name) return { ok: false, status: 400, error: 'Nome do teste: obrigatório' };
    data.name = name;
  }
  if (patch.arms !== undefined) {
    const res = checkArms(patch.arms, base);
    if (!res.ok) return { ok: false, status: 400, error: res.error };
    if (res.arms.length !== armsOf(e.arms).length) {
      return { ok: false, status: 400, error: 'Com o teste no ar não dá pra mudar a quantidade de versões — encerre e comece outro' };
    }
    data.arms = res.arms as unknown as Prisma.InputJsonArray;
  }
  const u = await db.surveyExperiment.update({ where: { id }, data });
  return { ok: true, experiment: experimentOut(u, base) };
}

// ---------- aba Pesquisas ----------

const LABELS = {
  q1: { testar: 'Queria testar antes', dinheiro: 'Plano todo era caro de uma vez', outra_pessoa: 'É pra outra pessoa', nao_sabia: 'Não sabia que eram 6 meses' },
  q2: { 1: '1★', 2: '2★', 3: '3★', 4: '4★', 5: '5★' } as Record<string, string>,
  q3: { todo_dia: 'Todo dia', maioria: 'Na maioria dos dias', esquece: 'Esquece mais do que gostaria', parou: 'Parou de tomar' },
  q3b: { medico: 'Médico desaconselhou', mal_estar: 'Não caiu bem', sem_diferenca: 'Não notou diferença', orcamento: 'Não coube no orçamento', outro: 'Outro motivo' },
  q5: { mensal: '1 frasco por mês', desconto: 'Desconto nos que faltam', progresso: 'Ver mais progresso antes', nao_continuar: 'Não vai continuar' },
  outcome: {
    cs: 'CS liga (sem oferta)', recorrencia: 'Assinatura mensal', oferta: 'Kit no preço de recompra',
    cupom10: 'Kit + cupom 10%', cupom15: 'Kit + cupom 15%', cupom20: 'Kit + cupom 20%', obrigado: 'Só agradecimento',
  } as Record<string, string>,
  // nota_baixa = regra antiga (nota 1–2), antes da venda pra nota 2 (2026-10-28).
  csReason: { nota_minima: 'Nota 1', nota_baixa: 'Nota 1–2', parou_medico: 'Parou: médico', parou_mal_estar: 'Parou: mal-estar' },
  segment: { parcial: 'Comprou 2–3 frascos', completo: 'Comprou 6+ frascos' } as Record<string, string>,
  timing: { '8+': '8+ dias antes de acabar', '4-7': '4 a 7 dias antes', '1-3': '1 a 3 dias antes', acabou: 'Já tinha acabado' } as Record<string, string>,
  channel: {
    email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp', manual: 'Manual (teste)', outro: 'Outro canal', nao_enviado: 'Sem envio marcado',
  } as Record<string, string>,
} as const;

const TIMING_ORDER = ['8+', '4-7', '1-3', 'acabou'] as const;

function offerLabel(k: string): string {
  if (k === 'assinatura') return 'Assinatura (1 frasco/mês)';
  if (k === 'cupom') return 'Kit com cupom';
  const m = /^kit:(\d+)$/.exec(k);
  return m ? `Kit de ${m[1]} frascos` : k === 'kit' ? 'Kit' : k;
}

export interface SurveyCount { id: string; label: string; count: number }

/**
 * Uma linha de "→ venda". `base` = quem entrou no grupo (abriu, concluiu ou
 * clicou — cada tabela diz qual); as taxas são sobre ela.
 */
export interface SurveySalesRow {
  id: string; label: string;
  /** Convites do grupo (tabelas de público, canal e pesquisas). */
  invited?: number;
  base: number; completed: number; clicked: number; purchases: number; revenueUsd: number;
}

export interface SurveyDailyRow { date: string; opened: number; completed: number; clicked: number; purchases: number; revenueUsd: number }

export interface SurveyExperimentArmReport {
  key: string; name: string; weight: number; changes: string[];
  /** Sorteados = abriram o link durante o teste. */
  opened: number; started: number; completed: number; clicked: number; purchases: number; revenueUsd: number;
  satisfactionAvg: number | null;
  /** Contra a versão A: clique no checkout e compra, sobre quem abriu. null na própria A. */
  vsControl: { click: ProportionTest | null; purchase: ProportionTest | null } | null;
}

export interface SurveyExperimentReport {
  id: string; name: string; status: string; winner: string | null; startedAt: string; endedAt: string | null;
  arms: SurveyExperimentArmReport[];
}

export interface SurveyDashboard {
  variants: {
    slug: string; name: string; active: boolean; family: string | null; previewUrl: string;
    /** Links cadastrados: assinatura, quantos kits e quantos cupons. */
    checkoutReady: { assinatura: boolean; kits: number; cupons: number };
    /** Teste A/B no ar (pra pré-visualizar cada versão). */
    experiment: { id: string; name: string; arms: { key: string; name: string }[] } | null;
  }[];
  variant: string | null;
  kpis: {
    invites: number; sent: number; opened: number; started: number; completed: number;
    checkoutClicks: number; purchases: number; revenueUsd: number; satisfactionAvg: number | null;
  };
  steps: SurveyCount[];
  outcomes: SurveyCount[];
  satisfaction: SurveyCount[];
  q1: SurveyCount[]; q3: SurveyCount[]; q3b: SurveyCount[]; q4: SurveyCount[]; q5: SurveyCount[];
  /** Tela final → clique → compra (base = concluíram com aquela tela). */
  outcomeSales: SurveySalesRow[];
  /** Botão clicado → compra (base = clicaram naquele botão; vale o último clique). */
  offerSales: SurveySalesRow[];
  /** Público: 2–3 × 6+ frascos (base = abriram). */
  segments: SurveySalesRow[];
  /** Quantos dias faltavam pro estoque acabar quando abriu (base = abriram). */
  timing: SurveySalesRow[];
  /** Canal do envio (base = abriram). */
  channels: SurveySalesRow[];
  /** Cada resposta → compra (base = concluíram com aquela resposta). */
  answerSales: { id: string; title: string; rows: SurveySalesRow[] }[];
  /** Por dia (BRT) do evento: abriu, concluiu, clicou, comprou. */
  daily: SurveyDailyRow[];
  /** Todas as pesquisas no mesmo período (base = abriram). */
  compare: (SurveySalesRow & { active: boolean })[];
  /** Testes A/B da pesquisa: o no ar e os últimos encerrados (período próprio de cada teste). */
  experiments: SurveyExperimentReport[];
  csQueue: SurveyCsRow[];
  recent: SurveyRecentRow[];
}

export interface SurveyCsRow {
  id: string; firstName: string | null; email: string; phone: string | null;
  reason: string; satisfaction: number | null; comment: string | null;
  completedAt: string | null; dueAt: string | null; status: string; note: string | null; ticketId: string | null;
}

export interface SurveyRecentRow {
  id: string; firstName: string | null; email: string; bottles: number; satisfaction: number | null;
  outcome: string | null; couponPct: number | null; comment: string | null; completedAt: string | null;
  checkout: boolean; purchased: boolean;
  /** Versão do teste A/B em que caiu. */
  arm: string | null;
}

function counts(ids: readonly string[], labels: Record<string, string>, values: (string | undefined)[]): SurveyCount[] {
  return ids.map((id) => ({ id, label: labels[id] ?? id, count: values.filter((v) => v === id).length }));
}

type InvRow = SurveyInvite & { response: SurveyResponse | null };
type SalesIndex = Map<string, { revenue: number; firstAt: Date; orders: { at: Date; usd: number }[] }>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((s, n) => s + n, 0) / xs.length) : null);
const DAY_MS = 86400000;
/** Dia em BRT (UTC−3, sem horário de verão desde 2019) — o dia do dash. */
const brtDay = (d: Date) => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);

/** Venda que veio do quiz: o checkout leva src=qz_<resposta> e o ingest grava em trackingId. */
async function surveySales(responseIds: string[]): Promise<SalesIndex> {
  const out: SalesIndex = new Map();
  const ids = [...new Set(responseIds)];
  for (let k = 0; k < ids.length; k += 5000) {
    const orders = await dbRead.order.findMany({
      where: { trackingId: { in: ids.slice(k, k + 5000).map((id) => `${SURVEY_TRACKING_PREFIX}${id}`) }, status: 'APPROVED' },
      select: { trackingId: true, grossAmountUsd: true, orderedAt: true },
    });
    for (const o of orders) {
      const id = o.trackingId!.slice(SURVEY_TRACKING_PREFIX.length);
      const usd = Number(o.grossAmountUsd);
      const cur = out.get(id);
      if (!cur) out.set(id, { revenue: usd, firstAt: o.orderedAt, orders: [{ at: o.orderedAt, usd }] });
      else {
        cur.revenue += usd;
        cur.orders.push({ at: o.orderedAt, usd });
        if (o.orderedAt < cur.firstAt) cur.firstAt = o.orderedAt;
      }
    }
  }
  return out;
}

function salesRow(id: string, label: string, rows: InvRow[], sales: SalesIndex, invited?: number): SurveySalesRow {
  let completed = 0;
  let clicked = 0;
  let purchases = 0;
  let revenue = 0;
  for (const i of rows) {
    const r = i.response;
    if (!r) continue;
    if (r.completedAt) completed++;
    if (r.checkoutAt) clicked++;
    const s = sales.get(r.id);
    if (s) {
      purchases++;
      revenue += s.revenue;
    }
  }
  return { id, label, ...(invited != null ? { invited } : {}), base: rows.length, completed, clicked, purchases, revenueUsd: round2(revenue) };
}

/**
 * Agrupa e conta até a venda. `invited` = a base vira quem ABRIU e o total do
 * grupo vai em `invited`. Resposta de múltipla escolha conta em cada opção.
 */
function breakdown(
  rows: InvRow[], keyOf: (i: InvRow) => string | string[] | null | undefined, label: (k: string) => string,
  sales: SalesIndex, opts: { order?: readonly string[]; invited?: boolean } = {},
): SurveySalesRow[] {
  const groups = new Map<string, InvRow[]>();
  for (const i of rows) {
    const k = keyOf(i);
    for (const key of Array.isArray(k) ? k : k == null ? [] : [k]) {
      const g = groups.get(key);
      if (g) g.push(i);
      else groups.set(key, [i]);
    }
  }
  const order = opts.order;
  const keys = order
    ? [...order.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !order.includes(k))]
    : [...groups.keys()].sort((a, b) => groups.get(b)!.length - groups.get(a)!.length);
  return keys.map((k) => {
    const g = groups.get(k)!;
    return opts.invited ? salesRow(k, label(k), g.filter((i) => i.openedAt), sales, g.length) : salesRow(k, label(k), g, sales);
  });
}

function timingBucket(i: InvRow): string | null {
  if (!i.openedAt) return null;
  const days = (i.stockUntil.getTime() - i.openedAt.getTime()) / DAY_MS;
  return days >= 8 ? '8+' : days >= 4 ? '4-7' : days > 0 ? '1-3' : 'acabou';
}

/** Série por dia (BRT) do evento — até 120 dias, os mais recentes. */
function dailySeries(rows: InvRow[], sales: SalesIndex, start: Date, end: Date): SurveyDailyRow[] {
  const last = brtDay(new Date(Math.min(end.getTime(), Date.now())));
  const lastMs = Date.parse(`${last}T00:00:00Z`);
  const firstMs = Math.max(Date.parse(`${brtDay(start)}T00:00:00Z`), lastMs - 119 * DAY_MS);
  const days = new Map<string, SurveyDailyRow>();
  for (let t = firstMs; t <= lastMs; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.set(date, { date, opened: 0, completed: 0, clicked: 0, purchases: 0, revenueUsd: 0 });
  }
  const bump = (at: Date | null | undefined, f: (r: SurveyDailyRow) => void) => {
    const r = at ? days.get(brtDay(at)) : undefined;
    if (r) f(r);
  };
  for (const i of rows) {
    bump(i.openedAt, (r) => { r.opened++; });
    const resp = i.response;
    if (!resp) continue;
    bump(resp.completedAt, (r) => { r.completed++; });
    bump(resp.checkoutAt, (r) => { r.clicked++; });
    const s = sales.get(resp.id);
    if (!s) continue;
    bump(s.firstAt, (r) => { r.purchases++; });
    for (const o of s.orders) bump(o.at, (r) => { r.revenueUsd += o.usd; });
  }
  return [...days.values()].map((r) => ({ ...r, revenueUsd: round2(r.revenueUsd) }));
}

/** Base do "o que muda": a pesquisa ao vivo enquanto o teste roda; a foto do encerramento depois. */
function diffBase(e: SurveyExperiment, live: SurveyVariantConfig): SurveyVariantConfig {
  return e.status === 'running' ? live : armsOf(e.arms)[0]?.snapshot ?? live;
}

function experimentReport(e: SurveyExperiment, live: SurveyVariantConfig, rows: InvRow[], sales: SalesIndex): SurveyExperimentReport {
  const base = diffBase(e, live);
  const arms: SurveyExperimentArmReport[] = armsOf(e.arms).map((a) => {
    const g = rows.filter((i) => i.experimentId === e.id && i.arm === a.key);
    const s = salesRow(a.key, a.name, g, sales);
    return {
      key: a.key, name: a.name, weight: a.weight,
      changes: a.config ? configDiff(base, armConfig(base, a)) : [],
      opened: g.length, started: g.filter((i) => i.response).length,
      completed: s.completed, clicked: s.clicked, purchases: s.purchases, revenueUsd: s.revenueUsd,
      satisfactionAvg: avg(g.map((i) => answersOf(i.response).q2).filter((n): n is number => typeof n === 'number')),
      vsControl: null,
    };
  });
  const ctl = arms.find((a) => a.key === CONTROL_ARM);
  if (ctl) {
    for (const a of arms) {
      if (a === ctl) continue;
      a.vsControl = {
        click: proportionTest(ctl.clicked, ctl.opened, a.clicked, a.opened),
        purchase: proportionTest(ctl.purchases, ctl.opened, a.purchases, a.opened),
      };
    }
  }
  return {
    id: e.id, name: e.name, status: e.status, winner: e.winner,
    startedAt: e.startedAt.toISOString(), endedAt: e.endedAt ? e.endedAt.toISOString() : null, arms,
  };
}

export async function getSurveyDashboard(opts: {
  slug?: string | null; start: Date; end: Date; includeTests?: boolean;
}): Promise<SurveyDashboard> {
  const testFilter = opts.includeTests ? {} : { isTest: false };
  const variants = await db.surveyVariant.findMany({ orderBy: { createdAt: 'asc' } });
  const running = await db.surveyExperiment.findMany({ where: { status: 'running' } });
  const variant = variants.find((v) => v.slug === opts.slug) ?? variants.find((v) => v.active) ?? variants[0] ?? null;
  const variantsOut = variants.map((v) => {
    const c = cfgOf(v);
    const exp = running.find((e) => e.variantId === v.id);
    return {
      slug: v.slug, name: v.name, active: v.active, family: v.family,
      previewUrl: `/api/survey/page?slug=${encodeURIComponent(v.slug)}&preview=1`,
      checkoutReady: {
        assinatura: Boolean(c.offers?.assinatura?.url),
        kits: Object.values(c.offers?.kits ?? {}).filter((k) => k?.url).length,
        cupons: (c.coupons ?? []).filter((x) => x.code).length,
      },
      experiment: exp ? { id: exp.id, name: exp.name, arms: armsOf(exp.arms).map((a) => ({ key: a.key, name: a.name })) } : null,
    };
  });
  const empty: SurveyDashboard = {
    variants: variantsOut, variant: variant?.slug ?? null,
    kpis: { invites: 0, sent: 0, opened: 0, started: 0, completed: 0, checkoutClicks: 0, purchases: 0, revenueUsd: 0, satisfactionAvg: null },
    steps: [], outcomes: [], satisfaction: [], q1: [], q3: [], q3b: [], q4: [], q5: [],
    outcomeSales: [], offerSales: [], segments: [], timing: [], channels: [], answerSales: [], daily: [], compare: [], experiments: [],
    csQueue: [], recent: [],
  };
  if (!variant) return empty;
  const cfg = cfgOf(variant);

  // Todas as pesquisas do período (a comparação usa todas; o resto, só a escolhida).
  const all = await db.surveyInvite.findMany({
    where: { createdAt: { gte: opts.start, lte: opts.end }, ...testFilter },
    include: { response: true },
  });
  const invites = all.filter((i) => i.variantId === variant.id);
  const experiments = await db.surveyExperiment.findMany({
    where: { variantId: variant.id }, orderBy: { startedAt: 'desc' }, take: 6,
  });
  const expInvites = experiments.length
    ? await db.surveyInvite.findMany({
        where: { experimentId: { in: experiments.map((e) => e.id) }, ...testFilter },
        include: { response: true },
      })
    : [];
  const sales = await surveySales([...all, ...expInvites].flatMap((i) => (i.response ? [i.response.id] : [])));

  const responses = invites.map((i) => i.response).filter((r): r is SurveyResponse => r != null);
  const ans = responses.map(answersOf);
  const completed = responses.filter((r) => r.completedAt);
  const opened = invites.filter((i) => i.openedAt);
  const done = invites.filter((i) => i.response?.completedAt);
  const clicked = invites.filter((i) => i.response?.checkoutAt);
  const sat = ans.map((a) => a.q2).filter((n): n is number => typeof n === 'number');
  const kpiSales = salesRow('all', 'all', invites, sales);

  const stepCount = (pred: (a: SurveyAnswers) => boolean) => ans.filter(pred).length;
  const q4Labels: Record<string, string> = { ...Object.fromEntries(q4Options(cfg).map((o) => [o.id, o.label])), nada: 'Nada ainda', cedo: 'Cedo demais' };
  const flat = (k: 'q4' | 'q5') => ans.flatMap((a) => (a[k] ?? []) as string[]);
  const doneAns = (i: InvRow) => answersOf(i.response);
  const lbl = (labels: Record<string, string>) => (k: string) => labels[k] ?? k;

  const csResponses = await db.surveyResponse.findMany({
    where: {
      variantId: variant.id, outcome: 'cs', invite: testFilter,
      OR: [{ csStatus: { not: 'resolvido' } }, { csUpdatedAt: { gte: new Date(Date.now() - 7 * DAY_MS) } }],
    },
    include: { invite: true },
    orderBy: { completedAt: 'asc' },
    take: 500,
  });
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  return {
    variants: variantsOut,
    variant: variant.slug,
    kpis: {
      invites: invites.length,
      sent: invites.filter((i) => i.sentAt).length,
      opened: opened.length,
      started: responses.length,
      completed: completed.length,
      checkoutClicks: kpiSales.clicked,
      purchases: kpiSales.purchases,
      revenueUsd: kpiSales.revenueUsd,
      satisfactionAvg: avg(sat),
    },
    steps: [
      { id: 'abriu', label: 'Abriu o link', count: opened.length },
      { id: 'q1', label: '1 · Motivo', count: stepCount((a) => a.q1 != null) },
      { id: 'q2', label: '2 · Satisfação', count: stepCount((a) => a.q2 != null) },
      { id: 'q3', label: '3 · Constância', count: stepCount((a) => a.q3 != null) },
      { id: 'q4', label: '4 · Resultado', count: stepCount((a) => a.q4 != null) },
      { id: 'q5', label: '5 · Terminar o plano', count: stepCount((a) => a.q5 != null) },
      { id: 'fim', label: 'Concluiu', count: completed.length },
    ],
    outcomes: counts(Object.keys(LABELS.outcome), LABELS.outcome,
      completed.map((r) => (r.outcome === 'cupom' ? `cupom${r.couponPct}` : r.outcome ?? undefined))),
    satisfaction: [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: `${n}★`, count: sat.filter((s) => s === n).length })),
    q1: counts(Object.keys(LABELS.q1), LABELS.q1, ans.map((a) => a.q1)),
    q3: counts(Object.keys(LABELS.q3), LABELS.q3, ans.map((a) => a.q3)),
    q3b: counts(Object.keys(LABELS.q3b), LABELS.q3b, ans.map((a) => a.q3b)),
    q4: counts(Object.keys(q4Labels), q4Labels, flat('q4')),
    q5: counts(Object.keys(LABELS.q5), LABELS.q5, flat('q5')),

    outcomeSales: breakdown(done, (i) => (i.response!.outcome === 'cupom' ? `cupom${i.response!.couponPct}` : i.response!.outcome),
      lbl(LABELS.outcome), sales, { order: Object.keys(LABELS.outcome) }),
    offerSales: breakdown(clicked, (i) => i.response!.checkoutOutcome ?? 'kit', offerLabel, sales,
      { order: ['assinatura', ...Object.keys(cfg.offers?.kits ?? {}).map((n) => `kit:${n}`), 'cupom'] }),
    segments: breakdown(invites, (i) => segmentOf(cfg, i.bottles), lbl(LABELS.segment), sales, { order: ['parcial', 'completo'], invited: true }),
    timing: breakdown(opened, timingBucket, lbl(LABELS.timing), sales, { order: TIMING_ORDER }),
    channels: breakdown(invites, (i) => i.channel || (i.sentAt ? 'outro' : 'nao_enviado'), lbl(LABELS.channel), sales, { invited: true }),
    answerSales: [
      { id: 'q2', title: 'Satisfação (pergunta 2)', rows: breakdown(done, (i) => (doneAns(i).q2 != null ? String(doneAns(i).q2) : null), lbl(LABELS.q2), sales, { order: ['1', '2', '3', '4', '5'] }) },
      { id: 'q1', title: 'Por que não levou os 6 (pergunta 1)', rows: breakdown(done, (i) => doneAns(i).q1, lbl(LABELS.q1), sales, { order: Object.keys(LABELS.q1) }) },
      { id: 'q3', title: 'Constância (pergunta 3)', rows: breakdown(done, (i) => doneAns(i).q3, lbl(LABELS.q3), sales, { order: Object.keys(LABELS.q3) }) },
      { id: 'q3b', title: 'Por que parou (3b)', rows: breakdown(done, (i) => doneAns(i).q3b, lbl(LABELS.q3b), sales, { order: Object.keys(LABELS.q3b) }) },
      { id: 'q4', title: 'O que notaram (pergunta 4)', rows: breakdown(done, (i) => doneAns(i).q4 ?? null, lbl(q4Labels), sales, { order: Object.keys(q4Labels) }) },
      { id: 'q5', title: 'O que ajudaria (pergunta 5)', rows: breakdown(done, (i) => doneAns(i).q5 ?? null, lbl(LABELS.q5), sales, { order: Object.keys(LABELS.q5) }) },
    ].filter((q) => q.rows.length),
    daily: dailySeries(invites, sales, opts.start, opts.end),
    compare: variants.map((v) => {
      const g = all.filter((i) => i.variantId === v.id);
      return { ...salesRow(v.slug, v.name, g.filter((i) => i.openedAt), sales, g.length), active: v.active };
    }),
    experiments: experiments.map((e) => experimentReport(e, cfg, expInvites, sales)),

    csQueue: csResponses.map((r) => {
      const a = answersOf(r);
      return {
        id: r.id, firstName: r.invite.firstName, email: r.invite.email, phone: r.invite.phone,
        reason: LABELS.csReason[r.csReason as keyof typeof LABELS.csReason] ?? r.csReason ?? '',
        satisfaction: a.q2 ?? null, comment: a.comentario || null,
        completedAt: iso(r.completedAt), dueAt: iso(r.csDueAt), status: r.csStatus ?? 'aberto',
        note: r.csNote, ticketId: r.sendtraceTicketId,
      };
    }),
    recent: invites
      .filter((i) => i.response)
      .sort((a, b) => (b.response!.updatedAt.getTime() - a.response!.updatedAt.getTime()))
      .slice(0, 200)
      .map((i) => {
        const r = i.response!;
        const a = answersOf(r);
        return {
          id: r.id, firstName: i.firstName, email: i.email, bottles: i.bottles, satisfaction: a.q2 ?? null,
          outcome: r.outcome, couponPct: r.couponPct, comment: a.comentario || null, completedAt: iso(r.completedAt),
          checkout: r.checkoutAt != null, purchased: sales.has(r.id), arm: i.experimentId ? i.arm : null,
        };
      }),
  };
}

export async function setSurveyCsStatus(id: string, status: string, note?: string | null): Promise<boolean> {
  if (!(CS_STATUSES as readonly string[]).includes(status)) return false;
  const res = await db.surveyResponse.updateMany({
    where: { id, outcome: 'cs' },
    data: { csStatus: status, csUpdatedAt: new Date(), ...(note !== undefined ? { csNote: note?.slice(0, 2000) || null } : {}) },
  });
  return res.count > 0;
}
