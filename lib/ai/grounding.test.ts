import { describe, expect, it } from 'vitest';
import { ResultStore } from './resultStore';
import { parseShownNumbers, readingsOf, verifyBlockNumbers } from './grounding';

function store(): ResultStore {
  const s = new ResultStore();
  s.nextRound();
  s.put('get_overview', {}, {
    range: { start: '2026-09-01T03:00:00.000Z', end: '2026-10-01T02:59:59.999Z' },
    kpis: { gross: 154318.42, grossOriginal: 171002.1, net: 98123.45, approvalRate: 0.9123, refundRate: 0.0823, cbRate: 0.0041, orderGroups: 1241, aov: 124.35, approvedCount: 1502 },
    daily: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, gross: 4000 + i * 37.5, orders: 40 + (i % 7) })),
  });
  s.put('get_profit_split', {}, {
    front: { grossUsd: 150210.3, profitUsd: 23456.78, cpaUsd: 41000 },
    refunds: { valuePct: 9.36, pct: 8.1, refundedCount: 122, salesCount: 1506 },
    totalUsd: 26789.01,
  });
  s.put('get_platforms', {}, {
    platforms: [
      { slug: 'clickbank', revenue: 80000, orders: 600, refundRate: 0.07, feeRatePct: 7.5 },
      { slug: 'digistore24', revenue: 50000, orders: 400, refundRate: 0.1045, feeRatePct: 8.37 },
      { slug: 'buygoods', revenue: 24318.42, orders: 241, refundRate: 0, feeRatePct: 9.9 },
    ],
  });
  s.putCalc('var_receita', 10.2274);
  s.putCalc('share_cb', 51.8408);
  s.putCalc('delta_aprov_pp', 1.23);
  return s;
}

const summary = (kpis: Array<{ label: string; value: string; delta?: string }>) => ({
  type: 'summary', title: 'Resumo', kpis: kpis.map((k) => ({ label: k.label, value: k.value, ...(k.delta ? { delta: { value: k.delta, trend: 'up' } } : {}) })),
});

describe('leitura dos números exibidos', () => {
  it('formatos US e pt-BR, moeda, %, pp, multiplicadores e ambiguidade de separador', () => {
    expect(readingsOf('1,241')).toEqual([{ value: 1241, g: 1 }, { value: 1.241, g: 0.001 }]);
    expect(readingsOf('154.318')).toEqual([{ value: 154318, g: 1 }, { value: 154.318, g: 0.001 }]);
    expect(readingsOf('1.234,56')).toEqual([{ value: 1234.56, g: 0.01 }]);
    expect(readingsOf('1,234.56')).toEqual([{ value: 1234.56, g: 0.01 }]);
    expect(readingsOf('12,4')).toEqual([{ value: 12.4, g: 0.1 }]);
    const [usd] = parseShownNumbers('US$ 1.234,56');
    expect(usd).toMatchObject({ text: 'US$ 1.234,56', readings: [{ value: 1234.56 }], ignored: false });
    expect(parseShownNumbers('−3.2 pp')[0]).toMatchObject({ text: '−3.2 pp', readings: [{ value: 3.2 }] });
    const [m] = parseShownNumbers('$1.2M');
    expect(m.readings[0].value).toBeCloseTo(1.2e6, 6);
    expect(m.readings[0].g).toBeCloseTo(1e5, 6);
    expect(parseShownNumbers('154,3 mil')[0].readings[0]).toEqual({ value: 154300, g: 100 });
    expect(parseShownNumbers('+8.2%')[0].text).toBe('+8.2%');
  });

  it('ignora datas, horas, anos, contagens pequenas e números grudados em letras', () => {
    const t = parseShownNumbers('Últimos 7 dias (01/09–30/09/2026, até 14:05) · Janela 3 · 2026 · UP1 · 30d · 1º lugar · Top 10');
    expect(t.filter((x) => !x.ignored)).toEqual([]);
  });
});

