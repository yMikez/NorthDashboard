// Briefing da IA no topo da Visão geral.
//
// Fluxo: o pacote de números sai na hora (mesmas fontes da tela); o texto da
// IA é gerado em segundo plano na 1ª abertura do dia de cada recorte e fica
// no banco (AiBriefing) — o resto do dia é leitura. A tela pede de novo a
// cada poucos segundos enquanto status = 'generating'.
//
// Recortes (scopeKey):
//   'all'      operação inteira
//   'u:<id>'   carteira de quem tem função (Gerente/SL/Hunter) — só os
//              afiliados dele, como em todo o resto do dash
//   '+d'       com as decisões do ClickUp (só pra quem abre a aba Decisões)
// Os filtros da barra NÃO entram: o briefing é a leitura da semana inteira.

// zod/v4: o helper do SDK (betaZodOutputFormat) converte com o toJSONSchema da v4 —
// esquema da API clássica (v3) quebra antes da chamada ("reading 'def'").
import { z } from 'zod/v4';
import { Prisma } from '@prisma/client';
import { db, dbRead } from '../db';
import { logger } from '../logger';
import { askStructured } from '../insights/llm';
import { readWindow } from '../insights/windowMetrics';
import { resolveAffiliateFilter } from '../shared/affiliateFilter';
import { isPortfolioScoped } from '../portfolio/core';
import { effectiveInternal } from '../services/affiliateIdentityCore';
import type { SessionUser } from '../auth/session';
import {
  briefingWindows, extremes, metricPair, topMovers,
  type DayPoint, type MetricPair, type Mover, type MoverRow,
} from './core';
import { CORRELATION_DISCLAIMER, type MetricShift } from '../decisions/core';

export interface BriefingDecision {
  id: string;
  title: string;
  decidedAt: string;
  channel: string | null;
  narrative: string;
  shifts: MetricShift[];
}

export interface BriefingPack {
  scope: { kind: 'operacao' | 'carteira'; label: string };
  windows: { cur: { from: string; to: string }; prev: { from: string; to: string }; days: number };
  metrics: MetricPair[];
  series: DayPoint[];
  ordersSeries: DayPoint[];
  stages: { front: string; backend: string | null; recovery: string };
  movers: { up: Mover[]; down: Mover[] };
  bestDay: { date: string; grossFmt: string } | null;
  worstDay: { date: string; grossFmt: string } | null;
  decisions: BriefingDecision[];
}

export const BriefingAiSchema = z.object({
  headline: z.string().describe('O fato mais importante da semana, em até ~100 caracteres.'),
  summary: z.string().describe('2 a 3 frases que contam a semana.'),
  highlights: z.array(z.object({
    title: z.string().describe('Até 6 palavras.'),
    detail: z.string().describe('Uma frase com o número que sustenta.'),
    // Texto livre + normalização: o SDK (0.95) não manda `enum` como
    // restrição à API, e um valor fora da lista derrubaria a resposta inteira.
    tone: z.string().describe('Um de: positivo | negativo | neutro.'),
    metric: z.string().describe('Um de: faturamento | pedidos | aov | net_after_cpa | aprovacao | reembolso | chargeback | outro.'),
  })).describe('3 ou 4 destaques.'),
  attention: z.string().nullable().describe('Um ponto a vigiar nesta semana, ou null.'),
  decisions: z.array(z.object({
    id: z.string(),
    line: z.string().describe('Uma frase ligando a decisão às métricas, sempre como correlação.'),
  })).describe('Uma linha por decisão do pacote; vazio se não houver.'),
});
export type BriefingAi = z.infer<typeof BriefingAiSchema>;

const TONES = new Set(['positivo', 'negativo', 'neutro']);
/** Tom fora da lista (ex.: "positiva") vira o mais próximo; o resto, neutro. */
export function normalizeTone(raw: string): 'positivo' | 'negativo' | 'neutro' {
  const t = raw.trim().toLowerCase();
  if (TONES.has(t)) return t as 'positivo' | 'negativo' | 'neutro';
  if (t.startsWith('posit')) return 'positivo';
  if (t.startsWith('negat')) return 'negativo';
  return 'neutro';
}

export interface BriefingResponse {
  status: 'ready' | 'generating' | 'error';
  scopeKey: string;
  pack: BriefingPack;
  ai: BriefingAi | null;
  generatedAt: string | null;
  model: string | null;
  error: string | null;
  disclaimer: string;
}

