import { beforeEach, describe, expect, it, vi } from 'vitest';

// Banco em memória: só o que as pesquisas usam nestes fluxos.
type Row = Record<string, any> & { id: string };
const mem = vi.hoisted(() => ({
  variants: [] as Row[],
  invites: [] as Row[],
  experiments: [] as Row[],
  families: new Set<string>(),
}));
const mockDb = vi.hoisted(() => {
  const byId = (rows: Row[], id: string): Row | null => rows.find((r) => r.id === id) ?? null;
  const matches = (row: Row, where: Record<string, any> = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'NOT') return !matches(row, v);
    if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
    return row[k] === v;
  });
  return {
    surveyVariant: {
      findUnique: vi.fn(async ({ where }: any) => mem.variants.find((v) => (where.slug ? v.slug === where.slug : v.id === where.id)) ?? null),
      findFirst: vi.fn(async ({ where }: any = {}) => mem.variants.find((v) => matches(v, where)) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const v = mem.variants.find((x) => (where.slug ? x.slug === where.slug : x.id === where.id))!;
        for (const [k, val] of Object.entries(data)) v[k] = k === 'version' && (val as any).increment ? v.version + (val as any).increment : val;
        v.updatedAt = new Date();
        return v;
      }),
      create: vi.fn(async ({ data }: any) => {
        const v = { id: `v${mem.variants.length + 1}`, version: 1, createdAt: new Date(), updatedAt: new Date(), ...data };
        mem.variants.push(v);
        return v;
      }),
    },
    surveyInvite: {
      findUnique: vi.fn(async ({ where }: any) => {
        const i = mem.invites.find((x) => x.token === where.token);
        if (!i) return null;
        return { ...i, variant: byId(mem.variants, i.variantId), response: i.response ?? null, experiment: i.experimentId ? byId(mem.experiments, i.experimentId) : null };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const i = byId(mem.invites, where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (k === 'experiment') i.experimentId = (v as any).connect.id;
          else i[k] = v;
        }
        return i;
      }),
    },
    surveyExperiment: {
      findFirst: vi.fn(async ({ where }: any) => mem.experiments.find((e) => matches(e, where)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => {
        const e = byId(mem.experiments, where.id);
        return e ? { ...e, variant: byId(mem.variants, e.variantId) } : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const e = byId(mem.experiments, where.id)!;
        return { ...e, variant: byId(mem.variants, e.variantId) };
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(byId(mem.experiments, where.id)!, data)),
      create: vi.fn(async ({ data }: any) => {
        const e = { id: `e${mem.experiments.length + 1}`, status: 'running', winner: null, startedAt: new Date(), endedAt: null, createdBy: null, ...data };
        mem.experiments.push(e);
        return e;
      }),
    },
    product: { count: vi.fn(async ({ where }: any) => (mem.families.has(where.family) ? 1 : 0)) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
});
vi.mock('../db', () => ({ db: mockDb, dbRead: mockDb }));

import {
  createSurveyExperiment, createSurveyVariant, surveyPageHtml, updateSurveyExperiment, updateSurveyVariant,
} from './surveys';

const CFG = {
  productName: 'NeuroRecall', eligibleBottles: [2, 3], fullPlanFrom: 6, planBottles: 6, daysPerBottle: 30, trackingParam: 'src',
  frontPrices: { 2: 158, 6: 294 },
  offers: {
    assinatura: { url: 'https://vupim.com/c/1', firstPrice: 69, monthlyPrice: 69 },
    kits: { 6: { url: 'https://vupim.com/c/6', price: 234, everyMonths: 6 } },
  },
  coupons: [{ pct: 10, code: 'KEEP10' }],
  couponValidDays: 7,
  q4: [],
  image: '/survey-assets/neurorecall.webp',
};
const B_CFG = { ...structuredClone(CFG), offers: { ...structuredClone(CFG.offers), assinatura: { url: 'https://vupim.com/c/1', firstPrice: 59, monthlyPrice: 59 } } };
const TOKEN = 'tok_0123456789abcdef';

beforeEach(() => {
  mem.variants.length = 0;
  mem.invites.length = 0;
  mem.experiments.length = 0;
  mem.families = new Set(['NeuroRecall', 'GlycoPulse']);
  mem.variants.push({ id: 'v1', slug: 'neurorecall', name: 'NeuroRecall', family: 'NeuroRecall', active: true, version: 3, config: structuredClone(CFG), createdAt: new Date(), updatedAt: new Date() });
  mem.invites.push({ id: 'i1', token: TOKEN, variantId: 'v1', email: 'a@b.com', firstName: 'Ann', bottles: 3, stockUntil: new Date(Date.now() + 5 * 86400000), openedAt: null, experimentId: null, arm: null, response: null });
});

describe('teste A/B na página pública', () => {
  it('sorteia na 1ª abertura, grava a versão e mostra a oferta dela', async () => {
    // A com peso 0: o sorteio cai sempre na B.
    mem.experiments.push({ id: 'e1', variantId: 'v1', status: 'running', name: 't', arms: [{ key: 'A', name: 'A', weight: 0 }, { key: 'B', name: 'B', weight: 100, config: B_CFG }], startedAt: new Date() });
    const { status, html } = await surveyPageHtml('neurorecall', TOKEN);
    expect(status).toBe(200);
    expect(mem.invites[0]).toMatchObject({ experimentId: 'e1', arm: 'B' });
    expect(mem.invites[0].openedAt).toBeInstanceOf(Date);
    expect(html).toContain('$59');
    expect(html).not.toContain('$69');
  });

  it('quem já começou a responder antes do teste fica de fora (vê a pesquisa como está)', async () => {
    mem.invites[0].response = { id: 'r1', answers: { q1: 'testar' }, completedAt: null };
    mem.invites[0].openedAt = new Date();
    mem.experiments.push({ id: 'e1', variantId: 'v1', status: 'running', name: 't', arms: [{ key: 'A', name: 'A', weight: 0 }, { key: 'B', name: 'B', weight: 100, config: B_CFG }], startedAt: new Date() });
    const { html } = await surveyPageHtml('neurorecall', TOKEN);
    expect(mem.invites[0].experimentId).toBeNull();
    expect(html).toContain('$69');
  });

  it('teste encerrado: quem caiu na B e não começou volta pra pesquisa como está', async () => {
    mem.experiments.push({ id: 'e1', variantId: 'v1', status: 'stopped', name: 't', arms: [{ key: 'A', name: 'A', weight: 50 }, { key: 'B', name: 'B', weight: 50, config: B_CFG }], startedAt: new Date() });
    Object.assign(mem.invites[0], { experimentId: 'e1', arm: 'B', openedAt: new Date() });
    const { html } = await surveyPageHtml('neurorecall', TOKEN);
    expect(html).toContain('$69');
    expect(html).not.toContain('$59');
  });
});

describe('ciclo do teste', () => {
  it('não começa com a versão B igual à A', async () => {
    const res = await createSurveyExperiment('neurorecall', { name: 'x', arms: [{}, { config: structuredClone(CFG) }] }, 'adm');
    expect(res).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('igual à atual') });
  });

  it('um teste por vez', async () => {
    const arms = [{}, { config: B_CFG }];
    expect((await createSurveyExperiment('neurorecall', { name: 'x', arms }, 'adm')).ok).toBe(true);
    expect(await createSurveyExperiment('neurorecall', { name: 'y', arms }, 'adm')).toMatchObject({ ok: false, status: 409 });
  });

  it('encerrar publicando a B troca a config da pesquisa (versão + 1) e guarda a A de antes', async () => {
    const created = await createSurveyExperiment('neurorecall', { name: 'Assinatura 59', arms: [{}, { name: 'B', config: B_CFG }] }, 'adm');
    if (!created.ok) throw new Error(created.error);
    expect(created.experiment.arms[1].changes).toContain('Assinatura: US$ 69 → US$ 59 por mês');

    const res = await updateSurveyExperiment(created.experiment.id, { action: 'stop', winner: 'B' });
    expect(res.ok).toBe(true);
    const v = mem.variants[0];
    expect(v.version).toBe(4);
    expect(v.config.offers.assinatura.monthlyPrice).toBe(59);
    // Público e rastreio continuam os da pesquisa.
    expect(v.config.eligibleBottles).toEqual([2, 3]);
    const e = mem.experiments[0];
    expect(e).toMatchObject({ status: 'stopped', winner: 'B' });
    expect(e.arms[0].snapshot.offers.assinatura.monthlyPrice).toBe(69);
    // No histórico, o "o que muda" segue comparando com a A de antes.
    if (res.ok) expect(res.experiment.arms[1].changes).toContain('Assinatura: US$ 69 → US$ 59 por mês');
    expect(await updateSurveyExperiment(created.experiment.id, { action: 'stop' })).toMatchObject({ ok: false, status: 409 });
  });

  it('encerrar mantendo a A não mexe na pesquisa', async () => {
    const created = await createSurveyExperiment('neurorecall', { name: 'x', arms: [{}, { config: B_CFG }] }, 'adm');
    if (!created.ok) throw new Error(created.error);
    await updateSurveyExperiment(created.experiment.id, { action: 'stop', winner: 'A' });
    expect(mem.variants[0].version).toBe(3);
    expect(mem.variants[0].config.offers.assinatura.monthlyPrice).toBe(69);
  });
});

