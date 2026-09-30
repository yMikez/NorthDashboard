import { describe, expect, it } from 'vitest';
import { migratedPglite } from './pgliteDb';

describe('migrações no Postgres embutido', () => {
  it('aplicam inteiras com e sem as extensões contrib (boot nunca trava)', async () => {
    const withExt = await migratedPglite();
    const ext = await withExt.query<{ extname: string }>(`SELECT extname FROM pg_extension`);
    expect(ext.rows.map((r) => r.extname)).toEqual(expect.arrayContaining(['pg_trgm', 'unaccent']));
    const without = await migratedPglite({ extensions: false });
    const cfg = await without.query<{ cfgname: string }>(`SELECT cfgname FROM pg_ts_config WHERE cfgname IN ('ns_pt','ns_simple')`);
    expect(cfg.rows.length).toBe(2);
  }, 60_000);
});
