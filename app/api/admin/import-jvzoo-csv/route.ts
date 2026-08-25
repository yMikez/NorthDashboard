// Import de vendas JVZoo a partir do export do painel (JVZooTransactions_*.csv)
// pra cobrir produtos que ainda não tinham IPN cadastrado.
//
//   POST /api/admin/import-jvzoo-csv   { rows: CsvRow[], dryRun?: boolean, batchTag?: string }
//   Auth: bearer INGEST_SECRET OU sessão ADMIN.
//
// Cada linha vira um payload no MESMO formato do IPN e passa pelo MESMO
// caminho (IngestLog → parseJvzooIngest → upsertOrder → reconcileJvzooSession):
// classificação de produto/papel, sessão (e-mail + dia), afiliado, cliente e
// COGS saem idênticos a uma venda que tivesse chegado pelo webhook. Linhas
// "Refunded"/"Disputed" recebem um 2º evento (RFND/CGBK) com a data do estorno.
// Linhas cujo transaction_id já existe são ignoradas (idempotente).
//
// Afiliado: o export só traz o NOME. Resolve pelo nick já conhecido na
// JVZoo; sem match, cria com externalId sintético `name:<slug>` (listado na
// resposta) — quando o IPN real chegar com o ID numérico, unifique os dois
// em Identidades.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { db } from '@/lib/db';
import { parseJvzooIngest, parseJvzooTimestamp } from '@/lib/connectors/jvzoo/ingest';
import type { JvzooPayload } from '@/lib/connectors/jvzoo/types';
import type { NormalizedOrder } from '@/lib/shared/types';
import { upsertOrder } from '@/lib/services/upsertOrder';
import { reconcileJvzooSession } from '@/lib/services/jvzooSessions';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface CsvRow {
  'Product Id'?: string; 'Product Name'?: string; SKU?: string; 'Affiliate Name'?: string;
  'Pay Key'?: string; 'Pre Key'?: string; Total?: string; Created?: string; Status?: string;
  'Customer Email'?: string; 'Customer First Name'?: string; 'Customer Last Name'?: string;
  'Customer Country'?: string; 'Tax Amount'?: string; 'Refunded Date'?: string; 'Refund Notes'?: string;
  Fees?: string; 'Affiliate Payout'?: string; Vtid?: string; tid?: string;
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string;
  'Phone Number'?: string; IP?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function transactionIdOf(row: CsvRow): string {
  const pre = str(row['Pre Key']);
  if (pre.includes('-')) return pre.split('-', 2)[1];
  return pre;
}

export async function POST(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!(bearer && checkIngestSecret(bearer))) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  let body: { rows?: unknown; dryRun?: unknown; batchTag?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const rows = Array.isArray(body.rows) ? (body.rows as CsvRow[]) : [];
  const dryRun = body.dryRun === true;
  const batchTag = str(body.batchTag) || `csv-import-${new Date().toISOString().slice(0, 10)}`;
  if (!rows.length) return NextResponse.json({ error: 'rows vazio' }, { status: 400 });
  if (rows.length > 500) return NextResponse.json({ error: 'máx 500 linhas por chamada' }, { status: 400 });

  const platform = await db.platform.findUnique({ where: { slug: 'jvzoo' }, select: { id: true } });
  if (!platform) return NextResponse.json({ error: 'plataforma jvzoo não existe' }, { status: 409 });

  const stats = {
    received: rows.length, existing: 0, imported: 0, refunds: 0, chargebacks: 0, skippedTest: 0, invalid: 0,
    errors: [] as Array<{ key: string; message: string }>,
    syntheticAffiliates: {} as Record<string, string>,
    preview: [] as Array<Record<string, unknown>>,
  };

  // Cache nome → externalId do afiliado (JVZoo).
  const affCache = new Map<string, string | null>();
  async function resolveAffiliate(name: string): Promise<string | null> {
    if (!name || /^no affiliate$/i.test(name)) return null;
    if (affCache.has(name)) return affCache.get(name)!;
    const found = await db.affiliate.findFirst({
      where: { platformId: platform!.id, nickname: { equals: name, mode: 'insensitive' } },
      orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } },
      select: { externalId: true },
    });
    let id: string;
    if (found) {
      id = found.externalId;
    } else {
      id = `name:${slug(name)}`;
      stats.syntheticAffiliates[name] = id;
    }
    affCache.set(name, id);
    return id;
  }

  for (const row of rows) {
    const transactionId = transactionIdOf(row);
    const key = transactionId || str(row['Pay Key']) || '?';
    try {
      if (!transactionId || !str(row['Product Id']) || !str(row.Created)) { stats.invalid++; continue; }
      const exists = await db.order.findUnique({
        where: { platformId_externalId: { platformId: platform.id, externalId: transactionId } },
        select: { id: true },
      });
      if (exists) { stats.existing++; continue; }

      const affiliateName = str(row['Affiliate Name']);
      const affiliateId = await resolveAffiliate(affiliateName);
      const total = Number.parseFloat(str(row.Total) || '0') || 0;
      const payout = Number.parseFloat(str(row['Affiliate Payout']) || '0') || 0;
      const fees = Number.parseFloat(str(row.Fees) || '0') || 0;
      const status = str(row.Status);
      const payouts = [
        ...(payout > 0 ? [{ payee_amount: payout.toFixed(2), payee_user_id: affiliateId ?? '', payee_name: affiliateName, payout_type: 'AFFILIATES', payment_processor: 'csv', payout_status: 'Paid' }] : []),
        ...(fees > 0 ? [{ payee_amount: fees.toFixed(2), payee_user_id: '3', payee_name: 'JVZoo', payout_type: 'JVZOO DOT COM', payment_processor: 'csv', payout_status: 'Paid' }] : []),
      ];
      const other = new URLSearchParams();
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'tid'] as const) {
        const v = str(row[k]);
        if (v) other.set(k, v);
      }
      if (str(row.Vtid)) other.set('vtid', str(row.Vtid));
      // Sem hora no export: meio-dia Eastern (mesmo dia BRT; sessão = e-mail + dia).
      const payload: JvzooPayload = {
        transaction_id: transactionId,
        transaction_type: 'SALE',
        product_id: str(row['Product Id']),
        product_name: str(row['Product Name']),
        sku: str(row.SKU),
        affiliate_id: affiliateId ?? '',
        affiliate_name: affiliateName && !/^no affiliate$/i.test(affiliateName) ? affiliateName : '',
        customer_email: str(row['Customer Email']).toLowerCase(),
        customer_first_name: str(row['Customer First Name']),
        customer_last_name: str(row['Customer Last Name']),
        delivery_country: str(row['Customer Country']),
        total: total.toFixed(2),
        tax_total: str(row['Tax Amount']) || '0.00',
        date: `${str(row.Created)} 12:00:00`,
        prekey: str(row['Pre Key']),
        receipt: str(row['Pay Key']),
        vendor_name: 'NorthScale LTDA',
        transactionPayouts: JSON.stringify(payouts),
        other_params: other.toString(),
        tid: str(row.tid),
        _import: batchTag,
        _import_status: status,
        _import_refunded_date: str(row['Refunded Date']),
        _import_refund_notes: str(row['Refund Notes']).slice(0, 500),
      };

      const normalized = parseJvzooIngest(payload);
      const absGross = Math.abs(normalized.grossAmountUsd);
      if (absGross > 0 && absGross < 2) { stats.skippedTest++; continue; }

      const reversal: 'REFUNDED' | 'CHARGEBACK' | null = status === 'Refunded' ? 'REFUNDED' : status === 'Disputed' ? 'CHARGEBACK' : null;
      const refundedDate = str(row['Refunded Date']);
      const eventAt = reversal ? (refundedDate ? parseJvzooTimestamp(`${refundedDate} 12:00:00`) : normalized.orderedAt) : null;

      if (dryRun) {
        if (stats.preview.length < 20) {
          stats.preview.push({
            transactionId, status: reversal ?? 'APPROVED', gross: normalized.grossAmountUsd, cpa: normalized.cpaPaidUsd, fees: normalized.fees,
            net: normalized.netAmountUsd, orderedAt: normalized.orderedAt.toISOString(), eventAt: eventAt?.toISOString() ?? null,
            product: `${normalized.productExternalId} ${normalized.productName}`, affiliate: normalized.affiliateExternalId,
            session: normalized.funnelSessionId, country: normalized.country,
          });
        }
        stats.imported++;
        if (reversal === 'REFUNDED') stats.refunds++;
        if (reversal === 'CHARGEBACK') stats.chargebacks++;
        continue;
      }

      await db.ingestLog.create({
        data: { source: batchTag, platformSlug: 'jvzoo', eventType: 'sale', externalId: transactionId, payload: payload as unknown as object, signatureOk: null, processedOk: true, processedAt: new Date() },
      });
      await upsertOrder(normalized);
      await reconcileJvzooSession(normalized.funnelSessionId);
      stats.imported++;

      if (reversal) {
        const ev: NormalizedOrder = { ...normalized, status: reversal, eventType: reversal === 'REFUNDED' ? 'rfnd' : 'cgbk', eventAt };
        await db.ingestLog.create({
          data: { source: batchTag, platformSlug: 'jvzoo', eventType: ev.eventType, externalId: transactionId, payload: { ...payload, transaction_type: reversal === 'REFUNDED' ? 'RFND' : 'CGBK' } as unknown as object, signatureOk: null, processedOk: true, processedAt: new Date() },
        });
        await upsertOrder(ev);
        if (reversal === 'REFUNDED') stats.refunds++; else stats.chargebacks++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.errors.push({ key, message });
      logger.warn({ err, key }, '[import-jvzoo-csv] linha falhou');
    }
  }
  if (!dryRun) clearResponseCache();
  return NextResponse.json({ ok: true, dryRun, batchTag, ...stats });
}
