// Reconciliação de sessão JVZoo.
//
// O parse (lib/connectors/jvzoo/ingest.ts) agrupa FE+upsells da mesma
// compra numa sessão "jvz:<tid>:<email>:<dia>" mas marca TODO pedido como
// FRONTEND — o payload não diz o papel (prekey é sempre auto-referente,
// validado 2026-08-03). Aqui o papel é decidido pela ORDEM DENTRO DA
// SESSÃO: a compra mais antiga é a FRONTEND, as demais são UPSELL com
// parentExternalId apontando pro receipt da FE.
//
// Idempotente e à prova de IPN fora de ordem: se a FE chegar DEPOIS do
// upsell, a passada dela rebaixa o upsell (forward-fix, mesmo espírito do
// fix de codename BuyGoods). Também conserta o clobber do update: eventos
// RFND/CGBK sobrescrevem productType com o valor do parse (FRONTEND) —
// rodar a reconciliação depois de todo upsert restaura o papel certo.
//
// Sessões que não começam com "jvz:" (rebill ancorado em si, pedidos sem
// email/tracking) não têm o que reconciliar — single-member por definição.

import type { ProductType } from '@prisma/client';
import { db } from '../db';

export async function reconcileJvzooSession(funnelSessionId: string | null): Promise<number> {
  if (!funnelSessionId || !funnelSessionId.startsWith('jvz:')) return 0;

  const platform = await db.platform.findUnique({
    where: { slug: 'jvzoo' },
    select: { id: true },
  });
  if (!platform) return 0;

  const rows = await db.order.findMany({
    where: { platformId: platform.id, funnelSessionId },
    orderBy: [{ orderedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, externalId: true, productType: true, parentExternalId: true },
  });
  if (rows.length === 0) return 0;

  const feExternalId = rows[0].externalId;
  let updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const want: ProductType = i === 0 ? 'FRONTEND' : 'UPSELL';
    if (rows[i].productType !== want || rows[i].parentExternalId !== feExternalId) {
      await db.order.update({
        where: { id: rows[i].id },
        data: { productType: want, parentExternalId: feExternalId },
      });
      updated++;
    }
  }
  return updated;
}
