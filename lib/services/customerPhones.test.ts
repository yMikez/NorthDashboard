import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import { customerPhoneBackfillSql, PHONE_SOURCES } from './customerPhones';

describe('backfill do telefone de cliente pelos IPNs guardados (PGlite)', () => {
  let pg: PGlite;
  const q = async (sql: Prisma.Sql) => (await pg.query<Record<string, unknown>>(sql.text, sql.values as unknown[])).rows;
  const log = (id: string, slug: string, payload: unknown, receivedAt: string) => pg.query(
    `INSERT INTO "IngestLog" (id, source, "platformSlug", "eventType", payload, "receivedAt") VALUES ($1, 'webhook', $2, 'x', $3, $4)`,
    [id, slug, JSON.stringify(payload), receivedAt],
  );
  const phoneOf = async (id: string) => (await pg.query<{ phone: string | null }>(`SELECT phone FROM "Customer" WHERE id = $1`, [id])).rows[0].phone;

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES
        ('p_bg','buygoods','BuyGoods'), ('p_jv','jvzoo','JVZoo'), ('p_d24','digistore24','Digistore24'),
        ('p_cp','cartpanda','Cartpanda'), ('p_cb','clickbank','ClickBank');
      INSERT INTO "Customer" (id, "platformId", "externalId", email, phone, "firstSeenAt") VALUES
        ('c_bg','p_bg','1','Ana@X.com',NULL,'2026-01-01'),
        ('c_bg_tem','p_bg','2','bia@x.com','15550000000','2026-01-01'),
        ('c_jv','p_jv','3','ana@x.com',NULL,'2026-01-01'),
        ('c_d24','p_d24','4','carla@x.com',NULL,'2026-01-01'),
        ('c_cp','p_cp','5','dani@x.com',NULL,'2026-01-01'),
        ('c_cb','p_cb','eva@x.com','eva@x.com',NULL,'2026-01-01'),
        ('c_sem','p_bg','6','semlog@x.com',NULL,'2026-01-01');
    `);
    // BuyGoods: dois avisos da Ana — vale o MAIS RECENTE com telefone.
    await log('l1', 'buygoods', { customer_emailaddress: 'ana@x.com', customer_phone: '(555) 111-1111' }, '2026-09-01');
    await log('l2', 'buygoods', { customer_emailaddress: ' ANA@x.com', customer_phone: '+1 555 222 2222' }, '2026-09-02');
    await log('l3', 'buygoods', { customer_emailaddress: 'ana@x.com', customer_phone: '' }, '2026-09-03');
    await log('l4', 'buygoods', { customer_emailaddress: 'bia@x.com', customer_phone: '555 999 9999' }, '2026-09-03');
    await log('l5', 'jvzoo', { customer_email: 'ana@x.com', customer_phone: '555-333-3333' }, '2026-09-01');
    await log('l6', 'digistore24', { buyer_email: 'carla@x.com', buyer_address_phone_no: '', address_phone_no: '0049 30 1234567' }, '2026-09-01');
    await log('l7', 'cartpanda', { order: { email: 'dani@x.com', customer: { email: 'dani@x.com', phone: '' }, phone: '+55 11 98888-7777' } }, '2026-09-01');
    await log('l8', 'clickbank', { customer: { billing: { email: 'Eva@X.com', phoneNumber: '+15555550000' } } }, '2026-09-01');
    await log('l9', 'salesbound', { emailAddress: 'fred@x.com', phoneNumber: '15056608654' }, '2026-09-01');
    await pg.query(`INSERT INTO "SalesboundTransaction" (id, "transactionId", "orderId", type, result, "amountUsd", "txnAt", email, items, "updatedAt")
      VALUES ('s1','t1','o1','SALE','SUCCESS',100,'2026-09-01','Fred@x.com','[]',now())`);
  }, 60_000);

  afterAll(async () => { await pg?.close(); });

  it('conta, preenche por e-mail (sem diferenciar maiúscula) e não sobrescreve quem já tem número', async () => {
    const counts: Record<string, number> = {};
    for (const slug of Object.keys(PHONE_SOURCES)) counts[slug] = Number((await q(customerPhoneBackfillSql(slug).count))[0].n);
    expect(counts).toEqual({ buygoods: 1, jvzoo: 1, digistore24: 1, cartpanda: 1, clickbank: 1, salesbound: 1 });

    for (const slug of Object.keys(PHONE_SOURCES)) await q(customerPhoneBackfillSql(slug).update);

    expect(await phoneOf('c_bg')).toBe('15552222222');     // aviso mais recente COM número
    expect(await phoneOf('c_bg_tem')).toBe('15550000000'); // já tinha: fica
    expect(await phoneOf('c_jv')).toBe('5553333333');      // cada plataforma com o seu aviso
    expect(await phoneOf('c_d24')).toBe('49301234567');    // address_phone_no, sem o 00
    expect(await phoneOf('c_cp')).toBe('5511988887777');   // order.phone de reserva
    expect(await phoneOf('c_cb')).toBe('15555550000');
    expect(await phoneOf('c_sem')).toBeNull();
    const { rows: [sb] } = await pg.query<{ phone: string }>(`SELECT phone FROM "SalesboundTransaction" WHERE id = 's1'`);
    expect(sb.phone).toBe('15056608654');

    for (const slug of Object.keys(PHONE_SOURCES)) expect(Number((await q(customerPhoneBackfillSql(slug).count))[0].n)).toBe(0);
  });
});
