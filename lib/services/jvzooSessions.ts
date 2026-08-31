// Reconciliação de sessão JVZoo — a regra DEFINITIVA do papel (FE/UPSELL/
// DOWNSELL + etapa) de cada pedido, sempre automática, nesta ordem:
//
//   1. MARCADOR NO NOME (classifyProduct.roleMarked): "/ FE", "/ OTO1",
//      "/ DS 1-A", "(Upgrade)", "(Last Chance)", "UP01", "Down 02"... É o
//      que a JVZoo manda no product_name — convenção real do IPN validada
//      2026-08-26 no export: "<Produto> N Bottles / FE|OTO1..3|DS1..3[ - A]".
//   2. MEMÓRIA DO CATÁLOGO: Product.productType só é gravado quando o nome
//      veio marcado; se depois o vendor tirar o marcador ("HoneyPril 12
//      Bottles"), o SKU continua com o papel que já provou ter.
//   3. POSIÇÃO NA SESSÃO (e-mail + dia Eastern): a compra mais antiga é a
//      FE; as demais são backend na ordem em que aconteceram (2ª = etapa 2…).
//      Upsell × downsell sem marcador: MENOS potes que o pedido anterior da
//      MESMA família = DOWNSELL; senão UPSELL.
//   4. MEIA-NOITE EASTERN: sessão sem FE marcada cujo cliente fechou uma FE
//      na sessão do dia anterior até 6h antes → funde com ela (o upsell
//      que passou de 00:00 ET deixa de ser "sessão órfã").
//
// planJvzooRoles() é pura (testada); reconcileJvzooSession() carrega,
// funde e grava. Idempotente e à prova de IPN fora de ordem: roda depois de
// TODO upsert (ingest, import CSV, backfill) — FE atrasada rebaixa o upsell,
// RFND/CGBK que reprocessam o pedido não derrubam o papel.
//
// Histórico: até 2026-08-12 só existia a posição (cega pra DOWNSELL); até
// 2026-08-26 o nome mandava mesmo SEM marcador (default FRONTEND) — 171+
// pedidos "/ OTO1" e todo SKU sem marcador entravam como FE.

import type { ProductType } from '@prisma/client';
import { db } from '../db';
import { classifyProduct, hasNumberedRoleMarker } from './productClassification';
import { rebalanceSessionFulfillment } from './sessionFulfillment';

export interface JvzooSessionRow {
  id: string;
  externalId: string;
  /** Product.externalId — identifica a OFERTA (recompra da mesma oferta reusa a etapa). */
  productId: string;
  orderedAt: Date;
  /** Papel explícito no nome (roleMarked) — null quando o nome não anota.
   *  `numbered`: o marcador traz o slot ("OTO2"); sem número ("(Upgrade)")
   *  o step do classificador é só âncora de família — a posição decide. */
  marked: { type: ProductType; step: number | null; numbered: boolean } | null;
  /** Product.productType — memória do catálogo (FRONTEND = sem opinião). */
  memoryType: ProductType | null;
  family: string | null;
  bottles: number | null;
  current: { productType: ProductType; funnelStep: number | null; parentExternalId: string | null };
}

export interface JvzooRolePlan {
  id: string;
  productType: ProductType;
  funnelStep: number;
  parentExternalId: string;
}

const isBackendType = (t: ProductType | null | undefined): boolean =>
  t === 'UPSELL' || t === 'DOWNSELL';

