// Backfill pós-deploy do fix de sessão BuyGoods. Roda DEPOIS da migration
// 20260531120000 (que já corrigiu funnelSessionId=sessid2). Faz:
//   1) Order.productType via classificador (corrige "Last Chance" → DOWNSELL,
//      que o IPN marcava como UPSELL).
//   2) REFRESH da daily_metrics (productType é dimensão da MV).
//   3) Rebalance de fulfillment por sessão (agora BG agrupa por sessid2 →
//      frete deixa de ser contado por-transação).
//
//   npm run backfill:bg-sessions

import { db } from '../lib/db';
import { classifyProduct } from '../lib/services/productClassification';
import { backfillSessionFulfillment } from '../lib/services/sessionFulfillment';

async function main() {
  const platform = await db.platform.findUnique({
    where: { slug: 'buygoods' },
    select: { id: true },
  });
  if (!platform) {
    console.log('[backfill-bg] sem plataforma buygoods — nada a fazer.');
    return;
  }

  // 1) Order.productType pelo classificador (fonte de verdade = NOME).
  const products = await db.product.findMany({
    where: { platformId: platform.id },
    select: { id: true, externalId: true, name: true },
  });
  let updated = 0;
  for (const p of products) {
    const c = classifyProduct(p.externalId, p.name ?? p.externalId);
    if (c.family == null) continue; // sem família confiante → não mexe
    const res = await db.order.updateMany({
      where: { platformId: platform.id, productId: p.id, productType: { not: c.type } },
      data: { productType: c.type },
    });
    if (res.count > 0) {
      console.log(`[backfill-bg] ${p.externalId} → ${c.type}: ${res.count} orders`);
      updated += res.count;
    }
  }
  console.log(`[backfill-bg] Order.productType atualizados: ${updated}`);

  // 2) Refresh da MV (productType mudou).
  try {
    await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY daily_metrics');
  } catch {
    await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW daily_metrics');
  }
  console.log('[backfill-bg] daily_metrics refreshed');

  // 3) Fulfillment por sessão (BG agora por funnelSessionId=sessid2).
  const fr = await backfillSessionFulfillment();
  console.log(`[backfill-bg] fulfillment: ${fr.sessionsScanned} sessões, ${fr.ordersTouched} orders`);
}

main()
  .catch((err) => {
    console.error('[backfill-bg] falhou:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
