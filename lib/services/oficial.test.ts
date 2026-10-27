import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { brtDia, oficialSql, reduceOficial, type OficialDiaRow } from './oficial';

describe('brtDia', () => {
  it('o fim do dia BRT continua no mesmo dia-rótulo', () => {
    expect(brtDia(new Date('2026-09-01T03:00:00.000Z'))).toBe('2026-09-01');
    expect(brtDia(new Date('2026-10-01T02:59:59.999Z'))).toBe('2026-09-30');
  });
});

describe('resultado oficial (PGlite)', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE SCHEMA dados_oficiais;
      CREATE TABLE dados_oficiais.dq_big_numbers_diario (
        publicacao_id int, plataforma text, dia date, fuso text, periodo text, pedidos numeric, vendas numeric,
        reembolsos numeric, parcela numeric, taxa numeric, chargebacks numeric, fulfillment numeric, outros numeric,
        liquido numeric, reserva numeric, saldo_a_receber numeric, a_receber_antes_fulfillment numeric);
      -- publicação antiga (ignorada) e a atual
      INSERT INTO dados_oficiais.dq_big_numbers_diario VALUES
        (1, 'JVZoo', '2026-09-01', 'America/New_York', '2026-09', 99, 99, 0, 0, 0, 0, NULL, 0, 99, NULL, NULL, NULL),
        (2, 'JVZoo', '2026-09-01', 'America/New_York', '2026-09', 10, 1000, -100, -600, 0, 0, NULL, -20, 280, NULL, NULL, NULL),
        (2, 'JVZoo', '2026-09-02', 'America/New_York', '2026-09', 5, 500, 0, -300, 0, 0, NULL, -10, 190, NULL, NULL, NULL),
        (2, 'JVZoo', '2026-10-01', 'America/New_York', '2026-10', 7, 700, 0, -400, 0, 0, NULL, 0, 300, NULL, NULL, NULL),
        (2, 'Logicall', '2026-09-02', 'America/Vancouver', '2026-09-Q1', 3, 300, -30, -80, -15, -5, NULL, -20, 170, -17, 153, NULL),
        (2, 'Tauk', '2026-09-02', 'UTC', '2026-08-31', 2, 200, -10, -50, -12, 0, NULL, -12, 128, NULL, NULL, 128);
    `);
  });
  afterAll(async () => { await pg?.close(); });

  const run = async (a: string, b: string) => {
    const sql = oficialSql(a, b);
    return (await pg.query<OficialDiaRow>(sql.text, sql.values as unknown[])).rows;
  };

  it('soma só a última publicação, pelo dia-rótulo de cada fonte', async () => {
    const { plataformas, total } = reduceOficial(await run('2026-09-01', '2026-09-30'));
    expect(plataformas.map((p) => p.chave)).toEqual(['jvzoo', 'logicall', 'tauk']);
    expect(plataformas[0]).toMatchObject({ pedidos: 15, vendas: 1500, reembolsos: -100, parcela: -900, outros: -30, liquido: 470, periodos: ['2026-09'], reserva: null });
    expect(plataformas[1]).toMatchObject({ liquido: 170, reserva: -17, saldoAReceber: 153 });
    expect(plataformas[2]).toMatchObject({ fulfillmentAConfirmar: true, liquidoSobreVendas: 0.64 });
    expect(total).toMatchObject({ vendas: 2000, liquido: 768, reserva: -17, saldoAReceber: 153 });
  });

  it('líquido = vendas + reembolsos + parcela + outros (sinais do publicado)', async () => {
    const { plataformas } = reduceOficial(await run('2026-09-01', '2026-09-30'));
    for (const p of plataformas) expect(p.vendas + p.reembolsos + p.parcela + p.outros).toBeCloseTo(p.liquido, 2);
  });
});
