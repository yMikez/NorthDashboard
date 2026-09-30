import { describe, expect, it } from 'vitest';
import { storedToolStatus, toolChipLabel } from './toolLabels';

describe('toolChipLabel', () => {
  it('rótulos PT-BR das tools novas', () => {
    const expected: Record<string, string> = {
      calc: 'Cálculo',
      aggregate_result: 'Agregação',
      aggregate_orders: 'Agregação',
      compare_periods: 'Comparação de períodos',
      get_data_coverage: 'Qualidade do dado',
      resolve_entities: 'Identificação',
      get_profit_model: 'Modelo de lucro',
      get_net_profit: 'Lucro real',
      load_skill: 'Playbook',
      get_definitions: 'Glossário',
      search_knowledge: 'Base de conhecimento',
      read_attachment: 'Leitura do anexo',
      query_attachment_table: 'Planilha anexada',
    };
    for (const [name, label] of Object.entries(expected)) expect(toolChipLabel(name)).toBe(label);
  });
  it('tools existentes também ganham nome legível', () => {
    expect(toolChipLabel('get_overview')).toBe('Visão geral');
    expect(toolChipLabel('get_refund_cohorts')).toBe('Coortes de reembolso');
  });
  it('playbook do histórico mostra a skill', () => {
    expect(toolChipLabel('load_skill', { name: 'margin_analysis' })).toBe('Playbook: margin analysis');
    expect(toolChipLabel('load_skill', { name: '' })).toBe('Playbook');
    expect(toolChipLabel('load_skill')).toBe('Playbook');
  });
  it('tool desconhecida mostra o nome técnico', () => {
    expect(toolChipLabel('get_future_thing')).toBe('get_future_thing');
  });
});

describe('storedToolStatus', () => {
  it('erro gravado pelo motor pinta o chip', () => {
    expect(storedToolStatus({ bytes: 20, error: 'invalid_input: família' })).toBe('error');
    expect(storedToolStatus({ ok: false })).toBe('error');
  });
  it('sucesso e registro antigo sem result = ok', () => {
    expect(storedToolStatus({ ok: true, bytes: 100 })).toBe('ok');
    expect(storedToolStatus(undefined)).toBe('ok');
    expect(storedToolStatus({ error: '' })).toBe('ok');
  });
});
