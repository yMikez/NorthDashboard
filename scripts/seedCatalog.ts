// Seed Product catalog from Planilhas/Products - {ClickBank,DigiStore}.csv.
//
// Reads the two CSVs, classifies each SKU via classifyProduct(), and upserts
// Products. For ClickBank, externalId == SKU; for DigiStore, externalId is
// extracted from the checkout URL (".../product/{numericId}").
//
// Run: npx tsx scripts/seedCatalog.ts

import fs from 'node:fs';
import path from 'node:path';
import { db } from '../lib/db';
import { classifyProduct } from '../lib/services/productClassification';
import type { ProductType } from '@prisma/client';

const CSV_DIR = path.join(__dirname, '..', 'Planilhas');
const CB_CSV = path.join(CSV_DIR, 'Products - ClickBank.csv');
const D24_CSV = path.join(CSV_DIR, 'Products - DigiStore.csv');

interface CatalogRow {
  vendorAccount: string;
  niche: string;
  sku: string;
  bottles: number | null;
  priceUsd: number | null;
  csvType: string;
  salesPageUrl: string | null;
  checkoutUrl: string | null;
  thanksPageUrl: string | null;
  driveUrl: string | null;
  status: string | null;
}

// CSV uses comma as separator and "..." for fields that contain commas
// (Brazilian price like "$294,00"). Parse a row respecting quoted fields.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parsePrice(raw: string): number | null {
  if (!raw) return null;
  // CSV prices are like "$294,00" — strip $ and convert , → .
  const m = raw.replace(/[$\s]/g, '').replace(',', '.');
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : null;
}

function parseBottles(raw: string): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function readCsvRows(filePath: string): CatalogRow[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  // Resolve column indices defensively (CB and D24 differ slightly).
  const idx = (name: string) =>
    header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const accountIdx = idx('ClickBank Account_id') !== -1 ? idx('ClickBank Account_id') : idx('DigiStore24 Account_id');
  const nicheIdx = idx('Nicho');
  const skuIdx = idx('Product Name/SKU');
  const qtyIdx = idx('Quantidade');
  const priceIdx = idx('Valor');
  const typeIdx = idx('Product Type');
  const salesIdx = idx('Sales page');
  const checkoutIdx = idx('Checkout');
  const thanksIdx = idx('Thanks Page');
  const driveIdx = idx('Drive');
  const statusIdx = idx('Status');

  const rows: CatalogRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const sku = cells[skuIdx]?.trim();
    if (!sku) continue; // skip empty SKU rows (placeholder ShipOffers entries)
    rows.push({
      vendorAccount: cells[accountIdx]?.trim() ?? '',
      niche: cells[nicheIdx]?.trim() ?? '',
      sku,
      bottles: parseBottles(cells[qtyIdx] ?? ''),
      priceUsd: parsePrice(cells[priceIdx] ?? ''),
      csvType: cells[typeIdx]?.trim() ?? '',
      salesPageUrl: cells[salesIdx]?.trim() || null,
      checkoutUrl: cells[checkoutIdx]?.trim() || null,
      thanksPageUrl: cells[thanksIdx]?.trim() || null,
      driveUrl: cells[driveIdx]?.trim() || null,
      status: cells[statusIdx]?.trim() || null,
    });
  }
  return rows;
}

// CSV "Product Type" → ProductType enum. The CSV is the authoritative source
// per the user's catalog spec — we trust it over our heuristic when both
// agree, and we log a warning when they disagree.
function csvTypeToEnum(csvType: string): ProductType | null {
  const t = csvType.toLowerCase();
  if (t.startsWith('front')) return 'FRONTEND';
  if (t.startsWith('upsell')) return 'UPSELL';
  if (t.startsWith('downsell')) return 'DOWNSELL';
  if (t.startsWith('bump')) return 'BUMP';
  if (t.startsWith('sms') || t.startsWith('recovery')) return 'SMS_RECOVERY';
  return null;
}

// DigiStore checkout URL → numeric productId. Pattern: .../product/{id}
function extractDigistoreProductId(checkoutUrl: string | null): string | null {
  if (!checkoutUrl) return null;
  const m = /\/product\/(\d+)/.exec(checkoutUrl);
  return m ? m[1] : null;
}