const SYSTEM = `Você é a analista de dados da NorthScale — vendor de suplementos que vende por afiliados nas plataformas ClickBank, Digistore24, BuyGoods, JVZoo, Cartpanda e Vupim. Toda manhã você escreve o briefing que abre o painel: os últimos 7 dias fechados contra os 7 anteriores.

Regras:
- Use SÓ os números do pacote JSON, exatamente como vêm formatados (campos *Fmt). Não some, não arredonde de novo, não estime, não invente número nem causa que o pacote não mostre.
- Português do Brasil, direto e humano, como uma colega experiente falando com o dono do negócio. Sem jargão de consultoria, sem emoji, sem ponto de exclamação, sem "vale destacar".
- Manchete: o fato que mais importa na semana. Resumo: 2 a 3 frases. Destaques: 3 ou 4, título curto e uma frase com o número.
- Tom pelo efeito no negócio: reembolso e chargeback subindo é negativo; estável é neutro.
- "Maiores altas/quedas" (movers) explicam onde a variação aconteceu — use quando ajudar, sem listar tudo.
- Atenção: um ponto concreto a vigiar, ou null se nada se destaca.
- Decisões: se o pacote trouxer decisões, escreva uma linha por decisão (use o mesmo id) relacionando-a às métricas como CORRELAÇÃO ("desde então", "coincidiu com"), nunca como causa. Se a janela for curta ou a direção não bater, diga.
- Se o pacote estiver vazio ou sem venda, diga isso de forma simples.`;

/** Rótulo e filtro do recorte de quem pede. */
async function scopeOf(user: SessionUser): Promise<{ key: string; affiliateIds: string[] | undefined; kind: 'operacao' | 'carteira'; label: string; withDecisions: boolean }> {
  const scoped = isPortfolioScoped(user);
  const withDecisions = !scoped && (user.role === 'ADMIN' || user.allowedTabs.includes('decisions'));
  if (!scoped) return { key: withDecisions ? 'all+d' : 'all', affiliateIds: undefined, kind: 'operacao', label: 'Toda a operação', withDecisions };
  return {
    key: `u:${user.id}`,
    affiliateIds: await resolveAffiliateFilter(null, user),
    kind: 'carteira',
    label: 'Sua carteira de afiliados',
    withDecisions: false,
  };
}

/** Faturamento por família, plataforma e afiliado (pessoa) nas duas janelas. */
async function moverRows(curStart: Date, prevStart: Date, end: Date, affiliateIds?: string[]): Promise<MoverRow[]> {
  const affCond = affiliateIds?.length ? Prisma.sql`AND o."affiliateId" IN (${Prisma.join(affiliateIds)})` : Prisma.empty;
  const rows = await dbRead.$queryRaw<Array<{
    family: string | null; platform: string; aid: string | null; ext: string | null; nick: string | null;
    internal: boolean | null; pid: string | null; pname: string | null; cur: number; prev: number;
  }>>(Prisma.sql`
    SELECT pr."family" AS family, pl."slug" AS platform, a."id" AS aid, a."externalId" AS ext, a."nickname" AS nick,
           a."isInternal" AS internal, a."partnerId" AS pid, p."displayName" AS pname,
           COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."orderedAt" >= ${curStart}), 0)::float8 AS cur,
           COALESCE(SUM(o."grossAmountUsd") FILTER (WHERE o."orderedAt" < ${curStart}), 0)::float8 AS prev
    FROM "Order" o
    JOIN "Product" pr ON pr."id" = o."productId"
    JOIN "Platform" pl ON pl."id" = o."platformId"
    LEFT JOIN "Affiliate" a ON a."id" = o."affiliateId"
    LEFT JOIN "AffiliatePartner" p ON p."id" = a."partnerId"
    WHERE o."status" = 'APPROVED' AND o."orderedAt" >= ${prevStart} AND o."orderedAt" <= ${end} ${affCond}
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`);
  const fam = new Map<string, MoverRow>();
  const plat = new Map<string, MoverRow>();
  const aff = new Map<string, MoverRow>();
  const bump = (m: Map<string, MoverRow>, key: string, row: MoverRow, cur: number, prev: number) => {
    const r = m.get(key) ?? row;
    r.cur += cur; r.prev += prev;
    m.set(key, r);
  };
  for (const r of rows) {
    if (r.family) bump(fam, r.family, { dimension: 'família', name: r.family, cur: 0, prev: 0 }, r.cur, r.prev);
    bump(plat, r.platform, { dimension: 'plataforma', name: r.platform, cur: 0, prev: 0 }, r.cur, r.prev);
    if (r.aid && r.ext && !effectiveInternal({ externalId: r.ext, nickname: r.nick, isInternal: r.internal })) {
      const key = r.pid ? `p:${r.pid}` : `a:${r.aid}`;
      bump(aff, key, { dimension: 'afiliado', name: r.pname ?? (r.nick?.trim() || r.ext), cur: 0, prev: 0 }, r.cur, r.prev);
    }
  }
  return [...fam.values(), ...plat.values(), ...aff.values()];
}

