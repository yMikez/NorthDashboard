import { describe, expect, it } from 'vitest';
import {
  normalizeExternalId, candidateExternalIds, buildMappingIndex, resolveAffiliateId, parseAffiliateState,
  planStateChange, resolvePeriod, aggregateAffiliateMetrics, unmappedEntryFor, pickFirstHeader, brtYmd,
  type AffiliateAggRow,
} from './affiliateMappingCore';

describe('normalizeExternalId', () => {
  it('trim + minúsculas (contrato §4)', () => {
    expect(normalizeExternalId('  MariaSilva ')).toBe('mariasilva');
    expect(normalizeExternalId(1234567)).toBe('1234567');
  });
  it('vazio depois do trim não existe', () => {
    expect(normalizeExternalId('   ')).toBeNull();
    expect(normalizeExternalId(null)).toBeNull();
    expect(normalizeExternalId(undefined)).toBeNull();
  });
});

describe('candidateExternalIds — o que cada plataforma manda no webhook de venda', () => {
  it('BuyGoods: aff_id (por produto) primeiro, aff_name (username da conta) como fallback', () => {
    expect(candidateExternalIds('buygoods', { externalId: '1234', nickname: 'Joao.Silva' })).toEqual(['1234', 'joao.silva']);
  });
  it('Digistore24: affiliate_name (= Digistore ID) primeiro, affiliate_id numérico depois', () => {
    expect(candidateExternalIds('digistore24', { externalId: '3956536', nickname: 'edugodoy16235294' })).toEqual(['edugodoy16235294', '3956536']);
  });
  it('JVZoo: affiliate_id numérico primeiro, nome como fallback', () => {
    expect(candidateExternalIds('jvzoo', { externalId: '3552225', nickname: 'Health Innovations' })).toEqual(['3552225', 'health innovations']);
  });
  it('plataformas fora do contrato (clickbank, cartpanda) não geram candidato', () => {
    expect(candidateExternalIds('clickbank', { externalId: 'abc', nickname: 'x' })).toEqual([]);
    expect(candidateExternalIds('cartpanda', { externalId: 'abc' })).toEqual([]);
  });
  it('sem duplicata quando id e nick coincidem; sem nick → só o id', () => {
    expect(candidateExternalIds('jvzoo', { externalId: 'ABC', nickname: 'abc' })).toEqual(['abc']);
    expect(candidateExternalIds('buygoods', { externalId: '77', nickname: null })).toEqual(['77']);
  });
});

describe('resolveAffiliateId', () => {
  const index = buildMappingIndex([
    { platform: 'buygoods', externalId: 'ms8841', affiliateId: 'aff_maria' },
    { platform: 'buygoods', externalId: 'mariasilva', affiliateId: 'aff_maria' },
    { platform: 'digistore24', externalId: 'maria_ds', affiliateId: 'aff_maria' },
    { platform: 'jvzoo', externalId: '1234567', affiliateId: 'aff_joao' },
  ]);
  it('casa contra QUALQUER um dos ids do afiliado (aff_id ou username)', () => {
    expect(resolveAffiliateId(index, 'buygoods', { externalId: 'MS8841', nickname: 'outro' })).toMatchObject({ affiliateId: 'aff_maria', matchedExternalId: 'ms8841' });
    expect(resolveAffiliateId(index, 'buygoods', { externalId: '999', nickname: 'MariaSilva' })).toMatchObject({ affiliateId: 'aff_maria', matchedExternalId: 'mariasilva' });
  });
  it('Digistore casa pelo nome (Digistore ID) mesmo com id numérico desconhecido', () => {
    expect(resolveAffiliateId(index, 'digistore24', { externalId: '3956536', nickname: 'Maria_DS' }).affiliateId).toBe('aff_maria');
  });
  it('não mapeado → null com os candidatos tentados', () => {
    expect(resolveAffiliateId(index, 'jvzoo', { externalId: '7', nickname: 'Zé' })).toEqual({ affiliateId: null, candidates: ['7', 'zé'], matchedExternalId: null });
  });
  it('mesmo id em plataforma diferente NÃO casa (chave é platform+external_id)', () => {
    expect(resolveAffiliateId(index, 'buygoods', { externalId: '1234567' }).affiliateId).toBeNull();
  });
});

