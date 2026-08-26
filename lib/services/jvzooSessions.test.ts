import { describe, expect, it } from 'vitest';
import { isPrevDaySession, planJvzooRoles, type JvzooSessionRow } from './jvzooSessions';

const t0 = new Date('2026-08-25T14:00:00Z');
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const row = (over: Partial<JvzooSessionRow> & { id: string }): JvzooSessionRow => ({
  externalId: 'TX' + over.id,
  orderedAt: at(0),
  marked: null,
  memoryType: 'FRONTEND',
  family: 'NeuroMindPro',
  bottles: 6,
  current: { productType: 'FRONTEND', funnelStep: null, parentExternalId: null },
  ...over,
});
const byId = (plans: ReturnType<typeof planJvzooRoles>) => Object.fromEntries(plans.map((p) => [p.id, p]));

describe('planJvzooRoles — papel pela sessão', () => {
  it('nome marcado manda: FE + OTO1 + DS2; parent = FE', () => {
    const p = byId(planJvzooRoles([
      row({ id: 'a', marked: { type: 'FRONTEND', step: 1 } }),
      row({ id: 'b', orderedAt: at(1), marked: { type: 'UPSELL', step: 2 }, bottles: 12 }),
      row({ id: 'c', orderedAt: at(3), marked: { type: 'DOWNSELL', step: 3 }, family: 'DigestFlow', bottles: 3 }),
    ]));
    expect(p.a).toMatchObject({ productType: 'FRONTEND', funnelStep: 1, parentExternalId: 'TXa' });
    expect(p.b).toMatchObject({ productType: 'UPSELL', funnelStep: 2, parentExternalId: 'TXa' });
    expect(p.c).toMatchObject({ productType: 'DOWNSELL', funnelStep: 3, parentExternalId: 'TXa' });
  });

  it('sem marcador: mais antiga = FE; menos potes da mesma família = DOWNSELL; senão UPSELL', () => {
    const p = byId(planJvzooRoles([
      row({ id: 'fe', bottles: 6 }),
      row({ id: 'ds', orderedAt: at(2), bottles: 3 }),                     // 3 < 6, mesma família
      row({ id: 'up', orderedAt: at(4), family: 'DigestFlow', bottles: 6 }), // família diferente → upsell
    ]));
    expect(p.fe).toMatchObject({ productType: 'FRONTEND', funnelStep: 1 });
    expect(p.ds).toMatchObject({ productType: 'DOWNSELL', funnelStep: 2 });
    expect(p.up).toMatchObject({ productType: 'UPSELL', funnelStep: 3 });
  });

  it('memória do catálogo: SKU sem marcador hoje mas já gravado como UPSELL continua UPSELL', () => {
    const p = byId(planJvzooRoles([
      row({ id: 'fe' }),
      row({ id: 'x', orderedAt: at(1), memoryType: 'UPSELL', bottles: 3 }), // potes diriam downsell; memória vence
    ]));
    expect(p.x).toMatchObject({ productType: 'UPSELL', funnelStep: 2 });
  });

  it('memória backend nunca vira âncora: a FE é a primeira sem opinião de backend', () => {
    const p = byId(planJvzooRoles([
      row({ id: 'oto', orderedAt: at(0), memoryType: 'UPSELL', bottles: 12 }), // IPN chegou antes, mas é OTO conhecido
      row({ id: 'fe', orderedAt: at(1) }),
    ]));
    expect(p.fe).toMatchObject({ productType: 'FRONTEND', funnelStep: 1, parentExternalId: 'TXfe' });
    expect(p.oto).toMatchObject({ productType: 'UPSELL', parentExternalId: 'TXfe' });
  });

  it('sessão só de backend (órfã): âncora continua com o papel do nome, não vira FE', () => {
    const p = byId(planJvzooRoles([
      row({ id: 'oto', marked: { type: 'UPSELL', step: 2 }, bottles: 12 }),
    ]));
    expect(p.oto).toMatchObject({ productType: 'UPSELL', funnelStep: 2, parentExternalId: 'TXoto' });
  });

  it('FE marcada que chegou depois no relógio de parede ainda ancora (fora de ordem)', () => {
    const p = byId(planJvzooRoles([
      row({ id: 'up', orderedAt: at(0), marked: { type: 'UPSELL', step: 2 } }),
      row({ id: 'fe', orderedAt: at(1), marked: { type: 'FRONTEND', step: 1 } }),
    ]));
    expect(p.fe.productType).toBe('FRONTEND');
    expect(p.up.parentExternalId).toBe('TXfe');
  });

  it('ordem estável: mesma hora desempata por id', () => {
    const p = byId(planJvzooRoles([row({ id: 'b' }), row({ id: 'a' })]));
    expect(p.a.productType).toBe('FRONTEND');
    expect(p.b).toMatchObject({ productType: 'UPSELL', funnelStep: 2 });
  });
});

describe('isPrevDaySession', () => {
  it('mesmo cliente, dia anterior', () => {
    expect(isPrevDaySession('jvz:a@b.com:2026-08-26', 'jvz:a@b.com:2026-08-25')).toBe(true);
    expect(isPrevDaySession('jvz:a@b.com:2026-09-01', 'jvz:a@b.com:2026-08-31')).toBe(true);
  });
  it('outro cliente, outro dia, chave que não é de sessão', () => {
    expect(isPrevDaySession('jvz:a@b.com:2026-08-26', 'jvz:c@d.com:2026-08-25')).toBe(false);
    expect(isPrevDaySession('jvz:a@b.com:2026-08-26', 'jvz:a@b.com:2026-08-24')).toBe(false);
    expect(isPrevDaySession('jvz:a@b.com:2026-08-26', 'TX123')).toBe(false);
    expect(isPrevDaySession('jvz:a@b.com:2026-08-26', null)).toBe(false);
  });
});
