import { describe, expect, it } from 'vitest';
import { gradeAnswer, nullInput, oracleInput, renderAnswer, scopeMatches, type AppliedScope, type FactExpectation, type GradeInput } from './grader';
import { GOLDEN_CASES } from './goldens';
import { resolveDate, type GoldenCase, type Lens } from './spec';

const NOW = new Date('2026-09-30T17:00:00Z');
const NAMES = ['Alfa Media', 'Bravo Ads', 'Charlie Leads', 'Delta Tráfego', 'Echo Growth'];

// Valores sintéticos por lente (distintos entre lentes — a troca de lente
// precisa ser detectável). Fato "absolute" vem negativo: queda.
function syntheticLens(l: Lens, kind: FactExpectation['kind'], j: number, absolute: boolean) {
  const k = l.kind ?? kind;
  const sign = absolute ? -1 : 1;
  const path = l.source?.path ?? '';
  if (k === 'text') {
    if (l.calc?.op === 'dominant') return { items: [l.calc.labels![0].split('|')], list: false };
    if (/\[\d+\.\.\d+\]/.test(path)) return { items: NAMES.map((n) => [n]), list: true };
    return { items: [[NAMES[j]]], list: false };
  }
  const base = { usd: 154_318.42, ratio: 0.0823, pct: 8.23, int: 1_234, number: 42.5 }[k];
  const step = { usd: 1_000, ratio: 0.01, pct: 1, int: 10, number: 1 }[k];
  return { items: [[sign * (base + j * step)]], list: false };
}

function synthetic(spec: GoldenCase): { facts: FactExpectation[]; expectedArgs: Array<AppliedScope | null> } {
  const facts: FactExpectation[] = (spec.facts ?? []).map((f) => ({
    label: f.label,
    kind: f.kind,
    tol: f.tol,
    ordered: f.ordered,
    absolute: f.absolute,
    lenses: f.lenses.map((l, j) => ({ name: l.name, kind: l.kind ?? f.kind, keywords: l.keywords ?? [], value: syntheticLens(l, f.kind, j, !!f.absolute) })),
  }));
  const expectedArgs = (spec.tools ?? []).map((t) => {
    if (!t.args) return null;
    const a = t.args as Record<string, unknown>;
    const exp: AppliedScope = {};
    if (typeof a.start_date === 'string') exp.start = `${resolveDate(a.start_date, NOW)}T03:00:00.000Z`;
    if (typeof a.end_date === 'string') exp.end = `${resolveDate(a.end_date, NOW)}T03:00:00.000Z`;
    if (Array.isArray(a.platforms)) exp.platforms = a.platforms as string[];
    if (Array.isArray(a.families)) exp.families = a.families as string[];
    return exp;
  });
  return { facts, expectedArgs };
}

const byId = (id: string) => GOLDEN_CASES.find((c) => c.id === id)!;

function answer(spec: GoldenCase, text: string, extra: Partial<GradeInput> = {}): GradeInput {
  const { facts, expectedArgs } = synthetic(spec);
  const calls = (spec.tools ?? []).map((t, i) => ({ name: t.anyOf[0], input: {}, applied: expectedArgs[i] ?? {} }));
  return { spec, turnStatus: 'ok', text, blocks: null, citations: [], calls, rounds: 2, inputTokens: 10_000, facts, expectedArgs, ...extra };
}

const check = (g: ReturnType<typeof gradeAnswer>, id: string) => g.checks.find((c) => c.id === id);

