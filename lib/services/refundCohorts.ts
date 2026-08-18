// Cohort de reembolso — spec do usuário em Cohort.md (2026-08-18).
//
// A pergunta que isto responde: "das vendas do dia X, quantas voltaram até o
// dia X+N?" — taxa POR COORTE DE VENDA, imune ao viés que quebra a taxa
// simples (reembolso de venda antiga caindo no mês errado quando o volume
// muda rápido).
//
// Regra central: o reembolso é sempre atribuído ao dia da VENDA original
// (orderedAt), com lag = dia do estorno − dia da venda. Os dois eixos vêm
// da dupla lente montada em 2026-08-11: orderedAt = venda,
// refundedAt/chargebackAt = estorno.
//
// Semântica por modelo de contabilidade (ver realOrderCount/profitModel):
//   - BASE da coorte  = vendas reais do dia:
//       APPROVED  (todas as plataformas; na Digistore a venda estornada
//                  CONTINUA APPROVED, então já carrega a base sozinha)
//       + REFUNDED/CHARGEBACK das plataformas in-place COM approvedAt
//         preenchido (a linha estornada É a venda; approvedAt null = venda
//         anterior à ingestão ou não recuperada pelo backfill → fora, senão
//         entraria na coorte do dia errado).
//   - EVENTOS de estorno = linhas REFUNDED/CHARGEBACK com data de evento:
//       Digistore → linha sintética (orderedAt = venda, refundedAt = estorno)
//       in-place  → a própria linha, se approvedAt preenchido.
//   Chargeback CONTA como estorno aqui — pro cohort de qualidade o que
//   importa é dinheiro devolvido, mesma régua do refund&cb% do modelo CPA.
//
// Censura: célula só existe se a coorte JÁ VIVEU aquele dia
// (hoje_BRT − dia_venda >= coluna). Coorte imatura fica null, não zero.
// Bucketização de dia em BRT, mesma da daily_metrics.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { EXTRA_ROW_REFUND_PLATFORMS } from './profitModel';

export interface RefundCohortFilters {
  startDate: Date;
  endDate: Date;
  platformSlugs?: string[];
  productFamilies?: string[];
  productExternalIds?: string[];
  productTypes?: string[];
  countries?: string[];
}

export interface CohortCell {
  cumCount: number;
  cumUsd: number;
  pctCount: number; // cumCount / baseCount
  pctUsd: number;   // cumUsd / baseUsd
}

export interface CohortRow {
  day: string;        // 'YYYY-MM-DD' (BRT)
  ageDays: number;    // hoje_BRT − day
  baseCount: number;
  baseUsd: number;
  // index = dias desde a venda (0..horizon); null = censurado (coorte
  // ainda não viveu esse dia).
  cells: Array<CohortCell | null>;
}

export interface MaturationPoint {
  age: number;
  // Agregado só das coortes com ageDays >= age (maduras até aquele dia).
  pctCount: number | null;
  pctUsd: number | null;
  eligibleBaseCount: number;
  eligibleBaseUsd: number;
}

export interface RefundCohortsResponse {
  todayBrt: string;
  horizonDays: number;
  cohorts: CohortRow[];       // mais recente primeiro
  curve: MaturationPoint[];   // age 0..horizon
  totals: {
    baseCount: number;
    baseUsd: number;
    refundCount: number;      // eventos dentro do horizonte
    refundUsd: number;
    beyondHorizonCount: number; // estornos com lag > horizonte (fora da matriz)
    // Estornos em dias SEM base elegível (ex.: refund de venda pré-ingestão
    // caindo num dia sem vendas) — fora da matriz, mas visíveis no rodapé.
    orphanEventCount: number;
  };
}

const BRT_DAY = (col: Prisma.Sql) =>
  Prisma.sql`(((${col}) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date`;

