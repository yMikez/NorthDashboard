// Ranking de afiliados (aba Afiliados › Ranking) — leitura do banco.
//
// Lê dados_oficiais.afiliados_pedidos (publicado pelo time de dados; ver
// docs/kb/ranking-afiliados.md) com o client `db`, por nome qualificado: a
// tabela existe nos dois modos (METRICS_SOURCE public ou oficial). O cadastro
// de afiliados e parceiros vem do public (é o dash que mantém).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import {
  type ContaCadastro, type LinhaDia, type PedidoLinha, type PedidosPacote, type Premissas, type RankingPayload,
  empacotarPedidos, mapearContas, montarPayload, sanitizarPremissas,
} from './affiliateRankingCore';

/** rtN = reembolso + taxas (alerta + disputa) que caíram até o dia N desde a venda: a curva por dia. */
const rt = (n: number) => Prisma.raw(
  `sum(CASE WHEN p.reembolso_dias <= ${n} THEN p.reembolso ELSE 0 END`
  + ` + CASE WHEN p.taxas_dias <= ${n} THEN p.taxa_alerta + p.taxa_disputa ELSE 0 END)::float8 AS rt${n}`,
);

/**
 * Agregado afiliado × dia do FE (JVZoo: dia de Nova York; Vupim: de Brasília).
 * Regras iguais às do painel de afiliados do time de dados (af_dia.sql): só
 * vendas com FE de origem e FE com afiliado; custo_fs e call_* só vêm na linha
 * do FE (a soma não duplica).
 */
export async function getAffiliateRankingData(): Promise<RankingPayload> {
  const [linhas, pub, cadastro] = await Promise.all([
    db.$queryRaw<LinhaDia[]>(Prisma.sql`
      SELECT p.fe_plataforma || ' ' || p.fe_afiliado_id AS afiliado,
             to_char(p.fe_dia, 'YYYY-MM-DD') AS dia,
             count(*) FILTER (WHERE p.e_fe)::int AS fes,
             sum(p.bruto)::float8 AS funil,
             sum(p.liquido)::float8 AS liq_funil,
             coalesce(sum(p.reembolso) FILTER (WHERE p.reembolso_dias <= 30), 0)::float8 AS dev30,
             coalesce(sum(p.reembolso) FILTER (WHERE p.reembolso_dias <= 10), 0)::float8 AS dev10,
             coalesce(sum(p.reembolso) FILTER (WHERE p.reembolso_dias <= 60), 0)::float8 AS dev60,
             coalesce(sum(p.taxa_alerta + p.taxa_disputa) FILTER (WHERE p.taxas_dias <= 10), 0)::float8 AS tx10,
             coalesce(sum(p.taxa_alerta + p.taxa_disputa) FILTER (WHERE p.taxas_dias <= 60), 0)::float8 AS tx60,
             ${rt(1)}, ${rt(3)}, ${rt(5)}, ${rt(7)}, ${rt(14)}, ${rt(21)}, ${rt(30)}, ${rt(45)},
             count(*)::int AS vendas,
             count(*) FILTER (WHERE p.disputa)::int AS disputas,
             coalesce(sum(p.custo_fs), 0)::float8 AS custo_fs,
             coalesce(sum(p.bruto) FILTER (WHERE p.armazem_achado), 0)::float8 AS funil_coberto,
             coalesce(sum(p.call_liquido), 0)::float8 AS liq_call,
             coalesce(sum(p.call_bruto), 0)::float8 AS bruto_call
      FROM dados_oficiais.afiliados_pedidos p
      WHERE p.fe_venda_id IS NOT NULL AND p.fe_afiliado_id IS NOT NULL
      GROUP BY 1, 2`),
    db.$queryRaw<{ publicacao_id: number | null; publicado_em: Date | null }[]>(Prisma.sql`
      SELECT x.publicacao_id::int AS publicacao_id, x.publicado_em
      FROM dados_oficiais._publicacao x
      WHERE x.publicacao_id = (SELECT max(publicacao_id) FROM dados_oficiais.afiliados_pedidos)`),
    db.$queryRaw<ContaCadastro[]>(Prisma.sql`
      SELECT pl.slug, a."externalId", a.nickname, a."partnerId", ap."displayName" AS "partnerName"
      FROM "Affiliate" a
      JOIN "Platform" pl ON pl.id = a."platformId"
      LEFT JOIN "AffiliatePartner" ap ON ap.id = a."partnerId"
      WHERE pl.slug IN ('jvzoo', 'vupim')`),
  ]);
  const { nomes, parceiros } = mapearContas(cadastro);
  const gerado = (pub[0]?.publicado_em ?? new Date()).toISOString();
  return montarPayload(linhas, nomes, parceiros, gerado, pub[0]?.publicacao_id ?? null);
}

/** Uma venda na lista de pedidos da página do afiliado (positivos = o que sai). */
export interface PedidoAfiliado {
  conta: string;
  plataforma: string;
  venda_id: string;
  etapa: string;
  e_fe: boolean;
  em: string;
  produto: string | null;
  status: string | null;
  bruto: number;
  cpa: number | null;
  reembolso: number;
  reembolso_dia: string | null;
  taxa_alerta: number;
  taxa_disputa: number;
  disputa: boolean;
  liquido: number;
  custo_fs: number | null;
  armazem_achado: boolean;
  call_liquido: number | null;
}

/**
 * Pedidos das contas pedidas, com o FE de origem entre `de` e `ate` (a safra).
 * Produto, status e CPA vêm do "Order": JVZoo pelo paykey (rawMetadata) no
 * dados_oficiais, Vupim pelo externalId no public.
 */
