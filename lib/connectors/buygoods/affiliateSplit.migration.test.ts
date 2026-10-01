// Migração 20261001120000_buygoods_affiliate_per_store no Postgres embutido:
// contas BuyGoods que somavam pessoas de lojas diferentes são separadas por
// loja, os pedidos vão junto e a marca de recuperação ambígua é desativada.
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { migratedPglite } from '../../test/pgliteDb';

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261001120000_buygoods_affiliate_per_store/migration.sql'),
  'utf8',
);

/** Insere preenchendo as colunas NOT NULL sem default com valor neutro do tipo. */
async function insert(db: PGlite, table: string, values: Record<string, unknown>) {
  const cols = await db.query<{ column_name: string; data_type: string; udt_name: string }>(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns
      WHERE table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL`,
    [table],
  );
  const row: Record<string, unknown> = { ...values };
  for (const c of cols.rows) {
    if (c.column_name in row) continue;
    if (c.data_type === 'USER-DEFINED') {
      const e = await db.query<{ enumlabel: string }>(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
        [c.udt_name],
      );
      row[c.column_name] = e.rows[0]?.enumlabel;
    } else if (/char|text/.test(c.data_type)) row[c.column_name] = `x-${c.column_name}`;
    else if (/numeric|integer|bigint|double|real|smallint/.test(c.data_type)) row[c.column_name] = 0;
    else if (c.data_type === 'boolean') row[c.column_name] = false;
    else if (/timestamp|date/.test(c.data_type)) row[c.column_name] = new Date('2026-06-01T12:00:00Z');
    else if (/json/.test(c.data_type)) row[c.column_name] = '{}';
    else if (c.data_type === 'ARRAY') row[c.column_name] = '{}';
  }
  const keys = Object.keys(row);
  await db.query(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    keys.map((k) => row[k]),
  );
}

let n = 0;
async function order(db: PGlite, affiliateId: string, store: string, gross: number, status = 'APPROVED') {
  n += 1;
  await insert(db, 'Order', {
    id: `o${n}`, platformId: 'p_bg', productId: 'prod1', externalId: `bg${n}`, affiliateId, vendorAccount: store,
    grossAmountUsd: gross, status, orderedAt: new Date(Date.UTC(2026, 5, 1 + (n % 20), 12)),
  });
  return `o${n}`;
}

async function ipn(db: PGlite, store: string, affId: string, name: string, times = 1) {
  for (let i = 0; i < times; i++) {
    n += 1;
    await insert(db, 'IngestLog', {
      id: `l${n}`, source: 'buygoods', platformSlug: 'buygoods', eventType: 'neworder',
      payload: JSON.stringify({ account_id: store, aff_id: affId, aff_name: name }),
    });
  }
}

describe('migração: conta BuyGoods por loja', () => {
  let db: PGlite;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await migratedPglite();
    // (Network, NetworkCommission e a fila de não mapeados vêm com o mínimo de colunas.)
    await insert(db, 'Platform', { id: 'p_bg', slug: 'buygoods' });
    await insert(db, 'Platform', { id: 'p_ds', slug: 'digistore24' });
    await insert(db, 'Product', { id: 'prod1', platformId: 'p_bg', externalId: 'neu6sms' });
    const aff = (id: string, platformId: string, externalId: string, nickname: string | null) =>
      insert(db, 'Affiliate', { id, platformId, externalId, nickname, firstSeenAt: new Date('2026-05-01T00:00:00Z') });
    await aff('a62', 'p_bg', '62', 'Tayllan Silva'); // nome do ÚLTIMO IPN — outra pessoa
    await aff('a58150', 'p_bg', '58150', 'Recoverly LTDA');
    await aff('a364622', 'p_bg', '364622', 'MailX'); // pré-cadastrada, sem venda
    await aff('a0', 'p_bg', '0', null);
    await aff('ads62', 'p_ds', '62', 'outro'); // outra plataforma: intocada

    // 62: Nicolas (12595) domina; Marco Cunha (12610) e Tayllan (12803) são outras pessoas.
    for (let i = 0; i < 5; i++) await order(db, 'a62', '12595', 250);
    ids.marco1 = await order(db, 'a62', '12610', 200);
    ids.marco2 = await order(db, 'a62', '12610', 200, 'REFUNDED');
    ids.tayllan = await order(db, 'a62', '12803,12803', 219); // loja repetida na wire
    await order(db, 'a58150', '12610', 144.9);
    await order(db, 'a0', '12595', 99);
    await order(db, 'a0', '12610', 99);
    await order(db, 'ads62', '999', 50);

    await ipn(db, '12595', '62', 'Nicolas Yago Zapora', 3);
    await ipn(db, '12595', '62', 'Nicolas  Yago Zapora'); // espaço duplo = mesmo nome
    await ipn(db, '12610', '62', 'Marco Cunha', 2);
    await ipn(db, '12803,12803', '62', 'Tayllan Silva');
    await ipn(db, '12610', '58150', 'Recoverly LTDA');

    for (const [id, affiliateId] of [['r62', 'a62'], ['r58150', 'a58150'], ['r364622', 'a364622']]) {
      await insert(db, 'RecoveryAffiliate', { id, affiliateId, commissionPct: 0.25, enabled: true, note: 'MailX', updatedAt: new Date() });
    }
    await insert(db, 'Network', { id: 'net1' });
    await insert(db, 'NetworkCommission', { id: 'nc1', networkId: 'net1', orderId: ids.marco1, affiliateId: 'a62', amountUsd: 10, commissionValue: 10 });
    await insert(db, 'unmapped_affiliate_events', { id: 'u62', platform: 'buygoods', external_id: '62', affiliate_account_id: 'a62', first_seen: new Date(), last_seen: new Date() });

    await db.exec(MIGRATION);
  }, 120_000);

  const accounts = async () =>
    (await db.query<{ id: string; externalId: string; nickname: string | null; platformId: string }>(
      `SELECT id, "externalId", nickname, "platformId" FROM "Affiliate" ORDER BY "platformId", "externalId"`,
    )).rows;

  it('cada loja vira uma conta; a dominante fica com o id original e o nome certo', async () => {
    const bg = (await accounts()).filter((a) => a.platformId === 'p_bg');
    expect(bg.map((a) => a.externalId)).toEqual(['0', '364622', '58150@12610', '62@12595', '62@12610', '62@12803']);
    const byExt = Object.fromEntries(bg.map((a) => [a.externalId, a]));
    expect(byExt['62@12595'].id).toBe('a62');
    expect(byExt['62@12595'].nickname).toBe('Nicolas Yago Zapora');
    expect(byExt['62@12610'].nickname).toBe('Marco Cunha');
    expect(byExt['62@12803'].nickname).toBe('Tayllan Silva');
    expect(byExt['58150@12610'].id).toBe('a58150');
  });

  it('pedidos (de qualquer status) e comissão de network vão pra conta da loja', async () => {
    const r = await db.query<{ id: string; ext: string; store: string }>(
      `SELECT o.id, a."externalId" AS ext, o."vendorAccount" AS store FROM "Order" o JOIN "Affiliate" a ON a.id = o."affiliateId" WHERE o.id = ANY($1)`,
      [[ids.marco1, ids.marco2, ids.tayllan]],
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(by[ids.marco1].ext).toBe('62@12610');
    expect(by[ids.marco2].ext).toBe('62@12610');
    expect(by[ids.tayllan]).toMatchObject({ ext: '62@12803', store: '12803' });
    const nc = await db.query<{ ext: string }>(`SELECT a."externalId" AS ext FROM "NetworkCommission" nc JOIN "Affiliate" a ON a.id = nc."affiliateId"`);
    expect(nc.rows[0].ext).toBe('62@12610');
    const nicolas = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM "Order" WHERE "affiliateId" = 'a62'`);
    expect(nicolas.rows[0].c).toBe(5);
  });

  it('marca de recuperação: desativada só onde a conta misturava lojas', async () => {
    const r = await db.query<{ id: string; enabled: boolean }>(`SELECT id, enabled FROM "RecoveryAffiliate" ORDER BY id`);
    expect(Object.fromEntries(r.rows.map((x) => [x.id, x.enabled]))).toEqual({ r364622: true, r58150: true, r62: false });
    const log = await db.query<{ externalId: string; kept: boolean; recoveryDisabled: boolean }>(
      `SELECT "externalId", kept, "recoveryDisabled" FROM "BuyGoodsAffiliateSplit" WHERE "sourceAffiliateId" = 'a62' ORDER BY "externalId"`,
    );
    expect(log.rows).toEqual([
      { externalId: '62@12595', kept: true, recoveryDisabled: true },
      { externalId: '62@12610', kept: false, recoveryDisabled: false },
      { externalId: '62@12803', kept: false, recoveryDisabled: false },
    ]);
  });

  it('"0", conta sem venda e outra plataforma ficam intocados; fila de não mapeados segue a conta', async () => {
    const all = await accounts();
    expect(all.find((a) => a.id === 'ads62')?.externalId).toBe('62');
    const zero = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM "Order" WHERE "affiliateId" = 'a0'`);
    expect(zero.rows[0].c).toBe(2);
    const u = await db.query<{ external_id: string }>(`SELECT external_id FROM unmapped_affiliate_events WHERE id = 'u62'`);
    expect(u.rows[0].external_id).toBe('62@12595');
  });

  it('rodar de novo não muda nada', async () => {
    const before = JSON.stringify(await accounts());
    await db.exec(MIGRATION);
    expect(JSON.stringify(await accounts())).toBe(before);
    const log = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM "BuyGoodsAffiliateSplit"`);
    expect(log.rows[0].c).toBe(4);
  });
});
