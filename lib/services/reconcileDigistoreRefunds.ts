// Reconciliação dos estornos da Digistore contra o export oficial do painel
// (Relatórios → Transações, filtro "refund"). Lê as linhas do CSV, descobre
// quais NUNCA chegaram por IPN e — em modo apply — cria a linha de estorno
// que está faltando.
//
// POR QUE ISSO EXISTE (diagnóstico 2026-08-11)
// -------------------------------------------
// Uma fatia dos refunds da Digistore nunca dispara IPN pra gente. Amostra de
// 24h auditada contra o IngestLog: 52 estornos no export, 36 recebidos, 16
// ausentes — e os 16 ausentes eram exatamente os executados pelas contas
// Tauk*Affilliate (os 36 recebidos, nenhum). Desde 24/04 são ~1.100 estornos
// a menos no banco que no painel. A causa está do lado da plataforma/n8n,
// fora do alcance do dash; até ela ser resolvida, este endpoint é a ponte —
// re-rodar com um export novo é idempotente.
//
// COMO A LINHA É MONTADA
// ----------------------
// O CSV não traz todas as dimensões do IPN (país em ISO, funil, tracking).
// Então, quando a VENDA original existe no banco (casada por
// funnelSessionId = "Order ID" do CSV), clonamos as dimensões dela e
// trocamos só o dinheiro (negativo) e as datas. Sem venda original, cai no
// que o CSV tem — a linha entra mais pobre, mas o dinheiro fica certo.
//
// A linha nasce pelo upsertOrder normal, igual a um IPN: mesma
// classificação de produto, mesmo snapshot de COGS, mesmo rebalanceamento
// de frete da sessão. Consistência com as linhas já ingeridas vale mais que
// perfeição contábil aqui.

import { db } from '../db';
import { upsertOrder } from './upsertOrder';
import { wallClockToUtc } from '../shared/datetime';
import type { NormalizedOrder } from '../shared/types';

/** Linha do export já normalizada pelo script (ver scripts/reconcileDigistoreRefunds.mjs). */
export interface DigistoreRefundCsvRow {
  transactionId: string;
  orderId: string;
  /** "MM/DD/YYYY" como sai do painel. */
  date: string;
  /** "HH:MM" como sai do painel. */
  time: string;
  /** Negativo no export. */
  gross: number;
  /** "Net amount" (bruto menos VAT), negativo. */
  net: number;
  /** "Your earnings" — o que sobrou pro vendor, negativo. */
  earnings: number;
  currency: string;
  productId: string;
  productName: string;
  /** Apelido do afiliado (o export não traz o ID numérico). */
  affiliate: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  buyerId: string | null;
  /** Coluna "Created by" — quem executou o estorno. Guardado pro diagnóstico. */
  createdBy: string | null;
}

export interface ReconcileStats {
  received: number;
  /** Já existia uma Order com esse transaction_id. */
  present: number;
  /** Faltava no banco. */
  missing: number;
  /** Criadas nesta chamada (0 em dry-run). */
  created: number;
  /** Faltavam mas não deu pra montar a linha (data inválida etc.). */
  failed: number;
  /** Das criadas, quantas acharam a venda original pra clonar dimensões. */
  matchedOriginalSale: number;
  /** Quem executou os estornos ausentes — a pista do buraco de IPN. */
  missingByCreatedBy: Record<string, number>;
  missingByMonth: Record<string, number>;
  /** Soma do gross ausente (negativo). */
  missingGrossUsd: number;
  sampleMissing: string[];
  errors: Array<{ transactionId: string; message: string }>;
}

// O painel exporta em wall clock do fuso configurado na conta — Eastern
// nesta (validado casando 8 transaction_ids do export com o receivedAt UTC
// do IngestLog: delta constante de 4,0h em agosto = EDT).
const CSV_TIMEZONE = 'America/New_York';

