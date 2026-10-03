// SQL da aba VSLs no Postgres embutido (todas as migrações): upsert da visita
// (beacon), visitas agregadas, venda confirmada BuyGoods e venda real da etapa.
import type { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { migratedPglite } from '../test/pgliteDb';
import { linkedRowsSql, realRowsSql, visitRowsSql } from './vslPerformance';
import { visitUpsertSql } from './vsl';
import { Prisma as P } from '@prisma/client';

const run = <T,>(db: PGlite, sql: Prisma.Sql) => db.query<T>(sql.text, sql.values as unknown[]);

async function insert(db: PGlite, table: string, values: Record<string, unknown>) {
  const cols = await db.query<{ column_name: string; data_type: string; udt_name: string }>(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns
      WHERE table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL`, [table]);
  const row: Record<string, unknown> = { ...values };
  for (const c of cols.rows) {
    if (c.column_name in row) continue;
    if (c.data_type === 'USER-DEFINED') {
      const e = await db.query<{ enumlabel: string }>(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, [c.udt_name]);
      row[c.column_name] = e.rows[0]?.enumlabel;
    } else if (/char|text/.test(c.data_type)) row[c.column_name] = `x-${c.column_name}`;
    else if (/numeric|integer|bigint|double|real|smallint/.test(c.data_type)) row[c.column_name] = 0;
    else if (c.data_type === 'boolean') row[c.column_name] = false;
    else if (/timestamp|date/.test(c.data_type)) row[c.column_name] = new Date('2026-10-01T12:00:00Z');
    else if (/json/.test(c.data_type)) row[c.column_name] = '{}';
  }
  const keys = Object.keys(row);
  await db.query(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => row[k]));
}

let n = 0;
async function order(db: PGlite, o: { plat: string; prod: string; type: string; ext?: string; parent?: string | null; session?: string | null; step?: number | null; gross: number; at: string; status?: string }) {
  n += 1;
  await insert(db, 'Order', {
    id: `o${n}`, platformId: o.plat, productId: o.prod, externalId: o.ext ?? `e${n}`, parentExternalId: o.parent ?? null,
    funnelSessionId: o.session ?? null, productType: o.type, funnelStep: o.step ?? null, grossAmountUsd: o.gross,
    status: o.status ?? 'APPROVED', orderedAt: new Date(o.at),
  });
}

describe('SQL da aba VSLs', () => {
  let db: PGlite;
  const START = new Date('2026-10-04T03:00:00Z'); // 04/10 BRT
  const END = new Date('2026-10-06T02:59:59Z');   // fim de 05/10 BRT

  beforeAll(async () => {
    db = await migratedPglite();
    await insert(db, 'Platform', { id: 'jv', slug: 'jvzoo' });
    await insert(db, 'Platform', { id: 'bg', slug: 'buygoods' });
    await insert(db, 'Product', { id: 'ge_fe', platformId: 'jv', externalId: 'ge-fe', family: 'GlycoEden' });
    await insert(db, 'Product', { id: 'ge_up', platformId: 'jv', externalId: 'ge-up', family: 'GlycoEden' });
    await insert(db, 'Product', { id: 'nc_up', platformId: 'jv', externalId: 'nc-up', family: 'NightCalm' });
    await insert(db, 'Product', { id: 'bg_fe', platformId: 'bg', externalId: 'neu6', family: 'GlycoEden' });
    await insert(db, 'Product', { id: 'bg_up', platformId: 'bg', externalId: 'neu6u', family: 'GlycoEden' });
    await insert(db, 'Product', { id: 'ge_fe6', platformId: 'jv', externalId: 'ge-fe6', family: 'GlycoEden', bottles: 6 });
    await insert(db, 'Product', { id: 'ge_fe3', platformId: 'jv', externalId: 'ge-fe3', family: 'GlycoEden', bottles: 3 });
    // Variantes do mesmo Upsell 1: quem levou 6 potes × quem levou 2–3.
    await insert(db, 'VslPage', { id: 'p_v6', key: 'glycoeden-up01-jvzoo-6potes', family: 'GlycoEden', stage: 'UP01', platform: 'jvzoo', variant: '6 potes', feBottles: [6], updatedAt: new Date() });
    await insert(db, 'VslPage', { id: 'p_v23', key: 'glycoeden-up01-jvzoo-23potes', family: 'GlycoEden', stage: 'UP01', platform: 'jvzoo', variant: '2–3 potes', feBottles: [2, 3], updatedAt: new Date() });
    await insert(db, 'VslPage', { id: 'p_jv', key: 'glycoeden-up01-jvzoo', family: 'GlycoEden', stage: 'UP01', platform: 'jvzoo', updatedAt: new Date() });
    await insert(db, 'VslPage', { id: 'p_bg', key: 'glycoeden-up01-buygoods', family: 'GlycoEden', stage: 'UP01', platform: 'buygoods', updatedAt: new Date() });

    // JVZoo, dia 04/10 BRT: 3 sessões com FE.
    await order(db, { plat: 'jv', prod: 'ge_fe', type: 'FRONTEND', ext: 's1', gross: 69, at: '2026-10-04T15:00:00Z' });
    await order(db, { plat: 'jv', prod: 'ge_up', type: 'UPSELL', parent: 's1', step: 2, gross: 147, at: '2026-10-04T15:05:00Z' }); // UP01 ✓
    await order(db, { plat: 'jv', prod: 'ge_fe', type: 'FRONTEND', ext: 's2', gross: 69, at: '2026-10-04T16:00:00Z' });
    await order(db, { plat: 'jv', prod: 'ge_up', type: 'UPSELL', parent: 's2', step: 3, gross: 99, at: '2026-10-04T16:06:00Z' }); // UP02 ✗
    await order(db, { plat: 'jv', prod: 'ge_fe', type: 'FRONTEND', ext: 's3', gross: 69, at: '2026-10-04T17:00:00Z' });
    await order(db, { plat: 'jv', prod: 'nc_up', type: 'UPSELL', parent: 's3', step: 2, gross: 120, at: '2026-10-04T17:04:00Z' }); // cross-sell no UP01 ✓
    await order(db, { plat: 'jv', prod: 'ge_up', type: 'UPSELL', parent: 's3', step: 2, gross: 147, at: '2026-10-04T17:05:00Z', status: 'REFUNDED' }); // ✗
    // FE de ontem (03/10 BRT) com upsell hoje: conta a venda, não a sessão de hoje.
    await order(db, { plat: 'jv', prod: 'ge_fe', type: 'FRONTEND', ext: 's0', gross: 69, at: '2026-10-04T01:00:00Z' });
    await order(db, { plat: 'jv', prod: 'ge_up', type: 'UPSELL', parent: 's0', step: 2, gross: 147, at: '2026-10-04T03:30:00Z' });

    // Dia 05/10: 2 FEs de 6 potes (1 compra o UP01) e 1 FE de 3 potes (compra o UP01).
    await order(db, { plat: 'jv', prod: 'ge_fe6', type: 'FRONTEND', ext: 'v6a', gross: 294, at: '2026-10-05T15:00:00Z' });
    await order(db, { plat: 'jv', prod: 'ge_up', type: 'UPSELL', parent: 'v6a', step: 2, gross: 147, at: '2026-10-05T15:05:00Z' });
    await order(db, { plat: 'jv', prod: 'ge_fe6', type: 'FRONTEND', ext: 'v6b', gross: 294, at: '2026-10-05T16:00:00Z' });
    await order(db, { plat: 'jv', prod: 'ge_fe3', type: 'FRONTEND', ext: 'v3a', gross: 177, at: '2026-10-05T17:00:00Z' });
    await order(db, { plat: 'jv', prod: 'ge_up', type: 'UPSELL', parent: 'v3a', step: 2, gross: 99, at: '2026-10-05T17:04:00Z' });

    // BuyGoods: sessão sess-1 comprou o UP01 depois da visita.
    await order(db, { plat: 'bg', prod: 'bg_fe', type: 'FRONTEND', ext: 'b1', session: 'sess-1', gross: 79, at: '2026-10-05T12:00:00Z' });
    await order(db, { plat: 'bg', prod: 'bg_up', type: 'UPSELL', ext: 'b2', session: 'sess-1', step: 2, gross: 197.8, at: '2026-10-05T12:06:00Z' });

    const ev = (visitId: string, pageId: string, platform: string, type: string, extra: Partial<Parameters<typeof visitUpsertSql>[0]> = {}) =>
      run(db, visitUpsertSql({ visitId, pageId, vslId: 'vsl_b', testId: null, armId: null, platform, sessionKey: null, pageUrl: 'getglycoeden.com/jv/Up01/', type, second: 0, ...extra }));
    await ev('visit00001', 'p_bg', 'buygoods', 'view', { sessionKey: 'sessid2:sess-1' });
    await ev('visit00001', 'p_bg', 'buygoods', 'play', { second: 30 });
    await ev('visit00001', 'p_bg', 'buygoods', 'pitch', { second: 420 });
    await ev('visit00001', 'p_bg', 'buygoods', 'progress', { second: 200 }); // menor: não desce
    await ev('visit00001', 'p_bg', 'buygoods', 'accept', { second: 421 });
    await ev('visit00002', 'p_bg', 'buygoods', 'view', { sessionKey: 'sessid2:sess-9' });
    await ev('visit00002', 'p_jv', 'jvzoo', 'accept'); // página trocada: ignorado
    await ev('visit00003', 'p_bg', 'buygoods', 'view', { sessionKey: 'sessid2:sess-1' }); // mesma sessão, outra aba
    await db.query(`UPDATE "VslVisit" SET "firstAt" = '2026-10-05T12:00:00Z'`);
  }, 120_000);

  it('upsert da visita: cada evento só preenche o vazio e o segundo máximo nunca desce', async () => {
    const r = await db.query<{ id: string; playAt: unknown; pitchAt: unknown; acceptAt: unknown; maxSecond: number; sessionKey: string | null }>(
      `SELECT id, "playAt", "pitchAt", "acceptAt", "maxSecond", "sessionKey" FROM "VslVisit" ORDER BY id`);
    expect(r.rows[0]).toMatchObject({ id: 'visit00001', maxSecond: 421, sessionKey: 'sessid2:sess-1' });
    expect(r.rows[0].playAt && r.rows[0].pitchAt && r.rows[0].acceptAt).toBeTruthy();
    expect(r.rows[1]).toMatchObject({ id: 'visit00002', acceptAt: null });
  });

  it('visitas agregadas por página, VSL e dia BRT', async () => {
    const r = await run<{ pageId: string; day: string; visits: number; plays: number; pitch: number; accepts: number }>(db, visitRowsSql({ start: START, end: END }));
    expect(r.rows).toEqual([expect.objectContaining({ pageId: 'p_bg', day: '2026-10-05', visits: 3, plays: 1, pitch: 1, accepts: 1, accepts_pitch: 1 })]);
    const onlyJv = await run(db, visitRowsSql({ start: START, end: END, platforms: ['jvzoo'] }));
    expect(onlyJv.rows).toEqual([]);
  });

  it('BuyGoods: visita casada com a venda da etapa pelo sessid2 (uma vez por sessão)', async () => {
    const where = P.sql`v."firstAt" >= ${START} AND v."firstAt" <= ${END}`;
    const r = await run<{ pageId: string; sold: number; revenue: number }>(db, linkedRowsSql(where));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ pageId: 'p_bg', sold: 1 });
    expect(Number(r.rows[0].revenue)).toBeCloseTo(197.8, 2);
  });

  it('venda real da etapa: família do FE da sessão (cross-sell entra), só aprovada, etapa certa', async () => {
    const r = await run<{ pageId: string; day: string; fe: number; sales: number; revenue: number }>(db, realRowsSql({ start: START, end: END }));
    const jv = r.rows.filter((x) => x.pageId === 'p_jv' && x.day === '2026-10-04');
    expect(jv).toEqual([expect.objectContaining({ day: '2026-10-04', fe: 3, sales: 3 })]);
    expect(Number(jv[0].revenue)).toBeCloseTo(147 + 120 + 147, 2);
    const bg = r.rows.find((x) => x.pageId === 'p_bg')!;
    expect(bg).toMatchObject({ day: '2026-10-05', fe: 1, sales: 1 });
  });

  it('variantes: a venda real se separa pelos potes do front', async () => {
    const r = await run<{ pageId: string; day: string; fe: number; sales: number; revenue: number }>(db, realRowsSql({ start: START, end: END }));
    const day5 = (id: string) => r.rows.find((x) => x.pageId === id && x.day === '2026-10-05');
    expect(day5('p_v6')).toMatchObject({ fe: 2, sales: 1 });
    expect(Number(day5('p_v6')!.revenue)).toBeCloseTo(147, 2);
    expect(day5('p_v23')).toMatchObject({ fe: 1, sales: 1 });
    expect(Number(day5('p_v23')!.revenue)).toBeCloseTo(99, 2);
    // página sem condição de potes continua vendo a etapa inteira
    expect(day5('p_jv')).toMatchObject({ fe: 3, sales: 2 });
  });

  it('filtro de etapa e família', async () => {
    const none = await run(db, realRowsSql({ start: START, end: END, stage: 'UP02' }));
    expect(none.rows).toEqual([]);
    const fam = await run(db, realRowsSql({ start: START, end: END, families: ['NightCalm'] }));
    expect(fam.rows).toEqual([]);
  });
});