describe('selftest do grader sobre o golden set', () => {
  it.each(GOLDEN_CASES.map((c) => [c.id, c] as const))('%s: oráculo passa, nulo não', (_id, spec) => {
    const { facts, expectedArgs } = synthetic(spec);
    const oracle = gradeAnswer(oracleInput(spec, facts, expectedArgs));
    expect(oracle.status, JSON.stringify(oracle.checks.filter((c) => c.status !== 'pass' && c.status !== 'skip'))).toBe('pass');
    expect(oracle.score).toBe(1);
    const nul = gradeAnswer(nullInput(spec, facts, expectedArgs));
    expect(nul.status).not.toBe('pass');
    if (facts.length || spec.unavailable) expect(nul.status).toBe('fail');
  });

  it.each(GOLDEN_CASES.filter((c) => c.facts?.length).map((c) => [c.id, c] as const))('%s: valor errado (×1,07) reprova', (_id, spec) => {
    const { facts, expectedArgs } = synthetic(spec);
    expect(gradeAnswer(oracleInput(spec, facts, expectedArgs, 'wrong_value')).status).toBe('fail');
  });

  it.each(
    GOLDEN_CASES.filter((c) => c.facts?.some((f) => f.lenses.some((l) => (l.kind ?? f.kind) === 'ratio' || (l.kind ?? f.kind) === 'pct'))).map((c) => [c.id, c] as const),
  )('%s: fração exibida como % reprova na unidade', (_id, spec) => {
    const { facts, expectedArgs } = synthetic(spec);
    const g = gradeAnswer(oracleInput(spec, facts, expectedArgs, 'wrong_unit'));
    expect(check(g, 'unit')?.status).toBe('fail');
    expect(g.status).toBe('fail');
  });
});

