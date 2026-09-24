// Dump de ordens pra consumo EXTERNO (reconciliação, BI, SendTrace).
//
// Duas lentes de janela, e a escolha importa:
//   - por DATA DA COMPRA (start/end, dia BRT): o retrato de um período.
//   - por ATUALIZAÇÃO (updatedSince): tudo que MUDOU desde X, mesmo com
//     compra antiga. É esta que pega o reembolso que chegou 25 dias depois
//     da venda sem precisar re-puxar uma janela rolante inteira
//     (pedido do SendTrace, 2026-09-22).
//
// ESTORNO — o dado bruto tem dois formatos, por plataforma:
//   in-place  (jvzoo, buygoods, clickbank, cartpanda, pagamerican): a PRÓPRIA
//             linha da venda vira status REFUNDED/CHARGEBACK. `originalGross`
//             guarda o valor da venda no momento do ingest e `gross` passa a
//             valer o que a plataforma reportou no evento de estorno.
//   extra-row (digistore24): a venda original CONTINUA APPROVED e entra uma
//             linha NOVA, negativa, apontando pra ela em `parentExternalId`.
// Pra não obrigar o consumidor a conhecer essa diferença, cada linha sai com
// `refundedUsd`/`chargebackUsd` já resolvidos (valor POSITIVO devolvido, 0
// quando não houve) e `refundModel` dizendo de qual formato ela veio.

import { Prisma } from '@prisma/client';
import { db } from '../db';

/** Plataformas onde o estorno entra como LINHA EXTRA (ver metrics/profitModel). */
export const EXTRA_ROW_PLATFORMS = new Set(['digistore24']);

export const ORDERS_DUMP_MAX_ROWS = 50_000;
const BRT_OFFSET_MS = 3 * 3600 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface OrdersDumpQuery {
  platform?: string | null;     // slug; null/'all' = todas
  start?: string | null;        // YYYY-MM-DD (dia BRT, inclusivo)
  end?: string | null;          // YYYY-MM-DD (dia BRT, inclusivo)
  updatedSince?: string | null; // ISO 8601: tudo que mudou a partir daqui
  limit?: number | null;
}

export type OrdersDumpResult =
  | { ok: false; error: string }
  | {
      ok: true;
      mode: 'ordered_at' | 'updated_since';
      platform: string;
      start: string | null;
      end: string | null;
      updated_since: string | null;
      count: number;
      truncated: boolean;
      /** Só no modo updated_since: passe isto como updated_since na próxima chamada. */
      next_updated_since: string | null;
      orders: OrdersDumpRow[];
    };

export interface OrdersDumpRow {
  externalId: string;
  parentExternalId: string | null;
  sessionId: string | null;
  platform: string;
  status: string;
  productType: string;
  funnelStep: number | null;
  refundModel: 'in-place' | 'extra-row';
  trafficSource: string | null;
  trackingId: string | null;
  clickId: string | null;
  campaignKey: string | null;
  gross: number;
  originalGross: number | null;
  net: number;
  cpa: number;
  refundedUsd: number;
  chargebackUsd: number;
  currency: string;
  orderedAt: string;
  approvedAt: string | null;
  refundedAt: string | null;
  chargebackAt: string | null;
  updatedAt: string;
  country: string | null;
  productId: string;
  productName: string;
  family: string | null;
  bottles: number | null;
  affiliateId: string | null;
  affiliateName: string | null;
  mappedAffiliateId: string | null;
  customerEmail: string | null;
}

const n = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

/**
 * Valor efetivamente devolvido nesta linha, sempre POSITIVO.
 *
 * extra-row: a linha É o estorno — vale |gross|.
 * in-place:  a linha é a venda que virou estorno. A plataforma pode mandar no
 *            evento (a) o valor devolvido, (b) o mesmo valor da venda, ou
 *            (c) o valor negativo. Resolvemos por |gross|, limitado ao valor
 *            da venda (`originalGross`) quando ele existe — assim um estorno
 *            PARCIAL aparece como parcial e um total como total, sem nunca
 *            devolver mais do que foi vendido.
 */
export function reversedAmount(row: { gross: number; originalGross: number | null; extraRow: boolean }): number {
  const abs = Math.abs(row.gross);
  if (row.extraRow) return Math.round(abs * 100) / 100;
  const sale = row.originalGross != null ? Math.abs(row.originalGross) : null;
  const val = sale != null ? Math.min(abs, sale) : abs;
  return Math.round(val * 100) / 100;
}

