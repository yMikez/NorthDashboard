// Devolução D60 por afiliado (aba Afiliados): real + previsto — leitura do banco.
//
// Lê dados_oficiais.afiliados_pedidos com o client `db` (como affiliateRanking.ts:
// a tabela existe nos dois modos de METRICS_SOURCE; publicada pelo time de dados,
// só a publicação atual fica na tabela). Agrupa pela conta do afiliado de
// ENTRADA do funil (fe_plataforma + fe_afiliado_id), no dia da venda (`dia`:
// JVZoo dia de Nova York, Vupim dia de Brasília). Regras e vocabulário:
// affiliateRefundForecastCore.ts e docs/kb/afiliados-previsao-d60.md.
//
// Real: colunas que a tabela já tem (funciona hoje). Previsto: colunas r60_*;
// enquanto não forem publicadas, a fonte volta `sem_previsao` e a tela mostra
// só o real. Falha de leitura = lista de afiliados igual, sem D60.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { logger } from '../logger';
import type { AffiliatesResponse } from './metrics';
import {
  type AffiliateRefundD60, type D60DbRow, type RefundD60Source,
  FORECAST_SINCE, brtDay, d60Key, d60Map, totalsFromRows,
} from './affiliateRefundForecastCore';

export interface D60Filters {
  startDate: Date;
  endDate: Date;
  platformSlugs?: string[];
  ignoredFilters?: string[];
}

// Real na regra do modelo: evento até 60 dias depois da venda (dia do
// reembolso − dia da venda; taxa de disputa pelo dia da cobrança).
const OK = Prisma.sql`(p.reembolso_dia IS NOT NULL AND greatest(p.reembolso_dia - p.dia, 0) <= 60)`;
const TX_DISP = Prisma.sql`(CASE WHEN p.taxas_dias IS NOT NULL AND greatest(p.taxas_dias, 0) <= 60 THEN coalesce(p.taxa_disputa, 0) ELSE 0 END)`;
const TX_ALERT = Prisma.sql`(CASE WHEN ${OK} AND coalesce(p.taxa_alerta, 0) > 0 THEN p.taxa_alerta ELSE 0 END)`;

const PREVISTO = Prisma.sql`
  count(p.r60_total_previsto)::int AS com_previsao,
  coalesce(sum(p.bruto) FILTER (WHERE p.r60_total_previsto IS NOT NULL), 0)::float8 AS vendido,
  coalesce(sum(p.r60_reembolso_previsto), 0)::float8 AS reembolso,
  coalesce(sum(p.r60_disputa_previsto), 0)::float8 AS chargeback,
  coalesce(sum(p.r60_alerta_previsto), 0)::float8 AS alertas,
  coalesce(sum(coalesce(p.r60_alerta_taxa_previsto, 0) + coalesce(p.r60_disputa_taxa_previsto, 0))
           FILTER (WHERE p.r60_total_previsto IS NOT NULL), 0)::float8 AS taxas,
  coalesce(sum(p.r60_total_previsto), 0)::float8 AS total,
  coalesce(sum(p.r60_total_previsto) FILTER (WHERE p.r60_fechado), 0)::float8 AS total_fechado`;
const SEM_PREVISTO = Prisma.sql`
  0 AS com_previsao, 0::float8 AS vendido, 0::float8 AS reembolso, 0::float8 AS chargeback, 0::float8 AS alertas,
  0::float8 AS taxas, 0::float8 AS total, 0::float8 AS total_fechado`;

type Meta = { publicacao_id: number | null; corte: string | null; versao: number | null };