describe('unmappedEntryFor', () => {
  it('external_id da fila = primeiro candidato; alternativo = segundo', () => {
    expect(unmappedEntryFor('digistore24', { externalId: '3956536', nickname: 'edugodoy' })).toEqual({ platform: 'digistore24', externalId: 'edugodoy', altExternalId: '3956536' });
    expect(unmappedEntryFor('jvzoo', { externalId: '55', nickname: null })).toEqual({ platform: 'jvzoo', externalId: '55', altExternalId: null });
    expect(unmappedEntryFor('clickbank', { externalId: '55' })).toBeNull();
  });
});

const WEBHOOK_BODY = {
  event: 'affiliate.updated',
  affiliate_id: 'cmfgq1x2a0000v8l4h3k9d2pw',
  name: ' Maria Silva ',
  status: 'active',
  platforms: [
    { platform: 'jvzoo', external_id: '1234567' },
    { platform: 'buygoods', external_id: ' MS8841 ' },
    { platform: 'BUYGOODS', external_id: 'ms8841' },
    { platform: 'digistore24', external_id: 'maria_ds' },
    { platform: 'cartpanda', external_id: 'cp1' },
    { platform: 'jvzoo', external_id: '   ' },
  ],
  occurred_at: '2026-09-12T13:37:00.123Z',
};

describe('parseAffiliateState (corpo do webhook == item do mapping)', () => {
  it('normaliza, descarta plataforma fora do contrato e vazio, ordena estável', () => {
    const r = parseAffiliateState(WEBHOOK_BODY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.affiliateId).toBe('cmfgq1x2a0000v8l4h3k9d2pw');
    expect(r.state.name).toBe('Maria Silva');
    expect(r.state.status).toBe('active');
    expect(r.state.occurredAt.toISOString()).toBe('2026-09-12T13:37:00.123Z');
    expect(r.state.platforms).toEqual([
      { platform: 'buygoods', externalId: 'ms8841' },
      { platform: 'digistore24', externalId: 'maria_ds' },
      { platform: 'jvzoo', externalId: '1234567' },
    ]);
    expect(r.dropped.map((d) => d.reason)).toEqual(['plataforma fora do contrato', 'external_id vazio']);
  });
  it('item do mapping usa updated_at no lugar de occurred_at', () => {
    const r = parseAffiliateState({ affiliate_id: 'a', name: 'A', status: 'inactive', platforms: [], updated_at: '2026-09-12T13:37:00.456Z' });
    expect(r.ok && r.state.occurredAt.toISOString()).toBe('2026-09-12T13:37:00.456Z');
    expect(r.ok && r.state.platforms).toEqual([]);
  });
  it('inválidos: sem affiliate_id, status estranho, data ruim, platforms não-lista, corpo não-objeto', () => {
    expect(parseAffiliateState({ ...WEBHOOK_BODY, affiliate_id: '' })).toMatchObject({ ok: false, error: 'affiliate_id ausente' });
    expect(parseAffiliateState({ ...WEBHOOK_BODY, status: 'banned' })).toMatchObject({ ok: false });
    expect(parseAffiliateState({ ...WEBHOOK_BODY, occurred_at: 'ontem' })).toMatchObject({ ok: false });
    expect(parseAffiliateState({ ...WEBHOOK_BODY, platforms: 'x' })).toMatchObject({ ok: false });
    expect(parseAffiliateState('texto')).toMatchObject({ ok: false });
    expect(parseAffiliateState(null)).toMatchObject({ ok: false });
    expect(parseAffiliateState([])).toMatchObject({ ok: false });
  });
  it('nome vazio cai no affiliate_id (nunca grava nome vazio)', () => {
    const r = parseAffiliateState({ ...WEBHOOK_BODY, name: '  ' });
    expect(r.ok && r.state.name).toBe('cmfgq1x2a0000v8l4h3k9d2pw');
  });
});