describe('verifyBlockNumbers', () => {
  it('números certos (arredondados, em %, pt-BR ou US, com multiplicador) passam — zero falso positivo', () => {
    const blocks = [
      summary([
        { label: 'Receita bruta', value: '$154,318', delta: '+10.2%' },
        { label: 'Receita (pt-BR)', value: '$ 154.318' },
        { label: 'Receita exata', value: 'US$ 154.318,42' },
        { label: 'Receita resumida', value: '$154.3K' },
        { label: 'Aprovação', value: '91.2%', delta: '+1.2 pp' },
        { label: 'Reembolso (venda)', value: '8.2%' },
        { label: 'Taxa de reembolso (card)', value: '9.4%' },
        { label: 'Chargeback', value: '0.41%' },
        { label: 'Sessões', value: '1,241' },
        { label: 'AOV', value: '$124.35' },
        { label: 'Net after CPA', value: '$23,457' },
        { label: 'Período', value: '01/09 a 30/09/2026 (30 dias)' },
      ]),
      { type: 'insights', insights: [{ title: 'Lucro total', value: '$26.8 mil', description: 'front + back', severity: 'positive' }] },
      {
        type: 'table',
        columns: [
          { key: 'platform', label: 'Plataforma', format: 'text' },
          { key: 'revenue', label: 'Receita', format: 'currency' },
          { key: 'share', label: 'Participação', format: 'percent' },
          { key: 'refund', label: 'Reembolso', format: 'fraction' },
          { key: 'orders', label: 'Pedidos', format: 'number' },
          { key: 'rank', label: '#', format: 'number' },
          { key: 'fee', label: 'Fee' },
        ],
        rows: [
          { platform: 'clickbank', revenue: 80000, share: 51.84, refund: 0.07, orders: 600, rank: 1, fee: '7.5%' },
          { platform: 'digistore24', revenue: '$50,000', share: '32.4%', refund: 0.1045, orders: '400', rank: 2, fee: '8.37%' },
        ],
      },
      { type: 'markdown', content: 'Texto livre com $999,999 não é conferido.' },
    ];
    const r = verifyBlockNumbers(blocks, store());
    expect(r.unmatched).toEqual(['32.4%']); // 50000 ÷ 154318 nunca passou pelo calc
    expect(r.checked).toBeGreaterThan(20);
  });

  it('números errados/inventados são apontados como exibidos', () => {
    const blocks = [
      summary([
        { label: 'Receita bruta', value: '$160,000', delta: '+12.9%' },
        { label: 'Reembolso', value: '15.7%' },
        { label: 'Pedidos', value: '2,345' },
        { label: 'AOV', value: '$124.35' },
      ]),
      {
        type: 'table',
        columns: [{ key: 'p', label: 'P', format: 'text' }, { key: 'revenue', label: 'Receita', format: 'currency' }],
        rows: [{ p: 'clickbank', revenue: 81234 }, { p: 'digistore24', revenue: 50000 }],
      },
    ];
    const r = verifyBlockNumbers(blocks, store());
    expect(r.unmatched).toEqual(['$160,000', '+12.9%', '15.7%', '2,345', '$81,234.00']);
    expect(r.checked).toBe(7);
  });

  it('tolerância: meia unidade do último dígito ou 0,5% relativo — o que for maior', () => {
    const s = store();
    const one = (value: string) => verifyBlockNumbers([summary([{ label: 'x', value }])], s).unmatched;
    expect(one('$154,318.42')).toEqual([]);
    expect(one('$154,320')).toEqual([]); // 0,001% de diferença
    expect(one('$155,000')).toEqual([]); // 0,44% < 0,5%
    expect(one('$156,000')).toEqual(['$156,000']); // 1,1%
    expect(one('$0.15M')).toEqual([]); // meia unidade de 0,01M = 5.000
    expect(one('9.36%')).toEqual([]);
    expect(one('9.5%')).toEqual(['9.5%']);
  });

  it('sem blocos numéricos (ou blocos inválidos) não confere nada', () => {
    expect(verifyBlockNumbers(null, store())).toEqual({ unmatched: [], checked: 0 });
    expect(verifyBlockNumbers([{ type: 'markdown', content: '$5' }], store())).toEqual({ unmatched: [], checked: 0 });
    expect(verifyBlockNumbers([summary([{ label: 'Dias', value: '7' }])], store())).toEqual({ unmatched: [], checked: 0 });
  });

  it('usa as contas do calc e todos os resultados do turno', () => {
    const s = new ResultStore();
    s.putCalc('break_even_cpa', 87.654);
    expect(verifyBlockNumbers([summary([{ label: 'CPA máximo', value: '$87.65' }])], s).unmatched).toEqual([]);
    expect(verifyBlockNumbers([summary([{ label: 'CPA máximo', value: '$88.10' }])], s).unmatched).toEqual(['$88.10']);
  });
});
