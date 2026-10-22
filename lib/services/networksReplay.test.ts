import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { migratedPglite } from '../test/pgliteDb';
import { ipnFormBody, replayCandidatesSql } from './networksReplay';

describe('ipnFormBody', () => {
  it('codifica como o nó do n8n (nulo vira vazio)', () => {
    expect(ipnFormBody({ transaction_id: 'AP-1', product_name: 'Neuro Mind+ 6', affiliate_id: '3649735', vat_tax: null }))
      .toBe('transaction_id=AP-1&product_name=Neuro%20Mind%2B%206&affiliate_id=3649735&vat_tax=');
  });
});

describe('replayCandidatesSql (PGlite)', () => {
  let pg: PGlite;
  const pgValue = (v: unknown) => (Array.isArray(v) ? `{${v.map((x) => JSON.stringify(String(x))).join(',')}}` : v);
  const log = (id: string, o: Record<string, unknown>) => pg.query(
    `INSERT INTO "IngestLog" (id, source, "platformSlug", "eventType", "externalId", "receivedAt", payload) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, o.source ?? 'n8n-jvzoo', 'jvzoo', o.eventType ?? 'sale', o.externalId, o.receivedAt, JSON.stringify({ affiliate_id: o.account, transaction_id: o.externalId })],
  );

  beforeAll(async () => {
    pg = await migratedPglite({ extensions: false });
    await log('l1', { externalId: 'T1', account: '3649735', receivedAt: new Date('2026-10-22T16:42:41Z') });
    await log('l1b', { externalId: 'T1', account: '3649735', receivedAt: new Date('2026-10-22T16:42:50Z') }); // reentrega do n8n
    await log('l2', { externalId: 'T1', account: '3649735', eventType: 'rfnd', receivedAt: new Date('2026-10-22T19:32:09Z') });
    await log('l3', { externalId: 'T2', account: '111', receivedAt: new Date('2026-10-20T10:00:00Z') });            // conta individual
    await log('l4', { externalId: 'T3', account: '3649735', receivedAt: new Date('2026-10-10T10:00:00Z') });        // antes do corte
    await log('l5', { externalId: 'T4', account: '3649735', eventType: 'test', receivedAt: new Date('2026-10-21T10:00:00Z') });
    await log('l6', { externalId: 'T5', account: '3649735', source: 'n8n-jvzoo-redes', receivedAt: new Date('2026-10-21T10:00:00Z') });
  }, 60_000);
  afterAll(async () => { await pg.close(); });

  it('só as IPNs de vendedor das contas, desde o corte, sem teste, uma por transação×evento', async () => {
    const sql = replayCandidatesSql(new Date('2026-10-14T03:00:00Z'), ['3649735']);
    const rows = (await pg.query<Record<string, unknown>>(sql.text, (sql.values as unknown[]).map(pgValue))).rows;
    expect(rows.map((r) => [r.id, r.eventType, r.account])).toEqual([
      ['l2', 'rfnd', '3649735'],
      ['l1', 'sale', '3649735'],
    ]);
  });
});
