// Métricas da aba "SMS" — saúde da stack Mautic → n8n → Twilio.
// Lê SmsEvent/SmsCampaign direto. Dia bucketado em BRT (UTC-3, sem DST
// desde 2019) — mesma semântica de "dia" do resto do dash.
//
// Agregação in-memory sobre projeções mínimas (padrão tauk/recovery):
// volume esperado de milhares de eventos/dia aguenta tranquilo; se um dia
// apertar, os agregados por dia/campanha migram pra groupBy/SQL — a API
// pública (SmsResponse) não muda.
//
// Definições (briefing):
// - Taxa de entrega = delivered ÷ (delivered+undelivered+failed) — o
//   denominador são os STATUS FINAIS do período, não os enviados
//   (callbacks podem atrasar).
// - Pendentes = sms_sent há mais de 1h sem sms_status final do mesmo sid
//   (sinal de callback quebrado).
// - 30007 = filtragem de operadora — o número mais importante da tela.

import { db } from '../db';
import { SMS_SUBACCOUNTS } from '../connectors/sms/config';

export interface SmsFilters {
  startDate: Date;
  endDate: Date;
  brand?: string | null;
  campaign?: string | null;
}

// ── Shapes das projeções (exportados pros testes do reducer) ────────────────

export interface SmsSentRow {
  messageSid: string | null;
  campaign: string | null;
  brand: string | null;
  subIndex: number | null;
  occurredAt: Date;
}

export interface SmsStatusRow {
  messageSid: string | null;
  status: string | null;
  errorCode: number | null;
  campaign: string | null;
  brand: string | null;
  subIndex: number | null;
  fromNumber: string | null;
  occurredAt: Date;
}

export interface SmsSkippedRow {
  reason: string | null;
  campaign: string | null;
  // Enriquecida no ingest pelo evento mais recente da mesma campanha
  // (o payload de sms_skipped não traz marca). Null em registros antigos
  // ou campanha nunca vista — aí o filtro cai pro mapa campanha→marca.
  brand: string | null;
  occurredAt: Date;
}

export interface SmsStopRow {
  brand: string | null;
  subIndex: number | null;
  campaign: string | null;
  occurredAt: Date;
}

export interface SmsCatalogRow {
  mauticId: number;
  name: string;
  slug: string | null;
  isPublished: boolean;
  archived: boolean;
}

export interface SmsReduceInput {
  startDate: Date;
  endDate: Date;
  now: Date;
  brandFilter: string | null;
  campaignFilter: string | null;
  sent: SmsSentRow[];
  // Janela ESTENDIDA (até +48h após endDate) — o cálculo de pendentes
  // precisa ver callbacks que chegaram depois do fim do período. As
  // métricas de entrega filtram occurredAt <= endDate internamente.
  statuses: SmsStatusRow[];
  skipped: SmsSkippedRow[];
  stops: SmsStopRow[];
  // Status finais do período ANTERIOR (mesma duração) → delta da entrega.
  prevStatusCounts: { delivered: number; undelivered: number; failed: number };
  // 30007 nas últimas 24h POR SUBCONTA (independente do período da tela) —
  // insumo das regras amarelo/vermelho do semáforo.
  errors24h: Array<{ brand: string | null; subIndex: number | null; count: number }>;
  campaignsCatalog: SmsCatalogRow[];
}

// ── Response ────────────────────────────────────────────────────────────────

export type SmsHealthLevel = 'green' | 'yellow' | 'red' | 'idle';

export interface SmsNumberCard {
  subIndex: number | null;
  brand: string | null;
  role: 'active' | 'reserve';
  numberMasked: string | null;
  sent: number;
  delivered: number;
  undelivered: number;
  failed: number;
  deliveryRate: number | null;
  stops: number;
  stopRate: number | null;
  filtered30007: number;
  filtered30007Last24h: number;
  pending: number;
  health: SmsHealthLevel;
  healthReasons: string[];
  daily: Array<{ date: string; sent: number; deliveryRate: number | null }>;
}