async function recentDecisions(): Promise<BriefingDecision[]> {
  const since = new Date(Date.now() - 45 * 86_400_000);
  const rows = await db.decision.findMany({
    where: { status: { not: 'DISCARDED' }, decidedAt: { gte: since }, correlation: { not: Prisma.DbNull } },
    orderBy: { decidedAt: 'desc' },
    take: 3,
    select: { id: true, title: true, decidedAt: true, channelId: true, correlation: true },
  });
  const names = new Map((await db.clickUpChannel.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return rows.map((d) => {
    const c = d.correlation as { narrative?: string; shifts?: MetricShift[] } | null;
    return {
      id: d.id, title: d.title, decidedAt: d.decidedAt.toISOString(), channel: d.channelId ? names.get(d.channelId) ?? null : null,
      narrative: c?.narrative ?? '', shifts: c?.shifts ?? [],
    };
  });
}

type Scope = Awaited<ReturnType<typeof scopeOf>>;

export async function buildPack(user: SessionUser, now = new Date(), known?: Scope): Promise<{ key: string; windowEnd: string; pack: BriefingPack }> {
  const scope = known ?? await scopeOf(user);
  const w = briefingWindows(now);
  const f = { startDate: w.cur.start, endDate: w.cur.end, affiliateIds: scope.affiliateIds };
  const [read, movers, decisions] = await Promise.all([
    readWindow(f, true),
    moverRows(w.cur.start, w.prev.start, w.cur.end, scope.affiliateIds),
    scope.withDecisions ? recentDecisions() : Promise.resolve([]),
  ]);
  const cur = read.totals;
  const prev = read.previous ?? cur;
  const metrics: MetricPair[] = [
    metricPair('faturamento', 'Faturamento', 'money', 'higher', cur.faturamento, prev.faturamento),
    metricPair('pedidos', 'Pedidos aprovados', 'int', 'higher', cur.pedidos, prev.pedidos),
    metricPair('aov', 'AOV', 'money2', 'higher', cur.aov, prev.aov),
    metricPair('net_after_cpa', 'Net after CPA', 'money', 'higher', cur.net_after_cpa, prev.net_after_cpa),
    metricPair('aprovacao', 'Taxa de aprovação', 'pct', 'higher', cur.aprovacao, prev.aprovacao),
    metricPair('reembolso', 'Reembolsos (US$)', 'money', 'lower', cur.reembolso, prev.reembolso),
    metricPair('chargeback', 'Chargeback', 'pct', 'lower', cur.chargeback, prev.chargeback),
  ];
  const series: DayPoint[] = read.daily.map((d, i) => ({ date: d.date, cur: d.gross, prev: read.previousDaily[i]?.gross ?? 0 }));
  const ordersSeries: DayPoint[] = read.daily.map((d, i) => ({ date: d.date, cur: d.orders, prev: read.previousDaily[i]?.orders ?? 0 }));
  const { best, worst } = extremes(series);
  const money = (v: number) => metricPair('faturamento', '', 'money', 'higher', v, v).curFmt;
  return {
    key: scope.key,
    windowEnd: w.cur.to,
    pack: {
      scope: { kind: scope.kind, label: scope.label },
      windows: { cur: { from: w.cur.from, to: w.cur.to }, prev: { from: w.prev.from, to: w.prev.to }, days: 7 },
      metrics,
      series,
      ordersSeries,
      stages: {
        front: money(read.stages.front),
        backend: read.stages.backendAvailable ? money(read.stages.backend) : null,
        recovery: money(read.stages.recovery),
      },
      movers: topMovers(movers, cur.faturamento),
      bestDay: best ? { date: best.date, grossFmt: money(best.cur) } : null,
      worstDay: worst && worst !== best ? { date: worst.date, grossFmt: money(worst.cur) } : null,
      decisions,
    },
  };
}

/** O que vai pra IA: só o que ela precisa, já formatado. */
function promptPayload(pack: BriefingPack) {
  return {
    recorte: pack.scope.label,
    janela_atual: pack.windows.cur,
    janela_anterior: pack.windows.prev,
    metricas: pack.metrics.map((m) => ({
      chave: m.key, nome: m.label, atual: m.curFmt, anterior: m.prevFmt, variacao: m.deltaFmt,
      leitura: m.good == null ? 'estável' : m.good ? 'melhorou' : 'piorou',
    })),
    faturamento_por_dia: pack.series.map((s) => ({ dia: s.date, atual: Math.round(s.cur), anterior_mesmo_dia_da_janela: Math.round(s.prev) })),
    estagios_da_janela_atual: pack.stages,
    maiores_altas: pack.movers.up.map((m) => ({ tipo: m.dimension, nome: m.name, de: m.prevFmt, para: m.curFmt, variacao: m.deltaFmt })),
    maiores_quedas: pack.movers.down.map((m) => ({ tipo: m.dimension, nome: m.name, de: m.prevFmt, para: m.curFmt, variacao: m.deltaFmt })),
    melhor_dia: pack.bestDay,
    pior_dia: pack.worstDay,
    decisoes: pack.decisions.map((d) => ({
      id: d.id, titulo: d.title, decidida_em: d.decidedAt.slice(0, 10), canal: d.channel, leitura_do_dash: d.narrative,
    })),
  };
}

// Uma geração por recorte de cada vez; erro fica 5 min antes de tentar de novo.
// O pacote da geração em andamento fica em memória: a tela pergunta a cada
// poucos segundos e não pode recalcular a Visão geral inteira a cada vez.
const inflight = new Map<string, { promise: Promise<void>; pack: BriefingPack }>();
const failures = new Map<string, { at: number; message: string }>();
const RETRY_AFTER_MS = 5 * 60_000;

async function generate(key: string, windowEnd: string, pack: BriefingPack): Promise<void> {
  try {
    const res = await askStructured({
      label: 'briefing',
      system: SYSTEM,
      user: `Pacote da semana (JSON):\n${JSON.stringify(promptPayload(pack))}`,
      schema: BriefingAiSchema,
      effort: 'medium',
    });
    const ai = {
      ...res.data,
      highlights: res.data.highlights.map((h) => ({ ...h, tone: normalizeTone(h.tone) })),
      decisions: res.data.decisions.filter((d) => pack.decisions.some((x) => x.id === d.id)),
    };
    const payload = JSON.parse(JSON.stringify({ pack, ai })) as Prisma.InputJsonValue;
    await db.aiBriefing.upsert({
      where: { scopeKey_windowEnd: { scopeKey: key, windowEnd } },
      create: { scopeKey: key, windowEnd, model: res.model, payload },
      update: { model: res.model, payload, createdAt: new Date() },
    });
    failures.delete(key);
  } catch (err) {
    logger.warn({ err, key }, '[briefing] geração falhou');
    failures.set(key, { at: Date.now(), message: err instanceof Error ? err.message : 'falhou' });
  }
}

export async function getBriefing(user: SessionUser, opts: { regenerate?: boolean; now?: Date } = {}): Promise<BriefingResponse> {
  const now = opts.now ?? new Date();
  const scope = await scopeOf(user);
  const key = scope.key;
  const windowEnd = briefingWindows(now).cur.to;
  const flightKey = `${key}|${windowEnd}`;
  const reply = (pack: BriefingPack, rest: Omit<BriefingResponse, 'scopeKey' | 'pack' | 'disclaimer'>): BriefingResponse =>
    ({ scopeKey: key, pack, disclaimer: CORRELATION_DISCLAIMER, ...rest });

  if (opts.regenerate) {
    await db.aiBriefing.deleteMany({ where: { scopeKey: key, windowEnd } });
    failures.delete(key);
  } else {
    // Pronto: devolve o pacote guardado junto com o texto (o texto fala desses números).
    const row = await db.aiBriefing.findUnique({ where: { scopeKey_windowEnd: { scopeKey: key, windowEnd } } });
    const saved = row?.payload as { pack?: BriefingPack; ai?: BriefingAi } | null | undefined;
    if (row && saved?.pack) {
      return reply(saved.pack, { status: 'ready', ai: saved.ai ?? null, generatedAt: row.createdAt.toISOString(), model: row.model, error: null });
    }
    const running = inflight.get(flightKey);
    if (running) return reply(running.pack, { status: 'generating', ai: null, generatedAt: null, model: null, error: null });
  }

  const { pack } = await buildPack(user, now, scope);
  const fail = failures.get(key);
  if (fail && Date.now() - fail.at < RETRY_AFTER_MS) {
    return reply(pack, { status: 'error', ai: null, generatedAt: null, model: null, error: fail.message });
  }
  if (!inflight.has(flightKey)) {
    const promise = generate(key, windowEnd, pack).finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, { promise, pack });
  }
  return reply(pack, { status: 'generating', ai: null, generatedAt: null, model: null, error: null });
}
