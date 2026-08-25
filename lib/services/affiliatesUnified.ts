// Aba Afiliados com contas UNIFICADAS: agrupa as linhas de getAffiliates
// pelo AffiliatePartner (identidade entre plataformas) mantendo a mesma
// forma de linha — a página continua lendo os mesmos campos; a linha do
// parceiro ganha `accounts` (uma por plataforma) pro drawer por plataforma.
//
// Regras de fusão (mesmas do mergeMetrics da Análise): somas pra
// contagens/valores, taxas re-derivadas dos totais, NET AOV ponderado por
// FEs, CPA/venda ponderado SÓ pelas contas com CPA conhecido, Net after
// CPA total = soma, por FE = total ÷ FEs com CPA.

import { db } from '../db';
import { cpaStatus, getProfitModelInputs, type ProfitThresholds } from './profitModel';
import type { AffiliatesResponse } from './metrics';

export type AffiliateRow = AffiliatesResponse['affiliates'][number];

export interface PartnerContact { email: string | null; phone: string | null; notes: string | null }
export interface PartnerOriginRef { type: string; ref: string | null }

export interface UnifiedAffiliateRow extends AffiliateRow {
  key: string;               // `${slug}:${externalId}` (solta) | `partner:<id>`
  partnerId: string | null;
  partnerName: string | null;
  platforms: string[];
  accounts: AffiliateRow[];  // 1 = conta solta
  contact: PartnerContact | null; // só admin
  origin: PartnerOriginRef | null; // indicação / instagram / plataforma / outro
}

