// Backfill cirúrgico para a colisão NeuroMind Pro ↔ NeuroPulse no BG.
//
// CONTEXTO: o vendor BuyGoods usa o MESMO product_codename pra dois
// produtos distintos (NeuroMind Pro e NeuroPulse). No nosso DB isso
// colapsa num único Product (UNIQUE em platformId+externalId), então
// orders dos dois produtos ficam misturados em uma família só.
//
// SOLUÇÃO: pra cada Order BG cujo Product.family = 'NeuroMindPro', lê
// o IngestLog (rawPayload) pra extrair o nome do produto enviado pelo
// IPN. Roda o classifier sobre esse nome. Se classificar pra uma
// família DIFERENTE de NeuroMindPro (ex: NeuroPulse), cria/encontra um
// Product sintético com externalId = {codename}__{family} e migra o
// Order pra ele. Order.productType/funnelStep também são reconciliados.
//
// POST /api/admin/fix-neuromind-collision
// Body: { dryRun?: boolean }   — dryRun (default true) só relata, não grava.
// Bearer: INGEST_SECRET.

import { NextResponse } from 'next/server';
import type { Prisma, ProductType } from '@prisma/client';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { classifyProduct } from '@/lib/services/productClassification';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IpnPayload {
  product_name?: string;
  product_codename?: string;
  product?: string;
}

interface SplitRow {
  originalCodename: string;
  derivedFamily: string;
  derivedType: ProductType;
  derivedFunnelStep: number | null;
  derivedBottles: number | null;
  ipnName: string;
  orderId: string;
  orderExternalId: string;
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let dryRun = true;
  try {
    const body = await req.json();
    if (body?.dryRun === false) dryRun = false;
  } catch {
    /* sem body → dryRun true */
  }

  try {
    // 1) Pega todos os Orders BG cujo Product.family = 'NeuroMindPro'.
    const orders = await db.order.findMany({
      where: {
        platform: { slug: 'buygoods' },
        product: { family: 'NeuroMindPro' },
      },
      select: {
        id: true,
        externalId: true,
        productId: true,
        productType: true,
        funnelStep: true,
        product: { select: { externalId: true, name: true, family: true } },
      },
    });

    // 2) Pra cada order, busca o IngestLog (último processedOk com mesmo
    //    externalId — o IPN da própria order).
    const splitPlan: SplitRow[] = [];
    const noPayload: string[] = [];

    for (const o of orders) {
      const log = await db.ingestLog.findFirst({
        where: {
          platformSlug: 'buygoods',
          externalId: o.externalId,
        },
        orderBy: { receivedAt: 'desc' },
        select: { payload: true },
      });
      const payload = log?.payload as IpnPayload | null;
      const ipnName =
        payload?.product_name?.toString().trim()
        || payload?.product?.toString().trim()
        || '';
      if (!ipnName) {
        noPayload.push(o.externalId);
        continue;
      }
      const c = classifyProduct(o.product.externalId, ipnName);
      if (!c.family || c.family === 'NeuroMindPro') {
        // Sem divergência → fica como está.
        continue;
      }
      splitPlan.push({
        originalCodename: o.product.externalId,
        derivedFamily: c.family,
        derivedType: c.type,
        derivedFunnelStep: c.funnelStep,
        derivedBottles: c.bottles,
        ipnName,
        orderId: o.id,
        orderExternalId: o.externalId,
      });
    }

    // 3) Agrupa por (codename, derivedFamily) pra resumir.
    const groupsMap = new Map<string, {
      codename: string;
      family: string;
      orderCount: number;
      sampleNames: Set<string>;
      sampleOrderIds: string[];
    }>();
    for (const row of splitPlan) {
      const key = `${row.originalCodename}__${row.derivedFamily}`;
      let g = groupsMap.get(key);
      if (!g) {
        g = {
          codename: row.originalCodename,
          family: row.derivedFamily,
          orderCount: 0,
          sampleNames: new Set(),
          sampleOrderIds: [],
        };
        groupsMap.set(key, g);
      }
      g.orderCount++;
      if (g.sampleNames.size < 3) g.sampleNames.add(row.ipnName);
      if (g.sampleOrderIds.length < 5) g.sampleOrderIds.push(row.orderExternalId);
    }
    const groups = Array.from(groupsMap.values()).map((g) => ({
      codename: g.codename,
      family: g.family,
      orderCount: g.orderCount,
      sampleNames: Array.from(g.sampleNames),
      sampleOrderIds: g.sampleOrderIds,
      syntheticExternalId: `${g.codename}__${g.family}`,
    }));

    if (dryRun || splitPlan.length === 0) {
      return NextResponse.json({
        dryRun: true,
        scanned: orders.length,
        toSplit: splitPlan.length,
        noPayloadCount: noPayload.length,
        noPayloadSample: noPayload.slice(0, 10),
        groups,
      });
    }

    // 4) APLICAR: cria Products sintéticos e migra orders.
    const platform = await db.platform.findUnique({
      where: { slug: 'buygoods' },
      select: { id: true },
    });
    if (!platform) {
      return NextResponse.json({ error: 'platform not found' }, { status: 500 });
    }

    const syntheticProductIds = new Map<string, string>(); // codename__family → productId
    let createdProducts = 0;
    let migratedOrders = 0;
    let funnelStepFixed = 0;
    let productTypeFixed = 0;

    for (const g of groups) {
      // Upsert do Product sintético (idempotente).
      const sample = splitPlan.find(
        (r) => r.originalCodename === g.codename && r.derivedFamily === g.family,
      )!;
      const created = await db.product.upsert({
        where: {
          platformId_externalId: {
            platformId: platform.id,
            externalId: g.syntheticExternalId,
          },
        },
        create: {
          platformId: platform.id,
          externalId: g.syntheticExternalId,
          name: sample.ipnName,
          productType: sample.derivedType,
          family: g.family,
          bottles: sample.derivedBottles,
        },
        update: {
          name: sample.ipnName,
          productType: sample.derivedType,
          family: g.family,
          bottles: sample.derivedBottles ?? undefined,
        },
        select: { id: true },
      });
      syntheticProductIds.set(`${g.codename}__${g.family}`, created.id);
      createdProducts++;
    }

    for (const row of splitPlan) {
      const newProductId = syntheticProductIds.get(`${row.originalCodename}__${row.derivedFamily}`);
      if (!newProductId) continue;
      const updates: Prisma.OrderUpdateInput = { product: { connect: { id: newProductId } } };
      if (row.derivedType) {
        updates.productType = row.derivedType;
        productTypeFixed++;
      }
      if (row.derivedFunnelStep != null) {
        updates.funnelStep = row.derivedFunnelStep;
        funnelStepFixed++;
      }
      await db.order.update({ where: { id: row.orderId }, data: updates });
      migratedOrders++;
    }

    return NextResponse.json({
      dryRun: false,
      scanned: orders.length,
      createdProducts,
      migratedOrders,
      productTypeFixed,
      funnelStepFixed,
      groups,
    });
  } catch (err) {
    logger.error({ err }, 'admin/fix-neuromind-collision failed');
    return NextResponse.json(
      { error: 'failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
