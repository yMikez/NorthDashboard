import { describe, expect, it } from 'vitest';
import { CalcError, displayValue, evaluate, parseCalcInput, parsePath, resolvePath, runCalc, type CalcScope } from './calc';

const RESULTS: Record<string, unknown> = {
  r1: {
    kpis: { gross: 154318.42, net: 98000.5, approvalRate: 0.9123, orderGroups: 1241, aov: 124.35 },
    platforms: [
      { slug: 'clickbank', revenue: 80000, refundRate: 0.07, orders: 600 },
      { slug: 'digistore24', revenue: 50000, refundRate: 0.1045, orders: 400 },
      { slug: 'buygoods', revenue: 24318.42, refundRate: 0, orders: 241 },
    ],
    byFamily: { 'Lumicept Gummies': { gross: 1200 }, NeuroMindPro: { gross: 9000 } },
    windows: [{ label: 'Janela 1', rows: [{ revenue: 10 }, { revenue: 20 }] }, { label: 'Janela 2', rows: [{ revenue: 5 }, { revenue: null }] }],
    mixed: [1, '2.5', null],
    text: 'abc',
  },
  r2: { kpis: { gross: 140000, approvalRate: 0.9 } },
};

function scope(names: Record<string, number | null> = {}): CalcScope {
  return {
    ref: (r) => {
      if (!(r in RESULTS)) throw new CalcError(`$${r} não existe`);
      return RESULTS[r];
    },
    name: (n) => (Object.prototype.hasOwnProperty.call(names, n) ? names[n] : undefined),
  };
}

const ev = (expr: string, names?: Record<string, number | null>) => evaluate(expr, scope(names));

describe('calc — parser e precedência', () => {
  it('precedência, parênteses, potência associativa à direita e menos unário', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('2 ^ 3 ^ 2')).toBe(512);
    expect(ev('-2 ^ 2')).toBe(-4);
    expect(ev('2 ^ -1')).toBe(0.5);
    expect(ev('--3')).toBe(3);
    expect(ev('10 - 4 - 3')).toBe(3);
    expect(ev('12 / 4 / 3')).toBe(1);
    expect(ev('1e3 + .5')).toBe(1000.5);
    expect(ev('−5 + 2')).toBe(-3); // sinal tipográfico
  });

  it('tira ruído de ponto flutuante', () => {
    expect(ev('0.1 + 0.2')).toBe(0.3);
  });

  it('erros de sintaxe e caracteres fora da gramática (sem eval)', () => {
    expect(() => ev('1 +')).toThrow(/incompleta/);
    expect(() => ev('(1 + 2')).toThrow(/\)/);
    expect(() => ev('1 2')).toThrow(/sobrou/);
    expect(() => ev('12%')).toThrow(/%/);
    expect(() => ev('process.exit(1)')).toThrow(CalcError);
    expect(() => ev('constructor')).toThrow(/nome desconhecido/);
    expect(() => ev('constructor(1)')).toThrow(/função desconhecida/);
    expect(() => ev('toString()')).toThrow(/função desconhecida/);
    expect(() => ev('a; b')).toThrow(/caractere/);
    expect(() => ev('"x"')).toThrow(/caractere/);
  });

  it('separador de milhar é recusado (dentro de sum viraria dois argumentos)', () => {
    expect(() => ev('sum(1,234.56)')).toThrow(/milhar/);
    expect(ev('max(1, 234)')).toBe(234);
    expect(ev('max(1,2)')).toBe(2);
  });

  it('limites de tamanho e profundidade', () => {
    expect(() => ev('1+'.repeat(300) + '1')).toThrow(/500|longa/);
    expect(() => ev('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/aninhada/);
  });
});