/** Papel/etapa/parent de cada pedido da sessão (pura). */
export function planJvzooRoles(rows: JvzooSessionRow[]): JvzooRolePlan[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort(
    (a, b) => a.orderedAt.getTime() - b.orderedAt.getTime() || a.id.localeCompare(b.id),
  );
  const knownBackend = (r: JvzooSessionRow): boolean =>
    r.marked ? isBackendType(r.marked.type) : isBackendType(r.memoryType);

  // Âncora (FE da sessão): a primeira que o NOME diz ser FE; senão a mais
  // antiga que não seja backend conhecido; senão a mais antiga (sessão só
  // de backend — vira âncora sem virar FRONTEND).
  const fe =
    sorted.find((r) => r.marked?.type === 'FRONTEND')
    ?? sorted.find((r) => !knownBackend(r))
    ?? sorted[0];

  // Ordem do funil pra atribuir POSIÇÃO. Timestamps reais (IPN) decidem
  // sozinhos; empate de horário (import de CSV carimba a sessão inteira com
  // a mesma hora) desempata por critério de funil: mesma família do FE
  // antes de cross-family (OTO1 é o pack maior da própria família; cross
  // vem depois), depois a âncora de slot do classificador, depois o id.
  const feFamily = fe.family;
  const sameFam = (r: JvzooSessionRow) => (r.family != null && r.family === feFamily ? 0 : 1);
  const walk = [fe, ...sorted.filter((r) => r.id !== fe.id).sort(
    (a, b) =>
      a.orderedAt.getTime() - b.orderedAt.getTime()
      || sameFam(a) - sameFam(b)
      || (a.marked?.step ?? 9) - (b.marked?.step ?? 9)
      || a.id.localeCompare(b.id),
  )];

  const plans: JvzooRolePlan[] = [];
  // O funil tem SEMPRE 3 slots de upsell e 3 de downsell (Up01..03 /
  // Down01..03). Posição passa disso quando o cliente compra 4+ ofertas ou
  // repete a mesma — teto no step 4 (slot 3), e oferta repetida (mesmo
  // productId) reusa a etapa da primeira compra em vez de abrir slot novo.
  const MAX_STEP = 4;
  const offerStep = new Map<string, number>();
  let position = 1; // 1 = FE; cada OFERTA nova não-âncora avança
  let prev: JvzooSessionRow | null = null;
  for (const r of walk) {
    let type: ProductType;
    let step: number;
    if (r.id === fe.id) {
      // Âncora: FRONTEND, salvo quando o nome diz explicitamente outra coisa
      // (sessão órfã de um "/ OTO1" — continua upsell, só ancora o grupo).
      type = r.marked && r.marked.type !== 'FRONTEND' ? r.marked.type : 'FRONTEND';
      step = r.marked?.step ?? 1;
    } else {
      position++;
      const repeatStep = offerStep.get(r.productId);
      if (repeatStep != null) position--; // recompra não abre slot novo
      if (r.marked) {
        type = r.marked.type;
        // Slot explícito ("OTO2") manda; "(Upgrade)" sem número fica com o
        // MAIOR entre a âncora de família e a posição real — cobre tanto o
        // 3º pedido genérico (posição 3 > âncora 2) quanto o DigestFlow
        // comprado em 2º pulando o OTO1 (âncora 3 > posição 2).
        step = r.marked.numbered
          ? (r.marked.step ?? position)
          : repeatStep ?? Math.max(r.marked.step ?? 2, position);
      } else if (isBackendType(r.memoryType)) {
        type = r.memoryType as ProductType;
        step = repeatStep ?? position;
      } else {
        const fewer =
          prev !== null
          && r.bottles != null && prev.bottles != null
          && r.family != null && r.family === prev.family
          && r.bottles < prev.bottles;
        type = fewer ? 'DOWNSELL' : 'UPSELL';
        step = repeatStep ?? position;
      }
      step = Math.min(step, MAX_STEP);
      offerStep.set(r.productId, step);
    }
    plans.push({ id: r.id, productType: type, funnelStep: step, parentExternalId: fe.externalId });
    prev = r;
  }
  return plans;
}

const SESSION_RE = /^jvz:(.+):(\d{4}-\d{2}-\d{2})$/;
const DAY_MS = 86_400_000;
const MERGE_WINDOW_MS = 6 * 3_600_000;

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** `current` é a sessão do DIA ANTERIOR do mesmo cliente que `anchor`? (resultado de uma fusão de meia-noite) */
export function isPrevDaySession(anchor: string, current: string | null): boolean {
  if (!current) return false;
  const a = SESSION_RE.exec(anchor);
  const c = SESSION_RE.exec(current);
  if (!a || !c) return false;
  return a[1] === c[1] && shiftDay(a[2], -1) === c[2];
}

