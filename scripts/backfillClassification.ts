// CLI wrapper around classifyExistingProducts(). Runs once at container
// startup (Dockerfile CMD chain) to classify any Products that came in via
// IPN before the family/variant/bottles columns existed. Idempotent.
//
// Run: npx tsx scripts/backfillClassification.ts

import { db } from '../lib/db';
import { classifyExistingProducts } from '../lib/services/classifyExistingProducts';

async function main() {
  console.log('[backfill] starting product classification backfill');
  const stats = await classifyExistingProducts();
  console.log('[backfill] done:', JSON.stringify(stats));
  if (stats.unrecognized.length > 0) {
    console.warn(`[backfill] ${stats.unrecognized.length} products did not match any known SKU pattern:`);
    for (const sku of stats.unrecognized.slice(0, 20)) {
      console.warn(`  - ${sku}`);
    }
    if (stats.unrecognized.length > 20) {
      console.warn(`  ... and ${stats.unrecognized.length - 20} more`);
    }
  }
}

main()
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