describe('calc — referências $rN', () => {
  it('chaves, índices, [*], [campo=valor] e chave entre aspas', () => {
    expect(ev('$r1.kpis.gross')).toBe(154318.42);
    expect(ev('$r1.platforms[slug=digistore24].refundRate')).toBe(0.1045);
    expect(ev('$r1.platforms[slug=DIGISTORE24].orders')).toBe(400); // caixa diferente = 2ª chance
    expect(ev('$r1.platforms[0].revenue')).toBe(80000);
    expect(ev('$r1.platforms[-1].revenue')).toBe(24318.42);
    expect(ev('sum($r1.platforms[*].revenue)')).toBe(154318.42);
    expect(ev('$r1.byFamily["Lumicept Gummies"].gross')).toBe(1200);
    expect(ev('sum($r1.byFamily[*].gross)')).toBe(10200);
    expect(ev('$r1.platforms.length')).toBe(3);
    expect(() => ev('sum($r1.platforms)')).toThrow(/objeto/);
  });

  it('[*] encadeado achata listas aninhadas; nulos ficam de fora das agregações', () => {
    expect(ev('sum($r1.windows[*].rows[*].revenue)')).toBe(35);
    expect(ev('count($r1.windows[*].rows[*].revenue)')).toBe(3);
    expect(ev('avg($r1.mixed)')).toBe(1.75); // string numérica conta, null não
  });

  it('erros úteis: chave inexistente lista as chaves; filtro sem match lista os valores', () => {
    expect(() => ev('$r1.kpis.grosss')).toThrow(/chaves: gross, net/);
    expect(() => ev('$r1.platforms[slug=jvzoo].revenue')).toThrow(/existentes: clickbank, digistore24, buygoods/);
    expect(() => ev('$r1.platforms[9].revenue')).toThrow(/fora da lista/);
    expect(() => ev('$r1.kpis')).toThrow(/objeto/);
    expect(() => ev('$r1.text')).toThrow(/não numérico/);
    expect(() => ev('$r9.kpis.gross')).toThrow(/não existe/);
    expect(() => ev('$r1.platforms[*].nope')).toThrow(/não existe/);
  });

  it('lista em operação escalar exige agregação', () => {
    expect(() => ev('$r1.platforms[*].revenue * 2')).toThrow(/lista/);
    expect(() => ev('$r1.platforms[*].revenue')).toThrow(/lista/);
  });

  it('recusa __proto__/constructor/prototype em qualquer segmento', () => {
    expect(() => ev('$r1.__proto__.x')).toThrow(/proibida/);
    expect(() => ev('$r1.kpis.constructor')).toThrow(/proibida/);
    expect(() => ev('$r1["prototype"]')).toThrow(/proibida/);
    expect(() => ev('$r1.platforms[constructor=x].revenue')).toThrow(/proibida/);
    expect(() => parsePath('a.__proto__')).toThrow(/proibida/);
  });

  it('só propriedades PRÓPRIAS (nada herdado do protótipo)', () => {
    expect(() => resolvePath({ a: 1 }, parsePath('toString'), '$x')).toThrow(/não existe/);
    expect(() => resolvePath({ a: 1 }, parsePath('hasOwnProperty'), '$x')).toThrow(/não existe/);
  });
});

describe('calc — funções', () => {
  it('pct_change / share / cagr em PONTOS percentuais; pp_change de frações', () => {
    expect(ev('pct_change($r1.kpis.gross, $r2.kpis.gross)')).toBeCloseTo(10.2274, 3);
    expect(ev('share($r1.platforms[slug=clickbank].revenue, $r1.kpis.gross)')).toBeCloseTo(51.8408, 3);
    expect(ev('pp_change($r1.kpis.approvalRate, $r2.kpis.approvalRate)')).toBeCloseTo(1.23, 6);
    expect(ev('cagr(121, 100, 2)')).toBeCloseTo(10, 6);
  });

  it('média ponderada ≠ média simples; median/min/max/abs/round', () => {
    const w = ev('weighted_avg($r1.platforms[*].refundRate, $r1.platforms[*].orders)')!;
    const simple = ev('avg($r1.platforms[*].refundRate)')!;
    expect(w).toBeCloseTo((0.07 * 600 + 0.1045 * 400) / 1241, 9);
    expect(simple).toBeCloseTo((0.07 + 0.1045) / 3, 9);
    expect(ev('median(3, 1, 2, 10)')).toBe(2.5);
    expect(ev('min(3, -1, 2)')).toBe(-1);
    expect(ev('abs(-3.5)')).toBe(3.5);
    expect(ev('round(1.005, 2)')).toBe(1.01);
    expect(ev('round(-2.5)')).toBe(-3);
    expect(() => ev('round(1, 1.5)')).toThrow(/inteiro/);
  });

  it('divisão por zero: "/" é erro; safe_div devolve null; bases zero são erro', () => {
    expect(() => ev('1 / 0')).toThrow(/divisão por zero/);
    expect(ev('safe_div(1, 0)')).toBeNull();
    expect(ev('safe_div(1, 0) + 5')).toBeNull(); // null propaga
    expect(() => ev('pct_change(10, 0)')).toThrow(/base zero/);
    expect(() => ev('share(1, 0)')).toThrow(/total zero/);
    expect(() => ev('weighted_avg($r1.platforms[*].revenue, $r1.windows[*].rows[*].revenue)')).toThrow(/tamanhos diferentes/);
  });

  it('função desconhecida e aridade', () => {
    expect(() => ev('foo(1)')).toThrow(/desconhecida/);
    expect(() => ev('abs(1, 2)')).toThrow(/argumento/);
    expect(() => ev('sum')).toThrow(/é função/);
  });
});

