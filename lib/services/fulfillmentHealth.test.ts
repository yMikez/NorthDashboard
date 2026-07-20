import { describe, it, expect } from 'vitest';
import {
  classifyFulfillmentHealth, resolveOrderSupplier,
  type HealthOrderRow, type HealthCatalogInput,
} from './fulfillmentHealth';

const catalog = (over: Partial<HealthCatalogInput> = {}): HealthCatalogInput => ({
  familySupplier: new Map([
    ['NeuroMindPro', 'redrock'],
    ['GlycoPulse', 'shipoffers'],
  ]),
  ratedKeys: new Set(['redrock|NeuroMindPro', 'shipoffers|_default']),
  ...over,
});

const row = (over: Partial<HealthOrderRow> = {}): HealthOrderRow => ({
  platformSlug: 'digistore24',
  productExternalId: 'P1',
  productName: 'NeuroMind 6 Bottles',
  family: 'NeuroMindPro',
  totalBottles: 6,
  supplierOverride: null,
  ...over,
});

describe('resolveOrderSupplier', () => {
  it('override do SKU > default da família > shipoffers', () => {
    const fs = catalog().familySupplier;
    expect(resolveOrderSupplier({ family: 'NeuroMindPro', supplierOverride: 'fullstack' }, fs)).toBe('fullstack');
    expect(resolveOrderSupplier({ family: 'NeuroMindPro', supplierOverride: null }, fs)).toBe('redrock');
    expect(resolveOrderSupplier({ family: 'Desconhecida', supplierOverride: null }, fs)).toBe('shipoffers');
    expect(resolveOrderSupplier({ family: null, supplierOverride: null }, fs)).toBe('shipoffers');
  });
});

describe('classifyFulfillmentHealth', () => {
  it('pedido saudável → cobertura 100 e sem issues', () => {
    const r = classifyFulfillmentHealth([row(), row()], catalog());
    expect(r.kpis).toEqual({ approvedOrders: 2, resolvedOrders: 2, coveragePct: 100 });
    expect(r.issues).toEqual([]);
  });

  it('SKU sem potes bloqueia a cobertura e lista o SKU', () => {
    const r = classifyFulfillmentHealth([row(), row({ productExternalId: 'P2', productName: 'Mistério', totalBottles: 0 })], catalog());
    expect(r.kpis.coveragePct).toBe(50);
    const issue = r.issues.find((i) => i.type === 'no_bottles')!;
    expect(issue.blocking).toBe(true);
    expect(issue.orders).toBe(1);
    expect(issue.skus[0]).toMatchObject({ externalId: 'P2', orders: 1 });
  });

  it('sem família / família sem custo / sem tarifa — todos bloqueantes', () => {
    const rows: HealthOrderRow[] = [
      row({ productExternalId: 'A', family: null }),                       // no_family (e shipoffers|_default tem rate)
      row({ productExternalId: 'B', family: 'FamNova' }),                  // family_no_cost (supplier default shipoffers TEM _default)
      // redrock SEM rate pra GlycoPulse e SEM _default → no_rate
      row({ productExternalId: 'C', family: 'GlycoPulse', supplierOverride: 'redrock' }),
    ];
    const r = classifyFulfillmentHealth(rows, catalog());
    expect(r.issues.map((i) => i.type).sort()).toEqual(['family_no_cost', 'no_family', 'no_rate']);
    expect(r.kpis.resolvedOrders).toBe(0);
  });

  it('mesmo pedido com N problemas conta UMA vez na cobertura', () => {
    const r = classifyFulfillmentHealth(
      [row({ family: null, totalBottles: 0 }), row({ productExternalId: 'OK' })],
      catalog(),
    );
    expect(r.kpis.approvedOrders).toBe(2);
    expect(r.kpis.resolvedOrders).toBe(1);
    expect(r.kpis.coveragePct).toBe(50);
  });

  it('fullstack é aviso (info) — NÃO derruba a cobertura', () => {
    const cat = catalog({
      familySupplier: new Map([['ThermoX', 'fullstack']]),
      ratedKeys: new Set(['fullstack|_default']),
    });
    const r = classifyFulfillmentHealth([row({ family: 'ThermoX' })], cat);
    expect(r.kpis.coveragePct).toBe(100);
    const issue = r.issues.find((i) => i.type === 'placeholder_supplier')!;
    expect(issue.blocking).toBe(false);
    expect(issue.orders).toBe(1);
  });

  it('sem pedidos no período → coveragePct null', () => {
    const r = classifyFulfillmentHealth([], catalog());
    expect(r.kpis.coveragePct).toBeNull();
  });
});
