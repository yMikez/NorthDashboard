import { describe, it, expect } from 'vitest';
import {
  reduceCallCenter, normalizeFamilyKey, levelFor,
  type CallCenterWatchRow, type CallCenterOrderRow,
} from './callCenter';

// now = 2026-07-28T18:00Z → hoje BRT = 2026-07-28.
const now = new Date('2026-07-28T18:00:00.000Z');

// n dias atrás (BRT), meio-dia — bem dentro do dia.
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);

const order = (over: Partial<CallCenterOrderRow> = {}): CallCenterOrderRow => ({
  platformSlug: 'buygoods',
  family: 'Hawaiian Harmony',
  productName: 'Hawaiian Harmony 6 Bottles',
  orderedAt: at(1),
  ...over,
});

const watch = (over: Partial<CallCenterWatchRow> = {}): CallCenterWatchRow => ({
  id: 'w1',
  platformSlug: 'buygoods',
  family: 'Hawaiian Harmony',
  ...over,
});

const mk = (n: number, daysAgo: number, over: Partial<CallCenterOrderRow> = {}) =>
  Array.from({ length: n }, () => order({ orderedAt: at(daysAgo), ...over }));

describe('normalizeFamilyKey / levelFor', () => {
  it('normaliza espaços/caixa/pontuação — "RetraBurn" casa "Retra Burn"', () => {
    expect(normalizeFamilyKey('Retra Burn')).toBe(normalizeFamilyKey('RetraBurn'));
    expect(normalizeFamilyKey('Horse Peak Gelatin')).toBe('horsepeakgelatin');
    // igualdade estrita: Lumicept NÃO é Lumicept Gummies
    expect(normalizeFamilyKey('Lumicept')).not.toBe(normalizeFamilyKey('Lumicept Gummies'));
  });

  it('limiares: ≥30 → tauk; ≥100 → salesbound', () => {
    expect(levelFor(29.9)).toBe('ok');
    expect(levelFor(30)).toBe('tauk');
    expect(levelFor(99.9)).toBe('tauk');
    expect(levelFor(100)).toBe('salesbound');
  });
});