/** "MM/DD/YYYY" + "HH:MM" (Eastern) → instante UTC. */
export function parseCsvTimestamp(date: string, time: string): Date | null {
  const m = date.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, MM, DD, YYYY] = m;
  const hhmm = /^\d{2}:\d{2}(:\d{2})?$/.test(time.trim()) ? time.trim() : '00:00';
  const withSeconds = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  return wallClockToUtc(`${YYYY}-${MM}-${DD} ${withSeconds}`, CSV_TIMEZONE);
}

export async function reconcileDigistoreRefunds(
  rows: DigistoreRefundCsvRow[],
  apply: boolean,
): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    received: rows.length,
    present: 0,
    missing: 0,
    created: 0,
    failed: 0,
    matchedOriginalSale: 0,
    missingByCreatedBy: {},
    missingByMonth: {},
    missingGrossUsd: 0,
    sampleMissing: [],
    errors: [],
  };

  const platform = await db.platform.findUnique({
    where: { slug: 'digistore24' },
    select: { id: true },
  });
  if (!platform) throw new Error('plataforma digistore24 não cadastrada');

  // Quais desses transaction_ids já existem? Uma query só pro lote inteiro.
  const known = new Set(
    (await db.order.findMany({
      where: { platformId: platform.id, externalId: { in: rows.map((r) => r.transactionId) } },
      select: { externalId: true },
    })).map((o) => o.externalId),
  );

  const missing = rows.filter((r) => !known.has(r.transactionId));
  stats.present = rows.length - missing.length;
  stats.missing = missing.length;
  for (const r of missing) {
    const by = r.createdBy || '(vazio)';
    stats.missingByCreatedBy[by] = (stats.missingByCreatedBy[by] ?? 0) + 1;
    const month = r.date.slice(6, 10) + '-' + r.date.slice(0, 2);
    stats.missingByMonth[month] = (stats.missingByMonth[month] ?? 0) + 1;
    stats.missingGrossUsd += r.gross;
  }
  stats.missingGrossUsd = Math.round(stats.missingGrossUsd * 100) / 100;
  stats.sampleMissing = missing.slice(0, 10).map((r) => r.transactionId);

  if (!apply || missing.length === 0) return stats;

  // Venda original de cada estorno ausente: o "Order ID" do export é o
  // order_id da Digistore, que o connector grava em funnelSessionId.
  const originals = await db.order.findMany({
    where: {
      platformId: platform.id,
      funnelSessionId: { in: missing.map((r) => r.orderId) },
      status: 'APPROVED',
    },
    select: {
      funnelSessionId: true, orderedAt: true, parentExternalId: true,
      previousTransactionId: true, vendorAccount: true, productType: true,
      funnelStep: true, billingType: true, paySequenceNo: true,
      numberOfInstallments: true, paymentMethod: true,
      country: true, state: true, city: true,
      clickId: true, trackingId: true, campaignKey: true, trafficSource: true,
      currencyOriginal: true,
      affiliate: { select: { externalId: true, nickname: true } },
      customer: { select: { externalId: true, email: true, firstName: true, lastName: true, language: true } },
      product: { select: { externalId: true, name: true } },
    },
  });
  const originalBySession = new Map(originals.map((o) => [o.funnelSessionId ?? '', o]));

  // Sem venda original o CSV só dá o APELIDO do afiliado — resolvemos pro
  // externalId real pra não criar Affiliate duplicado com chave errada.
  const affiliateIdByNickname = new Map(
    (await db.affiliate.findMany({
      where: {
        platformId: platform.id,
        nickname: { in: [...new Set(missing.map((r) => r.affiliate).filter((a): a is string => !!a))] },
      },
      select: { externalId: true, nickname: true },
    })).map((a) => [a.nickname ?? '', a.externalId]),
  );

  for (const row of missing) {
    try {
      const eventAt = parseCsvTimestamp(row.date, row.time);
      if (!eventAt) throw new Error(`data inválida: "${row.date} ${row.time}"`);

      const original = originalBySession.get(row.orderId);
      if (original) stats.matchedOriginalSale++;

      const normalized: NormalizedOrder = {
        platformSlug: 'digistore24',
        externalId: row.transactionId,
        // Sem a venda original não dá pra derivar o order_id base (o export
        // não traz upsell_no) — o próprio order_id vira âncora da sessão.
        parentExternalId: original?.parentExternalId ?? row.orderId,
        previousTransactionId: original?.previousTransactionId ?? null,
        vendorAccount: original?.vendorAccount ?? null,

        productExternalId: original?.product.externalId ?? row.productId,
        productName: original?.product.name || row.productName,
        productType: (original?.productType as NormalizedOrder['productType']) ?? 'FRONTEND',

        affiliateExternalId:
          original?.affiliate?.externalId
          ?? (row.affiliate ? affiliateIdByNickname.get(row.affiliate) ?? null : null),
        affiliateNickname: original?.affiliate?.nickname ?? row.affiliate,

        customerExternalId: original?.customer?.externalId ?? row.buyerId,
        customerEmail: original?.customer?.email ?? row.email,
        customerFirstName: original?.customer?.firstName ?? row.firstName,
        customerLastName: original?.customer?.lastName ?? row.lastName,
        customerLanguage: original?.customer?.language ?? null,

        status: 'REFUNDED',
        eventType: 'refund',
        billingType: (original?.billingType as NormalizedOrder['billingType']) ?? 'UNKNOWN',
        paySequenceNo: original?.paySequenceNo ?? null,
        numberOfInstallments: original?.numberOfInstallments ?? null,

        currencyOriginal: original?.currencyOriginal ?? row.currency ?? 'USD',
        grossAmountOrig: row.gross,
        grossAmountUsd: row.gross,
        // "Net amount" do export já é o bruto menos VAT → a diferença é o
        // imposto estornado.
        taxAmount: round2(row.gross - row.net),
        // O export não abre taxa de processamento; deixar 0 é melhor que
        // inventar (a retenção da plataforma é derivada de gross−net−cpa−tax).
        fees: 0,
        netAmountUsd: row.earnings,
        cpaPaidUsd: 0,

        paymentMethod: original?.paymentMethod ?? null,
        // País do export vem por extenso ("United States") e a Order guarda
        // ISO-2 do IPN — sem a venda original, melhor null que sujar o filtro.
        country: original?.country ?? null,
        state: original?.state ?? null,
        city: original?.city ?? null,

        funnelSessionId: row.orderId,
        funnelStep: original?.funnelStep ?? null,
        clickId: original?.clickId ?? null,
        trackingId: original?.trackingId ?? null,
        campaignKey: original?.campaignKey ?? null,
        trafficSource: original?.trafficSource ?? null,
        deviceType: null,
        browser: null,
        detailsUrl: null,

        // orderedAt = VENDA (eixo de coorte do modelo CPA). Sem a venda
        // original no banco, o estorno é o único instante que temos.
        orderedAt: original?.orderedAt ?? eventAt,
        eventAt,
        // NÃO usar as chaves transaction_date/transaction_time aqui: o
        // backfill de datas lê essas duas como wall clock Europe/Berlin (é
        // o que o IPN manda) e o export vem em Eastern — reinterpretar
        // deslocaria o estorno em horas. Ficam com prefixo csv_, mais o
        // instante já resolvido em UTC.
        rawMetadata: {
          _source: 'csv-reconcile',
          _reconciledFromExport: true,
          transaction_id: row.transactionId,
          order_id: row.orderId,
          csv_date: row.date,
          csv_time: row.time,
          csv_timezone: CSV_TIMEZONE,
          event_at_utc: eventAt.toISOString(),
          transaction_type: 'refund',
          created_by: row.createdBy,
          product_id: row.productId,
          product_name: row.productName,
          affiliate_name: row.affiliate,
          amount_brutto: row.gross,
          amount_netto: row.net,
          amount_vendor: row.earnings,
          currency: row.currency,
          matched_original_sale: Boolean(original),
        },
      };

      await upsertOrder(normalized);
      stats.created++;
    } catch (err) {
      stats.failed++;
      if (stats.errors.length < 20) {
        stats.errors.push({
          transactionId: row.transactionId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return stats;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