describe('pesquisa nova', () => {
  it('de outro produto: nasce desligada, sem links, códigos de cupom nem foto', async () => {
    const res = await createSurveyVariant({ slug: 'glycopulse', name: 'GlycoPulse', family: 'GlycoPulse', from: 'neurorecall' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.variant.config;
    expect(res.variant.active).toBe(false);
    expect(c.productName).toBe('GlycoPulse');
    expect(c.offers?.assinatura?.url).toBeNull();
    expect(c.offers?.kits?.['6']).toMatchObject({ url: null, price: 234 });
    expect(c.coupons).toEqual([{ pct: 10, code: null }]);
    expect(c.image).toBeUndefined();
  });

  it('recusa endereço inválido, repetido ou produto fora do catálogo', async () => {
    expect(await createSurveyVariant({ slug: 'API', name: 'x', family: 'GlycoPulse' })).toMatchObject({ ok: false, status: 400 });
    expect(await createSurveyVariant({ slug: 'api', name: 'x', family: 'GlycoPulse' })).toMatchObject({ ok: false, status: 400 });
    expect(await createSurveyVariant({ slug: 'neurorecall', name: 'x', family: 'GlycoPulse' })).toMatchObject({ ok: false, status: 409 });
    expect(await createSurveyVariant({ slug: 'novo', name: 'x', family: 'Inexistente' })).toMatchObject({ ok: false, status: 400 });
  });

  it('não liga duas pesquisas pro mesmo produto', async () => {
    const res = await createSurveyVariant({ slug: 'neurorecall-2', name: 'NR 2', family: 'NeuroRecall', from: 'neurorecall' });
    expect(res.ok).toBe(true);
    // Mesmo produto da origem: os links vêm junto.
    if (res.ok) expect(res.variant.config.offers?.assinatura?.url).toBe('https://vupim.com/c/1');
    expect(await updateSurveyVariant('neurorecall-2', { active: true })).toMatchObject({ ok: false, status: 409 });
    await updateSurveyVariant('neurorecall', { active: false });
    expect(await updateSurveyVariant('neurorecall-2', { active: true })).toMatchObject({ ok: true });
  });
});