describe('regras específicas', () => {
  it('número pt-BR arredondado passa; grosseiro não', () => {
    const spec = byId('G01');
    expect(gradeAnswer(answer(spec, 'Faturamos $ 154,3 mil em agosto.')).status).toBe('pass');
    expect(gradeAnswer(answer(spec, 'Faturamos $ 150 mil em agosto.')).status).toBe('fail');
  });

  it('lente certa sem nome = lens_mismatch (partial); nomeada = pass', () => {
    const spec = byId('G13'); // caixa-pedidos = 9.23%
    const bare = gradeAnswer(answer(spec, 'A taxa de reembolso de agosto foi 9.23%.'));
    expect(check(bare, 'fact:taxa de reembolso')?.status).toBe('lens_mismatch');
    expect(bare.status).toBe('partial');
    const named = gradeAnswer(answer(spec, 'Foram 9.23% dos pedidos estornados no período (lente caixa, pela data do estorno).'));
    expect(named.status).toBe('pass');
    // Coorte é fração no resultado (0.1123) → 11.23% na resposta
    expect(gradeAnswer(answer(spec, 'Pela coorte projetada, 11.2% das vendas de agosto devem voltar.')).status).toBe('pass');
  });

  it('hedge sobre número exato vira partial', () => {
    const g = gradeAnswer(answer(byId('G01'), 'Faturamos cerca de $154,318 em agosto.'));
    expect(check(g, 'hedge')?.status).toBe('fail');
    expect(g.status).toBe('partial');
  });

  it('negar dado disponível é falha crítica', () => {
    const g = gradeAnswer(answer(byId('G01'), 'Não tenho acesso a esses dados de faturamento.'));
    expect(check(g, 'false_denial')?.status).toBe('fail');
    expect(g.status).toBe('fail');
  });

  it('dado indisponível: dizer que não existe passa; inventar número reprova', () => {
    const spec = byId('G24');
    expect(gradeAnswer(answer(spec, 'O dashboard não rastreia visitantes nem cliques, então não dá pra calcular EPC. O mais próximo é o EPO: net ÷ sessões com FE.')).status).toBe('pass');
    const invented = gradeAnswer(answer(spec, 'O EPC de agosto foi $1.23 por clique.'));
    expect(invented.status).toBe('fail');
  });

  it('filtro herdado indevidamente (dêitico reverso) reprova nos args', () => {
    const spec = byId('G23');
    const { facts, expectedArgs } = synthetic(spec);
    const g = gradeAnswer({
      ...answer(spec, 'Vendemos $154,318.42 em agosto de 2026.'),
      facts,
      calls: [{ name: 'get_overview', input: {}, applied: { ...expectedArgs[0], families: ['GlycoPulse'] } }],
    });
    expect(check(g, 'args:0')?.status).toBe('fail');
    expect(g.status).toBe('partial');
  });

  it('avalia o que a UI mostra: número nos blocos (formatCell) conta', () => {
    const spec = byId('G01');
    const blocks = [
      { type: 'summary', title: 'Agosto', kpis: [{ label: 'Receita bruta', value: '$154,318.42' }] },
      { type: 'table', columns: [{ key: 'p', label: 'Plataforma' }, { key: 'g', label: 'Receita', format: 'currency' }], rows: [{ p: 'ClickBank', g: 154318.42 }] },
      { type: 'chart', title: 'série', series: [{ name: 's', data: [{ x: '2026-08-01', y: 999 }] }] },
    ];
    const g = gradeAnswer(answer(spec, 'Resumo abaixo. [[cite:1]]', { blocks }));
    expect(g.status).toBe('pass');
    expect(g.answer).not.toContain('[[cite');
    expect(renderAnswer('x', blocks)).not.toContain('999');
  });

  it('valor em R$ reprova (tudo é USD)', () => {
    expect(gradeAnswer(answer(byId('G01'), 'Faturamos $154,318.42 (R$ 800 mil).')).status).toBe('fail');
  });

  it('get_orders com hasMore sem a página seguinte reprova a paginação', () => {
    const spec = byId('G28');
    const { expectedArgs } = synthetic(spec);
    const page = (offset: number, hasMore: boolean) => ({ name: 'get_orders', input: { offset }, applied: expectedArgs[0], result: { page: { hasMore } } });
    const text = 'São 1,234 chargebacks em agosto.';
    expect(check(gradeAnswer(answer(spec, text, { calls: [page(0, true)] })), 'paginate')?.status).toBe('fail');
    expect(check(gradeAnswer(answer(spec, text, { calls: [page(0, true), page(1000, false)] })), 'paginate')?.status).toBe('pass');
  });

  it('direção errada é crítica', () => {
    const spec = byId('G10'); // variação sintética −8.23% → caiu
    expect(gradeAnswer(answer(spec, 'A receita de ontem caiu 8.23% contra anteontem.')).status).toBe('pass');
    expect(gradeAnswer(answer(spec, 'A receita de ontem subiu 8.23% contra anteontem.')).status).toBe('fail');
  });

  it('dado que mexeu entre antes e depois vira inconclusive, não fail', () => {
    const spec = byId('G01');
    const input = answer(spec, 'Faturamos $160,000.00.');
    input.facts[0].lenses[0].after = { items: [[170_000]], list: false };
    expect(gradeAnswer(input).status).toBe('inconclusive');
    // e o número "depois" também é aceito
    input.text = 'Faturamos $170,000.00.';
    expect(gradeAnswer(input).status).toBe('pass');
  });

  it('turno truncado/recusado/erro tem status próprio', () => {
    expect(gradeAnswer(answer(byId('G01'), '$154,318.42', { turnStatus: 'max_tokens' })).status).toBe('truncated');
    expect(gradeAnswer(answer(byId('G01'), '', { turnStatus: 'refusal' })).status).toBe('refusal');
    expect(gradeAnswer(answer(byId('G01'), '', { turnStatus: 'error' })).status).toBe('error');
  });

  it('fidelidade: números sem fonte nos resultados aparecem como não rastreados', () => {
    const spec = byId('G01');
    const g = gradeAnswer(answer(spec, 'Faturamos $154,318.42; aprovação de 91.2%; margem de $777.', {
      calls: [{ name: 'get_overview', input: {}, applied: synthetic(spec).expectedArgs[0], result: { kpis: { gross: 154318.42, approvalRate: 0.912 } } }],
    }));
    expect(g.soft.faithfulness).toBeCloseTo(2 / 3, 3);
    expect(g.soft.untraced).toEqual(['$777']);
    expect(g.soft.firstFactAt).toBe(10);
  });
});

describe('scopeMatches', () => {
  it('datas com ±1s e listas como conjunto; lista vazia exige ausência', () => {
    const actual: AppliedScope = { start: '2026-08-01T03:00:00.000Z', end: '2026-09-01T02:59:59.999Z', platforms: ['ClickBank'] };
    expect(scopeMatches(actual, { start: '2026-08-01T03:00:00.500Z', platforms: ['clickbank'] })).toBe(true);
    expect(scopeMatches(actual, { families: [] })).toBe(true);
    expect(scopeMatches({ ...actual, families: ['GlycoPulse'] }, { families: [] })).toBe(false);
    expect(scopeMatches(actual, { end: '2026-08-31T02:59:59.999Z' })).toBe(false);
    expect(scopeMatches(null, {})).toBe(false);
  });
});