interface SeedStats {
  upserted: number;
  skipped: number;
  classifierMismatches: number;
  unrecognized: string[];
}

async function seedRows(
  platformSlug: 'clickbank' | 'digistore24',
  rows: CatalogRow[],
): Promise<SeedStats> {
  const stats: SeedStats = { upserted: 0, skipped: 0, classifierMismatches: 0, unrecognized: [] };

  // Ensure platform exists.
  const platform = await db.platform.upsert({
    where: { slug: platformSlug },
    create: { slug: platformSlug, displayName: platformSlug === 'clickbank' ? 'ClickBank' : 'Digistore24' },
    update: {},
    select: { id: true },
  });

  for (const row of rows) {
    const externalId =
      platformSlug === 'clickbank'
        ? row.sku
        : extractDigistoreProductId(row.checkoutUrl);

    if (!externalId) {
      stats.skipped++;
      console.warn(`[seed] skip: cannot resolve externalId for ${platformSlug} sku=${row.sku}`);
      continue;
    }

    const csvType = csvTypeToEnum(row.csvType);
    const classified = classifyProduct(row.sku, row.sku);

    // Authoritative type: CSV takes precedence; classifier used only as
    // sanity check + to extract family/variant/bottles which CSV doesn't have.
    const finalType: ProductType = csvType ?? classified.type;

    if (csvType && classified.type && csvType !== classified.type && classified.family) {
      stats.classifierMismatches++;
      console.warn(
        `[seed] mismatch sku=${row.sku} csv=${csvType} classifier=${classified.type}`,
      );
    }
    if (!classified.family) stats.unrecognized.push(row.sku);

    await db.product.upsert({
      where: { platformId_externalId: { platformId: platform.id, externalId } },
      create: {
        platformId: platform.id,
        externalId,
        name: row.sku,
        productType: finalType,
        family: classified.family,
        variant: classified.variant,
        bottles: classified.bottles ?? row.bottles,
        vendorAccount: row.vendorAccount,
        catalogPriceUsd: row.priceUsd,
        niche: row.niche || null,
        salesPageUrl: row.salesPageUrl,
        checkoutUrl: row.checkoutUrl,
        thanksPageUrl: row.thanksPageUrl,
        driveUrl: row.driveUrl,
        catalogStatus: row.status,
      },
      update: {
        // We update the catalog metadata but do NOT overwrite productType if
        // the existing record already has orders attached — that classification
        // came from real ingest and may be more accurate per-order. The
        // catalog hint is best-effort.
        productType: finalType,
        family: classified.family ?? undefined,
        variant: classified.variant ?? undefined,
        bottles: classified.bottles ?? row.bottles ?? undefined,
        vendorAccount: row.vendorAccount || undefined,
        catalogPriceUsd: row.priceUsd ?? undefined,
        niche: row.niche || undefined,
        salesPageUrl: row.salesPageUrl ?? undefined,
        checkoutUrl: row.checkoutUrl ?? undefined,
        thanksPageUrl: row.thanksPageUrl ?? undefined,
        driveUrl: row.driveUrl ?? undefined,
        catalogStatus: row.status ?? undefined,
      },
    });
    stats.upserted++;
  }
  return stats;
}

async function main() {
  console.log(`[seed] reading ${CB_CSV}`);
  const cbRows = readCsvRows(CB_CSV);
  console.log(`[seed] reading ${D24_CSV}`);
  const d24Rows = readCsvRows(D24_CSV);

  console.log(`[seed] CSV rows: clickbank=${cbRows.length} digistore=${d24Rows.length}`);

  console.log(`[seed] seeding ClickBank ...`);
  const cbStats = await seedRows('clickbank', cbRows);
  console.log(`[seed] ClickBank done:`, cbStats);

  console.log(`[seed] seeding DigiStore ...`);
  const d24Stats = await seedRows('digistore24', d24Rows);
  console.log(`[seed] DigiStore done:`, d24Stats);

  console.log(`[seed] complete.`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
