import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CRM_CONFIG, buildCrmRow, classifySegment, cycleKeyFor, isAtRisk, normalizePhone, normalizeTier,
  reactivationLadder, resolvePhone, resolveTier, rowsToCsv, sortForQueue, summarize, upgradeTarget,
  type CrmInput, type CrmConfigInput,
} from './affiliateCrmCore';

const cfg: CrmConfigInput = DEFAULT_CRM_CONFIG;

function input(over: Partial<CrmInput> = {}): CrmInput {
  return {
    key: 'partner:p1', name: 'Fulano', kind: 'partner', platforms: ['jvzoo'],
    mappingStatus: 'active',
    tierManual: null, tierPlatform: null,
    phoneManual: null, phonePlatform: null, phoneIdentity: null,
    optOut: false,
    daysSinceLastSale: 1, lastSaleDay: '2026-09-23',
    daysSinceFirstSeen: 200, firstSeenDay: '2026-03-01',
    cpaAtual: 200, mainFamily: 'NeuroMindPro',
    sales7: 5, sales30: 20, revenue30: 12000, netAfterCpa30: 800, peakRevenue30: 15000,
    weeklySales: [5, 5, 5, 5, 5], rankTop10: false, weekKey: '2026-W39',
    touches: [],
    ...over,
  };
}

