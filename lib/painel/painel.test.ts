import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import { retargetIndex } from './ddl';
import { currentPainelHash, syncPainel, type SqlRunner } from './sync';

const runner = (pg: PGlite): SqlRunner => ({
  query: async <T,>(sql: string) => (await pg.query<T>(sql)).rows,
  transaction: async (statements) => {
    await pg.transaction(async (tx) => { for (const s of statements) await tx.exec(s); });
  },
});

describe('retargetIndex', () => {
  it('reaponta o índice da MV pro schema novo', () => {
    expect(retargetIndex('CREATE UNIQUE INDEX daily_metrics_pk ON public.daily_metrics USING btree (day, platform)', 'painel_novo', 'daily_metrics'))
      .toBe('CREATE UNIQUE INDEX daily_metrics_pk ON "painel_novo"."daily_metrics" USING btree (day, platform)');
  });
});

describe('schema painel (PGlite)', () => {
  let pg: PGlite;
  const ins = (table: string, cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return pg.query(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  };
  const order = (schema: string, id: string, o: Record<string, unknown>) => ins(`${schema}."Order"`, {
    id, externalId: id, platformId: 'p_jv', productId: 'pr_jv', currencyOriginal: 'USD', grossAmountOrig: 100,
    grossAmountUsd: 100, eventType: 'x', updatedAt: new Date(), productType: 'FRONTEND', status: 'APPROVED', netAmountUsd: 40,
    orderedAt: new Date('2026-10-01T15:00:00Z'), ...o,
  });
  const ccs = (schema: string, key: string, o: Record<string, unknown>) => ins(`${schema}."CallCenterSale"`, {
    id: key, externalKey: key, provider: 'logicall', status: 'APPROVED', amountUsd: 200, updatedAt: new Date(),
    purchasedAt: new Date('2026-10-01T15:00:00Z'), ...o,
  });
  const sb = (schema: string, tx: string, o: Record<string, unknown>) => ins(`${schema}."SalesboundTransaction"`, {
    id: tx, transactionId: tx, source: 'csv', orderId: `o-${tx}`, type: 'SALE', result: 'SUCCESS', amountUsd: 300,
    txnAt: new Date('2026-10-01T15:00:00Z'), items: '[]', updatedAt: new Date(), ...o,
  });
  const keys = async (sql: string) => (await pg.query<{ k: string }>(sql)).rows.map((r) => r.k).sort();

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_jv','jvzoo','JVZoo'), ('p_cb','clickbank','ClickBank');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family) VALUES
        ('pr_jv','p_jv','111','Front','FRONTEND','Cognizil'), ('pr_cb','p_cb','cb1','CB Front','FRONTEND','Cognizil');
      CREATE SCHEMA dados_oficiais;
      CREATE TABLE dados_oficiais."Platform" (LIKE public."Platform" INCLUDING DEFAULTS);
      CREATE TABLE dados_oficiais."Product" (LIKE public."Product" INCLUDING DEFAULTS);
      CREATE TABLE dados_oficiais."Affiliate" (LIKE public."Affiliate" INCLUDING DEFAULTS);
      CREATE TABLE dados_oficiais."Order" (LIKE public."Order" INCLUDING DEFAULTS);
      CREATE TABLE dados_oficiais."CallCenterSale" (LIKE public."CallCenterSale" INCLUDING DEFAULTS);
      CREATE TABLE dados_oficiais."SalesboundTransaction" (LIKE public."SalesboundTransaction" INCLUDING DEFAULTS);
      ALTER TABLE dados_oficiais."Order" DROP COLUMN "networkId";
      ALTER TABLE dados_oficiais."Affiliate" DROP COLUMN "networkId";
      INSERT INTO dados_oficiais."Platform" SELECT * FROM public."Platform" WHERE slug = 'jvzoo';
      INSERT INTO dados_oficiais."Product" (id, "platformId", "externalId", name, "productType")
        VALUES ('pr_jv','p_jv','111','Front (oficial)','FRONTEND'), ('dq_pr2','p_jv','222','Só no oficial','UPSELL');
    `);
    // JVZoo: J1 nos dois (o oficial vence no status; o public completa o COGS),
    // J2 só no public e ANTES da última venda oficial (fica fora — id que não casa),
    // J3 só no oficial, J9 só no public e DEPOIS da última oficial (tempo real),
    // C1 de outra plataforma (100% public).
    await order('public', 'J1', { status: 'REFUNDED', cogsUsd: 12, funnelSessionId: 'sess-painel', billingType: 'SINGLE_PAYMENT' });
    await order('dados_oficiais', 'J1', { status: 'CHARGEBACK', cogsUsd: null, funnelSessionId: 'sess-oficial', billingType: 'UNKNOWN' });
    await order('public', 'J2', { orderedAt: new Date('2026-10-02T15:00:00Z') });
    await order('dados_oficiais', 'J3', { orderedAt: new Date('2026-10-05T15:00:00Z'), productId: 'dq_pr2' });
    await order('public', 'J9', { orderedAt: new Date('2026-10-06T15:00:00Z') });
    await order('public', 'C1', { platformId: 'p_cb', productId: 'pr_cb' });
    // Call center: L1 nos dois; L2 VOID só no public, antigo (fora); L3 só no
    // public e novo (tempo real); Tauk do public NUNCA entra (chave e fuso diferentes).
    await ccs('public', 'logicall:L1', { email: 'cliente@exemplo.test' });
    await ccs('dados_oficiais', 'logicall:L1', { amountUsd: 210 });
    await ccs('public', 'logicall:L2', { status: 'VOID' });
    await ccs('public', 'logicall:L3', { purchasedAt: new Date('2026-10-09T15:00:00Z') });
    await ccs('public', 'a@b.test|2026-10-09', { provider: 'tauk', email: 'a@b.test', purchasedAt: new Date('2026-10-09T19:00:00Z') });
    await ccs('dados_oficiais', 'tauk:99', { provider: 'tauk' });
    // Ponte da Tauk: mesma venda, oficial 4h antes e sem e-mail.
    await ccs('dados_oficiais', 'tauk:100', { provider: 'tauk', firstName: 'Ana', purchasedAt: new Date('2026-10-09T15:00:00Z') });
    // Dois candidatos no webhook (mesmo valor e horário): ambíguo, não preenche.
    await ccs('public', 'c@d.test|2026-10-10', { provider: 'tauk', email: 'c@d.test', amountUsd: 99, purchasedAt: new Date('2026-10-10T19:00:00Z') });
    await ccs('public', 'e@f.test|2026-10-10', { provider: 'tauk', email: 'e@f.test', amountUsd: 99, purchasedAt: new Date('2026-10-10T19:00:00Z') });
    await ccs('dados_oficiais', 'tauk:101', { provider: 'tauk', amountUsd: 99, purchasedAt: new Date('2026-10-10T15:00:00Z') });
    // SalesBound: S1 nos dois; S2 webhook antigo (fora); S3 novo (tempo real);
    // S4 novo mas o oficial já tem pelo clientTxnId (fora).
    await sb('public', 'S1', { merchant: 'NMI' });
    await sb('dados_oficiais', 'S1', { amountUsd: 310 });
    await sb('public', 'wh:S2', { source: 'webhook' });
    await sb('public', 'wh:S3', { source: 'webhook', txnAt: new Date('2026-10-09T15:00:00Z') });
    await sb('dados_oficiais', 'S5', { clientTxnId: 'ctx-5', txnAt: new Date('2026-10-05T15:00:00Z') });
    await sb('public', 'wh:S4', { source: 'webhook', clientTxnId: 'ctx-5', txnAt: new Date('2026-10-09T16:00:00Z') });
  }, 120_000);
  afterAll(async () => { await pg?.close(); });

  it('monta, troca pelo painel e não refaz quando nada mudou', async () => {
    const r1 = await syncPainel(runner(pg));
    expect(r1.changed).toBe(true);
    expect(await currentPainelHash(runner(pg))).toBe(r1.hash);
    const r2 = await syncPainel(runner(pg));
    expect(r2).toMatchObject({ changed: false, hash: r1.hash });
    const schemas = (await pg.query<{ n: string }>(`SELECT nspname AS n FROM pg_namespace WHERE nspname LIKE 'painel%'`)).rows.map((r) => r.n);
    expect(schemas).toEqual(['painel']);
  });

  it('Order: oficial no lugar do public, sem duplicar, + outras plataformas + tempo real', async () => {
    expect(await keys(`SELECT "externalId" AS k FROM painel."Order"`)).toEqual(['C1', 'J1', 'J3', 'J9']);
    const dup = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT 1 FROM painel."Order" GROUP BY "platformId", "externalId" HAVING count(*) > 1) x`);
    expect(dup.rows[0].n).toBe(0);
    const j1 = (await pg.query<Record<string, unknown>>(`SELECT status, "cogsUsd"::float AS cogs, "funnelSessionId", "billingType" FROM painel."Order" WHERE "externalId" = 'J1'`)).rows[0];
    // Status do extrato; COGS e sessão do painel; billingType UNKNOWN do oficial cede ao painel.
    expect(j1).toMatchObject({ status: 'CHARGEBACK', cogs: 12, funnelSessionId: 'sess-painel', billingType: 'SINGLE_PAYMENT' });
  });

  it('conferência do Douglas: nenhuma JVZoo vinda do public exceto o tempo real', async () => {
    const r = await pg.query<{ k: string }>(`
      SELECT o."externalId" AS k FROM painel."Order" o JOIN painel."Platform" p ON p.id = o."platformId"
      WHERE p.slug = 'jvzoo' AND NOT EXISTS (SELECT 1 FROM dados_oficiais."Order" d WHERE d.id = o.id)`);
    expect(r.rows.map((x) => x.k)).toEqual(['J9']);
  });

  it('enum no WHERE com o DOMAIN do painel (como o Prisma qualifica)', async () => {
    const r = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM painel."Order" WHERE status = 'CHARGEBACK'::painel."OrderStatus"`);
    expect(r.rows[0].n).toBe(1);
  });

  it('cadastro: o do public vence e entra o que só o oficial tem', async () => {
    const r = (await pg.query<{ k: string; name: string }>(`SELECT "externalId" AS k, name FROM painel."Product" WHERE "platformId" = 'p_jv' ORDER BY 1`)).rows;
    expect(r).toEqual([{ k: '111', name: 'Front' }, { k: '222', name: 'Só no oficial' }]);
  });

  it('call center: oficial + completa do public; Tauk do public nunca; Logicall em tempo real', async () => {
    expect(await keys(`SELECT "externalKey" AS k FROM painel."CallCenterSale"`)).toEqual(['logicall:L1', 'logicall:L3', 'tauk:100', 'tauk:101', 'tauk:99']);
    const l1 = (await pg.query<Record<string, unknown>>(`SELECT "amountUsd"::float AS v, email FROM painel."CallCenterSale" WHERE "externalKey" = 'logicall:L1'`)).rows[0];
    expect(l1).toEqual({ v: 210, email: 'cliente@exemplo.test' });
  });

  it('ponte da Tauk: e-mail do webhook casado por valor + horário exato (4h à frente); ambíguo fica vazio', async () => {
    const r = (await pg.query<{ k: string; email: string | null; firstName: string | null }>(
      `SELECT "externalKey" AS k, email, "firstName" FROM painel."CallCenterSale" WHERE provider = 'tauk' ORDER BY 1`)).rows;
    expect(r).toEqual([
      { k: 'tauk:100', email: 'a@b.test', firstName: 'Ana' },
      { k: 'tauk:101', email: null, firstName: null },
      { k: 'tauk:99', email: null, firstName: null },
    ]);
  });

  it('SalesBound: oficial + tempo real, sem repetir o que o oficial já tem pelo clientTxnId', async () => {
    expect(await keys(`SELECT "transactionId" AS k FROM painel."SalesboundTransaction"`)).toEqual(['S1', 'S5', 'wh:S3']);
    const s1 = (await pg.query<Record<string, unknown>>(`SELECT "amountUsd"::float AS v, merchant FROM painel."SalesboundTransaction" WHERE "transactionId" = 'S1'`)).rows[0];
    expect(s1).toEqual({ v: 310, merchant: 'NMI' });
  });

  it('daily_metrics do painel existe, tem índice único e soma o dado mesclado', async () => {
    await pg.exec('REFRESH MATERIALIZED VIEW CONCURRENTLY painel.daily_metrics');
    const r = await pg.query<{ approved: number; cb: number }>(`
      SELECT sum(approved_count)::int AS approved, sum(chargeback_count)::int AS cb FROM painel.daily_metrics`);
    // J3, J9 e C1 aprovados; J1 chargeback.
    expect(r.rows[0]).toEqual({ approved: 3, cb: 1 });
    expect((await pg.query(`SELECT 1 FROM painel.lead_summary LIMIT 1`)).fields.length).toBeGreaterThan(0);
  });

  it('sem tempo real: só o oficial (e a troca de opção refaz o schema)', async () => {
    const r = await syncPainel(runner(pg), { opts: { sessao: 'painel', tempoReal: false } });
    expect(r.changed).toBe(true);
    expect(await keys(`SELECT "externalId" AS k FROM painel."Order"`)).toEqual(['C1', 'J1', 'J3']);
    expect(await keys(`SELECT "transactionId" AS k FROM painel."SalesboundTransaction"`)).toEqual(['S1', 'S5']);
  });
});