export interface SmsCampaignRowOut {
  mauticId: number | null;
  name: string | null;
  slug: string | null;
  status: 'active' | 'paused' | 'archived' | null;
  brand: string | null;
  sent: number;
  deliveryRate: number | null;
  stops: number;
  skipped: number;
  skippedByReason: Array<{ reason: string; count: number }>;
  dailySent: Array<{ date: string; sent: number }>;
  lastSentAt: string | null;
  // true = tem telemetria mas o slug não existe no catálogo do Mautic.
  orphan: boolean;
}

export interface SmsResponse {
  range: { start: string; end: string };
  filters: { brand: string | null; campaign: string | null };
  kpis: {
    sent: number;
    delivered: number;
    undelivered: number;
    failed: number;
    finals: number;
    deliveryRate: number | null;
    deliveryRatePrev: number | null;
    deliveryRateDeltaPp: number | null;
    stops: number;
    stopRate: number | null;
    skipped: number;
    skippedByReason: Array<{ reason: string; count: number }>;
    carrierFiltered30007: number;
    pending: number;
  };
  numbers: SmsNumberCard[];
  campaigns: SmsCampaignRowOut[];
  feed: Array<{
    id: string;
    type: string; // sent | delivered | undelivered | failed | stop | skipped
    occurredAt: string;
    brand: string | null;
    campaign: string | null;
    toMasked: string | null;
    detail: string | null;
  }>;
  alerts: {
    redNumbers: string[];
    callbacksSuspect: boolean;
    recentPendingRatio: number | null;
  };
}

// ── Helpers puros ───────────────────────────────────────────────────────────

const BRT_OFFSET_MS = 3 * 3600_000;
const HOUR_MS = 3600_000;

function brtDay(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Nunca expor número completo de lead: mantém DDI + últimos 4 dígitos
// ("+15551234567" → "+1•••4567").
export function maskPhone(n: string | null | undefined): string | null {
  if (!n) return null;
  const s = String(n).trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 5) return '•••';
  // DDI por aritmética (len − 10 dígitos nacionais), clampado em 1–2 chars —
  // cobre +1 (US, caso real dos leads) e +55 sem tabela de país.
  const cc = s.startsWith('+') ? '+' + digits.slice(0, Math.min(2, Math.max(1, digits.length - 10))) : '';
  return `${cc}•••${digits.slice(-4)}`;
}

// Semáforo de saúde por número/marca (regras do guia operacional):
//   🟢 entrega ≥ 95% e STOP < 1%
//   🟡 entrega 90–95% ou STOP 1–2% ou qualquer 30007 nas últimas 24h
//   🔴 entrega < 90% ou STOP > 2% ou 30007 recorrente (≥ 5 em 24h)
// Sem tráfego nem status no período → 'idle' (card apagado, sem alarme).
// Taxa sem denominador (sent > 0 mas nenhum callback ainda) não dispara
// vermelho por entrega — só as regras de STOP/30007 valem.
export function smsHealth(input: {
  sent: number;
  finals: number;
  deliveryRate: number | null;
  stopRate: number | null;
  filtered30007Last24h: number;
}): { level: SmsHealthLevel; reasons: string[] } {
  const { sent, finals, deliveryRate, stopRate, filtered30007Last24h } = input;
  if (sent === 0 && finals === 0 && filtered30007Last24h === 0) {
    return { level: 'idle', reasons: ['sem tráfego no período'] };
  }

  const red: string[] = [];
  if (deliveryRate != null && deliveryRate < 0.9) red.push(`entrega ${(deliveryRate * 100).toFixed(1)}% (< 90%)`);
  if (stopRate != null && stopRate > 0.02) red.push(`STOP ${(stopRate * 100).toFixed(1)}% (> 2%)`);
  if (filtered30007Last24h >= 5) red.push(`30007 recorrente: ${filtered30007Last24h} em 24h`);
  if (red.length > 0) return { level: 'red', reasons: red };

  const yellow: string[] = [];
  if (deliveryRate != null && deliveryRate < 0.95) yellow.push(`entrega ${(deliveryRate * 100).toFixed(1)}% (90–95%)`);
  if (stopRate != null && stopRate >= 0.01) yellow.push(`STOP ${(stopRate * 100).toFixed(1)}% (1–2%)`);
  if (filtered30007Last24h > 0) yellow.push(`${filtered30007Last24h}× 30007 nas últimas 24h`);
  if (yellow.length > 0) return { level: 'yellow', reasons: yellow };

  return { level: 'green', reasons: [] };
}

