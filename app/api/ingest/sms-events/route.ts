// POST /api/ingest/sms-events — telemetria da stack de SMS
// (Mautic → n8n gateway → Twilio, 4 subcontas / 1 número cada).
//
// Fluxo: o n8n envia cada evento por HTTP POST JSON com o header
// `x-ingest-secret` (mesmo shared secret dos demais ingests). O campo
// `event_type` discrimina 5 formatos: sms_sent, sms_skipped, sms_status,
// sms_stop e campaign_catalog (snapshot horário do Mautic).
//
// Contrato de resposta DIFERENTE dos outros ingests, por decisão do
// briefing: payload desconhecido/inválido e falha de processamento
// respondem 200 (logado no IngestLog) — o emissor tem retry e erro só
// gera reenvio desnecessário. Únicas exceções: secret errado (401) e
// falha ao gravar o próprio IngestLog (500 — aí o retry salva o evento).
//
// Idempotência: sms_sent e sms_status fazem UPSERT por (eventType,
// messageSid) — reenvio não duplica métrica; um status final novo pro
// mesmo sid sobrescreve o anterior. skipped/stop não têm chave natural
// (duplicata rara aceitável). campaign_catalog upserta por mautic_id e
// arquiva campanhas ausentes do snapshot.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { parseSmsPayload, type SmsEventRow } from '@/lib/connectors/sms/ingest';
import { subaccountByNumber } from '@/lib/connectors/sms/config';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// sms_stop chega sem brand/campaign (o Twilio só manda from/to). Enriquece:
//   1. brand/subconta pelo NOSSO número (`to`) via config;
//   2. fallback: último sms_status disparado por esse mesmo número;
//   3. campanha: último sms_sent pra esse lead (`from`) — atribuição
//      "última campanha que enviou pra este número" do briefing.
// Best-effort: se nada casar, o STOP fica sem atribuição (conta no global).
async function enrichStopRow(row: SmsEventRow): Promise<void> {
  const sub = subaccountByNumber(row.toNumber);
  if (sub) {
    row.subIndex = sub.subIndex;
    row.brand = sub.brand ?? row.brand;
  }
  if (row.brand == null && row.subIndex == null && row.toNumber) {
    const last = await db.smsEvent.findFirst({
      where: { eventType: 'sms_status', fromNumber: row.toNumber, NOT: { brand: null } },
      orderBy: { occurredAt: 'desc' },
      select: { brand: true, subIndex: true },
    });
    if (last) {
      row.brand = last.brand;
      row.subIndex = last.subIndex;
    }
  }
  if (row.campaign == null && row.fromNumber) {
    const lastSent = await db.smsEvent.findFirst({
      where: { eventType: 'sms_sent', toNumber: row.fromNumber },
      orderBy: { occurredAt: 'desc' },
      select: { campaign: true },
    });
    if (lastSent?.campaign) row.campaign = lastSent.campaign;
  }
}

