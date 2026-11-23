// Simulador de Funil (aba Análise › Simulador de Funil) — leitura do banco.
//
// Base: dados_oficiais.afiliados_pedidos (publicado pelo time de dados; só a
// publicação atual fica na tabela), uma linha por venda JVZoo/Vupim com o FE de
// origem, a previsão D60 da devolução (r60_*), o custo real da Full Stack
// (custo_fs, na linha do FE) e o líquido de call center (call_*, na linha do FE).
// Produto, taxa (fees) e CPA (cpaPaidUsd) vêm do "Order": JVZoo pelo paykey no
// dados_oficiais (etapa fina em rawMetadata.etapa), Vupim pelo externalId no
// public (etapa pelo funnelStep que a Vupim mandou). Mesmas junções de
// affiliateRanking.ts. A conta da tela fica em funnelSimulatorCore.ts e no
// navegador (public/src/pages/funnel-sim-engine.js).

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { type SimBase, type SimDbRow, type SimulacaoEntrada, empacotarBase } from './funnelSimulatorCore';

/** Primeiro dia da base (início do histórico completo da JVZoo com previsão D60). */
export const SIM_DESDE = '2026-08-01';

const FONTE = 'dados_oficiais.afiliados_pedidos (publicação atual do time de dados) + "Order" (produto, taxa e CPA). '
  + 'JVZoo pelo dia de Nova York; Vupim pelo dia de Brasília. USD.';

// Previsão D60: colunas r60_* (sem elas — ambiente sem a publicação nova — a devolução vem zerada e a tela avisa).
const R60 = Prisma.sql`
             coalesce(p.r60_reembolso_previsto, 0)::float8 AS reemb,
             coalesce(p.r60_disputa_previsto, 0)::float8 AS cb,
             coalesce(p.r60_alerta_previsto, 0)::float8 AS alerta,
             (coalesce(p.r60_alerta_taxa_previsto, 0) + coalesce(p.r60_disputa_taxa_previsto, 0))::float8 AS taxas,
             CASE WHEN p.r60_total_previsto IS NULL THEN 0 ELSE coalesce(p.bruto, 0) END::float8 AS bruto_prev,`;
const SEM_R60 = Prisma.sql`
             0::float8 AS reemb, 0::float8 AS cb, 0::float8 AS alerta, 0::float8 AS taxas, 0::float8 AS bruto_prev,`;

