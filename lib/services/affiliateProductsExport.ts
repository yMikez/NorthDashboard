// O que cada afiliado do NorthScale Afiliados já vende, por conta e produto
// (GET /api/integrations/affiliates/products). Alimenta a afiliação automática
// de lá: quem já vende um produto ganha a afiliação aprovada com o CPA da
// última venda, sem a equipe refazer à mão (pedido de 03/11/2026).
//
// Régua (a mesma do "CPA atual" das abas, mas por PRODUTO, não por conta):
//   · só pedidos já ligados a um afiliado de lá (mappedAffiliateId) — a mesma
//     ligação do ranking, então conta nova entra assim que o mapeamento chega;
//   · só front-end APROVADO, fora de rede, com valor (> 0) e fora de teste;
//   · Digistore: a venda estornada continua APPROVED (o estorno é outra linha),
//     então sai pelo anti-join no funnelSessionId + produto;
//   · CPA = o da venda mais recente com CPA > 0 (renegociação aparece na hora).
// Moeda vai junto: BuyGoods/Digistore/ClickBank gravam o valor original sem
// converter nos campos *Usd — quem consome decide o que fazer com não-USD.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { onAffiliateMappingChanged } from './affiliateMapping';

export const PRODUCTS_CACHE_TTL_MS = 5 * 60_000;
export const PRODUCTS_DEFAULT_DAYS = 180;
export const PRODUCTS_MAX_DAYS = 730;

export interface AffiliateProductRow {
  affiliate_id: string;
  platform: string;
  account_id: string;
  account_name: string | null;
  product_id: string;
  product_name: string;
  family: string | null;
  fe_sales: number;
  last_sale_at: Date;
  cpa_usd: Prisma.Decimal | number | null;
  cpa_at: Date | null;
  currency: string | null;
}

export interface AffiliateProductOut {
  product_id: string;
  product_name: string;
  family: string | null;
  fe_sales: number;
  last_sale_at: string;
  /** CPA da venda mais recente com CPA > 0 (null = nenhuma venda com CPA) */
  cpa_usd: number | null;
  cpa_at: string | null;
  /** moeda original da venda do cpa_usd (USD na JVZoo; outras podem vir sem conversão) */
  currency: string | null;
}

export interface AffiliateAccountProductsOut {
  affiliate_id: string;
  platform: string;
  /** ID da conta na plataforma, como chega nas vendas (BuyGoods: "aff_id@loja") */
  account_id: string;
  account_name: string | null;
  products: AffiliateProductOut[];
}

/** Linhas (afiliado × conta × produto) → uma entrada por conta, produtos por vendas */
export function shapeAffiliateProducts(rows: AffiliateProductRow[]): AffiliateAccountProductsOut[] {
  const byAccount = new Map<string, AffiliateAccountProductsOut>();
  for (const r of rows) {
    const key = `${r.affiliate_id}|${r.platform}|${r.account_id}`;
    let acc = byAccount.get(key);
    if (!acc) {
      acc = { affiliate_id: r.affiliate_id, platform: r.platform, account_id: r.account_id, account_name: r.account_name, products: [] };
      byAccount.set(key, acc);
    }
    const cpa = r.cpa_usd === null || r.cpa_usd === undefined ? null : Number(r.cpa_usd);
    acc.products.push({
      product_id: r.product_id,
      product_name: r.product_name,
      family: r.family,
      fe_sales: Number(r.fe_sales),
      last_sale_at: new Date(r.last_sale_at).toISOString(),
      cpa_usd: cpa !== null && Number.isFinite(cpa) && cpa > 0 ? Math.round(cpa * 100) / 100 : null,
      cpa_at: r.cpa_at ? new Date(r.cpa_at).toISOString() : null,
      currency: r.currency,
    });
  }
  for (const acc of byAccount.values()) acc.products.sort((a, b) => b.fe_sales - a.fe_sales || a.product_id.localeCompare(b.product_id));
  return [...byAccount.values()];
}

export async function computeAffiliateProducts(since: Date): Promise<AffiliateAccountProductsOut[]> {
  const rows = await db.$queryRaw<AffiliateProductRow[]>(Prisma.sql`
    WITH fe AS (
      SELECT o.id, o."mappedAffiliateId" AS affiliate_id, o."affiliateId" AS account_ref, o."productId",
             o."orderedAt", o."cpaPaidUsd" AS cpa, o."currencyOriginal" AS currency, pl."slug"
      FROM "Order" o
      JOIN "Platform" pl ON pl.id = o."platformId"
      WHERE o."mappedAffiliateId" IS NOT NULL
        AND o."affiliateId" IS NOT NULL
        AND o."productType" = 'FRONTEND'
        AND o."status" = 'APPROVED'
        AND o."networkId" IS NULL
        AND o."grossAmountUsd" > 0
        AND lower(o."eventType") NOT LIKE 'test%'
        AND o."orderedAt" >= ${since}
        AND NOT (pl."slug" = 'digistore24' AND o."funnelSessionId" IS NOT NULL AND EXISTS (
          SELECT 1 FROM "Order" r
          WHERE r."platformId" = o."platformId" AND r."status" IN ('REFUNDED', 'CHARGEBACK')
            AND r."funnelSessionId" = o."funnelSessionId" AND r."productId" = o."productId"))
    )
    SELECT fe.affiliate_id, fe."slug" AS platform, a."externalId" AS account_id, a."nickname" AS account_name,
           pr."externalId" AS product_id, pr."name" AS product_name, pr."family",
           COUNT(*)::int AS fe_sales,
           MAX(fe."orderedAt") AS last_sale_at,
           (ARRAY_AGG(fe.cpa ORDER BY fe."orderedAt" DESC, fe.id DESC) FILTER (WHERE fe.cpa > 0))[1] AS cpa_usd,
           (ARRAY_AGG(fe."orderedAt" ORDER BY fe."orderedAt" DESC, fe.id DESC) FILTER (WHERE fe.cpa > 0))[1] AS cpa_at,
           (ARRAY_AGG(fe.currency ORDER BY fe."orderedAt" DESC, fe.id DESC) FILTER (WHERE fe.cpa > 0))[1] AS currency
    FROM fe
    JOIN "Affiliate" a ON a.id = fe.account_ref
    JOIN "Product" pr ON pr.id = fe."productId"
    WHERE a."networkId" IS NULL AND a."isInternal" IS NOT TRUE
    GROUP BY 1, 2, 3, 4, 5, 6, 7
    ORDER BY 1, 2, 3
  `);
  return shapeAffiliateProducts(rows);
}

export interface ProductsCache {
  get(key: string): { body: AffiliateAccountProductsOut[]; at: number } | undefined;
  set(key: string, body: AffiliateAccountProductsOut[]): void;
  clear(): void;
}

export function createProductsCache(ttlMs = PRODUCTS_CACHE_TTL_MS, maxEntries = 16): ProductsCache {
  const map = new Map<string, { body: AffiliateAccountProductsOut[]; at: number }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) { map.delete(key); return undefined; }
      return hit;
    },
    set(key, body) {
      if (map.size >= maxEntries) map.clear();
      map.set(key, { body, at: Date.now() });
    },
    clear() { map.clear(); },
  };
}

export const affiliateProductsCache = createProductsCache();
// reprocesso do mapeamento reatribui pedidos: o próximo pull já vê a conta nova
onAffiliateMappingChanged(() => affiliateProductsCache.clear());
