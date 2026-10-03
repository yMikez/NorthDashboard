// Qualidade do dado que muda a leitura de um número (plataforma sem evento
// de estorno, lacuna de IPN da Digistore, comissão assumida, IPN atrasado):
// anexada automaticamente em _meta.dataQuality das tools que mexem com
// reembolso/lucro, e exposta inteira na tool get_data_coverage.
//
// A tela já avisa (RefundCoverageNotice); o modelo não via nada — e dizia
// "BuyGoods com 0% de reembolso, excelente" quando a BuyGoods simplesmente
// parou de mandar o evento. Os sinais são DERIVADOS do dado (somem sozinhos
// quando a ingestão volta); o que é constante documentada está marcado.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import { getRefundCoverage, type RefundCoverageResponse } from '../services/refundCoverage';
import { silentInScope } from '../services/refundCoverageCore';
import { getHealth } from '../services/health';
import { getProviderCommission } from '../services/integrationSettings';
import { EXTRA_ROW_REFUND_PLATFORMS } from '../services/profitModel';
import { dailyMetricsLastRefreshAt } from '../services/dailyMetrics';

export interface DataQualityNote {
  platform?: string;
  issue: string;
  effect: string;
  detail?: Record<string, unknown>;
}

// ~28% dos estornos da Digistore (os executados pelas contas Tauk*Affilliate)
// nunca disparam IPN — só entram pelo reconcile por CSV do painel
// (reconcileDigistoreRefunds.ts). Medido pelo dono em 2026-08; constante
// documentada, não medição ao vivo.
export const DIGISTORE_KNOWN_MISSING_SHARE = 0.28;

export const PLATFORM_TIMEZONES: Record<string, string> = {
  clickbank: 'America/Los_Angeles',
  digistore24: 'Europe/Berlin',
  buygoods: 'America/New_York',
  jvzoo: 'America/New_York',
  tauk: 'America/New_York',
  logicall: 'America/New_York (assumido)',
  salesbound: 'webhook America/New_York · export America/Chicago',
  buckets: 'America/Sao_Paulo (todo dia/hora do dashboard é BRT)',
};

export const KNOWN_GAPS = [
  'EPC indisponível: os IPNs não trazem visitantes (só EPO = net ÷ sessões com FE).',
  'SalesBound fica FORA do BACK do get_profit_split (placeholder 0); aparece em get_call_center e no get_net_profit.',
  'Comissão da Logicall é ASSUMIDA 35% enquanto não for cadastrada (commissionAssumed).',
  'Estornos/voids da SalesBound só chegam pelo export CSV (o webhook manda só venda).',
  'gross_original da Digistore pode incluir as linhas sintéticas de estorno (originalGrossUsd negativo; não confirmado) — evite comparar a lente "Date of Event" entre plataformas.',
  'Plataformas usam fuso próprio nos painéis; o dashboard bucketa tudo em BRT (diferença de 1 dia na borda é esperada).',
];

// Tools cujo número depende de estorno registrado (taxa, lucro, NET AOV).
const REFUND_TOOLS = new Set([
  'get_overview', 'get_platforms', 'get_affiliates', 'get_affiliate_detail', 'get_affiliate_analysis', 'get_affiliate_explain',
  'get_affiliate_sequence', 'get_products', 'get_families', 'get_refund_cohorts', 'get_profit_split', 'get_costs_overview',
  'get_orders', 'compare_periods', 'aggregate_orders', 'get_net_profit', 'get_profit_model',
]);
const COMMISSION_TOOLS = new Set(['get_call_center', 'get_profit_split', 'get_net_profit']);
// Números do período que dependem de a ingestão estar em dia (a régua do
// modelo de lucro não depende — fica fora).
const ORDER_TOOLS = new Set([...REFUND_TOOLS, 'get_funnel', 'get_funnel_sequence', 'get_fulfillment'].filter((t) => t !== 'get_profit_model'));

// Ingestão "parada": plataforma normalmente ativa sem evento há 6h+.
const STALE_AFTER_S = 6 * 3600;
const ACTIVE_EVENTS_7D = 50;
const ACTIVE_SALES_30D = 200;
const FAIL_MIN = 5;
const FAIL_SHARE = 0.05;

export interface IngestionRow {
  platform: string;
  lastReceivedAt: string | null;
  received7d: number;
  received24h: number;
  failed24h: number;
}

export interface CoverageSnapshot {
  refund: RefundCoverageResponse;
  lastCsvReconcileAt: string | null;
  ingestion: IngestionRow[];
  logicallCommissionAssumed: boolean;
}