function reasonsTop(map: Map<string, number>): Array<{ reason: string; count: number }> {
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => ({ reason, count }));
}

// ── Reducer puro ────────────────────────────────────────────────────────────

interface CardAcc {
  subIndex: number | null;
  brand: string | null;
  role: 'active' | 'reserve';
  number: string | null;
  sent: number;
  delivered: number;
  undelivered: number;
  failed: number;
  stops: number;
  filtered30007: number;
  filtered30007Last24h: number;
  pending: number;
  lastStatusFrom: { number: string; at: number } | null;
  sentByDay: Map<string, number>;
  deliveredByDay: Map<string, number>;
  finalsByDay: Map<string, number>;
}

export function reduceSms(input: SmsReduceInput): Omit<SmsResponse, 'feed'> {
  const { startDate, endDate, now, brandFilter, campaignFilter } = input;

  // Cards fixos da config + dinâmicos pra tráfego fora do mapa (marca nova
  // aparece na tela em vez de sumir das métricas por número).
  const cards = new Map<string, CardAcc>();
  const mkCard = (subIndex: number | null, brand: string | null, role: 'active' | 'reserve', number: string | null): CardAcc => ({
    subIndex, brand, role, number,
    sent: 0, delivered: 0, undelivered: 0, failed: 0, stops: 0,
    filtered30007: 0, filtered30007Last24h: 0, pending: 0,
    lastStatusFrom: null,
    sentByDay: new Map(), deliveredByDay: new Map(), finalsByDay: new Map(),
  });
  for (const s of SMS_SUBACCOUNTS) cards.set(`#${s.subIndex}`, mkCard(s.subIndex, s.brand, s.role, s.number));

  const cardFor = (subIndex: number | null, brand: string | null): CardAcc | null => {
    if (subIndex != null && cards.has(`#${subIndex}`)) {
      const c = cards.get(`#${subIndex}`)!;
      // Evento traz marca que a config ainda não conhece (ex.: sub reserva
      // ativado antes de editar o mapa) — adota a marca do evento.
      if (c.brand == null && brand != null) c.brand = brand;
      return c;
    }
    if (brand != null) {
      const bySub = Array.from(cards.values()).find((c) => c.brand === brand);
      if (bySub) return bySub;
    }
    if (subIndex == null && brand == null) return null;
    const key = subIndex != null ? `#${subIndex}` : `b:${brand}`;
    if (!cards.has(key)) cards.set(key, mkCard(subIndex, brand, 'active', null));
    return cards.get(key)!;
  };

  // Enviados + série diária por card.
  for (const r of input.sent) {
    const c = cardFor(r.subIndex, r.brand);
    if (c) {
      c.sent++;
      const day = brtDay(r.occurredAt);
      c.sentByDay.set(day, (c.sentByDay.get(day) ?? 0) + 1);
    }
  }

  // Status: métricas de entrega usam só o período; o Set de sids usa a
  // janela estendida inteira (pendentes).
  const statusSids = new Set<string>();
  let delivered = 0;
  let undelivered = 0;
  let failed = 0;
  let carrierFiltered = 0;
  const endMs = endDate.getTime();
  for (const r of input.statuses) {
    if (r.messageSid) statusSids.add(r.messageSid);
    if (r.occurredAt.getTime() > endMs) continue;
    const c = cardFor(r.subIndex, r.brand);
    const st = (r.status ?? '').toLowerCase();
    if (st === 'delivered') delivered++;
    else if (st === 'undelivered') undelivered++;
    else if (st === 'failed') failed++;
    if (r.errorCode === 30007) carrierFiltered++;
    if (c) {
      const day = brtDay(r.occurredAt);
      if (st === 'delivered') { c.delivered++; c.deliveredByDay.set(day, (c.deliveredByDay.get(day) ?? 0) + 1); }
      else if (st === 'undelivered') c.undelivered++;
      else if (st === 'failed') c.failed++;
      if (st === 'delivered' || st === 'undelivered' || st === 'failed') {
        c.finalsByDay.set(day, (c.finalsByDay.get(day) ?? 0) + 1);
      }
      if (r.errorCode === 30007) c.filtered30007++;
      if (r.fromNumber) {
        const at = r.occurredAt.getTime();
        if (!c.lastStatusFrom || at > c.lastStatusFrom.at) c.lastStatusFrom = { number: r.fromNumber, at };
      }
    }
  }
  const finals = delivered + undelivered + failed;

  for (const e of input.errors24h) {
    const c = cardFor(e.subIndex, e.brand);
    if (c) c.filtered30007Last24h += e.count;
  }

  // STOPs (atribuídos a card via subIndex/brand enriquecidos no ingest).
  for (const r of input.stops) {
    const c = cardFor(r.subIndex, r.brand);
    if (c) c.stops++;
  }

  // Pendentes: sms_sent há mais de 1h sem status final do mesmo sid.
  const pendingCutoff = now.getTime() - HOUR_MS;
  let pending = 0;
  for (const r of input.sent) {
    if (!r.messageSid || statusSids.has(r.messageSid)) continue;
    if (r.occurredAt.getTime() > pendingCutoff) continue;
    pending++;
    const c = cardFor(r.subIndex, r.brand);
    if (c) c.pending++;
  }

  // Descartados. Filtro de marca: usa o brand enriquecido no ingest;
  // registros antigos sem brand caem pro fallback do mapa campanha→marca
  // dos enviados da janela (que já vêm filtrados por marca do banco).
  // Limite conhecido do fallback: skip antigo (sem brand) de campanha
  // que não enviou nada na janela fica fora do filtro por marca.
  const campaignBrand = new Map<string, Map<string, number>>();
  for (const r of input.sent) {
    if (!r.campaign || !r.brand) continue;
    const m = campaignBrand.get(r.campaign) ?? new Map<string, number>();
    m.set(r.brand, (m.get(r.brand) ?? 0) + 1);
    campaignBrand.set(r.campaign, m);
  }
  const dominantBrand = (campaign: string | null): string | null => {
    if (!campaign) return null;
    const m = campaignBrand.get(campaign);
    if (!m) return null;
    let best: string | null = null;
    let bestN = 0;
    for (const [b, n] of m) if (n > bestN) { best = b; bestN = n; }
    return best;
  };
  const skippedRows = brandFilter
    ? input.skipped.filter((r) =>
        r.brand != null
          ? r.brand === brandFilter
          : r.campaign != null && campaignBrand.has(r.campaign))
    : input.skipped;
  const skippedByReason = new Map<string, number>();
  for (const r of skippedRows) {
    const reason = r.reason ?? 'sem motivo';
    skippedByReason.set(reason, (skippedByReason.get(reason) ?? 0) + 1);
  }

  // Delta de entrega vs período anterior (mesma duração).
  const prev = input.prevStatusCounts;
  const prevFinals = prev.delivered + prev.undelivered + prev.failed;
  const deliveryRate = finals > 0 ? round4(delivered / finals) : null;
  const deliveryRatePrev = prevFinals > 0 ? round4(prev.delivered / prevFinals) : null;
  const deliveryRateDeltaPp =
    deliveryRate != null && deliveryRatePrev != null
      ? Math.round((deliveryRate - deliveryRatePrev) * 1000) / 10
      : null;

  // Aviso "callbacks fora do ar": olha os envios de 2h..1h atrás (já
  // tiveram a 1h de tolerância) e mede quantos seguem sem status final.
  // Mínimo de 5 envios pra não alarmar com amostra minúscula.
  const recentSent = input.sent.filter((r) => {
    const t = r.occurredAt.getTime();
    return t >= now.getTime() - 2 * HOUR_MS && t <= pendingCutoff;
  });
  const recentUnmatched = recentSent.filter((r) => !r.messageSid || !statusSids.has(r.messageSid)).length;
  const recentPendingRatio = recentSent.length >= 5 ? round4(recentUnmatched / recentSent.length) : null;
  const callbacksSuspect = recentPendingRatio != null && recentPendingRatio > 0.2;

  // Cards → saída (config primeiro, na ordem; dinâmicos depois).
  const numbers: SmsNumberCard[] = Array.from(cards.values()).map((c) => {
    const cardFinals = c.delivered + c.undelivered + c.failed;
    const rate = cardFinals > 0 ? round4(c.delivered / cardFinals) : null;
    const stopRate = c.sent > 0 ? round4(c.stops / c.sent) : null;
    const health = smsHealth({
      sent: c.sent,
      finals: cardFinals,
      deliveryRate: rate,
      stopRate,
      filtered30007Last24h: c.filtered30007Last24h,
    });
    const days = new Set([...c.sentByDay.keys(), ...c.finalsByDay.keys()]);
    const daily = Array.from(days)
      .sort()
      .map((date) => {
        const f = c.finalsByDay.get(date) ?? 0;
        return {
          date,
          sent: c.sentByDay.get(date) ?? 0,
          deliveryRate: f > 0 ? round4((c.deliveredByDay.get(date) ?? 0) / f) : null,
        };
      });
    return {
      subIndex: c.subIndex,
      brand: c.brand,
      role: c.role,
      numberMasked: maskPhone(c.number ?? c.lastStatusFrom?.number ?? null),
      sent: c.sent,
      delivered: c.delivered,
      undelivered: c.undelivered,
      failed: c.failed,
      deliveryRate: rate,
      stops: c.stops,
      stopRate,
      filtered30007: c.filtered30007,
      filtered30007Last24h: c.filtered30007Last24h,
      pending: c.pending,
      health: health.level,
      healthReasons: health.reasons,
      daily,
    };
  });

  // ── Campanhas: catálogo × agregados por slug ──────────────────────────────
  interface CampAcc {
    sent: number;
    delivered: number;
    undelivered: number;
    failed: number;
    stops: number;
    skipped: number;
    skippedByReason: Map<string, number>;
    sentByDay: Map<string, number>;
    lastSentAt: Date | null;
  }
  const camps = new Map<string, CampAcc>();
  const campAcc = (slug: string): CampAcc => {
    let c = camps.get(slug);
    if (!c) {
      c = { sent: 0, delivered: 0, undelivered: 0, failed: 0, stops: 0, skipped: 0, skippedByReason: new Map(), sentByDay: new Map(), lastSentAt: null };
      camps.set(slug, c);
    }
    return c;
  };
  for (const r of input.sent) {
    if (!r.campaign) continue;
    const c = campAcc(r.campaign);
    c.sent++;
    const day = brtDay(r.occurredAt);
    c.sentByDay.set(day, (c.sentByDay.get(day) ?? 0) + 1);
    if (!c.lastSentAt || r.occurredAt > c.lastSentAt) c.lastSentAt = r.occurredAt;
  }
  for (const r of input.statuses) {
    if (!r.campaign || r.occurredAt.getTime() > endMs) continue;
    const c = campAcc(r.campaign);
    const st = (r.status ?? '').toLowerCase();
    if (st === 'delivered') c.delivered++;
    else if (st === 'undelivered') c.undelivered++;
    else if (st === 'failed') c.failed++;
  }
  for (const r of input.stops) {
    if (!r.campaign) continue;
    campAcc(r.campaign).stops++;
  }
  for (const r of skippedRows) {
    if (!r.campaign) continue;
    const c = campAcc(r.campaign);
    c.skipped++;
    const reason = r.reason ?? 'sem motivo';
    c.skippedByReason.set(reason, (c.skippedByReason.get(reason) ?? 0) + 1);
  }

  const catalog = campaignFilter
    ? input.campaignsCatalog.filter((c) => c.slug === campaignFilter)
    : input.campaignsCatalog;
  const catalogSlugs = new Set(catalog.map((c) => c.slug).filter(Boolean) as string[]);

  const campaignsOut: SmsCampaignRowOut[] = catalog.map((cat) => {
    const agg = cat.slug ? camps.get(cat.slug) : undefined;
    const aggFinals = agg ? agg.delivered + agg.undelivered + agg.failed : 0;
    return {
      mauticId: cat.mauticId,
      name: cat.name,
      slug: cat.slug,
      status: cat.archived ? 'archived' : cat.isPublished ? 'active' : 'paused',
      brand: cat.slug ? dominantBrand(cat.slug) : null,
      sent: agg?.sent ?? 0,
      deliveryRate: aggFinals > 0 ? round4((agg?.delivered ?? 0) / aggFinals) : null,
      stops: agg?.stops ?? 0,
      skipped: agg?.skipped ?? 0,
      skippedByReason: agg ? reasonsTop(agg.skippedByReason) : [],
      dailySent: agg
        ? Array.from(agg.sentByDay.entries()).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, sent]) => ({ date, sent }))
        : [],
      lastSentAt: agg?.lastSentAt?.toISOString() ?? null,
      orphan: false,
    };
  });
  // Slugs órfãos: telemetria sem entrada no catálogo (aviso na tabela).
  for (const [slug, agg] of camps) {
    if (catalogSlugs.has(slug)) continue;
    if (campaignFilter && slug !== campaignFilter) continue;
    const aggFinals = agg.delivered + agg.undelivered + agg.failed;
    campaignsOut.push({
      mauticId: null,
      name: null,
      slug,
      status: null,
      brand: dominantBrand(slug),
      sent: agg.sent,
      deliveryRate: aggFinals > 0 ? round4(agg.delivered / aggFinals) : null,
      stops: agg.stops,
      skipped: agg.skipped,
      skippedByReason: reasonsTop(agg.skippedByReason),
      dailySent: Array.from(agg.sentByDay.entries()).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, sent]) => ({ date, sent })),
      lastSentAt: agg.lastSentAt?.toISOString() ?? null,
      orphan: true,
    });
  }
  // Ordenação padrão: último envio desc; sem telemetria no fim.
  campaignsOut.sort((a, b) => (b.lastSentAt ?? '').localeCompare(a.lastSentAt ?? ''));

  const redNumbers = numbers
    .filter((n) => n.health === 'red')
    .map((n) => n.brand ?? (n.subIndex != null ? `Sub #${n.subIndex}` : 'desconhecido'));

  return {
    range: { start: startDate.toISOString(), end: endDate.toISOString() },
    filters: { brand: brandFilter, campaign: campaignFilter },
    kpis: {
      sent: input.sent.length,
      delivered,
      undelivered,
      failed,
      finals,
      deliveryRate,
      deliveryRatePrev,
      deliveryRateDeltaPp,
      stops: input.stops.length,
      stopRate: input.sent.length > 0 ? round4(input.stops.length / input.sent.length) : null,
      skipped: skippedRows.length,
      skippedByReason: reasonsTop(skippedByReason),
      carrierFiltered30007: carrierFiltered,
      pending,
    },
    numbers,
    campaigns: campaignsOut,
    alerts: {
      redNumbers,
      callbacksSuspect,
      recentPendingRatio,
    },
  };
}

