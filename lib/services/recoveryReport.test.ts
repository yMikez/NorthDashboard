import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PGlite } from '@electric-sql/pglite';

const mockDb = vi.hoisted(() => ({
  recoveryReportCustomer: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
  recoveryAffiliate: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../db', () => ({ db: mockDb }));

import {
  hashEmail, importRecoveryReport, parseCustomersReport, recoveryReportSummarySql, recoverySuggestionsSql,
  type ParsedReport,
} from './recoveryReport';
import { migratedPglite } from '../test/pgliteDb';

// Formato do export "Customers" da BuyGoods: título antes do cabeçalho.
const TITLE: (string | number | null)[][] = [
  ['Customers', null, null, null, null],
  ['Report Date: 10-05-2026', null, null, null, null],
  ['Criteria: rr_createdate - desc', null, null, null, null],
  ['Date Range: September 28, 2026 - October 05, 2026', null, null, null, null],
  [null, null, null, null, null],
  ['Name', 'Email', 'Affiliate Name', 'Lifetime Value', 'Balance'],
];

describe('parseCustomersReport', () => {
  it('acha o cabeçalho depois do título, lê período/data e troca e-mail por md5', () => {
    const p = parseCustomersReport([
      ...TITLE,
      ['Ana', ' Ana@X.com ', 'lusk1nha', 294, 0],
      ['Bia', 'bia@x.com', 'lusk1nha', '$1,207.50', '$0.00'],
    ]) as ParsedReport;
    expect(p.reportDate).toBe('2026-10-05');
    expect(p.createdFrom).toBe('2026-09-28');
    expect(p.createdTo).toBe('2026-10-05');
    expect(p.criteria).toBe('rr_createdate - desc');
    expect(p.rows).toEqual([
      { emailHash: hashEmail('ana@x.com'), affiliateName: 'lusk1nha', lifetimeValueUsd: 294, balanceUsd: 0 },
      { emailHash: hashEmail('bia@x.com'), affiliateName: 'lusk1nha', lifetimeValueUsd: 1207.5, balanceUsd: 0 },
    ]);
    // Nada do nome nem do e-mail em claro sai do parser.
    expect(JSON.stringify(p)).not.toMatch(/Ana|bia@/i);
  });

  it('md5 do e-mail normalizado = md5(lower(trim(email))) do Postgres', () => {
    expect(hashEmail('  Foo@Bar.COM ')).toBe('f3ada405ce890b6f8204094deb12d8a8');
  });

  it('venda direta (sem afiliado) e linha inválida ficam de fora, contadas', () => {
    const p = parseCustomersReport([
      ...TITLE,
      ['A', 'a@x.com', '', 100, 0],
      ['B', 'sem-arroba', 'lusk1nha', 100, 0],
      ['C', 'c@x.com', 'lusk1nha', 'abc', 0],
      [null, null, null, null, null],
    ]) as ParsedReport;
    expect(p.rows).toHaveLength(0);
    expect(p.noAffiliate).toBe(1);
    expect(p.invalid).toBe(2);
  });

  it('mesmo cliente repetido fica com o maior LTV', () => {
    const p = parseCustomersReport([...TITLE, ['A', 'a@x.com', 'lusk1nha', 100, 0], ['A', 'A@x.com', 'lusk1nha', 300, 0]]) as ParsedReport;
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].lifetimeValueUsd).toBe(300);
  });

  it('export sem a coluna de afiliado (o Customers padrão) é recusado', () => {
    const r = parseCustomersReport([['Date Created', 'Name', 'Email', 'Phone'], ['2026-09-01', 'A', 'a@x.com', '1']]);
    expect(r).toEqual({ error: expect.stringMatching(/Affiliate Name/) });
  });

  it('sem título: data e período ficam null', () => {
    const p = parseCustomersReport([TITLE[5], ['A', 'a@x.com', 'lusk1nha', 1, 0]]) as ParsedReport;
    expect(p.reportDate).toBeNull();
    expect(p.createdFrom).toBeNull();
    expect(p.rows).toHaveLength(1);
  });
});

describe('importRecoveryReport', () => {
  const parsed: ParsedReport = {
    rows: [
      { emailHash: 'h1', affiliateName: 'lusk1nha', lifetimeValueUsd: 294, balanceUsd: 0 },
      { emailHash: 'h2', affiliateName: 'lusk1nha', lifetimeValueUsd: 207, balanceUsd: 0 },
      { emailHash: 'h3', affiliateName: 'Lusk1nha', lifetimeValueUsd: 468, balanceUsd: 0 },
      { emailHash: 'h4', affiliateName: 'afiliado-comum', lifetimeValueUsd: 99, balanceUsd: 0 },
    ],
    createdFrom: '2026-09-28', createdTo: '2026-10-05', reportDate: '2026-10-05', criteria: null, invalid: 0, noAffiliate: 2,
  };
  const tx = { recoveryReportCustomer: mockDb.recoveryReportCustomer };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.recoveryAffiliate.findMany.mockResolvedValue([{ note: 'MailX' }, { note: 'Recorvely' }]);
    mockDb.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));
  });

  it('só importa afiliado com empresa; cria os novos, atualiza o que tem relatório mais velho e ignora o mais novo', async () => {
    mockDb.recoveryReportCustomer.findMany
      .mockResolvedValueOnce([]) // herança de empresa
      .mockResolvedValueOnce([
        { id: 'r2', affiliateName: 'lusk1nha', emailHash: 'h2', reportDate: new Date('2026-09-28T00:00:00Z') },
        { id: 'r3', affiliateName: 'Lusk1nha', emailHash: 'h3', reportDate: new Date('2026-10-12T00:00:00Z') },
      ]);
    const r = await importRecoveryReport({ parsed, platformSlug: 'buygoods', partners: { LUSK1NHA: 'MailX' }, batchTag: 't' });
    if ('error' in r) throw new Error(r.error);
    expect(r).toMatchObject({ created: 1, updated: 1, stale: 1, unmappedAffiliates: { 'afiliado-comum': 1 }, unknownPartners: [] });
    expect(r.byPartner).toEqual([
      { partner: 'MailX', affiliateName: 'lusk1nha', customers: 2, lifetimeValueUsd: 501 },
      { partner: 'MailX', affiliateName: 'Lusk1nha', customers: 1, lifetimeValueUsd: 468 },
    ]);
    const created = mockDb.recoveryReportCustomer.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ emailHash: 'h1', partner: 'MailX', platformSlug: 'buygoods', importBatch: 't' });
    expect(created[0].createdFrom.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(mockDb.recoveryReportCustomer.update).toHaveBeenCalledTimes(1);
    expect(mockDb.recoveryReportCustomer.update.mock.calls[0][0].where).toEqual({ id: 'r2' });
  });

  it('reimport sem mapa herda a empresa gravada; dryRun não grava', async () => {
    mockDb.recoveryReportCustomer.findMany
      .mockResolvedValueOnce([{ affiliateName: 'lusk1nha', partner: 'MailX' }])
      .mockResolvedValueOnce([]);
    const r = await importRecoveryReport({ parsed, platformSlug: 'buygoods', batchTag: 't', dryRun: true });
    if ('error' in r) throw new Error(r.error);
    expect(r.dryRun).toBe(true);
    expect(r.created).toBe(2);
    expect(r.unmappedAffiliates).toEqual({ Lusk1nha: 1, 'afiliado-comum': 1 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it('empresa que não existe na marcação de recuperação volta em unknownPartners', async () => {
    mockDb.recoveryReportCustomer.findMany.mockResolvedValue([]);
    const r = await importRecoveryReport({ parsed, platformSlug: 'buygoods', partners: { lusk1nha: 'Mailx Ltda' }, batchTag: 't', dryRun: true });
    if ('error' in r) throw new Error(r.error);
    expect(r.unknownPartners).toEqual(['Mailx Ltda']);
  });

  it('sem Report Date no arquivo nem no parâmetro = erro', async () => {
    const r = await importRecoveryReport({ parsed: { ...parsed, reportDate: null }, platformSlug: 'buygoods', batchTag: 't' });
    expect(r).toEqual({ error: expect.stringMatching(/reportDate/) });
  });
});

describe('SQL no Postgres (PGlite com as migrações)', () => {
  let pg: PGlite;
  const pgValue = (v: unknown) => (Array.isArray(v) ? `{${v.map((x) => JSON.stringify(String(x))).join(',')}}` : v);
  const q = async (sql: Prisma.Sql) => (await pg.query<Record<string, unknown>>(sql.text, (sql.values as unknown[]).map(pgValue))).rows;
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await pg.exec(`
      INSERT INTO "Platform" (id, slug, "displayName") VALUES ('p_bg','buygoods','BuyGoods'), ('p_jv','jvzoo','JVZoo');
      INSERT INTO "Product" (id, "platformId", "externalId", name, "productType", family) VALUES
        ('pr_sms','p_bg','neu6sms','Neuro Mind Pro 6 Bottles','FRONTEND','NeuroMindPro'),
        ('pr_sms2','p_bg','neu6sms2','Neuro Mind Pro 6 Bottles','FRONTEND','NeuroMindPro'),
        ('pr_fe','p_bg','neu6','Neuro Mind Pro 6 Bottles','FRONTEND','NeuroMindPro'),
        ('pr_jv','p_jv','2322247','NeuroRecall 6','FRONTEND','NeuroRecall');
      INSERT INTO "Affiliate" (id, "platformId", "externalId", nickname, "firstSeenAt") VALUES
        ('a_rec','p_bg','365022@12595','Recoverly LTDA','2026-01-01'),
        ('a_rec2','p_bg','290@12610','Recoverly LTDA','2026-01-01'),
        ('a_new','p_bg','58134@12610','Fulano Silva','2026-01-01'),
        ('a_test','p_bg','6@12595','Cristian Han','2026-01-01'),
        ('a_comum','p_bg','777@12595','Afiliado Comum','2026-01-01'),
        ('a_old','p_bg','888@12595','Antigo','2026-01-01'),
        ('a_prem','p_jv','premium','Premium','2026-01-01');
      INSERT INTO "RecoveryAffiliate" (id, "affiliateId", "commissionPct", enabled, note, "updatedAt") VALUES
        ('r1','a_rec',0.25,true,'Recorvely',now());
      INSERT INTO "Customer" (id, "platformId", "externalId", email, "firstSeenAt") VALUES
        ('c1','p_jv','c1',' Ana@X.com','2026-09-01'), ('c2','p_jv','c2','bia@x.com','2026-09-01');
      INSERT INTO "RecoveryReportCustomer" (id, "platformSlug", "affiliateName", partner, "emailHash", "lifetimeValueUsd", "balanceUsd", "createdFrom", "createdTo", "reportDate", "importBatch", "updatedAt") VALUES
        ('k1','buygoods','lusk1nha','MailX','${hashEmail('ana@x.com')}',294,0,'2026-09-28','2026-10-05','2026-10-05','t',now()),
        ('k2','buygoods','lusk1nha','MailX','${hashEmail('bia@x.com')}',207,0,'2026-09-28','2026-10-05','2026-10-05','t',now()),
        ('k3','buygoods','lusk1nha','MailX','${hashEmail('zé@x.com')}',468,10,'2026-09-28','2026-10-05','2026-10-05','t',now());
    `);
    // MailX marcada em OUTRA loja, pra ter a % da empresa na plataforma.
    await pg.exec(`
      INSERT INTO "Affiliate" (id, "platformId", "externalId", nickname, "firstSeenAt") VALUES ('a_mx','p_bg','364622@12595','MailX','2026-01-01');
      INSERT INTO "RecoveryAffiliate" (id, "affiliateId", "commissionPct", enabled, note, "updatedAt") VALUES ('r2','a_mx',0.25,true,'MailX',now());
    `);
    const ins = (id: string, o: Record<string, unknown>) => {
      const cols = { id, externalId: id, currencyOriginal: 'USD', grossAmountOrig: o.grossAmountUsd, eventType: 'x', updatedAt: new Date(), country: 'US', productType: 'FRONTEND', status: 'APPROVED', netAmountUsd: 0, ...o };
      const keys = Object.keys(cols);
      return pg.query(`INSERT INTO "Order" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
    };
    await ins('o1', { platformId: 'p_bg', productId: 'pr_sms2', affiliateId: 'a_rec', grossAmountUsd: 235.2, orderedAt: daysAgo(2) });
    await ins('o2', { platformId: 'p_bg', productId: 'pr_sms', affiliateId: 'a_new', grossAmountUsd: 294, orderedAt: daysAgo(3) });
    await ins('o3', { platformId: 'p_bg', productId: 'pr_fe', affiliateId: 'a_new', grossAmountUsd: 100, orderedAt: daysAgo(4) });
    await ins('o4', { platformId: 'p_bg', productId: 'pr_sms', affiliateId: 'a_test', grossAmountUsd: 0, orderedAt: daysAgo(10) });
    await ins('o5', { platformId: 'p_bg', productId: 'pr_fe', affiliateId: 'a_comum', grossAmountUsd: 500, orderedAt: daysAgo(1) });
    await ins('o6', { platformId: 'p_bg', productId: 'pr_sms2', affiliateId: 'a_rec2', grossAmountUsd: 144.9, orderedAt: daysAgo(5) });
    await ins('o7', { platformId: 'p_bg', productId: 'pr_sms', affiliateId: 'a_old', grossAmountUsd: 294, orderedAt: daysAgo(200) });
    await ins('o8', { platformId: 'p_jv', productId: 'pr_jv', affiliateId: 'a_prem', customerId: 'c1', grossAmountUsd: 294, orderedAt: daysAgo(9) });
    await ins('o9', { platformId: 'p_jv', productId: 'pr_jv', affiliateId: 'a_prem', customerId: 'c2', grossAmountUsd: 207, orderedAt: daysAgo(8) });
  }, 60_000);

  afterAll(async () => { await pg?.close(); });

  it('sugestões: conta não marcada que vendeu oferta *sms* e conta com nome de marcada; ignora teste de US$ 0, venda antiga e afiliado comum', async () => {
    const rows = await q(recoverySuggestionsSql(90));
    const byId = Object.fromEntries(rows.map((r) => [r.affiliateExternalId, r]));
    expect(Object.keys(byId).sort()).toEqual(['290@12610', '58134@12610']);
    expect(byId['58134@12610']).toMatchObject({ offerProducts: ['neu6sms'], suggestedPartner: null, orders: 2, grossUsd: 394 });
    expect(byId['290@12610']).toMatchObject({ offerProducts: ['neu6sms2'], suggestedPartner: 'Recorvely', orders: 1 });
  });

  it('resumo: LTV, clientes já conhecidos pelo dash, comissão pela % da empresa e origem pelo 1º pedido', async () => {
    const s = recoveryReportSummarySql('buygoods');
    const [p] = await q(s.byPartner);
    expect(p).toMatchObject({
      partner: 'MailX', affiliateName: 'lusk1nha', customers: 3, knownInDash: 2,
      lifetimeValueUsd: 969, balanceUsd: 10, commissionPct: 0.25, commissionUsd: 242.25,
      createdFrom: '2026-09-28', createdTo: '2026-10-05', lastReportDate: '2026-10-05',
    });
    expect(await q(s.byWindow)).toEqual([{ partner: 'MailX', createdFrom: '2026-09-28', createdTo: '2026-10-05', customers: 3, lifetimeValueUsd: 969 }]);
    expect(await q(s.origins)).toEqual([
      { partner: 'MailX', platform: 'jvzoo', account: 'premium', nickname: 'Premium', isRecoveryAccount: false, customers: 2, lifetimeValueUsd: 501 },
    ]);
  });
});