export interface UnifiedAffiliatesResponse extends Omit<AffiliatesResponse, 'affiliates'> {
  unified: true;
  affiliates: UnifiedAffiliateRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const sum = <T>(list: T[], f: (x: T) => number | null | undefined) => list.reduce((n, x) => n + (f(x) ?? 0), 0);

/** Funde N linhas de conta numa linha de parceiro (função pura, testada). */
export function mergeAffiliateRows(accounts: AffiliateRow[], partnerName: string, thresholds: ProfitThresholds): AffiliateRow {
  if (accounts.length === 1) return { ...accounts[0], nickname: partnerName || accounts[0].nickname };
  const primary = [...accounts].sort((a, b) => b.revenue - a.revenue)[0];
  const fe = sum(accounts, (a) => a.feApprovedCount);
  const realOrders = sum(accounts, (a) => a.realOrders);
  const denom = realOrders || 1;
  const orders = sum(accounts, (a) => a.orders);
  const refunds = sum(accounts, (a) => a.refunds);
  const chargebacks = sum(accounts, (a) => a.chargebacks);
  const revenue = sum(accounts, (a) => a.revenue);
  const cpa = sum(accounts, (a) => a.cpa);
  const withCpa = accounts.filter((a) => a.netAfterCpaTotalUsd != null && (a.cpaPerFe || 0) > 0);
  const feWithCpa = sum(withCpa, (a) => a.feApprovedCount);
  const nAfterTotal = withCpa.length ? r2(sum(withCpa, (a) => a.netAfterCpaTotalUsd)) : null;
  const nAfter = nAfterTotal != null && feWithCpa > 0 ? r2(nAfterTotal / feWithCpa) : null;
  const wavgFe = (f: (a: AffiliateRow) => number) => (fe > 0 ? r2(sum(accounts, (a) => f(a) * a.feApprovedCount) / fe) : 0);
  // NET AOV e CPA/venda sobre a MESMA base (contas com CPA, quando há) —
  // assim NET AOV − CPA/venda = Net after CPA também na linha do parceiro.
  const cpaBase = feWithCpa > 0 ? withCpa : accounts;
  const cpaBaseFe = feWithCpa > 0 ? feWithCpa : fe;
  const wavgCpaBase = (f: (a: AffiliateRow) => number) => (cpaBaseFe > 0 ? r2(sum(cpaBase, (a) => f(a) * a.feApprovedCount) / cpaBaseFe) : 0);
  const attRevenue = sum(accounts, (a) => a.attributedRevenue);
  const attProfit = sum(accounts, (a) => a.attributedProfit);
  const sparkLen = Math.max(...accounts.map((a) => a.sparkline?.length ?? 0), 0);
  const sparkline = new Array<number>(sparkLen).fill(0);
  for (const a of accounts) (a.sparkline ?? []).forEach((v, i) => { sparkline[i] += v; });
  const firstSeen = accounts.map((a) => a.firstSeenAt).filter(Boolean).sort()[0] ?? primary.firstSeenAt;
  const lastOrder = accounts.map((a) => a.lastOrderAt).filter((x): x is string => !!x).sort().pop() ?? null;
  return {
    ...primary,
    nickname: partnerName || primary.nickname,
    revenue: r2(revenue),
    orders,
    allOrders: sum(accounts, (a) => a.allOrders),
    realOrders,
    refunds,
    chargebacks,
    approvalRate: realOrders ? r4(orders / denom) : 0,
    refundRate: realOrders ? r4(refunds / denom) : 0,
    cbRate: realOrders ? r4(chargebacks / denom) : 0,
    cpa: r2(cpa),
    feApprovedCount: fe,
    feCpaPaidCount: sum(accounts, (a) => a.feCpaPaidCount),
    cpaPerFe: feWithCpa > 0 ? wavgCpaBase((a) => a.cpaPerFe) : 0,
    cpaPerFeApproved: fe > 0 ? r2(cpa / fe) : 0,
    netAovUsd: wavgCpaBase((a) => a.netAovUsd),
    netAfterCpaUsd: nAfter,
    netAfterCpaTotalUsd: nAfterTotal,
    cpaStatus: nAfter != null ? cpaStatus(nAfter, thresholds) : null,
    refundCbPctUsed: fe > 0 ? Math.round(sum(accounts, (a) => a.refundCbPctUsed * a.feApprovedCount) / fe * 10) / 10 : primary.refundCbPctUsed,
    refundCbPctOverride: null,
    opexPctUsed: primary.opexPctUsed,
    netMargin: r2(sum(accounts, (a) => a.netMargin)),
    cogs: r2(sum(accounts, (a) => a.cogs)),
    fulfillment: r2(sum(accounts, (a) => a.fulfillment)),
    estimatedProfit: r2(sum(accounts, (a) => a.estimatedProfit)),
    attributedSessions: sum(accounts, (a) => a.attributedSessions),
    attributedOrders: sum(accounts, (a) => a.attributedOrders),
    attributedRevenue: r2(attRevenue),
    attributedNet: r2(sum(accounts, (a) => a.attributedNet)),
    attributedCpa: r2(sum(accounts, (a) => a.attributedCpa)),
    attributedCogs: r2(sum(accounts, (a) => a.attributedCogs)),
    attributedFulfillment: r2(sum(accounts, (a) => a.attributedFulfillment)),
    attributedProfit: r2(attProfit),
    attributedMarginPct: attRevenue > 0 ? r2(attProfit / attRevenue * 100) : 0, // percentual, como na linha de conta
    topCountry: primary.topCountry,
    ltvRevenue: r2(sum(accounts, (a) => a.ltvRevenue)),
    ltvOrders: sum(accounts, (a) => a.ltvOrders),
    firstSeenAt: firstSeen,
    lastOrderAt: lastOrder,
    sparkline,
  };
}

/** Agrupa as linhas por parceiro (pura). `partnerOf(key)` → {id, name, contact} | null. */
export function groupAffiliateRows(
  rows: AffiliateRow[],
  partnerOf: (key: string) => { id: string; name: string; contact: PartnerContact | null; origin?: PartnerOriginRef | null } | null,
  thresholds: ProfitThresholds,
): UnifiedAffiliateRow[] {
  const byPartner = new Map<string, { name: string; contact: PartnerContact | null; origin: PartnerOriginRef | null; accounts: AffiliateRow[] }>();
  const out: UnifiedAffiliateRow[] = [];
  for (const r of rows) {
    const key = `${r.platformSlug}:${r.externalId}`;
    const p = partnerOf(key);
    if (!p) {
      out.push({ ...r, key, partnerId: null, partnerName: null, platforms: [r.platformSlug], accounts: [r], contact: null, origin: null });
      continue;
    }
    const g = byPartner.get(p.id) ?? { name: p.name, contact: p.contact, origin: p.origin ?? null, accounts: [] };
    g.accounts.push(r);
    byPartner.set(p.id, g);
  }
  for (const [pid, g] of byPartner) {
    const merged = mergeAffiliateRows(g.accounts, g.name, thresholds);
    const accounts = [...g.accounts].sort((a, b) => b.revenue - a.revenue);
    out.push({
      ...merged,
      key: `partner:${pid}`,
      partnerId: pid,
      partnerName: g.name,
      platforms: [...new Set(accounts.map((a) => a.platformSlug))], // maior receita primeiro
      accounts,
      contact: g.contact,
      origin: g.origin,
    });
  }
  out.sort((a, b) => b.revenue - a.revenue);
  return out;
}

export async function unifyAffiliates(data: AffiliatesResponse, includeContact: boolean, platformSlugs?: string[]): Promise<UnifiedAffiliatesResponse> {
  // Com filtro de plataforma ativo, contas de outras plataformas vêm zeradas
  // da lista base — não entram na linha do parceiro (senão o drawer listava
  // conta D24 com $0 num filtro "só JVZoo").
  const platformSet = platformSlugs?.length ? new Set(platformSlugs) : null;
  const baseRows = platformSet ? data.affiliates.filter((r) => platformSet.has(r.platformSlug)) : data.affiliates;
  const [linked, pm] = await Promise.all([
    db.affiliate.findMany({
      where: { partnerId: { not: null } },
      select: {
        externalId: true, platform: { select: { slug: true } }, partnerId: true,
        partner: { select: { id: true, displayName: true, email: true, phone: true, notes: true, originType: true, originRef: true } },
      },
    }),
    getProfitModelInputs(),
  ]);
  const map = new Map<string, { id: string; name: string; contact: PartnerContact | null; origin: PartnerOriginRef | null }>();
  for (const a of linked) {
    if (!a.partner) continue;
    map.set(`${a.platform.slug}:${a.externalId}`, {
      id: a.partner.id, name: a.partner.displayName,
      contact: includeContact ? { email: a.partner.email, phone: a.partner.phone, notes: a.partner.notes } : null,
      origin: a.partner.originType ? { type: a.partner.originType, ref: a.partner.originRef } : null,
    });
  }
  const affiliates = groupAffiliateRows(baseRows, (k) => map.get(k) ?? null, pm.thresholds);
  const active = affiliates.filter((r) => r.realOrders > 0);
  const totalRevenue = sum(active, (r) => r.revenue);
  const top5 = [...active].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  // activeNow/activePrev/newAff/churnedAff ficam na base original (por CONTA)
  // — os quatro precisam da mesma base pro card "vs período anterior" fazer
  // sentido. Só a concentração é recalculada sobre as linhas visíveis.
  return {
    ...data,
    unified: true,
    summary: {
      ...data.summary,
      concentration: totalRevenue > 0 ? r4(sum(top5, (r) => r.revenue) / totalRevenue) : 0,
    },
    affiliates,
  };
}
