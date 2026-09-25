import { describe, expect, it } from 'vitest';
import { parseRetentionPage, parseStatus, maxSourceUpdatedAt } from './retention';

const item = {
  id: 'ret_123',
  transacao_id: 'MRZI8U9PDAOB40NWW',
  plataforma: 'JVZoo',
  email: 'cliente@exemplo.com',
  degrau_oferecido: '50_off',
  degrau_aceito: '50_off',
  valor_preservado_usd: 147,
  status: 'aceito',
  ocorrido_em: '2026-09-22T14:03:00Z',
  atualizado_em: '2026-09-22T14:05:00Z',
};

describe('parseRetentionPage', () => {
  it('lê o contrato combinado', () => {
    const p = parseRetentionPage({ itens: [item], next_updated_since: '2026-09-22T14:05:00Z' });
    expect(p.dropped).toEqual([]);
    expect(p.nextUpdatedSince).toBe('2026-09-22T14:05:00Z');
    expect(p.items[0]).toMatchObject({
      externalId: 'ret_123',
      transactionId: 'MRZI8U9PDAOB40NWW',
      platform: 'jvzoo',            // normalizado — bate com o slug do dump
      preservedUsd: 147,
      status: 'aceito',
    });
    expect(p.items[0].occurredAt.toISOString()).toBe('2026-09-22T14:03:00.000Z');
    expect(p.items[0].sourceUpdatedAt.toISOString()).toBe('2026-09-22T14:05:00.000Z');
  });

  it('recusado não preserva valor, mesmo que mandem um', () => {
    const p = parseRetentionPage({ itens: [{ ...item, status: 'recusado', valor_preservado_usd: 147 }] });
    expect(p.items[0].preservedUsd).toBe(0);
  });

  it('item ruim é descartado com motivo; o resto da página passa', () => {
    const p = parseRetentionPage({
      itens: [
        item,
        { ...item, id: 'ret_sem_txn', transacao_id: '' },
        { ...item, id: 'ret_status', status: 'talvez' },
        { ...item, id: 'ret_data', ocorrido_em: 'ontem' },
        'lixo',
      ],
    });
    expect(p.items).toHaveLength(1);
    expect(p.dropped.map((d) => d.id)).toEqual(['ret_sem_txn', 'ret_status', 'ret_data', '?']);
    expect(p.dropped[0].reason).toContain('transacao_id');
  });

  it('sem atualizado_em, o incremental anda pelo ocorrido_em', () => {
    const { atualizado_em: _drop, ...sem } = item;
    const p = parseRetentionPage({ itens: [sem] });
    expect(p.items[0].sourceUpdatedAt.toISOString()).toBe('2026-09-22T14:03:00.000Z');
  });

  it('resposta fora do contrato não explode — vira descarte explicado', () => {
    expect(parseRetentionPage(null).dropped[0].reason).toContain('objeto JSON');
    expect(parseRetentionPage({ dados: [] }).dropped[0].reason).toContain('lista');
    expect(parseRetentionPage({ itens: [] }).items).toEqual([]);
  });

  it('aceita o vocabulário em inglês (o endpoint deles ainda não existe)', () => {
    expect(parseStatus('accepted')).toBe('aceito');
    expect(parseStatus('declined')).toBe('recusado');
    expect(parseStatus('offered')).toBe('oferecido');
    expect(parseStatus('qualquer')).toBeNull();
    const p = parseRetentionPage({ items: [{ ...item, transaction_id: item.transacao_id, transacao_id: undefined, platform: 'jvzoo', plataforma: undefined }] });
    expect(p.items).toHaveLength(1);
  });

  it('marcador do próximo pull é o maior atualizado_em da página', () => {
    const p = parseRetentionPage({
      itens: [item, { ...item, id: 'b', atualizado_em: '2026-09-22T18:00:00Z' }],
    });
    expect(maxSourceUpdatedAt(p.items)?.toISOString()).toBe('2026-09-22T18:00:00.000Z');
    expect(maxSourceUpdatedAt([])).toBeNull();
  });
});
