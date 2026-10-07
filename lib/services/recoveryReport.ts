// Recuperação que não chega por IPN: backfill pelo relatório "Customers" do
// painel da BuyGoods (Name, Email, Affiliate Name, Lifetime Value, Balance) e
// sugestões de conta não marcada. Contexto: as vendas BuyGoods da MailX nunca
// mandaram IPN (só pedidos de teste de US$ 0 em set/2026), então a comissão
// dela lá não aparece na aba Recuperação. O relatório é a única fonte.
//
// Nada de dado pessoal sai do parser: o e-mail vira md5(lower(trim(email)))
// — a mesma expressão casa com Customer.email em SQL — e o nome é descartado.
// O backfill ainda não tem tela (decisão do dono, 2026-10-07).

import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../db';

type Cell = string | number | null;

export interface ReportRow {
  emailHash: string;
  affiliateName: string;
  lifetimeValueUsd: number;
  balanceUsd: number;
}

export interface ParsedReport {
  rows: ReportRow[];
  /** Janela do relatório (Date Range), YYYY-MM-DD. */
  createdFrom: string | null;
  createdTo: string | null;
  /** "Report Date" do título, YYYY-MM-DD. */
  reportDate: string | null;
  /** "Criteria" do título (rr_createdate = data de cadastro do cliente). */
  criteria: string | null;
  invalid: number;
  noAffiliate: number;
}

export function hashEmail(email: string): string {
  return crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n: number) => String(n).padStart(2, '0');

