import { describe, expect, it } from 'vitest';
import { type SimDbRow, empacotarBase, etapaFina, familia, validarSimulacao } from './funnelSimulatorCore';

const linha = (o: Partial<SimDbRow>): SimDbRow => ({
  plataforma: 'JVZoo', produto_fe: 'Memovance Pro 6 Bottles / FE', dia: '2026-11-01', e_fe: false, etapa: 'Upsell',
  etapa_jvz: null, tipo_v: null, passo_v: null, vendas: 1, bruto: 100, fee: 9, cpa: 0, reemb: 10, cb: 4, alerta: 9, taxas: 2,
  bruto_prev: 100, custo_fs: 0, bruto_fs: 0, call_bruto: 0, call_liq: 0, ...o,
});

describe('familia', () => {
  it('corta kit, etapa e prefixos de oferta', () => {
    expect(familia('Memovance Pro 6 Bottles / FE')?.nome).toBe('Memovance Pro');
    expect(familia('NeuroRecall - 3 Bottles')?.chave).toBe('neurorecall');
    expect(familia('[FUNNEL]Neuro Recall · 3')?.nome).toBe('NeuroRecall');
    expect(familia('6B | GLYCO EDEN')?.nome).toBe('Glyco Eden');
    expect(familia('Produto Novo (6 Bottles)')?.nome).toBe('Produto Novo');
    expect(familia(null)).toBeNull();
  });
});

describe('etapaFina', () => {
  it('JVZoo usa a etapa da gold; sem ela, a etapa grossa', () => {
    expect(etapaFina(linha({ e_fe: true }))).toBe('FE');
    expect(etapaFina(linha({ etapa_jvz: 'OTO2' }))).toBe('OTO2');
    expect(etapaFina(linha({ etapa_jvz: null, etapa: 'Downsell' }))).toBe('DS1');
    expect(etapaFina(linha({ etapa_jvz: null, etapa: 'Outros' }))).toBe('Bump');
  });
  it('Vupim: OTO N = passo N; Last Chance N = passo N+1', () => {
    expect(etapaFina(linha({ plataforma: 'Vupim', tipo_v: 'UPSELL', passo_v: 3 }))).toBe('OTO3');
    expect(etapaFina(linha({ plataforma: 'Vupim', tipo_v: 'DOWNSELL', passo_v: 2 }))).toBe('DS1');
    expect(etapaFina(linha({ plataforma: 'Vupim', tipo_v: 'DOWNSELL', passo_v: 4 }))).toBe('DS3');
    expect(etapaFina(linha({ plataforma: 'Vupim', tipo_v: 'UPSELL', passo_v: null }))).toBe('OTO1');
  });
});

describe('empacotarBase', () => {
  it('junta por plataforma × família × dia × etapa e descarta família pequena', () => {
    const rows = [
      linha({ e_fe: true, etapa: 'FE', vendas: 30, bruto: 8820 }),
      linha({ etapa_jvz: 'OTO1', vendas: 5, bruto: 1100 }),
      linha({ etapa_jvz: 'OTO1', vendas: 2, bruto: 440, dia: '2026-11-01' }),
      linha({ produto_fe: 'Pequeno 6 Bottles / FE', e_fe: true, etapa: 'FE', vendas: 3 }),
    ];
    const b = empacotarBase(rows, { de: '2026-08-01', gerado: 'x', fonte: 'y' });
    expect(b.produtos).toEqual(['Memovance Pro']);
    expect(b.ate).toBe('2026-11-01');
    const dia = 92; // 01/08 → 01/11
    const oto1 = b.linhas.find((l) => l[3] === b.etapas.indexOf('OTO1'));
    expect(oto1?.slice(0, 6)).toEqual([0, 0, dia, 2, 7, 1540]);
    expect(b.linhas).toHaveLength(2);
  });
});

describe('validarSimulacao', () => {
  it('exige nome e params', () => {
    expect(validarSimulacao({ name: '  ', params: {} }).ok).toBe(false);
    expect(validarSimulacao({ name: 'BIFI', params: null }).ok).toBe(false);
    const v = validarSimulacao({ name: ' BIFI ', product: '', params: { a: 1 }, summary: { lucro_final: 1 } });
    expect(v.ok && v.valor.name).toBe('BIFI');
    expect(v.ok && v.valor.product).toBeNull();
  });
});