export async function getRefundCohorts(
  filters: RefundCohortFilters,
  horizonDays: number,
): Promise<RefundCohortsResponse> {
  const horizon = Math.min(Math.max(Math.trunc(horizonDays) || 30, 7), 180);
  const extraRow = [...EXTRA_ROW_REFUND_PLATFORMS];

  const conds: Prisma.Sql[] = [
    Prisma.sql`o."orderedAt" >= ${filters.startDate}`,
    Prisma.sql`o."orderedAt" <= ${filters.endDate}`,
  ];
  if (filters.platformSlugs?.length) {
    conds.push(Prisma.sql`pl."slug" = ANY(${filters.platformSlugs})`);
  }
  if (filters.countries?.length) {
    conds.push(Prisma.sql`o."country" = ANY(${filters.countries})`);
  }
  if (filters.productFamilies?.length) {
    conds.push(Prisma.sql`pr."family" = ANY(${filters.productFamilies})`);
  }
  if (filters.productExternalIds?.length) {
    conds.push(Prisma.sql`pr."externalId" = ANY(${filters.productExternalIds})`);
  }
  if (filters.productTypes?.length) {
    conds.push(Prisma.sql`o."productType" = ANY(${filters.productTypes}::"ProductType"[])`);
  }
  const whereSql = Prisma.join(conds, ' AND ');
  const saleDay = BRT_DAY(Prisma.sql`o."orderedAt"`);
  const eventDay = BRT_DAY(Prisma.sql`COALESCE(o."refundedAt", o."chargebackAt")`);

  const [baseRows, eventRows, todayRows] = await Promise.all([
    db.$queryRaw<Array<{ day: Date; n: bigint; usd: Prisma.Decimal }>>(Prisma.sql`
      SELECT ${saleDay} AS day,
             COUNT(*)::bigint AS n,
             COALESCE(SUM(COALESCE(o."originalGrossUsd", ABS(o."grossAmountUsd"))), 0) AS usd
      FROM "Order" o
      JOIN "Platform" pl ON o."platformId" = pl.id
      JOIN "Product"  pr ON o."productId"  = pr.id
      WHERE ${whereSql}
        -- status IN (...) fora do OR: deixa o planner usar (status, orderedAt)
        -- e corta PENDING/CANCELED do heap scan antes do filtro fino.
        AND o."status" IN ('APPROVED', 'REFUNDED', 'CHARGEBACK')
        AND (
          o."status" = 'APPROVED'
          OR (NOT (pl."slug" = ANY(${extraRow})) AND o."approvedAt" IS NOT NULL)
        )
      GROUP BY 1
    `),
    // lag em DIAS BRT (inteiro). GREATEST(0, …) cobre skew de relógio entre
    // plataformas (estorno "antes" da venda por fuso).
    db.$queryRaw<Array<{ day: Date; lag: number; n: bigint; usd: Prisma.Decimal }>>(Prisma.sql`
      SELECT ${saleDay} AS day,
             GREATEST(0, ${eventDay} - ${saleDay})::int AS lag,
             COUNT(*)::bigint AS n,
             COALESCE(SUM(ABS(o."grossAmountUsd")), 0) AS usd
      FROM "Order" o
      JOIN "Platform" pl ON o."platformId" = pl.id
      JOIN "Product"  pr ON o."productId"  = pr.id
      WHERE ${whereSql}
        AND o."status" IN ('REFUNDED', 'CHARGEBACK')
        AND COALESCE(o."refundedAt", o."chargebackAt") IS NOT NULL
        AND (pl."slug" = ANY(${extraRow}) OR o."approvedAt" IS NOT NULL)
        -- Linha reconciliada por CSV SEM venda original casada: o orderedAt
        -- dela é a data do ESTORNO (não da venda) — entraria na coorte do
        -- dia errado com lag 0. Fica fora até alguém casar a venda.
        AND NOT COALESCE(
          o."rawMetadata"->>'_source' = 'csv-reconcile'
          AND o."rawMetadata"->>'matched_original_sale' = 'false',
          false
        )
      GROUP BY 1, 2
    `),
    db.$queryRaw<Array<{ today: string }>>(
      Prisma.sql`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text AS today`,
    ),
  ]);

  return assembleRefundCohorts({
    base: baseRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      count: Number(r.n),
      usd: Number(r.usd),
    })),
    events: eventRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      lag: r.lag,
      count: Number(r.n),
      usd: Number(r.usd),
    })),
    todayBrt: todayRows[0].today,
    horizonDays: horizon,
  });
}