/** Notas pra UMA tool e escopo de plataformas. Puro (testável sem banco). */
export function notesFromSnapshot(tool: string, platformSlugs: string[] | undefined, snap: CoverageSnapshot, now: Date): DataQualityNote[] {
  const notes: DataQualityNote[] = [];
  const inScope = (slug: string) => !platformSlugs?.length || platformSlugs.includes(slug);

  if (REFUND_TOOLS.has(tool)) {
    for (const r of silentInScope(snap.refund.platforms, platformSlugs)) {
      notes.push({
        platform: r.platform,
        issue: 'refund_silent',
        effect: `${r.displayName}: ${r.sales} vendas aprovadas e ZERO estorno registrado em ${snap.refund.windowDays} dias — falha de ingestão, não excelência. Reembolso dessa plataforma sai 0% e o total da operação fica subestimado; nunca chame a taxa dela de boa.`,
        detail: { sales: r.sales, refundEvents: r.refundEvents, windowDays: snap.refund.windowDays },
      });
    }
    const d24 = snap.refund.platforms.find((p) => p.platform === 'digistore24');
    if (d24 && d24.sales > 0 && inScope('digistore24')) {
      notes.push({
        platform: 'digistore24',
        issue: 'digistore_refund_ipn_gap',
        effect: `Digistore: ~${Math.round(DIGISTORE_KNOWN_MISSING_SHARE * 100)}% dos estornos (contas Tauk*Affilliate) não disparam IPN e só entram pelo reconcile por CSV${snap.lastCsvReconcileAt ? ` (último em ${snap.lastCsvReconcileAt.slice(0, 10)})` : ' (nenhum reconcile registrado)'} — a taxa real tende a ser MAIOR que a mostrada, principalmente depois do último reconcile.`,
        detail: { knownMissingShare: DIGISTORE_KNOWN_MISSING_SHARE, lastCsvReconcileAt: snap.lastCsvReconcileAt, extraRowModel: EXTRA_ROW_REFUND_PLATFORMS.has('digistore24') },
      });
    }
  }

  if (COMMISSION_TOOLS.has(tool) && snap.logicallCommissionAssumed) {
    notes.push({
      platform: 'logicall',
      issue: 'commission_assumed',
      effect: 'Comissão da Logicall não cadastrada: o cálculo ASSUME 35% (mesmo acordo da Tauk) — lucro do call center Logicall é estimativa.',
    });
  }

  if (ORDER_TOOLS.has(tool)) {
    const sales30 = new Map(snap.refund.platforms.map((p) => [p.platform, p.sales]));
    const byPlatform = new Map(snap.ingestion.map((r) => [r.platform, r]));
    for (const p of snap.refund.platforms) {
      if (!inScope(p.platform)) continue;
      const ing = byPlatform.get(p.platform);
      const active = (ing?.received7d ?? 0) >= ACTIVE_EVENTS_7D || (sales30.get(p.platform) ?? 0) >= ACTIVE_SALES_30D;
      const secondsAgo = ing?.lastReceivedAt ? Math.floor((now.getTime() - Date.parse(ing.lastReceivedAt)) / 1000) : null;
      if (active && (secondsAgo == null || secondsAgo > STALE_AFTER_S)) {
        notes.push({
          platform: p.platform,
          issue: 'ingestion_stale',
          effect: `${p.displayName}: nenhum evento recebido há ${secondsAgo == null ? 'mais de 7 dias' : `${Math.floor(secondsAgo / 3600)}h`} (plataforma normalmente ativa) — hoje/ontem podem estar incompletos; confira get_health antes de concluir queda.`,
          detail: { lastReceivedAt: ing?.lastReceivedAt ?? null, secondsAgo },
        });
      }
      if (ing && ing.failed24h >= FAIL_MIN && ing.received24h > 0 && ing.failed24h / ing.received24h >= FAIL_SHARE) {
        notes.push({
          platform: p.platform,
          issue: 'ingestion_failures',
          effect: `${p.displayName}: ${ing.failed24h} de ${ing.received24h} eventos falharam nas últimas 24h — parte das vendas/estornos pode não ter entrado.`,
          detail: { failed24h: ing.failed24h, received24h: ing.received24h },
        });
      }
    }
  }
  return notes;
}

async function lastCsvReconcileAt(): Promise<string | null> {
  // Linhas de estorno criadas pelo reconcile levam rawMetadata._source.
  // Restringe à Digistore + status de estorno: tabela pequena perto do total.
  const rows = await db.$queryRaw<Array<{ at: Date | null }>>(Prisma.sql`
    SELECT MAX(o."createdAt") AS at
    FROM "Order" o
    JOIN "Platform" pl ON pl."id" = o."platformId"
    WHERE pl."slug" = 'digistore24'
      AND o."status" IN ('REFUNDED', 'CHARGEBACK')
      AND o."rawMetadata"->>'_source' = 'csv-reconcile'
  `);
  const at = rows[0]?.at;
  return at ? new Date(at).toISOString() : null;
}

