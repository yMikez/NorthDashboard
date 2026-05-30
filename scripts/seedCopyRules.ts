// Seed das regras de Copy Optimizer extraídas do COPYB2_AFFILIATES atual
// (js/utm-webhook.js do Upsell01). Roda 1x no deploy inicial. Idempotente:
// se a regra já existe, NÃO sobrescreve — pode ser que o admin já tenha
// ajustado o % via painel e não queremos resetar a cada deploy.
//
//   npm run seed:copy-rules

import { db } from '../lib/db';

const SEED: Array<{ key: string; keyType: 'id' | 'name'; black2Pct: number }> = [
  { key: '46', keyType: 'id', black2Pct: 100 },
  { key: '4214', keyType: 'id', black2Pct: 100 },
  { key: 'Matheus Petersen', keyType: 'name', black2Pct: 100 },
  { key: 'KLINSMAN PEREIRA', keyType: 'name', black2Pct: 100 },
];

async function main() {
  let created = 0;
  for (const r of SEED) {
    const existing = await db.affiliateCopyRule.findUnique({
      where: { key: r.key },
      select: { id: true },
    });
    if (existing) {
      console.log(`[seedCopyRules] regra "${r.key}" já existe — não tocando.`);
      continue;
    }
    await db.affiliateCopyRule.create({
      data: { ...r, updatedBy: 'seed' },
    });
    created++;
    console.log(`[seedCopyRules] criada "${r.key}" (${r.keyType}, ${r.black2Pct}%).`);
  }
  console.log(`[seedCopyRules] done — ${created} criadas, ${SEED.length - created} já existiam.`);
}

main()
  .catch((err) => {
    console.error('[seedCopyRules] falhou:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
