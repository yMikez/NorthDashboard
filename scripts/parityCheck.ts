// Prova de paridade Fase B: compara as implementações legacy (agregação em
// JS) vs SQL pushdown de getAffiliates e getProducts numa matriz de filtros.
//
// Uso:
//   DATABASE_URL="postgresql://dashboard:dashboard@localhost:5432/dashboard" npx tsx scripts/parityCheck.ts
//
// Critério de merge: zero diffs, OU diffs explicáveis apenas pelos
// empates documentados (FE da sessão com orderedAt idêntico, topCountry
// empatado, vendorAccount multi-valor, sparkline pré-período — todos
// não-determinísticos na legacy). Cada diff é impresso com o path completo.

import {
  getAffiliatesLegacy,
  getAffiliatesSql,
  getProductsLegacy,
  getProductsSql,
  type MetricsFilters,
} from '../lib/services/metrics';
import { db } from '../lib/db';

const DAY = 24 * 3600 * 1000;

// Fronteiras alinhadas a dia BRT (03:00 UTC) — mesmas que o front manda.
function brtRange(days: number): { startDate: Date; endDate: Date } {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endDate = new Date(utcMidnight + DAY + 3 * 3600 * 1000 - 1); // amanhã 02:59:59.999 UTC
  const startDate = new Date(utcMidnight - (days - 1) * DAY + 3 * 3600 * 1000);
  return { startDate, endDate };
}

interface Case { label: string; filters: MetricsFilters }

async function buildCases(): Promise<Case[]> {
  // Pega valores reais do banco pra montar a matriz de filtros.
  const [platform, family, country] = await Promise.all([
    db.platform.findFirst({ select: { slug: true } }),
    db.product.findFirst({ where: { family: { not: null } }, select: { family: true } }),
    db.order.findFirst({ where: { country: { not: null } }, select: { country: true } }),
  ]);
  const cases: Case[] = [];
  for (const days of [7, 30, 90]) {
    const range = brtRange(days);
    cases.push({ label: `${days}d sem filtro`, filters: { ...range } });
    if (platform) {
      cases.push({ label: `${days}d platform=${platform.slug}`, filters: { ...range, platformSlugs: [platform.slug] } });
    }
    if (family?.family) {
      cases.push({ label: `${days}d family=${family.family}`, filters: { ...range, productFamilies: [family.family] } });
    }
    if (country?.country) {
      cases.push({ label: `${days}d country=${country.country}`, filters: { ...range, countries: [country.country] } });
    }
    cases.push({ label: `${days}d stage=FRONTEND`, filters: { ...range, productTypes: ['FRONTEND'] } });
    if (platform && family?.family) {
      cases.push({
        label: `${days}d combinado`,
        filters: { ...range, platformSlugs: [platform.slug], productFamilies: [family.family] },
      });
    }
  }
  return cases;
}

type Diff = { path: string; legacy: unknown; sql: unknown };

function deepDiff(a: unknown, b: unknown, path: string, out: Diff[], limit = 50): void {
  if (out.length >= limit) return;
  if (a === b) return;
  if (typeof a === 'number' && typeof b === 'number') {
    // Tolerância de 1 centavo pra drift float JS-sum vs numeric-sum SQL.
    if (Math.abs(a - b) <= 0.011) return;
    out.push({ path, legacy: a, sql: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push({ path: `${path}.length`, legacy: a.length, sql: b.length });
      return;
    }
    for (let i = 0; i < a.length; i++) deepDiff(a[i], b[i], `${path}[${i}]`, out, limit);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      deepDiff(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
        out,
        limit,
      );
    }
    return;
  }
  out.push({ path, legacy: a, sql: b });
}

// Ordena por chave estável (não por revenue — empate de sort não é diff real).
function sortAffiliates(r: Awaited<ReturnType<typeof getAffiliatesSql>>) {
  return {
    summary: r.summary,
    affiliates: [...r.affiliates].sort((x, y) =>
      `${x.platformSlug}:${x.externalId}`.localeCompare(`${y.platformSlug}:${y.externalId}`),
    ),
  };
}
function sortProducts(r: Awaited<ReturnType<typeof getProductsSql>>) {
  return {
    byType: r.byType,
    products: [...r.products].sort((x, y) =>
      `${x.platformSlug}:${x.externalId}`.localeCompare(`${y.platformSlug}:${y.externalId}`),
    ),
  };
}

async function main() {
  const cases = await buildCases();
  let totalDiffs = 0;

  for (const c of cases) {
    const [affLegacy, affSql] = [await getAffiliatesLegacy(c.filters), await getAffiliatesSql(c.filters)];
    const affDiffs: Diff[] = [];
    deepDiff(sortAffiliates(affLegacy), sortAffiliates(affSql), 'affiliates', affDiffs);

    const [prodLegacy, prodSql] = [await getProductsLegacy(c.filters), await getProductsSql(c.filters)];
    const prodDiffs: Diff[] = [];
    deepDiff(sortProducts(prodLegacy), sortProducts(prodSql), 'products', prodDiffs);

    const n = affDiffs.length + prodDiffs.length;
    totalDiffs += n;
    const status = n === 0 ? 'OK ' : `${n} DIFFS`;
    console.log(`[${status}] ${c.label}  (affiliates=${affSql.affiliates.length}, products=${prodSql.products.length})`);
    for (const d of [...affDiffs, ...prodDiffs].slice(0, 20)) {
      console.log(`    ${d.path}: legacy=${JSON.stringify(d.legacy)} sql=${JSON.stringify(d.sql)}`);
    }
  }

  console.log(totalDiffs === 0
    ? '\n✅ PARIDADE TOTAL — zero diffs em todos os casos.'
    : `\n❌ ${totalDiffs} diffs — analisar se são os empates documentados.`);
  await db.$disconnect();
  process.exit(totalDiffs === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
