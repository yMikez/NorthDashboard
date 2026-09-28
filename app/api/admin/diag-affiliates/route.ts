// Diagnóstico READ-ONLY de ATRIBUIÇÃO por afiliado (bearer INGEST_SECRET).
//
//   GET /api/admin/diag-affiliates?platform=buygoods&days=14[&family=Neuro][&external_id=290]
//   GET /api/admin/diag-affiliates?platform=buygoods&days=14&by=subid
//
// by=subid agrupa pelos rastreios em vez da conta (clickId = subid,
// campaignKey = subid2, trafficSource). Serve pra quando o parceiro não tem
// conta própria na plataforma e é identificado por sub-id dentro da conta
// de outro — a venda existe, só não está pendurada no afiliado dele.
//
// Responde "por que a venda não caiu no afiliado X": mostra, por conta de
// afiliado, quantos pedidos e quanto faturou no período, com a quebra por
// família — mais o balde "sem afiliado", que é onde a venda cai quando o
// postback chega sem o id (a suspeita mais comum).
//
// NÃO devolve nenhum dado de cliente (e-mail, nome, país): é contagem e
// soma. É o que separa este endpoint do orders-dump.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const platform = (searchParams.get('platform') || 'buygoods').trim();
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '14', 10) || 14, 1), 180);
  const family = searchParams.get('family');
  const externalId = searchParams.get('external_id');
  const bySubid = searchParams.get('by') === 'subid';
  const since = new Date(Date.now() - days * 86_400_000);

  const conds: Prisma.Sql[] = [
    Prisma.sql`pl."slug" = ${platform}`,
    Prisma.sql`o."orderedAt" >= ${since}`,
  ];
  if (family) conds.push(Prisma.sql`pr."family" ILIKE ${`%${family}%`}`);
  if (externalId) conds.push(Prisma.sql`a."externalId" = ${externalId}`);
  const where = Prisma.join(conds, ' AND ');

  if (bySubid) {
    const subs = await db.$queryRaw<Array<{
      click_id: string | null; campaign_key: string | null; traffic_source: string | null;
      nickname: string | null; external_id: string | null; orders: number; gross: number; last_at: Date;
    }>>(Prisma.sql`
      SELECT
        o."clickId" AS click_id, o."campaignKey" AS campaign_key, o."trafficSource" AS traffic_source,
        a."nickname" AS nickname, a."externalId" AS external_id,
        COUNT(*)::int AS orders,
        COALESCE(SUM(o."grossAmountUsd"), 0)::float8 AS gross,
        MAX(o."orderedAt") AS last_at
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId"
      JOIN "Product" pr  ON pr.id = o."productId"
      LEFT JOIN "Affiliate" a ON a.id = o."affiliateId"
      WHERE ${where}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 7 DESC
      LIMIT 200
    `);
    return NextResponse.json({
      platform, days, family: family ?? null, modo: 'subid', desde: since.toISOString(),
      rastreios: subs.map((r) => ({
        subid: r.click_id, subid2: r.campaign_key, trafficSource: r.traffic_source,
        conta: r.external_id, contaNome: r.nickname,
        pedidos: r.orders, usd: Math.round(r.gross * 100) / 100, ultima: r.last_at.toISOString(),
      })),
    });
  }

  const rows = await db.$queryRaw<Array<{
    external_id: string | null; nickname: string | null; affiliate_id: string | null;
    family: string | null; status: string; orders: number; gross: number; first_at: Date; last_at: Date;
  }>>(Prisma.sql`
    SELECT
      a."externalId"   AS external_id,
      a."nickname"     AS nickname,
      a."id"           AS affiliate_id,
      pr."family"      AS family,
      o."status"       AS status,
      COUNT(*)::int    AS orders,
      COALESCE(SUM(o."grossAmountUsd"), 0)::float8 AS gross,
      MIN(o."orderedAt") AS first_at,
      MAX(o."orderedAt") AS last_at
    FROM "Order" o
    JOIN "Platform" pl ON pl.id = o."platformId"
    JOIN "Product" pr  ON pr.id = o."productId"
    LEFT JOIN "Affiliate" a ON a.id = o."affiliateId"
    WHERE ${where}
    GROUP BY 1, 2, 3, 4, 5
    ORDER BY 7 DESC
  `);

  const recovery = new Set(
    (await db.recoveryAffiliate.findMany({ where: { enabled: true }, select: { affiliateId: true } }))
      .map((r) => r.affiliateId),
  );

  // Agrega por conta, guardando a quebra por família e status.
  const byAff = new Map<string, {
    externalId: string | null; nickname: string | null; isRecovery: boolean;
    orders: number; grossUsd: number; firstAt: string; lastAt: string;
    porFamilia: Record<string, { pedidos: number; usd: number }>;
    porStatus: Record<string, number>;
  }>();
  for (const r of rows) {
    const key = r.affiliate_id ?? '(sem afiliado)';
    let agg = byAff.get(key);
    if (!agg) {
      agg = {
        externalId: r.external_id, nickname: r.nickname,
        isRecovery: r.affiliate_id ? recovery.has(r.affiliate_id) : false,
        orders: 0, grossUsd: 0, firstAt: r.first_at.toISOString(), lastAt: r.last_at.toISOString(),
        porFamilia: {}, porStatus: {},
      };
      byAff.set(key, agg);
    }
    agg.orders += r.orders;
    agg.grossUsd = Math.round((agg.grossUsd + r.gross) * 100) / 100;
    agg.porStatus[r.status] = (agg.porStatus[r.status] ?? 0) + r.orders;
    const fam = r.family ?? 'Sem família';
    const f = agg.porFamilia[fam] ?? { pedidos: 0, usd: 0 };
    f.pedidos += r.orders;
    f.usd = Math.round((f.usd + r.gross) * 100) / 100;
    agg.porFamilia[fam] = f;
    if (r.first_at.toISOString() < agg.firstAt) agg.firstAt = r.first_at.toISOString();
    if (r.last_at.toISOString() > agg.lastAt) agg.lastAt = r.last_at.toISOString();
  }

  return NextResponse.json({
    platform, days, family: family ?? null, external_id: externalId ?? null,
    desde: since.toISOString(),
    afiliados: [...byAff.entries()]
      .map(([id, v]) => ({ affiliateId: id, ...v }))
      .sort((a, b) => b.grossUsd - a.grossUsd),
  });
}