// ─── Montagem pura (exportada pra teste) ────────────────────────────────────

export interface CohortAssemblyInput {
  base: Array<{ day: string; count: number; usd: number }>;
  events: Array<{ day: string; lag: number; count: number; usd: number }>;
  todayBrt: string;
  horizonDays: number;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function assembleRefundCohorts(input: CohortAssemblyInput): RefundCohortsResponse {
  const { todayBrt, horizonDays } = input;

  // day → [lag] → {count, usd}
  const eventsByDay = new Map<string, Map<number, { count: number; usd: number }>>();
  let beyondHorizonCount = 0;
  for (const e of input.events) {
    if (e.lag > horizonDays) {
      beyondHorizonCount += e.count;
      continue;
    }
    let m = eventsByDay.get(e.day);
    if (!m) { m = new Map(); eventsByDay.set(e.day, m); }
    const cur = m.get(e.lag) ?? { count: 0, usd: 0 };
    cur.count += e.count;
    cur.usd += e.usd;
    m.set(e.lag, cur);
  }

  const baseDays = new Set(input.base.map((b) => b.day));
  let orphanEventCount = 0;
  for (const e of input.events) {
    if (!baseDays.has(e.day)) orphanEventCount += e.count;
  }
  const totals = {
    baseCount: 0, baseUsd: 0, refundCount: 0, refundUsd: 0,
    beyondHorizonCount, orphanEventCount,
  };

  const cohorts: CohortRow[] = input.base
    .slice()
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map((b) => {
      const ageDays = dayDiff(todayBrt, b.day);
      const lags = eventsByDay.get(b.day);
      totals.baseCount += b.count;
      totals.baseUsd += b.usd;

      let cumCount = 0;
      let cumUsd = 0;
      const cells: Array<CohortCell | null> = [];
      for (let col = 0; col <= horizonDays; col++) {
        // Censura: a coorte só "viveu" o dia N se hoje − venda >= N.
        if (ageDays < col) { cells.push(null); continue; }
        const hit = lags?.get(col);
        if (hit) { cumCount += hit.count; cumUsd += hit.usd; }
        cells.push({
          cumCount,
          cumUsd: round2(cumUsd),
          pctCount: b.count > 0 ? round4(cumCount / b.count) : 0,
          pctUsd: b.usd > 0 ? round4(cumUsd / b.usd) : 0,
        });
      }
      totals.refundCount += cumCount;
      totals.refundUsd += cumUsd;
      return {
        day: b.day,
        ageDays,
        baseCount: b.count,
        baseUsd: round2(b.usd),
        cells,
      };
    });

  totals.baseUsd = round2(totals.baseUsd);
  totals.refundUsd = round2(totals.refundUsd);

  // Curva de maturação: pra cada idade N, agrega SÓ as coortes que já têm
  // N dias — Σ estornos com lag<=N ÷ Σ base dessas coortes. É a curva que
  // compara saúde entre meses sem o viés das coortes imaturas.
  const curve: MaturationPoint[] = [];
  for (let age = 0; age <= horizonDays; age++) {
    let eligibleBaseCount = 0;
    let eligibleBaseUsd = 0;
    let cumCount = 0;
    let cumUsd = 0;
    for (const c of cohorts) {
      if (c.ageDays < age) continue;
      eligibleBaseCount += c.baseCount;
      eligibleBaseUsd += c.baseUsd;
      const cell = c.cells[age];
      if (cell) { cumCount += cell.cumCount; cumUsd += cell.cumUsd; }
    }
    curve.push({
      age,
      pctCount: eligibleBaseCount > 0 ? round4(cumCount / eligibleBaseCount) : null,
      pctUsd: eligibleBaseUsd > 0 ? round4(cumUsd / eligibleBaseUsd) : null,
      eligibleBaseCount,
      eligibleBaseUsd: round2(eligibleBaseUsd),
    });
  }

  return { todayBrt, horizonDays, cohorts, curve, totals };
}
