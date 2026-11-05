import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../../test/pgliteDb';

// Roda de novo a migração 20261105120000 sobre dados semeados (o
// migratedPglite aplica todas com o banco vazio). Roda DUAS vezes pra provar
// que não soma +1 de novo.
const SQL = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20261105120000_vupim_funnel_step_upsell/migration.sql'), 'utf8');

describe('migração Vupim: etapa do upsell +1 e famílias novas', () => {
  let pg: PGlite;
  const order = (id: string, o: Record<string, unknown>) => {
    const cols = {
      id, externalId: id, platformId: 'p_vu', productId: 'pr_fe', currencyOriginal: 'USD', grossAmountOrig: 100,
      grossAmountUsd: 100, eventType: 'x', updatedAt: new Date(), productType: 'FRONTEND', status: 'APPROVED', netAmountUsd: 0,
      orderedAt: new Date('2026-11-01T15:00:00Z'), ...o,
    };
    const keys = Object.keys(cols);
    return pg.query(`INSERT INTO "Order" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  };

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_vu', 'vupim', 'Vupim'), ('p_jv', 'jvzoo', 'JVZoo');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family, verified, "funnelStep") VALUES
        ('pr_fe', 'p_vu', 'fe', 'NeuroRecall - 6 Potes', 'FRONTEND', 'NeuroRecall', false, 0),
        ('pr_up1', 'p_vu', 'u1', 'NeuroRecall - 12 Potes', 'UPSELL', 'NeuroRecall', false, 1),
        ('pr_df', 'p_vu', 'u2', 'NeuroRecall - Digest Flow - 6 Potes', 'UPSELL', 'DigestFlow', false, 2),
        ('pr_nc', 'p_vu', 'u3', 'NeuroRecall - Night Calm - 3 Potes', 'UPSELL', 'NightCalm', false, 3),
        ('pr_ds', 'p_vu', 'd1', 'NeuroRecall - Last Chance 1', 'DOWNSELL', 'NeuroRecall', false, 2),
        ('pr_oto', 'p_vu', 'o3', 'NeuroRecall - OTO3 Night Calm', 'UPSELL', 'NightCalm', false, NULL),
        ('pr_lc', 'p_vu', 'l2', 'NeuroRecall - LastChance2', 'DOWNSELL', 'NeuroRecall', false, NULL),
        ('pr_ver', 'p_vu', 'v', 'NeuroRecall - 9 Potes', 'UPSELL', 'NeuroRecall', true, 2),
        ('pr_jv', 'p_jv', 'j', 'NeuroMind Pro 6 Bottles / OTO1', 'UPSELL', 'NeuroMindPro', false, 2),
        ('f_vu', 'p_vu', 'f1', 'FE - LungFresh (6 Bottles)', 'FRONTEND', NULL, false, 0),
        ('f_jv', 'p_jv', 'f2', 'Lung Fresh - 3 Bottles / OTO1', 'UPSELL', NULL, false, 2),
        ('f_fp', 'p_jv', 'f3', 'FlushPril 6 Bottles / FE', 'FRONTEND', NULL, false, 1),
        ('f_mv', 'p_jv', 'f4', 'MemoVance 6 Bottles / FE', 'FRONTEND', NULL, false, 1),
        ('f_ver', 'p_jv', 'f5', 'LungFresh 2 Bottles', 'FRONTEND', NULL, true, 1),
        ('f_combo', 'p_jv', 'f6', 'LungFresh + FlushPril 6 Bottles', 'UPSELL', NULL, false, NULL),
        ('f_outra', 'p_jv', 'f7', 'LungFresh 9 Bottles', 'UPSELL', 'Outra', false, NULL);
    `);
    await order('FE', { funnelStep: 0 });
    // Pedidos antigos (connector velho): etapa crua da Vupim.
    await order('U1', { productId: 'pr_up1', productType: 'UPSELL', funnelStep: 1, rawMetadata: { funnelStepName: 'Upsell 1' } });
    await order('U2', { productId: 'pr_df', productType: 'UPSELL', funnelStep: 2 });
    await order('U3', { productId: 'pr_nc', productType: 'UPSELL', funnelStep: 3, rawMetadata: { origin: 'upsell' } });
    await order('D1', { productId: 'pr_ds', productType: 'DOWNSELL', funnelStep: 2 });
    // Connector novo já gravou na convenção do painel: não mexe.
    await order('NOVO', { productId: 'pr_nc', productType: 'UPSELL', funnelStep: 4, rawMetadata: { vupimFunnelStep: 3 } });
    // Estorno processado pelo código novo: rawMetadata novo, etapa antiga preservada → +1.
    await order('EST', { productId: 'pr_up1', productType: 'UPSELL', funnelStep: 1, rawMetadata: { vupimFunnelStep: 1 } });
    // Sem etapa: pelo nome da etapa/produto.
    await order('X1', { productId: 'pr_oto', productType: 'UPSELL', funnelStep: null });
    await order('X2', { productId: 'pr_lc', productType: 'DOWNSELL', funnelStep: null });
    await order('X3', { productId: 'pr_up1', productType: 'UPSELL', funnelStep: null, rawMetadata: { funnelStepName: 'Upsell 2' } });
    await order('X4', { productId: 'pr_df', productType: 'UPSELL', funnelStep: null });
    // Outra plataforma: não mexe.
    await order('JV', { platformId: 'p_jv', productId: 'pr_jv', productType: 'UPSELL', funnelStep: 2 });
    await pg.exec(SQL);
    await pg.exec(SQL);
  }, 120_000);
  afterAll(async () => { await pg?.close(); });

  it('upsell da Vupim vira N+1 (uma vez só); downsell, front e JVZoo ficam', async () => {
    const r = (await pg.query<{ id: string; step: number | null; raw: string | null }>(
      `SELECT id, "funnelStep" AS step, "rawMetadata"->>'vupimFunnelStep' AS raw FROM "Order" ORDER BY id`,
    )).rows;
    expect(r).toEqual([
      { id: 'D1', step: 2, raw: null },
      { id: 'EST', step: 2, raw: '1' },
      { id: 'FE', step: 0, raw: null },
      { id: 'JV', step: 2, raw: null },
      { id: 'NOVO', step: 4, raw: '3' },
      { id: 'U1', step: 2, raw: '1' },
      { id: 'U2', step: 3, raw: '2' },
      { id: 'U3', step: 4, raw: '3' },
      { id: 'X1', step: 4, raw: null },
      { id: 'X2', step: 3, raw: null },
      { id: 'X3', step: 3, raw: null },
      { id: 'X4', step: null, raw: null },
    ]);
    const meta = (await pg.query<{ m: Record<string, unknown> }>(`SELECT "rawMetadata" AS m FROM "Order" WHERE id = 'U1'`)).rows[0].m;
    expect(meta).toEqual({ funnelStepName: 'Upsell 1', vupimFunnelStep: 1 });
  });

  it('catálogo da Vupim acompanha a etapa mais comum dos pedidos; verificado não muda', async () => {
    const r = (await pg.query<{ id: string; step: number | null }>(
      `SELECT id, "funnelStep" AS step FROM "Product" WHERE id LIKE 'pr_%' ORDER BY id`,
    )).rows;
    expect(r).toEqual([
      { id: 'pr_df', step: 3 },
      { id: 'pr_ds', step: 2 },
      { id: 'pr_fe', step: 0 },
      { id: 'pr_jv', step: 2 },
      { id: 'pr_lc', step: 3 },
      { id: 'pr_nc', step: 4 },
      { id: 'pr_oto', step: 4 },
      { id: 'pr_up1', step: 2 },
      { id: 'pr_ver', step: 2 },
    ]);
  });

  it('família vazia ganha LungFresh/FlushPril/Memovance PRO pelo nome, em qualquer plataforma', async () => {
    const r = (await pg.query<{ id: string; family: string | null }>(
      `SELECT id, family FROM "Product" WHERE id LIKE 'f_%' ORDER BY id`,
    )).rows;
    expect(r).toEqual([
      { id: 'f_combo', family: null },
      { id: 'f_fp', family: 'FlushPril' },
      { id: 'f_jv', family: 'LungFresh' },
      { id: 'f_mv', family: 'Memovance PRO' },
      { id: 'f_outra', family: 'Outra' },
      { id: 'f_ver', family: null },
      { id: 'f_vu', family: 'LungFresh' },
    ]);
  });
});