export async function getAffiliateOrders(contas: string[], de: string, ate: string): Promise<PedidoAfiliado[]> {
  if (!contas.length) return [];
  return db.$queryRaw<PedidoAfiliado[]>(Prisma.sql`
    SELECT p.fe_plataforma || ' ' || p.fe_afiliado_id AS conta, p.plataforma, p.venda_id, p.etapa, p.e_fe,
           to_char(p.vendido_em AT TIME ZONE CASE WHEN p.plataforma = 'JVZoo' THEN 'America/New_York' ELSE 'America/Sao_Paulo' END,
                   'YYYY-MM-DD HH24:MI') AS em,
           coalesce(pj.name, pv.name) AS produto,
           coalesce(oj.status::text, ov.status::text) AS status,
           coalesce(oj."cpaPaidUsd", ov."cpaPaidUsd")::float8 AS cpa,
           coalesce(p.reembolso, 0)::float8 AS reembolso,
           to_char(p.reembolso_dia, 'YYYY-MM-DD') AS reembolso_dia,
           coalesce(p.taxa_alerta, 0)::float8 AS taxa_alerta,
           coalesce(p.taxa_disputa, 0)::float8 AS taxa_disputa,
           coalesce(p.disputa, false) AS disputa,
           p.bruto::float8 AS bruto, p.liquido::float8 AS liquido, p.custo_fs::float8 AS custo_fs,
           coalesce(p.armazem_achado, false) AS armazem_achado, p.call_liquido::float8 AS call_liquido
    FROM dados_oficiais.afiliados_pedidos p
    LEFT JOIN dados_oficiais."Order" oj ON p.plataforma = 'JVZoo' AND oj."rawMetadata"->>'paykey' = p.venda_id
    LEFT JOIN dados_oficiais."Product" pj ON pj.id = oj."productId"
    LEFT JOIN "Order" ov ON p.plataforma = 'Vupim' AND ov."externalId" = p.venda_id
          AND ov."platformId" = (SELECT id FROM "Platform" WHERE slug = 'vupim')
    LEFT JOIN "Product" pv ON pv.id = ov."productId"
    WHERE p.fe_plataforma || ' ' || p.fe_afiliado_id IN (${Prisma.join(contas)})
      AND p.fe_dia BETWEEN ${de}::date AND ${ate}::date
    ORDER BY p.vendido_em DESC`);
}

/**
 * Todas as vendas com FE de origem e afiliado, empacotadas (Visão Geral e Reembolso Prev. precisam de todas de uma vez:
 * CPA da safra, curva por produto, caminho no funil e o detalhe de cada série). Mesmas junções de getAffiliateOrders.
 */
export async function getAffiliateAllOrders(): Promise<PedidosPacote> {
  const linhas = await db.$queryRaw<PedidoLinha[]>(Prisma.sql`
    SELECT p.fe_plataforma || ' ' || p.fe_afiliado_id AS conta, p.plataforma, p.venda_id, p.fe_venda_id,
           to_char(p.fe_dia, 'YYYY-MM-DD') AS fe_dia,
           to_char(p.vendido_em AT TIME ZONE CASE WHEN p.plataforma = 'JVZoo' THEN 'America/New_York' ELSE 'America/Sao_Paulo' END,
                   'YYYY-MM-DD') AS dia,
           p.etapa,
           coalesce(pj.name, pv.name) AS produto,
           coalesce(oj."cpaPaidUsd", ov."cpaPaidUsd")::float8 AS cpa,
           p.bruto::float8 AS bruto,
           coalesce(p.reembolso, 0)::float8 AS reembolso,
           to_char(p.reembolso_dia, 'YYYY-MM-DD') AS reembolso_dia,
           coalesce(p.taxa_alerta, 0)::float8 AS taxa_alerta,
           coalesce(p.taxa_disputa, 0)::float8 AS taxa_disputa
    FROM dados_oficiais.afiliados_pedidos p
    LEFT JOIN dados_oficiais."Order" oj ON p.plataforma = 'JVZoo' AND oj."rawMetadata"->>'paykey' = p.venda_id
    LEFT JOIN dados_oficiais."Product" pj ON pj.id = oj."productId"
    LEFT JOIN "Order" ov ON p.plataforma = 'Vupim' AND ov."externalId" = p.venda_id
          AND ov."platformId" = (SELECT id FROM "Platform" WHERE slug = 'vupim')
    LEFT JOIN "Product" pv ON pv.id = ov."productId"
    WHERE p.fe_venda_id IS NOT NULL AND p.fe_afiliado_id IS NOT NULL
    ORDER BY p.vendido_em`);
  return empacotarPedidos(linhas);
}

// ---------- Premissas compartilhadas ----------

export async function getAffiliateScoreConfig(): Promise<{ premissas: Premissas; updatedAt: string | null; updatedBy: string | null }> {
  const row = await db.affiliateScoreConfig.findUnique({ where: { id: 'global' } });
  return {
    premissas: sanitizarPremissas(row?.params ?? null),
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

/** Grava as premissas (já sanitizadas) e guarda o histórico de quem mudou. */
export async function saveAffiliateScoreConfig(entrada: unknown, quem: string): Promise<Premissas> {
  const premissas = sanitizarPremissas(entrada);
  const params = premissas as unknown as Prisma.InputJsonValue;
  await db.$transaction([
    db.affiliateScoreConfig.upsert({
      where: { id: 'global' },
      create: { id: 'global', params, updatedBy: quem },
      update: { params, updatedBy: quem },
    }),
    db.affiliateScoreConfigLog.create({ data: { params, changedBy: quem } }),
  ]);
  return premissas;
}
