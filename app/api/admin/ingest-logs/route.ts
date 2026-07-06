// Admin (bearer INGEST_SECRET): inspeção read-only dos IngestLogs.
// Criado pra verificar recuperação de ingest (ex: credencial do n8n apagada
// → validar que os eventos voltaram a chegar e quantificar o buraco) sem
// precisar de acesso ao banco ou à UI do n8n.
//
//   GET /api/admin/ingest-logs?platform=buygoods&limit=20
//     → últimos N logs (sem payload — leve), mais novos primeiro
//   GET /api/admin/ingest-logs?platform=buygoods&summary=1&days=14
//     → contagem por dia × plataforma (pra enxergar o buraco no timeline)
//   GET /api/admin/ingest-logs?id=<logId>
//     → um log específico COM payload completo

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const platform = searchParams.get('platform')?.trim().toLowerCase() || undefined;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1), 200);

  if (id) {
    const log = await db.ingestLog.findUnique({ where: { id } });
    if (!log) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ log });
  }

  if (searchParams.get('summary') === '1') {
    const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '14', 10) || 14, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await db.ingestLog.findMany({
      where: { receivedAt: { gte: since }, ...(platform ? { platformSlug: platform } : {}) },
      select: { platformSlug: true, receivedAt: true, processedOk: true },
      orderBy: { receivedAt: 'asc' },
    });
    // dia (UTC) → plataforma → { total, ok }
    const byDay: Record<string, Record<string, { total: number; ok: number }>> = {};
    for (const r of rows) {
      const day = r.receivedAt.toISOString().slice(0, 10);
      const cell = ((byDay[day] ??= {})[r.platformSlug] ??= { total: 0, ok: 0 });
      cell.total++;
      if (r.processedOk) cell.ok++;
    }
    return NextResponse.json({ since: since.toISOString(), days, byDay });
  }

  const logs = await db.ingestLog.findMany({
    where: platform ? { platformSlug: platform } : undefined,
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      source: true,
      platformSlug: true,
      eventType: true,
      externalId: true,
      signatureOk: true,
      processedOk: true,
      error: true,
      receivedAt: true,
      processedAt: true,
    },
  });
  return NextResponse.json({ count: logs.length, logs });
}
