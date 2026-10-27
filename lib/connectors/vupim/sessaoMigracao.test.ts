import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../../test/pgliteDb';

// Roda de novo a migração 20261027160000 sobre dados semeados: o
// migratedPglite aplica todas com o banco vazio, então aqui a lógica dela
// (família e corrente de sessão) é exercitada de verdade.
const SQL = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20261027160000_vupim_familia_e_sessao/migration.sql'), 'utf8');

describe('migração Vupim: família do produto entregue + sessão pela corrente', () => {
  let pg: PGlite;
  const order = (id: string, o: Record<string, unknown>) => {
    const cols = {
      id, externalId: id, platformId: 'p_vu', productId: 'pr_front', currencyOriginal: 'USD', grossAmountOrig: 100,
      grossAmountUsd: 100, eventType: 'x', updatedAt: new Date(), productType: 'FRONTEND', status: 'APPROVED', netAmountUsd: 0,
      orderedAt: new Date('2026-10-20T15:00:00Z'), ...o,
    };
    const keys = Object.keys(cols);
    return pg.query(`INSERT INTO "Order" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  };

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_vu', 'vupim', 'Vupim');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family, verified) VALUES
        ('pr_front', 'p_vu', 'f', 'NeuroRecall - 6 Potes', 'FRONTEND', 'NeuroRecall', false),
        ('pr_up', 'p_vu', 'u', 'NeuroRecall - 12 Potes', 'UPSELL', 'NeuroRecall', false),
        ('pr_df', 'p_vu', 'd', 'NeuroRecall - Digest Flow - 6 Potes', 'UPSELL', 'NeuroRecall + DigestFlow', false),
        ('pr_ok', 'p_vu', 'v', 'GlycoEden - Gelazen 9 Bottles', 'UPSELL', 'GlycoEden + Gelazen', true);
    `);
    // FE e UP1 na sessão S1; o Digest Flow (passo 3) veio com sessão nova S2
    // e aponta pro UP1; o Night Calm (passo 4) aponta pro Digest Flow.
    await order('FE', { parentExternalId: 'S1', funnelSessionId: 'S1' });
    await order('UP1', { productId: 'pr_up', productType: 'UPSELL', parentExternalId: 'S1', funnelSessionId: 'S1', rawMetadata: { parentTransactionId: 'FE' } });
    await order('UP2', { productId: 'pr_df', productType: 'UPSELL', parentExternalId: 'S2', funnelSessionId: 'S2', rawMetadata: { parentTransactionId: 'UP1' } });
    await order('UP3', { productId: 'pr_df', productType: 'UPSELL', parentExternalId: 'S3', funnelSessionId: 'S3', rawMetadata: { parentTransactionId: 'UP2' } });
    // Renovação ancora em si mesma: não entra na corrente.
    await order('REN', { parentExternalId: 'REN', funnelSessionId: 'REN', rawMetadata: { parentTransactionId: 'FE', origin: 'renewal' } });
    await pg.exec(SQL);
  }, 120_000);
  afterAll(async () => { await pg?.close(); });

  it('upsell de outro produto herda a sessão do front, subindo a corrente', async () => {
    const r = (await pg.query<{ id: string; s: string; f: string }>(`SELECT id, "parentExternalId" AS s, "funnelSessionId" AS f FROM "Order" ORDER BY id`)).rows;
    expect(r).toEqual([
      { id: 'FE', s: 'S1', f: 'S1' },
      { id: 'REN', s: 'REN', f: 'REN' },
      { id: 'UP1', s: 'S1', f: 'S1' },
      { id: 'UP2', s: 'S1', f: 'S1' },
      { id: 'UP3', s: 'S1', f: 'S1' },
    ]);
  });

  it('família do produto entregue e potes; produto verificado não muda', async () => {
    const r = (await pg.query<{ id: string; family: string; bottles: number | null }>(`SELECT id, family, bottles FROM "Product" ORDER BY id`)).rows;
    expect(r).toEqual([
      { id: 'pr_df', family: 'DigestFlow', bottles: 6 },
      { id: 'pr_front', family: 'NeuroRecall', bottles: 6 },
      { id: 'pr_ok', family: 'GlycoEden + Gelazen', bottles: null },
      { id: 'pr_up', family: 'NeuroRecall', bottles: 12 },
    ]);
  });
});