describe('normalização de tier e telefone', () => {
  it('lê os rótulos da plataforma e ignora o que não reconhece', () => {
    expect(normalizeTier('Base')).toBe('BASE');
    expect(normalizeTier('ascendente+')).toBe('ASCENDENTE');
    expect(normalizeTier('North VIP')).toBe('NORTH');
    expect(normalizeTier('ouro')).toBeNull();
    expect(normalizeTier(null)).toBeNull();
  });
  it('telefone vira só dígitos; lixo curto demais é null', () => {
    expect(normalizePhone('+55 (11) 98888-7777')).toBe('5511988887777');
    expect(normalizePhone('0055 11 98888 7777')).toBe('5511988887777');
    expect(normalizePhone('1234')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('manual vence plataforma, que vence o contato do drawer de identidade', () => {
    expect(resolvePhone(input({ phoneManual: '5511988887777', phonePlatform: '15551234567', phoneIdentity: '15559999999' })))
      .toEqual({ phone: '5511988887777', source: 'manual' });
    expect(resolvePhone(input({ phonePlatform: '15551234567', phoneIdentity: '15559999999' })))
      .toEqual({ phone: '15551234567', source: 'plataforma' });
    expect(resolvePhone(input({ phoneIdentity: '15559999999' })))
      .toEqual({ phone: '15559999999', source: 'identidade' });
    expect(resolvePhone(input())).toEqual({ phone: null, source: null });
  });
  it('tier: manual > plataforma > inferido por CPA > padrão', () => {
    expect(resolveTier(input({ tierManual: 'BASE', tierPlatform: 'North' }), cfg)).toEqual({ tier: 'BASE', source: 'manual' });
    expect(resolveTier(input({ tierPlatform: 'North' }), cfg)).toEqual({ tier: 'NORTH', source: 'plataforma' });
    expect(resolveTier(input({ cpaAtual: 245 }), cfg)).toEqual({ tier: 'NORTH', source: 'cpa' });
    expect(resolveTier(input({ cpaAtual: 200 }), cfg)).toEqual({ tier: 'BASE', source: 'cpa' });
    expect(resolveTier(input({ cpaAtual: null }), cfg)).toEqual({ tier: 'BASE', source: 'padrao' });
  });
});

describe('segmentação', () => {
  it('dormência é por tier: 4 dias parado é dormente pro North e ativo pro Base', () => {
    const base = input({ daysSinceLastSale: 4, tierManual: 'BASE' });
    const north = input({ daysSinceLastSale: 4, tierManual: 'NORTH' });
    expect(classifySegment(base, 'BASE', cfg)).toBe('ativo');
    expect(classifySegment(north, 'NORTH', cfg)).toBe('dormente');
  });
  it('passou do limite de frio, sai da régua de reativação', () => {
    expect(classifySegment(input({ daysSinceLastSale: 29 }), 'BASE', cfg)).toBe('dormente');
    expect(classifySegment(input({ daysSinceLastSale: 30 }), 'BASE', cfg)).toBe('frio');
  });
  it('cadastrado e sem venda: onboarding na janela, frio depois dela', () => {
    const novo = input({ daysSinceLastSale: null, lastSaleDay: null, daysSinceFirstSeen: 3, kind: 'mapping' });
    expect(classifySegment(novo, 'BASE', cfg)).toBe('onboarding');
    expect(classifySegment({ ...novo, daysSinceFirstSeen: 25 }, 'BASE', cfg)).toBe('frio');
  });
  it('opt-out e inativo no sistema saem da régua', () => {
    expect(classifySegment(input({ optOut: true }), 'BASE', cfg)).toBe('fora');
    expect(classifySegment(input({ mappingStatus: 'inactive' }), 'BASE', cfg)).toBe('fora');
  });
  it('em risco: caiu ≥40% da própria média, mas ainda vende', () => {
    expect(isAtRisk(input({ sales7: 5, weeklySales: [10, 10, 10, 10, 5] }), cfg)).toBe(true);
    expect(isAtRisk(input({ sales7: 7, weeklySales: [10, 10, 10, 10, 7] }), cfg)).toBe(false);
    // parou de vender de vez não é "em risco", é dormente — outro segmento
    expect(isAtRisk(input({ sales7: 0, weeklySales: [10, 10, 10, 10, 0] }), cfg)).toBe(false);
  });
  it('base pequena não vira "em risco" por ruído', () => {
    expect(isAtRisk(input({ sales7: 1, weeklySales: [1, 1, 1, 1, 1] }), cfg)).toBe(false);
  });
  it('upgrade só com volume sustentado e acima do tier atual', () => {
    const sustentando = input({ weeklySales: [3, 12, 14, 11] });
    expect(upgradeTarget(sustentando, 'BASE', cfg)).toBe('ASCENDENTE');
    expect(upgradeTarget(sustentando, 'ASCENDENTE', cfg)).toBeNull(); // já é
    expect(upgradeTarget(input({ weeklySales: [30, 30, 30] }), 'ASCENDENTE', cfg)).toBe('NORTH');
    expect(upgradeTarget(input({ weeklySales: [12, 4, 13] }), 'BASE', cfg)).toBeNull(); // oscilou
  });
});

describe('escada de toques', () => {
  it('Base segue o playbook (D7/D11/D14/D21); North corre antes', () => {
    expect(reactivationLadder('BASE', cfg).map((s) => s.label)).toEqual(['D7', 'D11', 'D14', 'D21']);
    expect(reactivationLadder('NORTH', cfg).map((s) => s.label)).toEqual(['D3', 'D7', 'D10', 'D17']);
  });
  it('toque vencido aparece; toque futuro não', () => {
    const r = buildCrmRow(input({ daysSinceLastSale: 12 }), cfg);
    expect(r.segment).toBe('dormente');
    expect(r.nextTouch?.label).toBe('D7');   // ainda não mandaram o primeiro
    expect(r.nextTouch?.overdueDays).toBe(5);
  });
  it('não repete um toque já enviado no mesmo ciclo — pega o próximo devido', () => {
    const base = input({ daysSinceLastSale: 12, lastSaleDay: '2026-09-12' });
    const cycle = cycleKeyFor('dormente', base);
    const r = buildCrmRow({ ...base, touches: [{ touchpoint: 'R1', cycleKey: cycle, tag: 'reativacao_d7', sentAt: '2026-09-19T12:00:00Z' }] }, cfg);
    expect(r.nextTouch?.label).toBe('D11');
  });
  it('mandou tudo que venceu: fica sem toque pendente até o próximo degrau', () => {
    const base = input({ daysSinceLastSale: 8, lastSaleDay: '2026-09-16' });
    const cycle = cycleKeyFor('dormente', base);
    const r = buildCrmRow({ ...base, touches: [{ touchpoint: 'R1', cycleKey: cycle, tag: 'reativacao_d7', sentAt: '2026-09-23T12:00:00Z' }] }, cfg);
    expect(r.nextTouch).toBeNull();
    expect(r.pending).toBe(false);
  });
  it('SKIP tira da fila no ciclo, sem virar toque', () => {
    const base = input({ daysSinceLastSale: 12, lastSaleDay: '2026-09-12' });
    const cycle = cycleKeyFor('dormente', base);
    const r = buildCrmRow({ ...base, touches: [{ touchpoint: 'SKIP', cycleKey: cycle, tag: null, sentAt: '2026-09-23T12:00:00Z' }] }, cfg);
    expect(r.nextTouch).toBeNull();
  });

  // A propriedade que protege a operação: vendeu de novo, a régua zera.
  it('VENDEU DE NOVO: ciclo muda, toques antigos não contam e ele sai da régua', () => {
    const parado = input({ daysSinceLastSale: 12, lastSaleDay: '2026-09-12' });
    const cicloAntigo = cycleKeyFor('dormente', parado);
    const tocado = { ...parado, touches: [{ touchpoint: 'R1', cycleKey: cicloAntigo, tag: 'reativacao_d7', sentAt: '2026-09-19T12:00:00Z' }] };
    expect(buildCrmRow(tocado, cfg).nextTouch?.label).toBe('D11');

    // vende hoje
    const voltou = { ...tocado, daysSinceLastSale: 0, lastSaleDay: '2026-09-24' };
    const r = buildCrmRow(voltou, cfg);
    expect(r.segment).toBe('ativo');
    expect(r.nextTouch).toBeNull();
    expect(r.touchesInCycle).toEqual([]);   // o toque antigo ficou no ciclo antigo

    // e se parar de novo, a régua recomeça do D7 (ciclo novo)
    const parouDeNovo = buildCrmRow({ ...voltou, daysSinceLastSale: 9 }, cfg);
    expect(parouDeNovo.segment).toBe('dormente');
    expect(parouDeNovo.nextTouch?.label).toBe('D7');
  });
});

describe('valor, prioridade e alertas', () => {
  it('sem telefone vira alerta (é o gargalo pra operar)', () => {
    expect(buildCrmRow(input(), cfg).alerts).toContain('sem_whatsapp');
    expect(buildCrmRow(input({ phoneManual: '5511988887777' }), cfg).alerts).not.toContain('sem_whatsapp');
  });
  it('quem dá prejuízo no mês é sinalizado, não só quem sumiu', () => {
    const r = buildCrmRow(input({ netAfterCpa30: -1200, sales30: 20 }), cfg);
    expect(r.alerts).toContain('prejuizo');
  });
  it('uma venda no vermelho não dispara alerta de prejuízo', () => {
    expect(buildCrmRow(input({ netAfterCpa30: -50, sales30: 1 }), cfg).alerts).not.toContain('prejuizo');
  });
  it('CPA de North com volume de Base vira alerta de desalinhamento', () => {
    const r = buildCrmRow(input({ cpaAtual: 250, sales30: 8, weeklySales: [2, 2, 2, 2, 2] }), cfg);
    expect(r.alerts).toContain('cpa_acima_do_volume');
  });
  it('valor é o maior entre o mês atual e o melhor mês — quem já foi grande conta', () => {
    const r = buildCrmRow(input({ revenue30: 0, peakRevenue30: 40000, daysSinceLastSale: 20 }), cfg);
    expect(r.valueUsd).toBe(40000);
    expect(r.priority).toBe('alta');
  });
  it('fila: pendentes primeiro, depois por prioridade e valor', () => {
    const rows = [
      buildCrmRow(input({ key: 'a', daysSinceLastSale: 0, revenue30: 50000, peakRevenue30: 50000 }), cfg),
      buildCrmRow(input({ key: 'b', daysSinceLastSale: 12, revenue30: 100, peakRevenue30: 100 }), cfg),
      buildCrmRow(input({ key: 'c', daysSinceLastSale: 12, revenue30: 30000, peakRevenue30: 30000 }), cfg),
    ];
    expect(sortForQueue(rows).map((r) => r.key)).toEqual(['c', 'b', 'a']);
  });
});

describe('resumo e CSV', () => {
  it('conta pendentes e quantos deles estão sem telefone', () => {
    const rows = [
      buildCrmRow(input({ key: 'a', daysSinceLastSale: 12 }), cfg),
      buildCrmRow(input({ key: 'b', daysSinceLastSale: 12, phoneManual: '5511988887777' }), cfg),
      buildCrmRow(input({ key: 'c', daysSinceLastSale: 0 }), cfg),
    ];
    const s = summarize(rows);
    expect(s.total).toBe(3);
    expect(s.pending).toBe(2);
    expect(s.pendingWithoutPhone).toBe(1);
    expect(s.bySegment.dormente).toBe(2);
  });
  it('CSV sai com as colunas do playbook, na ordem, e escapa vírgula', () => {
    const csv = rowsToCsv([buildCrmRow(input({ name: 'Silva, João', daysSinceLastSale: 12, phoneManual: '5511988887777' }), cfg)]);
    const [head, line] = csv.split('\n');
    expect(head.startsWith('nome,whatsapp,tier,dias_sem_venda,produto_principal,cpa_atual,tag_sugerida')).toBe(true);
    expect(line.startsWith('"Silva, João",5511988887777,Base,12,NeuroMindPro,200.00,reativacao_d7')).toBe(true);
  });
});