describe('runCalc — lote nomeado', () => {
  it('nomes anteriores, unidade inferida, display US e gravação pro grounding', () => {
    const saved = new Map<string, number | null>();
    const out = runCalc(
      [
        { name: 'atual', expr: '$r1.kpis.gross', unit: 'usd' },
        { name: 'anterior', expr: '$r2.kpis.gross', unit: 'usd' },
        { name: 'var', expr: 'pct_change(atual, anterior)' },
        { name: 'dpp', expr: 'pp_change($r1.kpis.approvalRate, $r2.kpis.approvalRate)' },
        { name: 'taxa', expr: '$r1.platforms[slug=digistore24].refundRate', unit: 'fraction' },
        { name: 'pedidos', expr: '$r1.kpis.orderGroups', unit: 'count' },
      ],
      { ref: (r) => RESULTS[r], save: (n, v) => saved.set(n, v) },
    );
    expect(out.errors).toEqual([]);
    const byName = Object.fromEntries(out.results.map((r) => [r.name, r]));
    expect(byName.atual.display).toBe('$154,318.42');
    expect(byName.var.unit).toBe('percent');
    expect(byName.var.display).toBe('10.2%');
    expect(byName.dpp.unit).toBe('pp');
    expect(byName.dpp.display).toBe('+1.2 pp');
    expect(byName.taxa.display).toBe('10.4%');
    expect(byName.pedidos.display).toBe('1,241');
    expect(saved.get('var')).toBeCloseTo(10.2274, 3);
  });

  it('erro numa expressão não derruba as outras; dependente acusa a origem', () => {
    const out = runCalc(
      [
        { name: 'ruim', expr: '1 / 0' },
        { name: 'depende', expr: 'ruim + 1' },
        { name: 'ok', expr: '2 + 2' },
        { name: 'ok', expr: '3' },
        { name: 'sum', expr: '1' },
        { name: 'nulo', expr: 'safe_div(1, 0)' },
      ],
      { ref: () => undefined },
    );
    expect(out.results.map((r) => r.name)).toEqual(['ok', 'nulo']);
    expect(out.results[1]).toMatchObject({ value: null, display: '—' });
    const msgs = Object.fromEntries(out.errors.map((e) => [e.name, e.message]));
    expect(msgs.ruim).toMatch(/divisão por zero/);
    expect(msgs.depende).toMatch(/depende de "ruim"/);
    expect(msgs.sum).toMatch(/nome de função/);
    expect(out.errors.some((e) => e.name === 'ok' && /repetido/.test(e.message))).toBe(true);
    expect(msgs.nulo).toMatch(/sem valor/);
  });

  it('nome de propriedade herdada ("constructor") não resolve como variável', () => {
    const out = runCalc([{ name: 'x', expr: 'constructor + 1' }], { ref: () => undefined, previous: new Map() });
    expect(out.errors[0].message).toMatch(/nome desconhecido/);
  });

  it('usa contas de calls anteriores pelo nome', () => {
    const out = runCalc([{ name: 'dobro', expr: 'base * 2' }], { ref: () => undefined, previous: new Map([['base', 21]]) });
    expect(out.results[0].value).toBe(42);
  });

  it('valida o input cru', () => {
    expect(parseCalcInput({})).toMatch(/expressions/);
    expect(parseCalcInput({ expressions: [{ name: 'X', expr: '1' }] })).toMatch(/name inválido/);
    expect(parseCalcInput({ expressions: [{ name: 'x', expr: '1', unit: 'brl' }] })).toMatch(/unit inválido/);
    expect(parseCalcInput({ expressions: Array.from({ length: 41 }, (_, i) => ({ name: `x${i}`, expr: '1' })) })).toMatch(/40/);
    expect(parseCalcInput({ expressions: [{ name: 'x', expr: '1 + 1' }] })).toEqual([{ name: 'x', expr: '1 + 1', unit: undefined }]);
  });

  it('display por unidade', () => {
    expect(displayValue(0.45, 'percent')).toBe('0.45%');
    expect(displayValue(-3.21, 'pp')).toBe('−3.2 pp');
    expect(displayValue(7.5, 'days')).toBe('7.5 dias');
    expect(displayValue(1234.5, 'number')).toBe('1,234.5');
  });
});