async function loadRows(platformId: string, funnelSessionId: string): Promise<JvzooSessionRow[]> {
  const rows = await db.order.findMany({
    where: { platformId, funnelSessionId },
    select: {
      id: true, externalId: true, orderedAt: true, productType: true, funnelStep: true, parentExternalId: true,
      product: {
        select: {
          externalId: true, name: true, productType: true, family: true,
          bottles: true, verified: true, funnelStep: true,
        },
      },
    },
  });
  return rows.map((r) => {
    const c = classifyProduct(r.product.externalId, r.product.name, 'jvzoo');
    const nameNumbered = c.roleMarked && hasNumberedRoleMarker(r.product.name);
    // Precedência do papel: marcador NUMERADO no nome > catálogo VERIFICADO
    // (etapa gravada conta como slot explícito) > marcador sem número >
    // memória/posição (planJvzooRoles).
    const marked = nameNumbered
      ? { type: c.type, step: c.funnelStep, numbered: true }
      : r.product.verified
        ? { type: r.product.productType, step: r.product.funnelStep, numbered: r.product.funnelStep != null }
        : c.roleMarked
          ? { type: c.type, step: c.funnelStep, numbered: false }
          : null;
    return {
      id: r.id,
      externalId: r.externalId,
      productId: r.product.externalId,
      orderedAt: r.orderedAt,
      marked,
      memoryType: r.product.productType,
      family: (r.product.verified ? r.product.family : c.family) ?? r.product.family,
      bottles: (r.product.verified ? r.product.bottles : c.bottles) ?? r.product.bottles,
      current: { productType: r.productType, funnelStep: r.funnelStep, parentExternalId: r.parentExternalId },
    };
  });
}

/**
 * Meia-noite Eastern: se esta sessão não tem FE marcada e o mesmo cliente
 * fechou uma FE na sessão do dia anterior até 6h antes do 1º pedido daqui,
 * move todos os pedidos pra lá. Devolve a sessão de destino (ou null).
 */
async function mergeIntoPreviousDay(platformId: string, sessionId: string, rows: JvzooSessionRow[]): Promise<string | null> {
  const m = SESSION_RE.exec(sessionId);
  if (!m || rows.length === 0) return null;
  if (rows.some((r) => r.marked?.type === 'FRONTEND')) return null;
  const prevId = `jvz:${m[1]}:${shiftDay(m[2], -1)}`;
  const first = rows.reduce((a, b) => (b.orderedAt < a.orderedAt ? b : a));
  const prevFe = await db.order.findFirst({
    where: {
      platformId,
      funnelSessionId: prevId,
      productType: 'FRONTEND',
      orderedAt: { gte: new Date(first.orderedAt.getTime() - MERGE_WINDOW_MS), lte: first.orderedAt },
    },
    select: { id: true },
  });
  if (!prevFe) return null;
  await db.order.updateMany({ where: { platformId, funnelSessionId: sessionId }, data: { funnelSessionId: prevId } });
  return prevId;
}

export async function reconcileJvzooSession(funnelSessionId: string | null): Promise<number> {
  if (!funnelSessionId || !funnelSessionId.startsWith('jvz:')) return 0;

  const platform = await db.platform.findUnique({ where: { slug: 'jvzoo' }, select: { id: true } });
  if (!platform) return 0;

  let sessionId = funnelSessionId;
  let rows = await loadRows(platform.id, sessionId);
  if (rows.length === 0) return 0;

  const merged = await mergeIntoPreviousDay(platform.id, sessionId, rows);
  if (merged) {
    sessionId = merged;
    rows = await loadRows(platform.id, sessionId);
  }

  const plans = planJvzooRoles(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let updated = 0;
  for (const p of plans) {
    const r = byId.get(p.id)!;
    if (
      r.current.productType !== p.productType
      || r.current.parentExternalId !== p.parentExternalId
      || r.current.funnelStep !== p.funnelStep
    ) {
      await db.order.update({
        where: { id: p.id },
        data: { productType: p.productType, parentExternalId: p.parentExternalId, funnelStep: p.funnelStep },
      });
      updated++;
    }
  }

  if (merged) {
    // Pacote = sessão: a antiga esvaziou, a nova ganhou pedidos.
    await rebalanceSessionFulfillment(platform.id, funnelSessionId, 'session');
    await rebalanceSessionFulfillment(platform.id, merged, 'session');
    updated++;
  }
  return updated;
}