// sms_skipped não traz brand — só reason/campaign. Enriquece a marca pelo
// evento mais recente da mesma campanha que tenha brand (sent/status), pra
// o filtro por marca da tela não esconder skips de campanha que ainda não
// enviou nada na janela (ex.: lote inteiro caiu em quiet hours). Usa o
// índice (campaign, occurredAt). Best-effort: sem match, fica sem marca.
async function enrichSkippedRow(row: SmsEventRow): Promise<void> {
  if (row.brand != null || row.campaign == null) return;
  const last = await db.smsEvent.findFirst({
    where: { campaign: row.campaign, NOT: { brand: null } },
    orderBy: { occurredAt: 'desc' },
    select: { brand: true, subIndex: true },
  });
  if (last) {
    row.brand = last.brand;
    row.subIndex = last.subIndex;
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const secret = req.headers.get('x-ingest-secret') ?? url.searchParams.get('secret');
  if (!checkIngestSecret(secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let data: Record<string, unknown> | null = null;
  let rawText = '';
  try {
    rawText = await req.text();
    const parsed: unknown = rawText.trim() ? JSON.parse(rawText) : null;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = null;
  }

  if (data === null) {
    // Body não-JSON/não-objeto: registra o cru e responde 200 (ver header).
    await db.ingestLog.create({
      data: {
        source: 'n8n-sms',
        platformSlug: 'sms',
        eventType: 'invalid',
        externalId: null,
        payload: { invalidBody: rawText.slice(0, 2000) },
        signatureOk: null,
        processedOk: false,
        error: 'unparseable body',
      },
      select: { id: true },
    });
    logger.warn({ platform: 'sms' }, 'sms ingest: unparseable body');
    return NextResponse.json({ ok: false, error: 'invalid body' });
  }

  const eventType = typeof data.event_type === 'string' ? data.event_type : 'unknown';
  const log = await db.ingestLog.create({
    data: {
      source: 'n8n-sms',
      platformSlug: 'sms',
      eventType,
      externalId: typeof data.message_sid === 'string' ? data.message_sid : null,
      payload: data as unknown as object,
      signatureOk: null,
    },
    select: { id: true },
  });

  try {
    const parsed = parseSmsPayload(data);

    if (parsed.kind === 'unknown') {
      // event_type novo: não é erro (o gateway evolui) — fica no IngestLog
      // pra inspeção e responde 200 pro n8n não re-enviar.
      await db.ingestLog.update({
        where: { id: log.id },
        data: { processedOk: false, error: `unknown event_type: ${parsed.eventType}`.slice(0, 500) },
      });
      logger.warn({ platform: 'sms', eventType: parsed.eventType }, 'sms ingest: unknown event_type');
      return NextResponse.json({ ok: true, event: parsed.eventType, ignored: true });
    }

    if (parsed.kind === 'catalog') {
      for (const c of parsed.campaigns) {
        await db.smsCampaign.upsert({
          where: { mauticId: c.mauticId },
          create: {
            mauticId: c.mauticId,
            name: c.name,
            slug: c.slug,
            isPublished: c.isPublished,
            category: c.category,
            mauticCreatedAt: c.mauticCreatedAt,
            mauticModifiedAt: c.mauticModifiedAt,
            archived: false,
            lastSyncedAt: parsed.syncedAt,
            raw: c.raw as unknown as object,
          },
          update: {
            name: c.name,
            slug: c.slug,
            isPublished: c.isPublished,
            category: c.category,
            mauticCreatedAt: c.mauticCreatedAt,
            mauticModifiedAt: c.mauticModifiedAt,
            archived: false,
            lastSyncedAt: parsed.syncedAt,
            raw: c.raw as unknown as object,
          },
        });
      }
      // Ausente do snapshot = pausada/deletada no Mautic → archived. Guard
      // contra snapshot vazio (bug no emissor não pode arquivar tudo).
      if (parsed.campaigns.length > 0) {
        await db.smsCampaign.updateMany({
          where: { mauticId: { notIn: parsed.campaigns.map((c) => c.mauticId) } },
          data: { archived: true },
        });
      }
      await db.ingestLog.update({
        where: { id: log.id },
        data: { processedOk: true, processedAt: new Date() },
      });
      logger.info({ platform: 'sms', campaigns: parsed.campaigns.length }, 'sms campaign catalog synced');
      return NextResponse.json({ ok: true, event: eventType, campaigns: parsed.campaigns.length });
    }

    const row = parsed.row;
    if (row.eventType === 'sms_stop') await enrichStopRow(row);
    if (row.eventType === 'sms_skipped') await enrichSkippedRow(row);

    const fields = {
      campaign: row.campaign,
      brand: row.brand,
      subIndex: row.subIndex,
      status: row.status,
      errorCode: row.errorCode,
      reason: row.reason,
      fromNumber: row.fromNumber,
      toNumber: row.toNumber,
      occurredAt: row.occurredAt,
      raw: data as unknown as object,
    };
    if (row.messageSid && (row.eventType === 'sms_sent' || row.eventType === 'sms_status')) {
      await db.smsEvent.upsert({
        where: { eventType_messageSid: { eventType: row.eventType, messageSid: row.messageSid } },
        create: { eventType: row.eventType, messageSid: row.messageSid, ...fields },
        update: fields,
      });
    } else {
      await db.smsEvent.create({
        data: { eventType: row.eventType, messageSid: row.messageSid, ...fields },
      });
    }

    await db.ingestLog.update({
      where: { id: log.id },
      data: { processedOk: true, processedAt: new Date() },
    });
    logger.info(
      { platform: 'sms', eventType: row.eventType, campaign: row.campaign, brand: row.brand, status: row.status, errorCode: row.errorCode },
      'sms event ingested',
    );
    return NextResponse.json({ ok: true, event: row.eventType });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.ingestLog
      .update({ where: { id: log.id }, data: { processedOk: false, error: message.slice(0, 500) } })
      .catch(() => {});
    logger.error({ err, logId: log.id }, 'sms ingest failed');
    // 200 de propósito (ver header): o payload cru já está no IngestLog
    // pra replay manual; retry automático do n8n não resolve.
    return NextResponse.json({ ok: false, error: 'processing failed' });
  }
}