export async function ordersDump(q: OrdersDumpQuery): Promise<OrdersDumpResult> {
  const platform = (q.platform ?? '').trim();
  const allPlatforms = !platform || platform === 'all';
  const updatedSinceRaw = (q.updatedSince ?? '').trim();
  const start = (q.start ?? '').trim();
  const end = (q.end ?? '').trim();
  const limit = Math.min(Math.max(Math.trunc(Number(q.limit) || ORDERS_DUMP_MAX_ROWS), 1), ORDERS_DUMP_MAX_ROWS);

  const where: Prisma.OrderWhereInput = {};
  if (!allPlatforms) where.platform = { slug: platform };

  let mode: 'ordered_at' | 'updated_since';
  if (updatedSinceRaw) {
    const since = new Date(updatedSinceRaw);
    if (Number.isNaN(since.getTime())) return { ok: false, error: 'updated_since inválido (use ISO 8601)' };
    where.updatedAt = { gte: since };
    mode = 'updated_since';
  } else {
    if (!YMD.test(start) || !YMD.test(end)) {
      return { ok: false, error: 'informe start e end (YYYY-MM-DD) OU updated_since (ISO 8601)' };
    }
    where.orderedAt = {
      gte: new Date(new Date(`${start}T00:00:00Z`).getTime() + BRT_OFFSET_MS),
      lte: new Date(new Date(`${end}T23:59:59.999Z`).getTime() + BRT_OFFSET_MS),
    };
    mode = 'ordered_at';
  }

  const rows = await db.order.findMany({
    where,
    orderBy: mode === 'updated_since' ? { updatedAt: 'asc' } : { orderedAt: 'asc' },
    take: limit,
    select: {
      externalId: true, parentExternalId: true, funnelSessionId: true, status: true, productType: true, funnelStep: true,
      trafficSource: true, trackingId: true, clickId: true, campaignKey: true,
      grossAmountUsd: true, originalGrossUsd: true, netAmountUsd: true, cpaPaidUsd: true, currencyOriginal: true,
      orderedAt: true, approvedAt: true, refundedAt: true, chargebackAt: true, updatedAt: true,
      country: true, mappedAffiliateId: true, bottlesShipped: true,
      platform: { select: { slug: true } },
      product: { select: { externalId: true, name: true, family: true } },
      affiliate: { select: { externalId: true, nickname: true } },
      customer: { select: { email: true } },
    },
  });

  const orders: OrdersDumpRow[] = rows.map((o) => {
    const extraRow = EXTRA_ROW_PLATFORMS.has(o.platform.slug);
    const gross = n(o.grossAmountUsd);
    const originalGross = o.originalGrossUsd != null ? n(o.originalGrossUsd) : null;
    const reversed = o.status === 'REFUNDED' || o.status === 'CHARGEBACK'
      ? reversedAmount({ gross, originalGross, extraRow })
      : 0;
    return {
      externalId: o.externalId,
      parentExternalId: o.parentExternalId,
      sessionId: o.funnelSessionId,
      platform: o.platform.slug,
      status: o.status,
      productType: o.productType,
      funnelStep: o.funnelStep,
      refundModel: extraRow ? 'extra-row' : 'in-place',
      trafficSource: o.trafficSource, trackingId: o.trackingId, clickId: o.clickId, campaignKey: o.campaignKey,
      gross, originalGross,
      net: n(o.netAmountUsd),
      cpa: n(o.cpaPaidUsd),
      refundedUsd: o.status === 'REFUNDED' ? reversed : 0,
      chargebackUsd: o.status === 'CHARGEBACK' ? reversed : 0,
      currency: o.currencyOriginal,
      orderedAt: o.orderedAt.toISOString(),
      approvedAt: o.approvedAt?.toISOString() ?? null,
      refundedAt: o.refundedAt?.toISOString() ?? null,
      chargebackAt: o.chargebackAt?.toISOString() ?? null,
      updatedAt: o.updatedAt.toISOString(),
      country: o.country,
      productId: o.product.externalId,
      productName: o.product.name,
      family: o.product.family,
      bottles: o.bottlesShipped,
      affiliateId: o.affiliate?.externalId ?? null,
      affiliateName: o.affiliate?.nickname ?? null,
      mappedAffiliateId: o.mappedAffiliateId,
      customerEmail: o.customer?.email ?? null,
    };
  });

  const truncated = orders.length >= limit;
  return {
    ok: true,
    mode,
    platform: allPlatforms ? 'all' : platform,
    start: mode === 'ordered_at' ? start : null,
    end: mode === 'ordered_at' ? end : null,
    updated_since: mode === 'updated_since' ? new Date(updatedSinceRaw).toISOString() : null,
    count: orders.length,
    truncated,
    // Continuação sem pular nem repetir: a próxima chamada começa no último
    // updatedAt devolvido (o consumidor deduplica por externalId + platform).
    next_updated_since: mode === 'updated_since' && truncated && orders.length > 0
      ? orders[orders.length - 1].updatedAt
      : null,
    orders,
  };
}