export async function getAffiliateRefundD60(f: D60Filters): Promise<{ map: Map<string, AffiliateRefundD60>; source: RefundD60Source }> {
  const startDay = brtDay(f.startDate);
  const endDay = brtDay(f.endDate);
  const [col] = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema = 'dados_oficiais' AND table_name = 'afiliados_pedidos' AND column_name = 'r60_total_previsto'`);
  const temPrevisao = !!col?.n;

  const slugs = (f.platformSlugs ?? []).map((s) => s.toLowerCase());
  const platformCond = slugs.length ? Prisma.sql`AND lower(p.fe_plataforma) IN (${Prisma.join(slugs)})` : Prisma.empty;
  const [rows, meta] = await Promise.all([
    db.$queryRaw<D60DbRow[]>(Prisma.sql`
      SELECT lower(p.fe_plataforma) AS slug, p.fe_afiliado_id AS aff,
             count(*)::int AS pedidos,
             coalesce(sum(p.bruto), 0)::float8 AS vendido_total,
             coalesce(sum(p.reembolso) FILTER (WHERE ${OK} AND NOT coalesce(p.disputa, false) AND coalesce(p.taxa_alerta, 0) = 0), 0)::float8 AS re_real,
             coalesce(sum(p.reembolso) FILTER (WHERE ${OK} AND coalesce(p.disputa, false)), 0)::float8 AS cb_real,
             coalesce(sum(p.reembolso) FILTER (WHERE ${OK} AND NOT coalesce(p.disputa, false) AND coalesce(p.taxa_alerta, 0) > 0), 0)::float8 AS al_real,
             coalesce(sum(${TX_ALERT} + ${TX_DISP}), 0)::float8 AS tx_real,
             coalesce(sum(CASE WHEN ${OK} THEN coalesce(p.reembolso, 0) ELSE 0 END + ${TX_ALERT} + ${TX_DISP}), 0)::float8 AS total_real,
             ${temPrevisao ? PREVISTO : SEM_PREVISTO}
      FROM dados_oficiais.afiliados_pedidos p
      WHERE p.fe_afiliado_id IS NOT NULL AND p.fe_plataforma IS NOT NULL
        AND p.dia BETWEEN ${startDay}::date AND ${endDay}::date
        ${platformCond}
      GROUP BY 1, 2`),
    db.$queryRaw<Meta[]>(temPrevisao
      ? Prisma.sql`SELECT max(p.publicacao_id)::int AS publicacao_id, to_char(max(p.previsao_data_corte), 'YYYY-MM-DD') AS corte,
                          max(p.previsao_versao)::int AS versao
                   FROM dados_oficiais.afiliados_pedidos p`
      : Prisma.sql`SELECT max(p.publicacao_id)::int AS publicacao_id, NULL::text AS corte, NULL::int AS versao
                   FROM dados_oficiais.afiliados_pedidos p`),
  ]);
  const m = meta[0];
  return {
    map: d60Map(rows),
    source: {
      status: temPrevisao ? 'ok' : 'sem_previsao',
      reason: temPrevisao ? undefined : 'previsão D60 ainda não publicada no banco: só o real',
      publicacaoId: m?.publicacao_id ?? null, cutoffDay: m?.corte ?? null, modelVersion: m?.versao ?? null,
      since: FORECAST_SINCE, startDay, endDay, ignoredFilters: f.ignoredFilters ?? [],
      totals: totalsFromRows(rows),
    },
  };
}

/** Pendura o D60 em cada linha de conta (antes de unificar por parceiro). Falha = lista sem D60. */
export async function attachRefundD60(data: AffiliatesResponse, f: D60Filters): Promise<AffiliatesResponse> {
  try {
    const { map, source } = await getAffiliateRefundD60(f);
    const listed = new Set(data.affiliates.map((r) => d60Key(r.platformSlug, r.externalId)));
    return {
      ...data,
      refundD60Source: { ...source, unmatchedAccounts: [...map.keys()].filter((k) => !listed.has(k)).length },
      affiliates: data.affiliates.map((r) => ({ ...r, refundD60: map.get(d60Key(r.platformSlug, r.externalId)) ?? null })),
    };
  } catch (err) {
    logger.error({ err }, 'refund D60 failed');
    return {
      ...data,
      refundD60Source: {
        status: 'indisponivel', reason: 'falha ao ler a devolução D60', publicacaoId: null, cutoffDay: null, modelVersion: null,
        since: FORECAST_SINCE, startDay: brtDay(f.startDate), endDay: brtDay(f.endDate), ignoredFilters: f.ignoredFilters ?? [],
      },
      affiliates: data.affiliates.map((r) => ({ ...r, refundD60: null })),
    };
  }
}