function isoDay(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "September 28, 2026" → 2026-09-28. */
function monthDay(s: string): string | null {
  const m = /^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/i.exec(s.trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  return mi < 0 ? null : isoDay(Number(m[3]), mi + 1, Number(m[2]));
}

/** Valor do painel: número ou "$1,234.50". */
function money(v: Cell): number | null {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v.replace(/[$\s,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const text = (v: Cell) => (v == null ? '' : String(v).trim());

/**
 * Lê as linhas cruas da planilha. O export tem linhas de título antes do
 * cabeçalho ("Report Date: 10-05-2026", "Date Range: September 28, 2026 -
 * October 05, 2026"); o cabeçalho é a primeira linha com uma coluna Email.
 * Linha sem afiliado é venda direta — fica de fora (conta em noAffiliate).
 */
export function parseCustomersReport(raw: Cell[][]): ParsedReport | { error: string } {
  const hi = raw.findIndex((r) => r.some((c) => text(c).toLowerCase() === 'email'));
  if (hi < 0) return { error: 'cabeçalho não encontrado (falta a coluna Email)' };
  const header = raw[hi].map((c) => text(c).toLowerCase());
  const iEmail = header.indexOf('email');
  const iAff = header.findIndex((h) => h.startsWith('affiliate'));
  const iLtv = header.findIndex((h) => h.startsWith('lifetime'));
  const iBal = header.findIndex((h) => h.startsWith('balance'));
  if (iAff < 0) return { error: 'relatório sem a coluna Affiliate Name — exporte o Customers com o afiliado' };
  if (iLtv < 0) return { error: 'relatório sem a coluna Lifetime Value' };

  const title = raw.slice(0, hi).map((r) => r.map(text).filter(Boolean).join(' ')).join('\n');
  const rd = /Report Date:\s*(\d{1,2})-(\d{1,2})-(\d{4})/i.exec(title);
  const range = /Date Range:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})\s*-\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i.exec(title);
  const crit = /Criteria:\s*([^\n]+)/i.exec(title);

  // Mesmo cliente duas vezes no arquivo: fica o maior LTV (é acumulado).
  const byKey = new Map<string, ReportRow>();
  let invalid = 0;
  let noAffiliate = 0;
  for (const r of raw.slice(hi + 1)) {
    if (!r.some((c) => text(c) !== '')) continue;
    const email = text(r[iEmail]).toLowerCase();
    const affiliateName = text(r[iAff]);
    const ltv = money(r[iLtv] ?? null);
    const bal = iBal >= 0 ? money(r[iBal] ?? null) : 0;
    if (!email.includes('@') || ltv == null || bal == null) { invalid++; continue; }
    if (!affiliateName) { noAffiliate++; continue; }
    const row = { emailHash: hashEmail(email), affiliateName, lifetimeValueUsd: ltv, balanceUsd: bal };
    const key = `${affiliateName.toLowerCase()}|${row.emailHash}`;
    const prev = byKey.get(key);
    if (!prev || prev.lifetimeValueUsd < ltv) byKey.set(key, row);
  }
  return {
    rows: [...byKey.values()],
    createdFrom: range ? monthDay(range[1]) : null,
    createdTo: range ? monthDay(range[2]) : null,
    reportDate: rd ? isoDay(Number(rd[3]), Number(rd[1]), Number(rd[2])) : null,
    criteria: crit ? crit[1].trim() : null,
    invalid,
    noAffiliate,
  };
}

export interface ImportResult {
  dryRun: boolean;
  reportDate: string;
  createdFrom: string | null;
  createdTo: string | null;
  rows: number;
  created: number;
  updated: number;
  /** Já existe com relatório mais novo — não sobrescreve. */
  stale: number;
  invalid: number;
  noAffiliate: number;
  /** Afiliados do relatório sem empresa de recuperação: não importados. */
  unmappedAffiliates: Record<string, number>;
  byPartner: Array<{ partner: string; affiliateName: string; customers: number; lifetimeValueUsd: number }>;
  /** Empresa informada que não existe em nenhuma marcação de recuperação. */
  unknownPartners: string[];
}

const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * Grava o relatório. Só entra afiliado com empresa: do mapa `partners`
 * (affiliateName → empresa, sem diferenciar maiúscula) ou herdada de import
 * anterior do mesmo affiliateName. O resto volta em unmappedAffiliates — o
 * relatório da loja inteira traz afiliado comum, que não é recuperação.
 */
export async function importRecoveryReport(input: {
  parsed: ParsedReport;
  platformSlug: string;
  partners?: Record<string, string>;
  reportDate?: string | null;
  batchTag: string;
  dryRun?: boolean;
}): Promise<ImportResult | { error: string }> {
  const { parsed, platformSlug } = input;
  const reportDate = parsed.reportDate ?? input.reportDate ?? null;
  if (!reportDate) return { error: 'sem Report Date no arquivo — informe reportDate (YYYY-MM-DD)' };

  const given = new Map<string, string>();
  for (const [k, v] of Object.entries(input.partners ?? {})) {
    if (k.trim() && v.trim()) given.set(k.trim().toLowerCase(), v.trim());
  }
  const names = [...new Set(parsed.rows.map((r) => r.affiliateName))];
  const inherited = await db.recoveryReportCustomer.findMany({
    where: { platformSlug, affiliateName: { in: names }, partner: { not: null } },
    distinct: ['affiliateName'],
    orderBy: { updatedAt: 'desc' },
    select: { affiliateName: true, partner: true },
  });
  const partnerOf = (name: string) =>
    given.get(name.toLowerCase()) ?? inherited.find((i) => i.affiliateName === name)?.partner ?? null;

  const unmappedAffiliates: Record<string, number> = {};
  const rows = parsed.rows.filter((r) => {
    if (partnerOf(r.affiliateName)) return true;
    unmappedAffiliates[r.affiliateName] = (unmappedAffiliates[r.affiliateName] ?? 0) + 1;
    return false;
  });

  const known = new Set(
    (await db.recoveryAffiliate.findMany({ where: { note: { not: null } }, select: { note: true } }))
      .map((r) => (r.note ?? '').trim().toLowerCase()),
  );
  const partnersUsed = [...new Set(rows.map((r) => partnerOf(r.affiliateName)!))];
  const unknownPartners = partnersUsed.filter((p) => !known.has(p.toLowerCase()));

  const existing = new Map<string, { id: string; reportDate: Date }>();
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const found = await db.recoveryReportCustomer.findMany({
      where: { platformSlug, emailHash: { in: chunk.map((r) => r.emailHash) } },
      select: { id: true, affiliateName: true, emailHash: true, reportDate: true },
    });
    for (const f of found) existing.set(`${f.affiliateName}|${f.emailHash}`, { id: f.id, reportDate: f.reportDate });
  }

  const rd = dateOnly(reportDate);
  const toCreate: Prisma.RecoveryReportCustomerCreateManyInput[] = [];
  const toUpdate: Array<{ id: string; data: Prisma.RecoveryReportCustomerUpdateInput }> = [];
  let stale = 0;
  for (const r of rows) {
    const partner = partnerOf(r.affiliateName)!;
    const prev = existing.get(`${r.affiliateName}|${r.emailHash}`);
    if (!prev) {
      toCreate.push({
        platformSlug, affiliateName: r.affiliateName, partner, emailHash: r.emailHash,
        lifetimeValueUsd: new Prisma.Decimal(r.lifetimeValueUsd), balanceUsd: new Prisma.Decimal(r.balanceUsd),
        createdFrom: parsed.createdFrom ? dateOnly(parsed.createdFrom) : null,
        createdTo: parsed.createdTo ? dateOnly(parsed.createdTo) : null,
        reportDate: rd, importBatch: input.batchTag,
      });
    } else if (prev.reportDate.getTime() > rd.getTime()) {
      stale++;
    } else {
      toUpdate.push({
        id: prev.id,
        data: {
          partner, lifetimeValueUsd: new Prisma.Decimal(r.lifetimeValueUsd), balanceUsd: new Prisma.Decimal(r.balanceUsd),
          reportDate: rd, importBatch: input.batchTag,
        },
      });
    }
  }

  if (!input.dryRun) {
    await db.$transaction(async (tx) => {
      for (let i = 0; i < toCreate.length; i += 1000) {
        await tx.recoveryReportCustomer.createMany({ data: toCreate.slice(i, i + 1000), skipDuplicates: true });
      }
      for (const u of toUpdate) await tx.recoveryReportCustomer.update({ where: { id: u.id }, data: u.data });
    }, { timeout: 120_000 });
  }

  const agg = new Map<string, { partner: string; affiliateName: string; customers: number; lifetimeValueUsd: number }>();
  for (const r of rows) {
    const partner = partnerOf(r.affiliateName)!;
    const k = `${partner}|${r.affiliateName}`;
    const a = agg.get(k) ?? { partner, affiliateName: r.affiliateName, customers: 0, lifetimeValueUsd: 0 };
    a.customers++;
    a.lifetimeValueUsd = Math.round((a.lifetimeValueUsd + r.lifetimeValueUsd) * 100) / 100;
    agg.set(k, a);
  }

  return {
    dryRun: input.dryRun === true,
    reportDate, createdFrom: parsed.createdFrom, createdTo: parsed.createdTo,
    rows: parsed.rows.length,
    created: toCreate.length, updated: toUpdate.length, stale,
    invalid: parsed.invalid, noAffiliate: parsed.noAffiliate,
    unmappedAffiliates, byPartner: [...agg.values()], unknownPartners,
  };
}

// ---------- Leitura (sem tela por enquanto) ----------

/**
 * Totais do backfill por empresa/afiliado e por janela do relatório, quantos
 * clientes o dash já conhece (mesmo e-mail em Customer) e de onde eles vieram
 * (afiliado do 1º pedido no dash). Comissão estimada = LTV × % vigente da
 * empresa na plataforma — o LTV é bruto e acumulado, não desconta estorno.
 */
export function recoveryReportSummarySql(platformSlug: string): {
  byPartner: Prisma.Sql; byWindow: Prisma.Sql; origins: Prisma.Sql;
} {
  // Cliente do relatório × Customer do dash pelo md5 do e-mail.
  const matched = Prisma.sql`
    SELECT rc.id AS rc_id, c.id AS customer_id
    FROM "RecoveryReportCustomer" rc
    JOIN "Customer" c ON c.email IS NOT NULL AND md5(lower(trim(c.email))) = rc."emailHash"
    WHERE rc."platformSlug" = ${platformSlug}`;
  return {
    byPartner: Prisma.sql`
      WITH m AS (SELECT DISTINCT rc_id FROM (${matched}) x),
      pct AS (
        SELECT lower(trim(r.note)) AS partner, MAX(r."commissionPct") AS pct
        FROM "RecoveryAffiliate" r
        JOIN "Affiliate" a ON a.id = r."affiliateId"
        JOIN "Platform" pl ON pl.id = a."platformId" AND pl.slug = ${platformSlug}
        WHERE r.enabled AND r.note IS NOT NULL
        GROUP BY 1
      )
      SELECT rc.partner, rc."affiliateName",
             COUNT(*)::int AS customers,
             COUNT(m.rc_id)::int AS "knownInDash",
             SUM(rc."lifetimeValueUsd")::float AS "lifetimeValueUsd",
             SUM(rc."balanceUsd")::float AS "balanceUsd",
             MAX(pct.pct)::float AS "commissionPct",
             ROUND(SUM(rc."lifetimeValueUsd") * COALESCE(MAX(pct.pct), 0), 2)::float AS "commissionUsd",
             to_char(MIN(rc."createdFrom"), 'YYYY-MM-DD') AS "createdFrom",
             to_char(MAX(rc."createdTo"), 'YYYY-MM-DD') AS "createdTo",
             to_char(MAX(rc."reportDate"), 'YYYY-MM-DD') AS "lastReportDate"
      FROM "RecoveryReportCustomer" rc
      LEFT JOIN m ON m.rc_id = rc.id
      LEFT JOIN pct ON pct.partner = lower(trim(rc.partner))
      WHERE rc."platformSlug" = ${platformSlug}
      GROUP BY 1, 2 ORDER BY 5 DESC`,
    byWindow: Prisma.sql`
      SELECT rc.partner, to_char(rc."createdFrom", 'YYYY-MM-DD') AS "createdFrom", to_char(rc."createdTo", 'YYYY-MM-DD') AS "createdTo",
             COUNT(*)::int AS customers, SUM(rc."lifetimeValueUsd")::float AS "lifetimeValueUsd"
      FROM "RecoveryReportCustomer" rc
      WHERE rc."platformSlug" = ${platformSlug}
      GROUP BY 1, 2, 3 ORDER BY 2 DESC NULLS LAST, 1`,
    origins: Prisma.sql`
      WITH m AS (${matched}),
      firsto AS (
        SELECT DISTINCT ON (m.rc_id) m.rc_id, pl.slug AS platform, a."externalId" AS account, a.nickname,
               (r.id IS NOT NULL) AS "isRecoveryAccount"
        FROM m
        JOIN "Order" o ON o."customerId" = m.customer_id
        JOIN "Platform" pl ON pl.id = o."platformId"
        LEFT JOIN "Affiliate" a ON a.id = o."affiliateId"
        LEFT JOIN "RecoveryAffiliate" r ON r."affiliateId" = o."affiliateId"
        ORDER BY m.rc_id, o."orderedAt" ASC
      )
      SELECT rc.partner, f.platform, f.account, f.nickname, f."isRecoveryAccount",
             COUNT(*)::int AS customers, SUM(rc."lifetimeValueUsd")::float AS "lifetimeValueUsd"
      FROM firsto f JOIN "RecoveryReportCustomer" rc ON rc.id = f.rc_id
      GROUP BY 1, 2, 3, 4, 5 ORDER BY 6 DESC LIMIT 30`,
  };
}

export async function recoveryReportSummary(platformSlug = 'buygoods') {
  const q = recoveryReportSummarySql(platformSlug);
  const [byPartner, byWindow, origins] = await Promise.all([
    db.$queryRaw<unknown[]>(q.byPartner),
    db.$queryRaw<unknown[]>(q.byWindow),
    db.$queryRaw<unknown[]>(q.origins),
  ]);
  return { platformSlug, byPartner, byWindow, origins };
}

// ---------- Sugestões de marcação ----------

export interface RecoverySuggestion {
  affiliateId: string;
  affiliateExternalId: string;
  platformSlug: string;
  nickname: string | null;
  /** offer = vendeu produto de recuperação; sibling = mesmo nome de conta marcada. */
  reasons: Array<'offer' | 'sibling'>;
  offerProducts: string[];
  /** Empresa da conta marcada de mesmo nome (pré-preenche o formulário). */
  suggestedPartner: string | null;
  orders: number;
  grossUsd: number;
  lastOrderAt: string;
}

// Oferta de recuperação na BuyGoods = código de produto terminado em sms /
// sms2 (neu6sms, the3sms2…): a página que o parceiro manda por SMS. Venda paga
// disso por conta NÃO marcada quase certamente é comissão de recuperação que
// o dash está contando como venda comum.
export const RECOVERY_OFFER_RE = 'sms[0-9]*$';

export function recoverySuggestionsSql(days = 90): Prisma.Sql {
  // Primeiro o universo pequeno (conta não marcada com venda de oferta OU com
  // nome de conta marcada); só depois agrega os pedidos dela.
  return Prisma.sql`
    WITH marked AS (
      SELECT a."platformId", lower(trim(a.nickname)) AS nick, lower(trim(r.note)) AS company, r.note
      FROM "RecoveryAffiliate" r JOIN "Affiliate" a ON a.id = r."affiliateId"
      WHERE r.enabled
    ),
    offer_sellers AS (
      SELECT DISTINCT o."affiliateId"
      FROM "Order" o
      JOIN "Product" pr ON pr.id = o."productId"
      JOIN "Platform" pl ON pl.id = pr."platformId" AND pl.slug = 'buygoods'
      WHERE pr."externalId" ~* ${RECOVERY_OFFER_RE}
        AND o."affiliateId" IS NOT NULL AND o."grossAmountUsd" > 0
        AND o."orderedAt" >= now() - make_interval(days => ${days}::int)
    ),
    pool AS (
      SELECT a.id, sib.note
      FROM "Affiliate" a
      LEFT JOIN LATERAL (
        SELECT m.note FROM marked m
        WHERE m."platformId" = a."platformId" AND a.nickname IS NOT NULL
          AND lower(trim(a.nickname)) IN (m.nick, m.company)
        LIMIT 1
      ) sib ON true
      WHERE NOT EXISTS (SELECT 1 FROM "RecoveryAffiliate" r WHERE r."affiliateId" = a.id)
        AND (sib.note IS NOT NULL OR a.id IN (SELECT "affiliateId" FROM offer_sellers))
    ),
    cand AS (
      SELECT o."affiliateId",
             COUNT(*)::int AS orders,
             SUM(o."grossAmountUsd")::float AS gross,
             MAX(o."orderedAt") AS last,
             array_agg(DISTINCT pr."externalId") FILTER (WHERE pl.slug = 'buygoods' AND pr."externalId" ~* ${RECOVERY_OFFER_RE}) AS offers
      FROM "Order" o
      JOIN pool ON pool.id = o."affiliateId"
      JOIN "Product" pr ON pr.id = o."productId"
      JOIN "Platform" pl ON pl.id = o."platformId"
      WHERE o."grossAmountUsd" > 0
        AND o."orderedAt" >= now() - make_interval(days => ${days}::int)
      GROUP BY 1
    )
    SELECT a.id AS "affiliateId", a."externalId" AS "affiliateExternalId", pl.slug AS "platformSlug", a.nickname,
           COALESCE(cand.offers, ARRAY[]::text[]) AS "offerProducts", pool.note AS "suggestedPartner",
           cand.orders, cand.gross AS "grossUsd", cand.last AS "lastOrderAt"
    FROM cand
    JOIN pool ON pool.id = cand."affiliateId"
    JOIN "Affiliate" a ON a.id = cand."affiliateId"
    JOIN "Platform" pl ON pl.id = a."platformId"
    ORDER BY cand.gross DESC
    LIMIT 20`;
}

export async function recoverySuggestions(days = 90): Promise<RecoverySuggestion[]> {
  const rows = await db.$queryRaw<Array<{
    affiliateId: string; affiliateExternalId: string; platformSlug: string; nickname: string | null;
    offerProducts: string[]; suggestedPartner: string | null; orders: number; grossUsd: number; lastOrderAt: Date;
  }>>(recoverySuggestionsSql(days));
  return rows.map((r) => ({
    affiliateId: r.affiliateId,
    affiliateExternalId: r.affiliateExternalId,
    platformSlug: r.platformSlug,
    nickname: r.nickname,
    reasons: [
      ...(r.offerProducts.length ? (['offer'] as const) : []),
      ...(r.suggestedPartner ? (['sibling'] as const) : []),
    ],
    offerProducts: r.offerProducts,
    suggestedPartner: r.suggestedPartner,
    orders: r.orders,
    grossUsd: Math.round(r.grossUsd * 100) / 100,
    lastOrderAt: new Date(r.lastOrderAt).toISOString(),
  }));
}