async function ingestionRows(now: Date): Promise<IngestionRow[]> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const rows = await db.$queryRaw<Array<{ platform: string; last_at: Date | null; received7d: number; received24h: number; failed24h: number }>>(Prisma.sql`
    SELECT "platformSlug" AS platform,
           MAX("receivedAt") AS last_at,
           COUNT(*)::int AS received7d,
           COUNT(*) FILTER (WHERE "receivedAt" >= ${dayAgo})::int AS received24h,
           COUNT(*) FILTER (WHERE "receivedAt" >= ${dayAgo} AND NOT "processedOk")::int AS failed24h
    FROM "IngestLog"
    WHERE "receivedAt" >= ${weekAgo}
    GROUP BY 1
  `);
  return rows.map((r) => ({
    platform: r.platform,
    lastReceivedAt: r.last_at ? new Date(r.last_at).toISOString() : null,
    received7d: r.received7d, received24h: r.received24h, failed24h: r.failed24h,
  }));
}

const TTL_MS = 60_000;
let snapCache: { at: number; promise: Promise<CoverageSnapshot> } | null = null;

export function loadCoverageSnapshot(now = new Date()): Promise<CoverageSnapshot> {
  if (snapCache && Date.now() - snapCache.at < TTL_MS) return snapCache.promise;
  const promise = (async (): Promise<CoverageSnapshot> => {
    const [refund, lastCsv, ingestion, logicall] = await Promise.all([
      getRefundCoverage(now),
      lastCsvReconcileAt(),
      ingestionRows(now),
      getProviderCommission('logicall'),
    ]);
    return { refund, lastCsvReconcileAt: lastCsv, ingestion, logicallCommissionAssumed: logicall.assumed };
  })();
  snapCache = { at: Date.now(), promise };
  promise.catch(() => { if (snapCache?.promise === promise) snapCache = null; });
  return promise;
}

/**
 * Notas de qualidade pra anexar ao resultado de `tool` (cache 60s). Nunca
 * lança: sem snapshot (banco lento), a tool responde sem as notas.
 */
export async function dataQualityFor(tool: string, platformSlugs?: string[]): Promise<DataQualityNote[]> {
  if (!REFUND_TOOLS.has(tool) && !COMMISSION_TOOLS.has(tool) && !ORDER_TOOLS.has(tool)) return [];
  try {
    const now = new Date();
    return notesFromSnapshot(tool, platformSlugs, await loadCoverageSnapshot(now), now);
  } catch (err) {
    logger.warn({ tool, err: err instanceof Error ? err.message : String(err) }, '[chat] dataQuality indisponível');
    return [];
  }
}

/** Relatório completo da tool get_data_coverage. */
export async function getDataCoverage(platforms?: string[]): Promise<Record<string, unknown>> {
  const now = new Date();
  const [snap, health] = await Promise.all([loadCoverageSnapshot(now), getHealth()]);
  const scope = (slug: string) => !platforms?.length || platforms.includes(slug);
  return {
    generatedAt: now.toISOString(),
    refunds: {
      windowDays: snap.refund.windowDays,
      platforms: snap.refund.platforms.filter((p) => scope(p.platform)),
      rule: 'silent = ≥ 200 vendas aprovadas na janela e nenhum evento de estorno — leitura PARCIAL',
    },
    digistoreRefundGap: {
      knownMissingShare: DIGISTORE_KNOWN_MISSING_SHARE,
      lastCsvReconcileAt: snap.lastCsvReconcileAt,
      note: 'Estornos das contas Tauk*Affilliate só entram pelo reconcile do CSV do painel; depois do último reconcile a taxa da Digistore está subcontada.',
    },
    ingestion: health.ingestion.perPlatform.filter((p) => scope(p.platform)).map((p) => ({
      platform: p.platform, displayName: p.displayName, lastReceivedAt: p.lastReceivedAt, secondsAgo: p.secondsAgo,
      receivedCount24h: p.receivedCount24h, failedCount24h: p.failedCount24h, successRate24h: p.successRate24h,
    })),
    catalog: {
      pendingOrders: health.catalog.pendingOrders,
      pendingGrossUsd: health.catalog.pendingGrossUsd,
      unverifiedProducts: health.catalog.unverifiedProducts,
      productsWithoutFamily: health.catalog.productsWithoutFamily,
      unknownSKUs: health.catalog.unknownSKUs,
      note: 'Pedidos com custo pendente têm COGS/frete NULL (não $0) — lucro por custo real fica otimista até os SKUs pendentes serem confirmados no catálogo.',
    },
    callCenter: { logicallCommissionAssumed: snap.logicallCommissionAssumed },
    // Visão Geral lê a MV daily_metrics (refresh throttled): idade dela diz
    // se o card pode estar atrás do pedido mais recente.
    dailyMetricsLastRefreshAt: dailyMetricsLastRefreshAt()?.toISOString() ?? null,
    timezones: PLATFORM_TIMEZONES,
    knownGaps: KNOWN_GAPS,
    // Todas as ressalvas ativas no escopo (reembolso + comissão + ingestão):
    // get_net_profit é a tool que passa pelas três regras.
    alerts: notesFromSnapshot('get_net_profit', platforms, snap, now),
    units: { 'ingestion.successRate24h': 'fraction', 'digistoreRefundGap.knownMissingShare': 'fraction' },
  };
}