export async function getFunnelSimulatorBase(): Promise<SimBase & { temPrevisao: boolean }> {
  const [col] = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema = 'dados_oficiais' AND table_name = 'afiliados_pedidos' AND column_name = 'r60_total_previsto'`);
  const temPrevisao = !!col?.n;
  const rows = await db.$queryRaw<SimDbRow[]>(Prisma.sql`
    WITH b AS (
      SELECT p.plataforma, p.venda_id, p.fe_venda_id, p.e_fe, p.etapa, p.fe_dia,
             coalesce(pj.name, pv.name) AS produto,
             oj."rawMetadata"->>'etapa' AS etapa_jvz,
             ov."productType"::text AS tipo_v,
             coalesce(CASE WHEN ov."rawMetadata"->>'vupimFunnelStep' ~ '^[0-9]+$'
                           THEN (ov."rawMetadata"->>'vupimFunnelStep')::int END, ov."funnelStep") AS passo_v,
             coalesce(oj.fees, ov.fees, 0)::float8 AS fee,
             coalesce(oj."cpaPaidUsd", ov."cpaPaidUsd", 0)::float8 AS cpa,
             coalesce(p.bruto, 0)::float8 AS bruto,
             ${temPrevisao ? R60 : SEM_R60}
             coalesce(p.custo_fs, 0)::float8 AS custo_fs,
             CASE WHEN coalesce(p.armazem_achado, false) THEN coalesce(p.bruto, 0) ELSE 0 END::float8 AS bruto_fs,
             coalesce(p.call_bruto, 0)::float8 AS call_bruto,
             coalesce(p.call_liquido, 0)::float8 AS call_liq
      FROM dados_oficiais.afiliados_pedidos p
      LEFT JOIN dados_oficiais."Order" oj ON p.plataforma = 'JVZoo' AND oj."rawMetadata"->>'paykey' = p.venda_id
      LEFT JOIN dados_oficiais."Product" pj ON pj.id = oj."productId"
      LEFT JOIN "Order" ov ON p.plataforma = 'Vupim' AND ov."externalId" = p.venda_id
            AND ov."platformId" = (SELECT id FROM "Platform" WHERE slug = 'vupim')
      LEFT JOIN "Product" pv ON pv.id = ov."productId"
      WHERE p.fe_venda_id IS NOT NULL AND p.fe_plataforma = p.plataforma AND p.fe_dia >= ${SIM_DESDE}::date
    ),
    fe AS (SELECT fe_venda_id, max(produto) AS produto_fe FROM b WHERE e_fe GROUP BY fe_venda_id)
    SELECT b.plataforma, fe.produto_fe, to_char(b.fe_dia, 'YYYY-MM-DD') AS dia, b.e_fe, b.etapa, b.etapa_jvz, b.tipo_v, b.passo_v,
           count(*)::int AS vendas, sum(bruto)::float8 AS bruto, sum(fee)::float8 AS fee, sum(cpa)::float8 AS cpa,
           sum(reemb)::float8 AS reemb, sum(cb)::float8 AS cb, sum(alerta)::float8 AS alerta, sum(taxas)::float8 AS taxas,
           sum(bruto_prev)::float8 AS bruto_prev, sum(custo_fs)::float8 AS custo_fs, sum(bruto_fs)::float8 AS bruto_fs,
           sum(call_bruto)::float8 AS call_bruto, sum(call_liq)::float8 AS call_liq
    FROM b JOIN fe USING (fe_venda_id)
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8`);
  return { ...empacotarBase(rows, { de: SIM_DESDE, gerado: new Date().toISOString(), fonte: FONTE }), temPrevisao };
}

// ---------- análises salvas ----------

export interface SimulacaoSalva {
  id: string; name: string; product: string | null; params: unknown; summary: unknown;
  createdById: string | null; createdByName: string | null; updatedAt: string; createdAt: string;
}

export async function listFunnelSimulations(): Promise<SimulacaoSalva[]> {
  const rows = await db.funnelSimulation.findMany({ orderBy: { updatedAt: 'desc' }, take: 500 });
  const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nome = new Map(users.map((u) => [u.id, u.name || u.email.split('@')[0]]));
  return rows.map((r) => ({
    id: r.id, name: r.name, product: r.product, params: r.params, summary: r.summary,
    createdById: r.createdById, createdByName: r.createdById ? nome.get(r.createdById) ?? null : null,
    updatedAt: r.updatedAt.toISOString(), createdAt: r.createdAt.toISOString(),
  }));
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function createFunnelSimulation(e: SimulacaoEntrada, userId: string): Promise<string> {
  const r = await db.funnelSimulation.create({
    data: { name: e.name, product: e.product, params: json(e.params), summary: json(e.summary), createdById: userId, updatedById: userId },
    select: { id: true },
  });
  return r.id;
}

/** Atualiza; só quem criou ou admin. Devolve 'ok', 'nao_achou' ou 'proibido'. */
export async function updateFunnelSimulation(id: string, e: SimulacaoEntrada, user: { id: string; role: string }): Promise<'ok' | 'nao_achou' | 'proibido'> {
  const atual = await db.funnelSimulation.findUnique({ where: { id }, select: { createdById: true } });
  if (!atual) return 'nao_achou';
  if (user.role !== 'ADMIN' && atual.createdById && atual.createdById !== user.id) return 'proibido';
  await db.funnelSimulation.update({
    where: { id },
    data: { name: e.name, product: e.product, params: json(e.params), summary: json(e.summary), updatedById: user.id },
  });
  return 'ok';
}

export async function deleteFunnelSimulation(id: string, user: { id: string; role: string }): Promise<'ok' | 'nao_achou' | 'proibido'> {
  const atual = await db.funnelSimulation.findUnique({ where: { id }, select: { createdById: true } });
  if (!atual) return 'nao_achou';
  if (user.role !== 'ADMIN' && atual.createdById && atual.createdById !== user.id) return 'proibido';
  await db.funnelSimulation.delete({ where: { id } });
  return 'ok';
}
