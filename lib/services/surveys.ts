// Pesquisas / quiz pós-compra: convite, página pública, respostas e a aba
// Pesquisas do dash. Regra e texto em lib/surveys/fimTratamento.ts; HTML em
// lib/surveys/render.ts.
//
// Escrita sempre no `db` (public). A lista de elegíveis lê a lead_summary pelo
// `dbRead` — a mesma conta de estoque da aba Leads (30 dias por frasco).

import { randomBytes } from 'node:crypto';
import { Prisma, type SurveyInvite, type SurveyResponse, type SurveyVariant } from '@prisma/client';
import { db, dbRead } from '../db';
import {
  SURVEY_TRACKING_PREFIX, availableOffers, checkoutUrl, cleanAnswer, decideOutcome, firstNameOf, kitSizeFor, q4Options,
  segmentOf, type CheckoutKind, type OutcomeDecision, type SurveyAnswers, type SurveyVariantConfig,
} from '../surveys/fimTratamento';
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

type InviteFull = SurveyInvite & { variant: SurveyVariant; response: SurveyResponse | null };

async function loadInvite(token: string): Promise<InviteFull | null> {
  if (!TOKEN_RE.test(token)) return null;
  const inv = await db.surveyInvite.findUnique({ where: { token }, include: { variant: true, response: true } });
  return inv && inv.variant.active ? inv : null;
}

// ---------- página pública ----------