describe('planStateChange (idempotência por occurred_at, substituição do conjunto)', () => {
  const t1 = new Date('2026-09-12T13:37:00.123Z');
  const t2 = new Date('2026-09-12T13:40:00.000Z');
  const incoming = { affiliateId: 'a', name: 'Maria', status: 'active' as const, occurredAt: t2, platforms: [{ platform: 'buygoods' as const, externalId: 'x' }, { platform: 'jvzoo' as const, externalId: '9' }] };
  it('afiliado desconhecido → apply com tudo adicionado (criação = primeiro affiliate.updated)', () => {
    expect(planStateChange(null, incoming)).toEqual({ action: 'apply', added: incoming.platforms, removed: [] });
  });
  it('occurred_at menor que o gravado → stale (tentativa atrasada/reordenada)', () => {
    const cur = { occurredAt: t2, name: 'Maria', status: 'active', platforms: incoming.platforms };
    expect(planStateChange(cur, { ...incoming, occurredAt: t1 }).action).toBe('stale');
  });
  it('mesmo occurred_at e mesmo estado → unchanged (replay da mesma entrega)', () => {
    const cur = { occurredAt: t2, name: 'Maria', status: 'active', platforms: [...incoming.platforms].reverse() };
    expect(planStateChange(cur, incoming).action).toBe('unchanged');
  });
  it('mesmo X-Event-Id com corpo mais novo (coalescência) → apply com diff', () => {
    const cur = { occurredAt: t1, name: 'Maria', status: 'inactive', platforms: [{ platform: 'buygoods', externalId: 'x' }, { platform: 'digistore24', externalId: 'old' }] };
    const plan = planStateChange(cur, incoming);
    expect(plan.action).toBe('apply');
    expect(plan.added).toEqual([{ platform: 'jvzoo', externalId: '9' }]);
    expect(plan.removed).toEqual([{ platform: 'digistore24', externalId: 'old' }]);
  });
  it('occurred_at IGUAL com conjunto diferente → unchanged (replay nunca rouba um ID transferido de volta)', () => {
    const cur = { occurredAt: t2, name: 'Maria', status: 'active', platforms: [{ platform: 'buygoods', externalId: 'x' }] }; // jvzoo:9 foi transferido
    expect(planStateChange(cur, incoming).action).toBe('unchanged');
  });
  it('só nome/status mudou → apply sem pares', () => {
    const cur = { occurredAt: t1, name: 'Maria S.', status: 'active', platforms: incoming.platforms };
    expect(planStateChange(cur, incoming)).toEqual({ action: 'apply', added: [], removed: [] });
  });
});

