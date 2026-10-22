// Redes de afiliados (contrato docs/integracoes/redes.md) — parte com banco.
//
// O pedido continua vindo da IPN de vendedor da JVZoo (Order). Aqui ficam:
//   - o espelho das redes/integrantes (affiliate_networks, …_members);
//   - a marca de cada venda de rede (network_sales) e os checkouts
//     iniciados (network_checkouts), pelo evento do n8n e pela conferência;
//   - a classificação do pedido: Order.networkId e Affiliate.networkId.
//     Pedido de rede não recebe mappedAffiliateId nem entra na fila de não
//     mapeados, e sai das abas dos afiliados individuais.
//
// Um pedido JVZoo é de rede quando (1) existe network_sales com o mesmo
// transaction_id, (2) a conta do afiliado é uma conta JVZoo de rede, ou
// (3) ele é do funil (mesma sessão) de um pedido de rede.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import {
  foldPaykeyMark, mergeNetworkSale, type MemberRef, type NetworkRef, type NetworkSaleSource, type ParsedNetworkCheckout,
  type ParsedNetworkSale, type StoredNetworkSale,
} from './networksCore';

// ---------- Índice conta JVZoo → rede (usado no ingest) ----------

const INDEX_TTL_MS = 60_000;
let indexCache: { at: number; map: Map<string, string> } | null = null;

export function invalidateNetworkIndex(): void {
  indexCache = null;
}

/** affiliate_id da JVZoo → network_id. Barato (tabela pequena, cache de 60 s). */
export async function getNetworkAccountIndex(): Promise<Map<string, string>> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.map;
  const rows = await db.affiliateNetwork.findMany({ select: { id: true, jvzooAffiliateIds: true } });
  const map = new Map<string, string>();
  for (const r of rows) for (const id of r.jvzooAffiliateIds) map.set(id, r.id);
  indexCache = { at: Date.now(), map };
  return map;
}

// ---------- Cadastro (rede e integrante) ----------

/**
 * Upsert da rede. `replaceIds`: o diretório traz a lista COMPLETA de contas;
 * o evento traz uma conta só (soma à lista).
 */
export async function upsertNetworkRef(
  ref: NetworkRef,
  opts: { replaceIds?: boolean; now?: Date; deferAccountSync?: boolean } = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const existing = await db.affiliateNetwork.findUnique({ where: { id: ref.id }, select: { jvzooAffiliateIds: true } });
  const ids = opts.replaceIds ? ref.jvzooAffiliateIds : [...new Set([...(existing?.jvzooAffiliateIds ?? []), ...ref.jvzooAffiliateIds])];
  const idsChanged = !existing || ids.length !== existing.jvzooAffiliateIds.length || ids.some((i) => !existing.jvzooAffiliateIds.includes(i));
  await db.affiliateNetwork.upsert({
    where: { id: ref.id },
    create: { id: ref.id, name: ref.name, status: ref.status, operationMode: ref.operationMode, jvzooAffiliateIds: ids, syncedAt: now },
    update: { name: ref.name, status: ref.status, operationMode: ref.operationMode ?? undefined, jvzooAffiliateIds: ids, syncedAt: now },
  });
  if (idsChanged) {
    invalidateNetworkIndex();
    // O diretório troca várias redes numa rodada e sincroniza uma vez no fim.
    if (!opts.deferAccountSync) await syncNetworkAccounts();
  }
  return idsChanged;
}

export async function upsertMemberRef(m: MemberRef, now = new Date()): Promise<void> {
  await db.affiliateNetworkMember.upsert({
    where: { id: m.id },
    create: { id: m.id, networkId: m.networkId, publicId: m.publicId, name: m.name, status: m.status, syncedAt: now },
    update: { networkId: m.networkId, publicId: m.publicId ?? undefined, name: m.name, status: m.status, syncedAt: now },
  });
}

// ---------- Venda e checkout ----------