// ── Serviço (queries + reducer + feed) ──────────────────────────────────────

export async function getSms(filters: SmsFilters): Promise<SmsResponse> {
  const now = new Date();
  const { startDate, endDate } = filters;
  const brand = filters.brand ?? null;
  const campaign = filters.campaign ?? null;

  const brandWhere = brand ? { brand } : {};
  const campaignWhere = campaign ? { campaign } : {};
  const range = { gte: startDate, lte: endDate };
  // Janela estendida pros callbacks que chegam depois do fim do período
  // (cálculo de pendentes) — ver comentário no SmsReduceInput.
  const rangeExtended = { gte: startDate, lte: new Date(endDate.getTime() + 48 * HOUR_MS) };
  const durationMs = endDate.getTime() - startDate.getTime();

  const [sent, statuses, skipped, stops, prevStatusGroups, errors24h, campaignsCatalog, feedRows] = await Promise.all([
    db.smsEvent.findMany({
      where: { eventType: 'sms_sent', occurredAt: range, ...brandWhere, ...campaignWhere },
      select: { messageSid: true, campaign: true, brand: true, subIndex: true, occurredAt: true },
    }),
    db.smsEvent.findMany({
      where: { eventType: 'sms_status', occurredAt: rangeExtended, ...brandWhere, ...campaignWhere },
      select: { messageSid: true, status: true, errorCode: true, campaign: true, brand: true, subIndex: true, fromNumber: true, occurredAt: true },
    }),
    // brand é aplicado no reducer: usa o brand enriquecido no ingest e cai
    // pro mapa campanha→marca pros registros antigos sem marca.
    db.smsEvent.findMany({
      where: { eventType: 'sms_skipped', occurredAt: range, ...campaignWhere },
      select: { reason: true, campaign: true, brand: true, occurredAt: true },
    }),
    db.smsEvent.findMany({
      where: { eventType: 'sms_stop', occurredAt: range, ...brandWhere, ...campaignWhere },
      select: { brand: true, subIndex: true, campaign: true, occurredAt: true },
    }),
    db.smsEvent.groupBy({
      by: ['status'],
      where: {
        eventType: 'sms_status',
        occurredAt: { gte: new Date(startDate.getTime() - durationMs), lt: startDate },
        ...brandWhere,
        ...campaignWhere,
      },
      _count: { _all: true },
    }),
    db.smsEvent.groupBy({
      by: ['brand', 'subIndex'],
      where: { eventType: 'sms_status', errorCode: 30007, occurredAt: { gte: new Date(now.getTime() - 24 * HOUR_MS) } },
      _count: { _all: true },
    }),
    db.smsCampaign.findMany({
      select: { mauticId: true, name: true, slug: true, isPublished: true, archived: true },
      orderBy: { mauticId: 'asc' },
    }),
    db.smsEvent.findMany({
      where: {
        eventType: { in: ['sms_sent', 'sms_status', 'sms_skipped', 'sms_stop'] },
        occurredAt: range,
        ...brandWhere,
        ...campaignWhere,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true, eventType: true, status: true, errorCode: true, reason: true,
        campaign: true, brand: true, toNumber: true, fromNumber: true, occurredAt: true,
      },
    }),
  ]);

  const prevStatusCounts = { delivered: 0, undelivered: 0, failed: 0 };
  for (const g of prevStatusGroups) {
    const st = (g.status ?? '').toLowerCase();
    if (st === 'delivered') prevStatusCounts.delivered += g._count._all;
    else if (st === 'undelivered') prevStatusCounts.undelivered += g._count._all;
    else if (st === 'failed') prevStatusCounts.failed += g._count._all;
  }

  const reduced = reduceSms({
    startDate,
    endDate,
    now,
    brandFilter: brand,
    campaignFilter: campaign,
    sent,
    statuses,
    skipped,
    stops,
    prevStatusCounts,
    errors24h: errors24h.map((e) => ({ brand: e.brand, subIndex: e.subIndex, count: e._count._all })),
    campaignsCatalog,
  });

  const feed = feedRows.map((r) => {
    const type = r.eventType === 'sms_status'
      ? ((r.status ?? 'status').toLowerCase())
      : r.eventType.replace(/^sms_/, '');
    const detail = r.reason
      ?? (r.errorCode != null ? `erro ${r.errorCode}${r.errorCode === 30007 ? ' · filtragem de operadora' : ''}` : null);
    return {
      id: String(r.id),
      type,
      occurredAt: r.occurredAt.toISOString(),
      brand: r.brand,
      campaign: r.campaign,
      // Em sent/status o lead é o `to`; em stop o lead é o `from`.
      toMasked: maskPhone(r.eventType === 'sms_stop' ? r.fromNumber : r.toNumber),
      detail,
    };
  });

  return { ...reduced, feed };
}
