// POST /api/ingest/tauk — vendas recuperadas pela Tauk Solutions.
//
// Fluxo: Tauk → webhook n8n (GET com dados nos QUERY PARAMS, body vazio) →
// n8n encaminha o objeto `query` como JSON pra cá com o header
// `x-ingest-secret` (mesmo shared secret dos demais ingests).
//
// Aceita JSON ({"Fulfillment Status": "HOLD", ...}), form-urlencoded, ou —
// tolerância extra — os campos direto na querystring desta própria URL.
// Grava IngestLog (platformSlug 'tauk') e faz UPSERT em TaukSale por
// externalKey (email|purchase-date) — reenvio não duplica.
//
// De propósito NÃO cria Order: payload sem produto/ID de transação, e a
// venda pode também transitar pela plataforma principal (dupla contagem).
// A aba "Tauk" lê TaukSale direto.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseTaukPayload } from '@/lib/connectors/tauk/ingest';
import { logger, maskEmail } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = req.headers.get('x-ingest-secret') ?? url.searchParams.get('secret');
  if (!checkIngestSecret(secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Body: JSON | form-urlencoded | vazio (campos na querystring).
  let data: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw.trim()) {
      const ct = (req.headers.get('content-type') ?? '').toLowerCase();
      data = ct.includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(raw))
        : (JSON.parse(raw) as Record<string, unknown>);
    }
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (Object.keys(data).length === 0) {
    data = Object.fromEntries(url.searchParams);
    delete data.secret;
  }

  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-tauk',
      platformSlug: 'tauk',
      eventType: 'recovery_sale',
      externalId: null,
      payload: data as unknown as object,
      signatureOk: null,
    },
    select: { id: true },
  });

  try {
    const sale = parseTaukPayload(data);
    await db.taukSale.upsert({
      where: { externalKey: sale.externalKey },
      create: {
        externalKey: sale.externalKey,
        email: sale.email,
        firstName: sale.firstName,
        lastName: sale.lastName,
        phone: sale.phone,
        address: sale.address,
        amountUsd: sale.amountUsd,
        fulfillmentStatus: sale.fulfillmentStatus,
        purchasedAt: sale.purchasedAt,
        raw: data as unknown as object,
      },
      update: {
        email: sale.email,
        firstName: sale.firstName,
        lastName: sale.lastName,
        phone: sale.phone,
        address: sale.address,
        amountUsd: sale.amountUsd,
        fulfillmentStatus: sale.fulfillmentStatus,
        purchasedAt: sale.purchasedAt,
        raw: data as unknown as object,
      },
    });

    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date(), externalId: sale.externalKey },
    });

    logger.info(
      { platform: 'tauk', email: maskEmail(sale.email ?? ''), amountUsd: sale.amountUsd, status: sale.fulfillmentStatus },
      'tauk sale ingested',
    );
    return NextResponse.json({ ok: true, key: sale.externalKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: false, error: message.slice(0, 500) },
    });
    logger.error({ err }, 'tauk ingest failed');
    return NextResponse.json({ error: 'ingest failed', message }, { status: 400 });
  }
}