export async function applyNetworkSale(parsed: ParsedNetworkSale, source: NetworkSaleSource, raw: unknown): Promise<'created' | 'updated'> {
  // Marca gravada pelo paykey (o postback chegou antes da venda): junta a esta.
  const orphan = parsed.paykey && parsed.paykey !== parsed.transactionId
    ? await db.networkSale.findUnique({ where: { transactionId: parsed.paykey } })
    : null;
  if (orphan) parsed = { ...parsed, fields: foldPaykeyMark(parsed.fields, orphan as unknown as StoredNetworkSale) };
  const existing = await db.networkSale.findUnique({ where: { transactionId: parsed.transactionId } });
  const stored: StoredNetworkSale | null = existing
    ? {
      ...existing,
      amountUsd: existing.amountUsd == null ? null : Number(existing.amountUsd),
      networkCpa: existing.networkCpa == null ? null : Number(existing.networkCpa),
      memberAmount: existing.memberAmount == null ? null : Number(existing.memberAmount),
      networkMargin: existing.networkMargin == null ? null : Number(existing.networkMargin),
    } as unknown as StoredNetworkSale
    : null;
  const data = mergeNetworkSale(stored, parsed.fields, source);
  // A mescla nunca devolve nulo (nulo não apaga) — os tipos só não sabem disso.
  // `raw` guarda o último corpo do EVENTO (tem postback e tráfego); a leitura
  // só o grava quando a venda nasce por ela. O da marca órfã é de evento.
  const keepRaw = existing != null && source === 'read' && !orphan;
  const rawBody = source === 'read' && orphan ? orphan.raw : raw;
  const prismaData = {
    ...data,
    isTest: data.isTest ?? undefined,
    adClick: data.adClick ? (data.adClick as Prisma.InputJsonValue) : undefined,
    ...(keepRaw ? {} : { raw: (rawBody ?? {}) as Prisma.InputJsonValue }),
  } as Prisma.NetworkSaleUncheckedUpdateInput;
  if (existing) {
    await db.networkSale.update({ where: { transactionId: parsed.transactionId }, data: prismaData });
  } else {
    await db.networkSale.create({
      data: {
        ...(prismaData as Prisma.NetworkSaleUncheckedCreateInput),
        transactionId: parsed.transactionId,
        networkId: parsed.fields.networkId,
        attributionStatus: data.attributionStatus ?? 'pending',
        isTest: parsed.fields.isTest ?? false,
      },
    });
  }
  if (orphan) await db.networkSale.deleteMany({ where: { transactionId: orphan.transactionId } });
  return existing ? 'updated' : 'created';
}

export async function applyNetworkCheckout(parsed: ParsedNetworkCheckout, raw: unknown): Promise<'created' | 'updated'> {
  const fields = {
    networkId: parsed.network.id,
    memberId: parsed.member?.id ?? undefined,
    productId: parsed.productId ?? undefined,
    jvzooProductId: parsed.jvzooProductId ?? undefined,
    jvzooClickId: parsed.jvzooClickId ?? undefined,
    funnelId: parsed.funnelId ?? undefined,
    country: parsed.country ?? undefined,
    tid: parsed.tid ?? undefined,
    utmSource: parsed.utmSource ?? undefined,
    utmCampaign: parsed.utmCampaign ?? undefined,
    sub1: parsed.sub1 ?? undefined,
    raw: (raw ?? {}) as Prisma.InputJsonValue,
  };
  const existing = await db.networkCheckout.findUnique({ where: { sessionId: parsed.sessionId }, select: { sessionId: true } });
  if (existing) {
    // O mesmo checkout de novo: completa o que faltava, sem mudar a hora.
    await db.networkCheckout.update({ where: { sessionId: parsed.sessionId }, data: fields });
    return 'updated';
  }
  await db.networkCheckout.create({ data: { ...fields, sessionId: parsed.sessionId, at: parsed.at } });
  return 'created';
}

// ---------- Classificação dos pedidos ----------

/**
 * Affiliate.networkId das contas JVZoo de rede (e limpa o de quem saiu de
 * todas as redes). Conta de rede não tem mappedAffiliateId e sai da fila de
 * não mapeados.
 */
export async function syncNetworkAccounts(): Promise<{ marked: number; cleared: number; dequeued: number }> {
  const [m, c, d] = networkAccountsSql(await getNetworkAccountIndex());
  const marked = await db.$executeRaw(m);
  const cleared = await db.$executeRaw(c);
  const dequeued = await db.$executeRaw(d);
  if (marked || cleared || dequeued) logger.info({ marked, cleared, dequeued }, '[networks] contas de rede');
  return { marked, cleared, dequeued };
}

/** SQL de syncNetworkAccounts (exportado pra teste): marca, limpa, tira da fila. */
export function networkAccountsSql(index: Map<string, string>): [Prisma.Sql, Prisma.Sql, Prisma.Sql] {
  const ids = [...index.keys()];
  const networkIds = ids.map((i) => index.get(i)!);
  return [
    Prisma.sql`
      UPDATE "Affiliate" a SET "networkId" = n.network_id, "mappedAffiliateId" = NULL
      FROM (SELECT unnest(${ids}::text[]) AS ext, unnest(${networkIds}::text[]) AS network_id) n,
           "Platform" pl
      WHERE pl.slug = 'jvzoo' AND a."platformId" = pl.id AND a."externalId" = n.ext
        AND (a."networkId" IS DISTINCT FROM n.network_id OR a."mappedAffiliateId" IS NOT NULL)`,
    Prisma.sql`
      UPDATE "Affiliate" a SET "networkId" = NULL
      WHERE a."networkId" IS NOT NULL AND NOT (a."externalId" = ANY(${ids}::text[]))`,
    Prisma.sql`
      DELETE FROM unmapped_affiliate_events u
      USING "Affiliate" a
      WHERE a."networkId" IS NOT NULL
        AND (u.affiliate_account_id = a.id OR (u.platform = 'jvzoo' AND u.external_id = a."externalId"))`,
  ];
}