describe('resolvePeriod (dia = America/Sao_Paulo)', () => {
  // 2026-09-12 01:30 BRT == 04:30Z — de madrugada, UTC já é o mesmo dia; e
  // 2026-09-11 23:30 BRT == 2026-09-12 02:30Z — UTC virou o dia, BRT não.
  const nowLate = new Date('2026-09-12T02:30:00.000Z');
  it('brtYmd usa o calendário de Brasília', () => {
    expect(brtYmd(nowLate)).toBe('2026-09-11');
    expect(brtYmd(new Date('2026-09-12T04:30:00.000Z'))).toBe('2026-09-12');
  });
  it('7d = hoje (BRT) e os 6 anteriores, da meia-noite BRT até agora', () => {
    const r = resolvePeriod('7d', null, null, nowLate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe('2026-09-05');
    expect(r.to).toBe('2026-09-11');
    expect(r.start.toISOString()).toBe('2026-09-05T03:00:00.000Z');
    expect(r.end).toEqual(nowLate);
  });
  it('30d idem com 30 dias', () => {
    const r = resolvePeriod('30d', null, null, nowLate);
    expect(r.ok && r.from).toBe('2026-08-13');
  });
  it('mtd = dia 1 do mês corrente BRT', () => {
    const r = resolvePeriod('mtd', null, null, nowLate);
    expect(r.ok && r.from).toBe('2026-09-01');
    expect(r.ok && r.start.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });
  it('custom = from..to inclusivos, dias inteiros BRT', () => {
    const r = resolvePeriod('custom', '2026-09-01', '2026-09-12', nowLate);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.start.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-13T02:59:59.999Z');
  });
  it('custom inválido: sem datas, formato, calendário, ordem, > 366 dias', () => {
    expect(resolvePeriod('custom', null, null)).toMatchObject({ ok: false });
    expect(resolvePeriod('custom', '2026/09/01', '2026-09-12')).toMatchObject({ ok: false });
    expect(resolvePeriod('custom', '2026-02-30', '2026-03-01')).toMatchObject({ ok: false });
    expect(resolvePeriod('custom', '2026-09-12', '2026-09-01')).toMatchObject({ ok: false, error: 'from deve ser anterior ou igual a to' });
    expect(resolvePeriod('custom', '2025-01-01', '2026-01-02')).toMatchObject({ ok: false, error: 'intervalo custom limitado a 366 dias' });
    expect(resolvePeriod('custom', '2025-01-01', '2026-01-01').ok).toBe(true); // exatamente 366
  });
  it('period desconhecido/ausente → erro', () => {
    expect(resolvePeriod('90d', null, null)).toMatchObject({ ok: false, error: 'period deve ser 7d, 30d, mtd ou custom' });
    expect(resolvePeriod(null, null, null)).toMatchObject({ ok: false });
  });
});

describe('aggregateAffiliateMetrics — mesma régua das abas', () => {
  const base: AffiliateAggRow = {
    affiliateId: 'a', platformSlug: 'jvzoo', approvedGross: 0, approvedCount: 0,
    refundedRowsCount: 0, chargebackRowsCount: 0, refundedRowsOriginalGross: 0, chargebackRowsOriginalGross: 0,
    refundEventsUsd: 0, refundEventsCount: 0, chargebackEventsUsd: 0, chargebackEventsCount: 0,
  };
  it('plataforma in-place (JVZoo): venda depois estornada conta no faturado pelo valor original e no nº de pedidos', () => {
    const out = aggregateAffiliateMetrics([{
      ...base, approvedGross: 1000, approvedCount: 10,
      refundedRowsCount: 1, refundedRowsOriginalGross: 100,          // 1 venda do período que voltou
      refundEventsUsd: 100, refundEventsCount: 1,                     // o estorno aconteceu no período
    }]);
    expect(out).toEqual([{ affiliate_id: 'a', gross_sales: 1100, refunds: 100, net_sales: 1000, orders_count: 11, refund_rate: 9.09 }]);
  });
  it('Digistore (linha extra): venda original segue APPROVED e a linha de estorno é sintética — não entra em pedidos/faturado', () => {
    const out = aggregateAffiliateMetrics([{
      ...base, platformSlug: 'digistore24', approvedGross: 1100, approvedCount: 11,
      refundedRowsCount: 1, refundedRowsOriginalGross: 0,              // linha sintética (orig negativo → 0)
      refundEventsUsd: 100, refundEventsCount: 1,
    }]);
    expect(out).toEqual([{ affiliate_id: 'a', gross_sales: 1100, refunds: 100, net_sales: 1000, orders_count: 11, refund_rate: 9.09 }]);
  });
  it('consolida as três plataformas do mesmo affiliate_id; chargeback conta como estorno', () => {
    const out = aggregateAffiliateMetrics([
      { ...base, platformSlug: 'buygoods', approvedGross: 500.5, approvedCount: 5 },
      { ...base, platformSlug: 'digistore24', approvedGross: 300, approvedCount: 3, chargebackEventsUsd: 50, chargebackEventsCount: 1 },
      { ...base, platformSlug: 'jvzoo', approvedGross: 200, approvedCount: 2 },
      { ...base, affiliateId: 'b', platformSlug: 'jvzoo', approvedGross: 999, approvedCount: 1 },
    ]);
    // ordenado por net_sales desc: b (999) antes de a (950.5)
    expect(out).toEqual([
      { affiliate_id: 'b', gross_sales: 999, refunds: 0, net_sales: 999, orders_count: 1, refund_rate: 0 },
      { affiliate_id: 'a', gross_sales: 1000.5, refunds: 50, net_sales: 950.5, orders_count: 10, refund_rate: 10 },
    ]);
  });
  it('estorno no período de venda anterior ao período → net pode ficar negativo (lente de caixa), taxa sem divisão por zero', () => {
    const out = aggregateAffiliateMetrics([{ ...base, refundEventsUsd: 80, refundEventsCount: 1 }]);
    expect(out).toEqual([{ affiliate_id: 'a', gross_sales: 0, refunds: 80, net_sales: -80, orders_count: 0, refund_rate: 0 }]);
  });
  it('lista vazia é válida (ninguém vendeu)', () => {
    expect(aggregateAffiliateMetrics([])).toEqual([]);
  });
  it('ordena por net_sales desc (critério do ranking deles), empate por affiliate_id', () => {
    const out = aggregateAffiliateMetrics([
      { ...base, affiliateId: 'z', approvedGross: 10, approvedCount: 1 },
      { ...base, affiliateId: 'b', approvedGross: 10, approvedCount: 1 },
      { ...base, affiliateId: 'top', approvedGross: 99, approvedCount: 1 },
    ]);
    expect(out.map((r) => r.affiliate_id)).toEqual(['top', 'b', 'z']);
  });
});

describe('pickFirstHeader', () => {
  it('header repetido "a, b" usa o primeiro, com trim', () => {
    expect(pickFirstHeader(' k1 , k2')).toBe('k1');
    expect(pickFirstHeader(null)).toBe('');
  });
});