describe('reduceCallCenter', () => {
  it('média 3d dispara o nível; hoje/ontem/média 7d/pico reportados', () => {
    const orders = [
      ...mk(5, 0),   // hoje (parcial — não entra na média)
      ...mk(40, 1),  // ontem
      ...mk(35, 2),
      ...mk(30, 3),  // média 3d = 35 → TAUK
      ...mk(10, 4),
      ...mk(10, 5),
      ...mk(10, 6),
      ...mk(10, 7),
    ];
    const r = reduceCallCenter([watch()], orders, now);
    expect(r.rows.length).toBe(1);
    const row = r.rows[0];
    expect(row.today).toBe(5);
    expect(row.yesterday).toBe(40);
    expect(row.avg3d).toBe(35);
    expect(row.avg7d).toBeCloseTo((40 + 35 + 30 + 10 * 4) / 7, 1);
    expect(row.peak7d).toBe(40);
    expect(row.level).toBe('tauk');
    expect(r.alerts.length).toBe(1);
  });

  it('≥100/dia → salesbound', () => {
    const orders = [...mk(120, 1), ...mk(110, 2), ...mk(100, 3)];
    const r = reduceCallCenter([watch()], orders, now);
    expect(r.rows[0].level).toBe('salesbound');
  });

  it('match tolerante: watch "RetraBurn" casa família "Retra Burn" do catálogo', () => {
    const orders = mk(105, 1, { platformSlug: 'digistore24', family: 'Retra Burn' })
      .concat(mk(105, 2, { platformSlug: 'digistore24', family: 'Retra Burn' }))
      .concat(mk(105, 3, { platformSlug: 'digistore24', family: 'Retra Burn' }));
    const r = reduceCallCenter([watch({ platformSlug: 'digistore24', family: 'RetraBurn' })], orders, now);
    expect(r.rows[0].family).toBe('Retra Burn'); // exibe o nome do catálogo
    expect(r.rows[0].dormant).toBe(false);
    expect(r.rows[0].level).toBe('salesbound');
  });

  it('filtro por plataforma: vendas de OUTRA plataforma não contam', () => {
    const orders = mk(200, 1, { platformSlug: 'digistore24' });
    const r = reduceCallCenter([watch({ platformSlug: 'buygoods' })], orders, now);
    expect(r.rows[0].avg3d).toBe(0);
    expect(r.rows[0].dormant).toBe(true);
    expect(r.rows[0].level).toBe('ok');
  });

  it('wildcard (family null): uma linha POR FAMÍLIA da plataforma', () => {
    const orders = [
      ...mk(35, 1, { platformSlug: 'jvzoo', family: 'Hawaiian Harmony' }),
      ...mk(35, 2, { platformSlug: 'jvzoo', family: 'Hawaiian Harmony' }),
      ...mk(35, 3, { platformSlug: 'jvzoo', family: 'Hawaiian Harmony' }),
      ...mk(2, 1, { platformSlug: 'jvzoo', family: 'MindTrex' }),
      ...mk(50, 1, { platformSlug: 'buygoods' }), // outra plataforma — fora
    ];
    const r = reduceCallCenter([watch({ id: 'wj', platformSlug: 'jvzoo', family: null })], orders, now);
    expect(r.rows.length).toBe(2);
    const hh = r.rows.find((x) => x.family === 'Hawaiian Harmony')!;
    expect(hh.level).toBe('tauk');
    expect(r.rows.find((x) => x.family === 'MindTrex')!.level).toBe('ok');
    expect(r.alerts.length).toBe(1);
  });

  it('produto sem família usa o nome do produto como agrupador', () => {
    const orders = mk(3, 1, { platformSlug: 'jvzoo', family: null, productName: 'Produto Novo X' });
    const r = reduceCallCenter([watch({ platformSlug: 'jvzoo', family: null })], orders, now);
    expect(r.rows[0].family).toBe('Produto Novo X');
  });

  it('watch dormente (produto ainda sem vendas) aparece zerado, sem alerta', () => {
    const r = reduceCallCenter([watch({ family: 'HeartFlush' })], [], now);
    expect(r.rows[0]).toMatchObject({ family: 'HeartFlush', dormant: true, avg3d: 0, level: 'ok' });
    expect(r.alerts.length).toBe(0);
  });

  it('wildcard NÃO duplica família já coberta por watch explícito da mesma plataforma', () => {
    const orders = [
      ...mk(35, 1, { platformSlug: 'jvzoo', family: 'Hawaiian Harmony' }),
      ...mk(35, 2, { platformSlug: 'jvzoo', family: 'Hawaiian Harmony' }),
      ...mk(35, 3, { platformSlug: 'jvzoo', family: 'Hawaiian Harmony' }),
      ...mk(2, 1, { platformSlug: 'jvzoo', family: 'MindTrex' }),
    ];
    const r = reduceCallCenter([
      watch({ id: 'we', platformSlug: 'jvzoo', family: 'Hawaiian Harmony' }),
      watch({ id: 'wj', platformSlug: 'jvzoo', family: null }),
    ], orders, now);
    const hh = r.rows.filter((x) => x.family === 'Hawaiian Harmony');
    expect(hh.length).toBe(1); // sem linha duplicada
    expect(hh[0].watchId).toBe('we'); // precedência do explícito
    expect(hh[0].wildcard).toBe(false);
    expect(r.alerts.length).toBe(1);
    expect(r.rows.find((x) => x.family === 'MindTrex')!.wildcard).toBe(true);
  });

  it('flag wildcard marcada nas linhas do monitor de plataforma inteira', () => {
    const r = reduceCallCenter([watch({ platformSlug: 'jvzoo', family: null })], [], now);
    expect(r.rows[0].wildcard).toBe(true);
    const r2 = reduceCallCenter([watch()], [], now);
    expect(r2.rows[0].wildcard).toBe(false);
  });

  it('fallback por PREFIXO só pra produto SEM família no catálogo', () => {
    // "HeartFlush" ainda não classificado: orders com family null e nome longo.
    const orders = [
      ...mk(31, 1, { family: null, productName: 'HeartFlush Trial Pack' }),
      ...mk(31, 2, { family: null, productName: 'Heart Flush 6 Bottles' }),
      ...mk(31, 3, { family: null, productName: 'HeartFlush Trial Pack' }),
    ];
    const r = reduceCallCenter([watch({ family: 'HeartFlush' })], orders, now);
    expect(r.rows[0].dormant).toBe(false);
    expect(r.rows[0].family).toBe('HeartFlush');
    expect(r.rows[0].avg3d).toBe(31 * 2 / 3 + 31 / 3); // soma dos dois SKUs
    expect(r.rows[0].level).toBe('tauk');
  });

  it('prefixo NÃO se aplica a famílias reais do catálogo (Lumicept ≠ Lumicept Gummies)', () => {
    const orders = mk(200, 1, { family: 'Lumicept Gummies' });
    const r = reduceCallCenter([watch({ family: 'Lumicept' })], orders, now);
    expect(r.rows[0].dormant).toBe(true);
    expect(r.rows[0].avg3d).toBe(0);
  });

  it('pico de 1 dia NÃO dispara (média 3d resiste a outlier)', () => {
    const orders = [...mk(80, 1), ...mk(2, 2), ...mk(2, 3)];
    const r = reduceCallCenter([watch()], orders, now);
    expect(r.rows[0].avg3d).toBe(28);
    expect(r.rows[0].level).toBe('ok');
    expect(r.rows[0].peak7d).toBe(80);
  });
});