/**
 * SQL da marcação (exportado pra teste). `transactionIds` limita o passo da marca.
 *
 * Cada passo parte do conjunto PEQUENO (contas de rede, marcas, pedidos de
 * rede), materializado, e casa com Order por índice. Juntar Order com Order
 * pela expressão COALESCE(parentExternalId, externalId) não tem índice e, com
 * a coluna nova sem estatística, o planner varria a tabela por pedido (prod,
 * 2026-10-22: o passo do funil rodou 9 min até ser cancelado).
 */
export function markNetworkOrdersSql(transactionIds?: string[]): Prisma.Sql[] {
  const scope = transactionIds?.length ? Prisma.sql`AND ns.transaction_id = ANY(${transactionIds}::text[])` : Prisma.empty;
  return [
    // (2) conta do afiliado é conta de rede
    Prisma.sql`
      WITH a AS MATERIALIZED (SELECT id, "networkId" FROM "Affiliate" WHERE "networkId" IS NOT NULL)
      UPDATE "Order" o SET "networkId" = COALESCE(o."networkId", a."networkId"), "mappedAffiliateId" = NULL
      FROM a
      WHERE o."affiliateId" = a.id
        AND (o."networkId" IS NULL OR o."mappedAffiliateId" IS NOT NULL)`,
    // (1) marca do n8n/conferência (vence a conta)
    Prisma.sql`
      WITH m AS MATERIALIZED (
        SELECT ns.transaction_id, ns.network_id, pl.id AS platform_id
        FROM network_sales ns, "Platform" pl
        WHERE pl.slug = 'jvzoo' ${scope}
      )
      UPDATE "Order" o SET "networkId" = m.network_id, "mappedAffiliateId" = NULL
      FROM m
      WHERE o."platformId" = m.platform_id AND o."externalId" = m.transaction_id
        AND (o."networkId" IS DISTINCT FROM m.network_id OR o."mappedAffiliateId" IS NOT NULL)`,
    // (3) funil da venda principal (mesma sessão: o pedido raiz e os filhos dele)
    Prisma.sql`
      WITH k AS MATERIALIZED (
        SELECT DISTINCT ON (p."platformId", COALESCE(p."parentExternalId", p."externalId"))
               p."platformId" AS platform_id, COALESCE(p."parentExternalId", p."externalId") AS key, p."networkId" AS network_id
        FROM "Order" p JOIN "Platform" pl ON pl.id = p."platformId" AND pl.slug = 'jvzoo'
        WHERE p."networkId" IS NOT NULL
        ORDER BY p."platformId", COALESCE(p."parentExternalId", p."externalId"), p."orderedAt"
      ),
      t AS MATERIALIZED (
        SELECT o.id, k.network_id FROM k JOIN "Order" o ON o."platformId" = k.platform_id AND o."externalId" = k.key
        WHERE o."networkId" IS NULL
        UNION
        SELECT o.id, k.network_id FROM k JOIN "Order" o ON o."platformId" = k.platform_id AND o."parentExternalId" = k.key
        WHERE o."networkId" IS NULL
      )
      UPDATE "Order" o SET "networkId" = t.network_id, "mappedAffiliateId" = NULL
      FROM t
      WHERE o.id = t.id AND o."networkId" IS NULL`,
  ];
}

export async function markNetworkOrders(transactionIds?: string[]): Promise<{ byAccount: number; byMark: number; byFunnel: number }> {
  const [a, b, c] = markNetworkOrdersSql(transactionIds);
  const byAccount = await db.$executeRaw(a);
  const byMark = await db.$executeRaw(b);
  const byFunnel = await db.$executeRaw(c);
  if (byAccount || byMark || byFunnel) logger.info({ byAccount, byMark, byFunnel }, '[networks] pedidos de rede marcados');
  return { byAccount, byMark, byFunnel };
}

/**
 * No ingest da JVZoo (upsertOrder): a rede do pedido, se houver. Conta de
 * rede → rede da conta; senão a marca do n8n já gravada; senão o pedido pai.
 */
export async function networkForJvzooOrder(input: {
  platformId: string;
  externalId: string;
  parentExternalId: string | null;
  accountNetworkId: string | null;
}): Promise<string | null> {
  if (input.accountNetworkId) return input.accountNetworkId;
  const mark = await db.networkSale.findUnique({ where: { transactionId: input.externalId }, select: { networkId: true } });
  if (mark) return mark.networkId;
  if (input.parentExternalId && input.parentExternalId !== input.externalId) {
    const parent = await db.order.findFirst({
      where: { platformId: input.platformId, externalId: input.parentExternalId },
      select: { networkId: true },
    });
    if (parent?.networkId) return parent.networkId;
  }
  return null;
}