export async function surveyPageHtml(slug: string, token: string): Promise<{ status: number; html: string }> {
  const inv = await loadInvite(token);
  if (!inv || inv.variant.slug !== slug) {
    const variant = await db.surveyVariant.findUnique({ where: { slug } }).catch(() => null);
    return { status: 404, html: renderSurveyInvalid(variant ? cfgOf(variant) : null) };
  }
  if (!inv.openedAt) {
    await db.surveyInvite.update({ where: { id: inv.id }, data: { openedAt: new Date() } });
  }
  const html = renderSurveyPage({
    cfg: cfgOf(inv.variant),
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

/** Pré-visualização pro dash: dados de exemplo, nada é gravado. ?bottles=6 mostra o público completo. */
export async function surveyPreviewHtml(slug: string, bottles?: unknown): Promise<string | null> {
  const variant = await db.surveyVariant.findUnique({ where: { slug } });
  if (!variant) return null;
  const cfg = cfgOf(variant);
  return renderSurveyPage({
    cfg, ctx: { firstName: 'John', bottles: previewBottles(cfg, bottles) },
    slug, token: '', preview: true, answers: {}, outcome: null, couponPct: null, followUp: false,
  });
}

export async function previewOutcome(slug: string, raw: unknown, bottles?: unknown): Promise<OutcomeDecision | null> {
  const variant = await db.surveyVariant.findUnique({ where: { slug } });
  if (!variant) return null;
  const cfg = cfgOf(variant);
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
  const clean = cleanAnswer(cfgOf(inv.variant), key, value);
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
  const cfg = cfgOf(inv.variant);
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
  const cfg = cfgOf(inv.variant);
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

export interface SurveyInviteOut {
  email: string;
  firstName: string | null;
  phone: string | null;
  bottles: number;
  stockUntil: string;
  link: string;
}

export interface CreateInvitesResult {
  variant: string;
  eligible: number;
  created: number;
  invites: SurveyInviteOut[];
}

/**
 * Quem recebe: o último produto da pessoa é o da variante, comprou 2 ou 3
 * frascos (config.eligibleBottles) ou o plano inteiro e mais (≥
 * config.fullPlanFrom), sem estorno, e o estoque acaba nos próximos
 * `withinDays` dias. Quem já tem convite pra esse mesmo estoque não
 * ganha outro. `channel` marca como enviado agora (o n8n dispara em seguida).
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
    orderBy: { stockUntil: 'asc' },
  });
  return {
    variant: variant.slug,
    eligible: rows.length,
    created: created.length,
    invites: created.map((i) => ({
      email: i.email, firstName: i.firstName, phone: i.phone, bottles: i.bottles,
      stockUntil: i.stockUntil.toISOString(), link: surveyLink(variant.slug, i.token),
    })),
  };
}

/** Convite de teste pra um e-mail qualquer (admin). Fica fora dos números da aba. */
export async function createSurveyTestInvite(opts: {
  slug: string; email: string; firstName?: string | null; bottles?: number;
}): Promise<SurveyInviteOut | null> {
  const variant = await db.surveyVariant.findUnique({ where: { slug: opts.slug } });
  if (!variant) return null;
  const bottles = [2, 3].includes(Number(opts.bottles)) ? Number(opts.bottles) : 3;
  const inv = await db.surveyInvite.create({
    data: {
      token: newToken(), variantId: variant.id, email: opts.email.trim().toLowerCase(),
      firstName: opts.firstName?.trim() || null, bottles,
      stockUntil: new Date(Date.now() + 7 * 86400000), channel: 'manual', isTest: true,
    },
  });
  return {
    email: inv.email, firstName: inv.firstName, phone: null, bottles: inv.bottles,
    stockUntil: inv.stockUntil.toISOString(), link: surveyLink(variant.slug, inv.token),
  };
}

// ---------- cadastro das variantes (aba Pesquisas, admin) ----------

export interface SurveyVariantAdmin {
  slug: string; name: string; family: string | null; active: boolean; version: number;
  config: SurveyVariantConfig; updatedAt: string;
}

export async function listSurveyVariantsAdmin(): Promise<SurveyVariantAdmin[]> {
  const rows = await db.surveyVariant.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map((v) => ({
    slug: v.slug, name: v.name, family: v.family, active: v.active, version: v.version,
    config: cfgOf(v), updatedAt: v.updatedAt.toISOString(),
  }));
}

/**
 * Salva o que veio do formulário. O texto/oferta muda → versão + 1 (cada
 * resposta guarda a versão que viu, pra comparar antes × depois).
 */
export async function updateSurveyVariant(
  slug: string,
  patch: { active?: unknown; name?: unknown; config?: unknown },
): Promise<{ ok: true; variant: SurveyVariantAdmin } | { ok: false; status: 400 | 404; error: string }> {
  const current = await db.surveyVariant.findUnique({ where: { slug } });
  if (!current) return { ok: false, status: 404, error: 'pesquisa não encontrada' };
  const data: Prisma.SurveyVariantUpdateInput = {};
  if (patch.active !== undefined) data.active = patch.active === true;
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!name || name.length > 120) return { ok: false, status: 400, error: 'Nome da pesquisa: obrigatório (até 120)' };
    data.name = name;
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
  return {
    ok: true,
    variant: { slug: v.slug, name: v.name, family: v.family, active: v.active, version: v.version, config: cfgOf(v), updatedAt: v.updatedAt.toISOString() },
  };
}

// ---------- aba Pesquisas ----------

const LABELS = {
  q1: { testar: 'Queria testar antes', dinheiro: 'Plano todo era caro de uma vez', outra_pessoa: 'É pra outra pessoa', nao_sabia: 'Não sabia que eram 6 meses' },
  q3: { todo_dia: 'Todo dia', maioria: 'Na maioria dos dias', esquece: 'Esquece mais do que gostaria', parou: 'Parou de tomar' },
  q3b: { medico: 'Médico desaconselhou', mal_estar: 'Não caiu bem', sem_diferenca: 'Não notou diferença', orcamento: 'Não coube no orçamento', outro: 'Outro motivo' },
  q5: { mensal: '1 frasco por mês', desconto: 'Desconto nos que faltam', progresso: 'Ver mais progresso antes', nao_continuar: 'Não vai continuar' },
  outcome: {
    cs: 'CS liga (sem oferta)', recorrencia: 'Assinatura mensal', oferta: 'Kit no preço de recompra',
    cupom10: 'Kit + cupom 10%', cupom15: 'Kit + cupom 15%', cupom20: 'Kit + cupom 20%', obrigado: 'Só agradecimento',
  },
  // nota_baixa = regra antiga (nota 1–2), antes da venda pra nota 2 (2026-10-28).
  csReason: { nota_minima: 'Nota 1', nota_baixa: 'Nota 1–2', parou_medico: 'Parou: médico', parou_mal_estar: 'Parou: mal-estar' },
} as const;

export interface SurveyCount { id: string; label: string; count: number }

export interface SurveyDashboard {
  variants: {
    slug: string; name: string; active: boolean; previewUrl: string;
    /** Links cadastrados: assinatura, quantos kits e quantos cupons. */
    checkoutReady: { assinatura: boolean; kits: number; cupons: number };
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
}

function counts(ids: readonly string[], labels: Record<string, string>, values: (string | undefined)[]): SurveyCount[] {
  return ids.map((id) => ({ id, label: labels[id] ?? id, count: values.filter((v) => v === id).length }));
}

export async function getSurveyDashboard(opts: {
  slug?: string | null; start: Date; end: Date; includeTests?: boolean;
}): Promise<SurveyDashboard> {
  const testFilter = opts.includeTests ? {} : { isTest: false };
  const variants = await db.surveyVariant.findMany({ orderBy: { createdAt: 'asc' } });
  const variant = variants.find((v) => v.slug === opts.slug) ?? variants.find((v) => v.active) ?? variants[0] ?? null;
  const variantsOut = variants.map((v) => {
    const c = cfgOf(v);
    return {
      slug: v.slug, name: v.name, active: v.active,
      previewUrl: `/api/survey/page?slug=${encodeURIComponent(v.slug)}&preview=1`,
      checkoutReady: {
        assinatura: Boolean(c.offers?.assinatura?.url),
        kits: Object.values(c.offers?.kits ?? {}).filter((k) => k?.url).length,
        cupons: (c.coupons ?? []).filter((x) => x.code).length,
      },
    };
  });
  const empty: SurveyDashboard = {
    variants: variantsOut, variant: variant?.slug ?? null,
    kpis: { invites: 0, sent: 0, opened: 0, started: 0, completed: 0, checkoutClicks: 0, purchases: 0, revenueUsd: 0, satisfactionAvg: null },
    steps: [], outcomes: [], satisfaction: [], q1: [], q3: [], q3b: [], q4: [], q5: [], csQueue: [], recent: [],
  };
  if (!variant) return empty;
  const cfg = cfgOf(variant);

  const invites = await db.surveyInvite.findMany({
    where: { variantId: variant.id, createdAt: { gte: opts.start, lte: opts.end }, ...testFilter },
    include: { response: true },
  });
  const responses = invites.map((i) => i.response).filter((r): r is SurveyResponse => r != null);
  const ans = responses.map(answersOf);
  const completed = responses.filter((r) => r.completedAt);

  // Venda que veio do quiz: o checkout leva src=qz_<resposta> e o ingest grava em trackingId.
  const purchases = responses.length
    ? await dbRead.order.findMany({
        where: { trackingId: { in: responses.map((r) => `${SURVEY_TRACKING_PREFIX}${r.id}`) }, status: 'APPROVED' },
        select: { trackingId: true, grossAmountUsd: true },
      })
    : [];
  const boughtIds = new Set(purchases.map((p) => p.trackingId!.slice(SURVEY_TRACKING_PREFIX.length)));
  const sat = ans.map((a) => a.q2).filter((n): n is number => typeof n === 'number');

  const stepCount = (pred: (a: SurveyAnswers) => boolean) => ans.filter(pred).length;
  const q4Labels = Object.fromEntries(q4Options(cfg).map((o) => [o.id, o.label]));
  const flat = (k: 'q4' | 'q5') => ans.flatMap((a) => (a[k] ?? []) as string[]);

  const csResponses = await db.surveyResponse.findMany({
    where: {
      variantId: variant.id, outcome: 'cs', invite: testFilter,
      OR: [{ csStatus: { not: 'resolvido' } }, { csUpdatedAt: { gte: new Date(Date.now() - 7 * 86400000) } }],
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
      opened: invites.filter((i) => i.openedAt).length,
      started: responses.length,
      completed: completed.length,
      checkoutClicks: responses.filter((r) => r.checkoutAt).length,
      purchases: boughtIds.size,
      revenueUsd: Math.round(purchases.reduce((s, p) => s + Number(p.grossAmountUsd), 0) * 100) / 100,
      satisfactionAvg: sat.length ? Math.round((sat.reduce((s, n) => s + n, 0) / sat.length) * 100) / 100 : null,
    },
    steps: [
      { id: 'abriu', label: 'Abriu o link', count: invites.filter((i) => i.openedAt).length },
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
    q4: counts(Object.keys(q4Labels), { ...q4Labels, nada: 'Nada ainda', cedo: 'Cedo demais' }, flat('q4')),
    q5: counts(Object.keys(LABELS.q5), LABELS.q5, flat('q5')),
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
          checkout: r.checkoutAt != null, purchased: boughtIds.has(r.id),
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
