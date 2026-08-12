// Reconciliação de sessão JVZoo.
//
// O webhook não diz o papel do pedido (prekey é sempre auto-referente,
// validado 2026-08-03), então quem decide é, nesta ordem:
//
//   1. O NOME do produto, quando o classificador reconhece o SKU. Os nomes
//      da JVZoo anotam o papel: "(Upgrade)" → UPSELL, "(Last Chance)" →
//      DOWNSELL, sem marcador → FRONTEND. Vale pra 24 dos 28 SKUs.
//   2. A POSIÇÃO dentro da sessão, só pros SKUs que o classificador não sabe
//      ler: a compra mais antiga é FRONTEND, as demais UPSELL.
//
// Até 2026-08-12 só existia a regra 2, e ela é cega pra DOWNSELL — daí 0
// downsells em 3.156 pedidos, com ~60 "(Last Chance)" contados como upsell.
// Pior: quando a sessão RACHAVA (ver jvzooSessionAnchor), o upsell virava a
// "compra mais antiga" da própria sessão e saía FRONTEND — ~55 casos.
// Com o nome mandando, um upsell órfão continua UPSELL mesmo sozinho.
//
// Esta função ainda é necessária depois do upsertOrder porque:
//   - amarra parentExternalId de todos os membros na FE da sessão;
//   - preenche funnelStep pelos SKUs que o classificador não tipa;
//   - conserta o clobber do update (RFND/CGBK reprocessam o pedido).
//
// Idempotente e à prova de IPN fora de ordem. Sessões que não começam com
// "jvz:" (rebill ancorado em si, pedidos sem email/data) não têm o que
// reconciliar — single-member por definição.

import type { ProductType } from '@prisma/client';
import { db } from '../db';
import { classifyProduct } from './productClassification';

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
    select: {
      id: true,
      externalId: true,
      productType: true,
      funnelStep: true,
      parentExternalId: true,
      product: { select: { externalId: true, name: true } },
    },
  });
  if (rows.length === 0) return 0;

  // Papel/etapa pelo nome. family === null = classificador sem opinião
  // confiável (SKU fora de qualquer padrão) → cai na posição.
  const typed = rows.map((r) => {
    const c = classifyProduct(r.product.externalId, r.product.name, 'jvzoo');
    return {
      row: r,
      role: c.family ? c.type : null,
      step: c.family ? c.funnelStep : null,
    };
  });

  // FE da sessão = a primeira (mais antiga) que o NOME diz ser frontend.
  // Sessão só de backend (a FE caiu fora da janela, ou nunca chegou): a mais
  // antiga vira a âncora, sem virar FRONTEND por isso.
  const fe = typed.find((t) => t.role === 'FRONTEND') ?? typed[0];

  let updated = 0;
  for (let i = 0; i < typed.length; i++) {
    const t = typed[i];
    const isAnchor = t.row.id === fe.row.id;
    const wantType: ProductType = t.role ?? (isAnchor ? 'FRONTEND' : 'UPSELL');
    // Etapa: a do nome quando existe; senão a posição (FE=1, 2ª compra=2…).
    const wantStep = t.step ?? (isAnchor ? 1 : i + 1);

    if (
      t.row.productType !== wantType
      || t.row.parentExternalId !== fe.row.externalId
      || t.row.funnelStep !== wantStep
    ) {
      await db.order.update({
        where: { id: t.row.id },
        data: {
          productType: wantType,
          parentExternalId: fe.row.externalId,
          funnelStep: wantStep,
        },
      });
      updated++;
    }
  }
  return updated;
}
