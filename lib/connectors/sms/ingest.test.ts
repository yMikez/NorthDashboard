import { describe, it, expect } from 'vitest';
import { parseSmsPayload, extractCampaignSlug } from './ingest';

describe('extractCampaignSlug', () => {
  it('extrai o slug entre colchetes do name do Mautic', () => {
    expect(extractCampaignSlug('Reposição NeuroMind [neuromind-reposicao-01]')).toBe('neuromind-reposicao-01');
  });
  it('sem colchetes → null (badge "sem telemetria")', () => {
    expect(extractCampaignSlug('Campanha sem slug')).toBeNull();
    expect(extractCampaignSlug(null)).toBeNull();
  });
  it('só casa slug válido (minúsculas/dígitos/hífen)', () => {
    expect(extractCampaignSlug('X [Foo_Bar]')).toBeNull();
    expect(extractCampaignSlug('X [abc] [def-2]')).toBe('abc'); // primeiro match
  });
});

describe('parseSmsPayload', () => {
  it('sms_sent', () => {
    const p = parseSmsPayload({
      event_type: 'sms_sent',
      campaign: 'neuromind-reposicao-01',
      brand: 'NeuroMind',
      sub_index: 0,
      to: '+15551234567',
      message_sid: 'SMabc',
      occurred_at: '2026-07-08T14:22:00.000Z',
    });
    expect(p.kind).toBe('event');
    if (p.kind !== 'event') return;
    expect(p.row.eventType).toBe('sms_sent');
    expect(p.row.messageSid).toBe('SMabc');
    expect(p.row.subIndex).toBe(0);
    expect(p.row.toNumber).toBe('+15551234567');
    expect(p.row.occurredAt.toISOString()).toBe('2026-07-08T14:22:00.000Z');
  });

  it('sms_status: status/error_code; error_code null vira null', () => {
    const p = parseSmsPayload({
      event_type: 'sms_status',
      message_sid: 'SMabc',
      status: 'undelivered',
      error_code: 30007,
      to: '+15551234567',
      from: '+15559876543',
      brand: 'NeuroMind',
      sub_index: 0,
      is_final: true,
      is_failure: true,
      occurred_at: '2026-07-08T14:22:05.000Z',
    });
    if (p.kind !== 'event') throw new Error('esperava event');
    expect(p.row.status).toBe('undelivered');
    expect(p.row.errorCode).toBe(30007);
    expect(p.row.fromNumber).toBe('+15559876543');

    const q = parseSmsPayload({ event_type: 'sms_status', message_sid: 'x', status: 'delivered', error_code: null });
    if (q.kind !== 'event') throw new Error('esperava event');
    expect(q.row.errorCode).toBeNull();
  });

  it('sms_skipped: reason preservado, sem sid', () => {
    const p = parseSmsPayload({
      event_type: 'sms_skipped',
      reason: 'marca nao cadastrada no gateway: "XYZ"',
      campaign: 'neuromind-reposicao-01',
      occurred_at: '2026-07-08T14:22:00.000Z',
    });
    if (p.kind !== 'event') throw new Error('esperava event');
    expect(p.row.reason).toContain('marca nao cadastrada');
    expect(p.row.messageSid).toBeNull();
  });

  it('sms_stop: from=lead, to=nosso número', () => {
    const p = parseSmsPayload({
      event_type: 'sms_stop',
      from: '+15551234567',
      to: '+15559876543',
      occurred_at: '2026-07-08T15:01:00.000Z',
    });
    if (p.kind !== 'event') throw new Error('esperava event');
    expect(p.row.fromNumber).toBe('+15551234567');
    expect(p.row.toNumber).toBe('+15559876543');
  });

  it('campaign_catalog: extrai slug, tolera item sem id/name', () => {
    const p = parseSmsPayload({
      event_type: 'campaign_catalog',
      synced_at: '2026-07-08T15:00:00.000Z',
      campaigns: [
        { mautic_id: 3, name: 'Reposição NeuroMind [neuromind-reposicao-01]', is_published: true, created: '2026-07-07T10:00:00+00:00', modified: '2026-07-08T09:00:00+00:00', category: null },
        { mautic_id: 4, name: 'Sem slug no nome', is_published: false },
        { name: 'sem id — ignorada' },
        'lixo',
      ],
    });
    expect(p.kind).toBe('catalog');
    if (p.kind !== 'catalog') return;
    expect(p.campaigns.length).toBe(2);
    expect(p.campaigns[0].slug).toBe('neuromind-reposicao-01');
    expect(p.campaigns[0].isPublished).toBe(true);
    expect(p.campaigns[1].slug).toBeNull();
    expect(p.campaigns[1].isPublished).toBe(false);
  });

  it('event_type desconhecido → unknown (loga e responde 200, nunca 4xx)', () => {
    const p = parseSmsPayload({ event_type: 'sms_novo_evento', foo: 1 });
    expect(p).toEqual({ kind: 'unknown', eventType: 'sms_novo_evento' });
  });

  it('occurred_at inválido/ausente cai pro relógio do servidor (não perde o evento)', () => {
    const before = Date.now();
    const p = parseSmsPayload({ event_type: 'sms_sent', message_sid: 'x', occurred_at: 'not-a-date' });
    if (p.kind !== 'event') throw new Error('esperava event');
    expect(p.row.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('sub_index como string numérica é coagido', () => {
    const p = parseSmsPayload({ event_type: 'sms_sent', message_sid: 'x', sub_index: '1' });
    if (p.kind !== 'event') throw new Error('esperava event');
    expect(p.row.subIndex).toBe(1);
  });
});
