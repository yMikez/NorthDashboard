import { describe, it, expect } from 'vitest';
import {
  smsHealth, maskPhone, reduceSms, reduceSmsSales,
  type SmsReduceInput, type SmsSentRow, type SmsStatusRow, type SmsSaleRow,
} from './sms';

const start = new Date('2026-07-01T03:00:00.000Z');
const end = new Date('2026-07-09T02:59:59.999Z');
const now = new Date('2026-07-08T18:00:00.000Z');

const baseInput = (over: Partial<SmsReduceInput> = {}): SmsReduceInput => ({
  startDate: start,
  endDate: end,
  now,
  brandFilter: null,
  campaignFilter: null,
  sent: [],
  statuses: [],
  skipped: [],
  stops: [],
  prevStatusCounts: { delivered: 0, undelivered: 0, failed: 0 },
  errors24h: [],
  campaignsCatalog: [],
  ...over,
});

const sent = (over: Partial<SmsSentRow> = {}): SmsSentRow => ({
  messageSid: 'SM1',
  campaign: 'neuromind-reposicao-01',
  brand: 'NeuroMind',
  subIndex: 0,
  occurredAt: new Date('2026-07-08T14:22:00.000Z'),
  ...over,
});

const status = (over: Partial<SmsStatusRow> = {}): SmsStatusRow => ({
  messageSid: 'SM1',
  status: 'delivered',
  errorCode: null,
  campaign: 'neuromind-reposicao-01',
  brand: 'NeuroMind',
  subIndex: 0,
  fromNumber: '+15559876543',
  occurredAt: new Date('2026-07-08T14:22:05.000Z'),
  ...over,
});

describe('maskPhone', () => {
  it('mantém DDI + últimos 4 dígitos', () => {
    expect(maskPhone('+15551234567')).toBe('+1•••4567');
  });
  it('DDI de 2 dígitos (BR)', () => {
    expect(maskPhone('+5511998765432')).toBe('+55•••5432');
  });
  it('número curto/lixo não vaza nada', () => {
    expect(maskPhone('1234')).toBe('•••');
    expect(maskPhone('')).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });
});

describe('smsHealth (semáforo do guia operacional)', () => {
  const base = { sent: 100, finals: 100, deliveryRate: 0.97, stopRate: 0.005, filtered30007Last24h: 0 };

  it('verde: entrega ≥95% e STOP <1%', () => {
    expect(smsHealth(base).level).toBe('green');
    expect(smsHealth({ ...base, deliveryRate: 0.95, stopRate: 0.0099 }).level).toBe('green');
  });

  it('amarelo: entrega 90–95%', () => {
    expect(smsHealth({ ...base, deliveryRate: 0.9499 }).level).toBe('yellow');
    expect(smsHealth({ ...base, deliveryRate: 0.9 }).level).toBe('yellow');
  });

  it('amarelo: STOP 1–2%', () => {
    expect(smsHealth({ ...base, stopRate: 0.01 }).level).toBe('yellow');
    expect(smsHealth({ ...base, stopRate: 0.02 }).level).toBe('yellow');
  });

  it('amarelo: QUALQUER 30007 nas últimas 24h', () => {
    expect(smsHealth({ ...base, filtered30007Last24h: 1 }).level).toBe('yellow');
  });

  it('vermelho: entrega <90%', () => {
    expect(smsHealth({ ...base, deliveryRate: 0.8999 }).level).toBe('red');
  });

  it('vermelho: STOP >2%', () => {
    expect(smsHealth({ ...base, stopRate: 0.021 }).level).toBe('red');
  });

  it('vermelho: 30007 recorrente (≥5 em 24h)', () => {
    const h = smsHealth({ ...base, filtered30007Last24h: 5 });
    expect(h.level).toBe('red');
    expect(h.reasons.join(' ')).toContain('30007');
  });

  it('sem tráfego → idle (não alarma)', () => {
    expect(smsHealth({ sent: 0, finals: 0, deliveryRate: null, stopRate: null, filtered30007Last24h: 0 }).level).toBe('idle');
  });

  it('enviados sem callback ainda (rate null) não dispara vermelho por entrega', () => {
    expect(smsHealth({ sent: 10, finals: 0, deliveryRate: null, stopRate: 0, filtered30007Last24h: 0 }).level).toBe('green');
  });
});

describe('reduceSms', () => {
  it('taxa de entrega usa status finais como denominador, não enviados', () => {
    const r = reduceSms(baseInput({
      sent: [sent({ messageSid: 'a' }), sent({ messageSid: 'b' }), sent({ messageSid: 'c' }), sent({ messageSid: 'd' })],
      // só 2 callbacks chegaram: 1 delivered + 1 failed → 50%, não 25%.
      statuses: [status({ messageSid: 'a' }), status({ messageSid: 'b', status: 'failed' })],
    }));
    expect(r.kpis.sent).toBe(4);
    expect(r.kpis.finals).toBe(2);
    expect(r.kpis.deliveryRate).toBe(0.5);
  });

  it('pendentes: enviado há >1h sem status; recente ou com status não conta', () => {
    const r = reduceSms(baseInput({
      sent: [
        sent({ messageSid: 'old-no-status', occurredAt: new Date('2026-07-08T10:00:00Z') }),
        sent({ messageSid: 'old-with-status', occurredAt: new Date('2026-07-08T10:00:00Z') }),
        sent({ messageSid: 'fresh-no-status', occurredAt: new Date('2026-07-08T17:30:00Z') }), // 30min < 1h
      ],
      statuses: [status({ messageSid: 'old-with-status', occurredAt: new Date('2026-07-08T10:00:05Z') })],
    }));
    expect(r.kpis.pending).toBe(1);
  });

  it('status que chega DEPOIS do fim do período (janela estendida) mata o pendente mas não entra na taxa', () => {
    const histStart = new Date('2026-06-01T03:00:00.000Z');
    const histEnd = new Date('2026-06-10T02:59:59.999Z');
    const r = reduceSms(baseInput({
      startDate: histStart,
      endDate: histEnd,
      now: new Date('2026-06-20T00:00:00Z'),
      sent: [sent({ messageSid: 'x', occurredAt: new Date('2026-06-09T23:00:00Z') })],
      statuses: [status({ messageSid: 'x', occurredAt: new Date('2026-06-10T03:10:00Z') })], // pós-end
    }));
    expect(r.kpis.pending).toBe(0);
    expect(r.kpis.finals).toBe(0);
    expect(r.kpis.deliveryRate).toBeNull();
  });

  it('30007 conta como filtragem de operadora e pinta o card', () => {
    const r = reduceSms(baseInput({
      sent: [sent({ messageSid: 'a' })],
      statuses: [status({ messageSid: 'a', status: 'undelivered', errorCode: 30007 })],
      errors24h: [{ brand: 'NeuroMind', subIndex: 0, count: 5 }],
    }));
    expect(r.kpis.carrierFiltered30007).toBe(1);
    const card = r.numbers.find((n) => n.brand === 'NeuroMind')!;
    expect(card.filtered30007).toBe(1);
    expect(card.filtered30007Last24h).toBe(5);
    expect(card.health).toBe('red'); // ≥5 em 24h
  });

  it('cards fixos da config aparecem mesmo sem tráfego (reservas idle)', () => {
    const r = reduceSms(baseInput());
    expect(r.numbers.length).toBe(4);
    expect(r.numbers.every((n) => n.health === 'idle')).toBe(true);
    expect(r.numbers.filter((n) => n.role === 'reserve').length).toBe(2);
  });

  it('marca fora da config vira card dinâmico em vez de sumir', () => {
    const r = reduceSms(baseInput({
      sent: [sent({ brand: 'MarcaNova', subIndex: 5, messageSid: 'z' })],
    }));
    const dyn = r.numbers.find((n) => n.brand === 'MarcaNova');
    expect(dyn).toBeDefined();
    expect(dyn!.sent).toBe(1);
  });

  it('catálogo × telemetria: join por slug, órfã marcada, sem-slug zerada', () => {
    const r = reduceSms(baseInput({
      sent: [
        sent({ messageSid: 'a', campaign: 'neuromind-reposicao-01' }),
        sent({ messageSid: 'b', campaign: 'slug-orfao-01' }),
      ],
      statuses: [status({ messageSid: 'a' })],
      campaignsCatalog: [
        { mauticId: 3, name: 'Reposição NeuroMind [neuromind-reposicao-01]', slug: 'neuromind-reposicao-01', isPublished: true, archived: false },
        { mauticId: 4, name: 'Campanha sem slug', slug: null, isPublished: false, archived: false },
        { mauticId: 5, name: 'Antiga [antiga-01]', slug: 'antiga-01', isPublished: true, archived: true },
      ],
    }));
    const bySlug = new Map(r.campaigns.map((c) => [c.slug, c]));
    expect(bySlug.get('neuromind-reposicao-01')!.sent).toBe(1);
    expect(bySlug.get('neuromind-reposicao-01')!.deliveryRate).toBe(1);
    expect(bySlug.get('neuromind-reposicao-01')!.status).toBe('active');
    expect(bySlug.get(null as unknown as string)!.sent).toBe(0); // sem slug = sem telemetria
    expect(bySlug.get('antiga-01')!.status).toBe('archived');
    const orphan = bySlug.get('slug-orfao-01')!;
    expect(orphan.orphan).toBe(true);
    expect(orphan.sent).toBe(1);
  });

  it('STOPs: contagem, taxa e atribuição por marca', () => {
    const r = reduceSms(baseInput({
      sent: Array.from({ length: 100 }, (_, i) => sent({ messageSid: `s${i}` })),
      stops: [
        { brand: 'NeuroMind', subIndex: 0, campaign: 'neuromind-reposicao-01', occurredAt: new Date('2026-07-08T15:01:00Z') },
        { brand: 'NeuroMind', subIndex: 0, campaign: null, occurredAt: new Date('2026-07-08T15:02:00Z') },
      ],
    }));
    expect(r.kpis.stops).toBe(2);
    expect(r.kpis.stopRate).toBe(0.02);
    expect(r.numbers.find((n) => n.brand === 'NeuroMind')!.stops).toBe(2);
  });

  it('descartados: quebra por reason; filtro de marca usa brand enriquecido + fallback campanha→marca', () => {
    const input = baseInput({
      sent: [sent({ messageSid: 'a' })], // NeuroMind, neuromind-reposicao-01
      skipped: [
        // registros antigos sem brand → fallback pelo mapa campanha→marca
        { reason: 'mobile inválido', campaign: 'neuromind-reposicao-01', brand: null, occurredAt: new Date('2026-07-08T14:00:00Z') },
        { reason: 'mobile inválido', campaign: 'neuromind-reposicao-01', brand: null, occurredAt: new Date('2026-07-08T14:01:00Z') },
        // brand enriquecido no ingest de OUTRA marca → cai fora sob filtro
        { reason: 'quiet hours', campaign: 'campanha-de-outra-marca', brand: 'Thermo Burn', occurredAt: new Date('2026-07-08T14:02:00Z') },
      ],
    });
    const all = reduceSms(input);
    expect(all.kpis.skipped).toBe(3);
    expect(all.kpis.skippedByReason[0]).toEqual({ reason: 'mobile inválido', count: 2 });

    const filtered = reduceSms({ ...input, brandFilter: 'NeuroMind' });
    expect(filtered.kpis.skipped).toBe(2);
  });

  it('campanha SÓ com skips (zero envios na janela) não some sob filtro da própria marca', () => {
    // Ex.: lote inteiro caiu em quiet hours antes do primeiro envio — o
    // brand enriquecido no ingest é o que mantém o descarte visível.
    const r = reduceSms(baseInput({
      brandFilter: 'NeuroMind',
      sent: [],
      skipped: [
        { reason: 'fora da janela de envio (quiet hours)', campaign: 'neuromind-flash-01', brand: 'NeuroMind', occurredAt: new Date('2026-07-08T14:00:00Z') },
      ],
    }));
    expect(r.kpis.skipped).toBe(1);
    const camp = r.campaigns.find((c) => c.slug === 'neuromind-flash-01')!;
    expect(camp.skipped).toBe(1);
    expect(camp.orphan).toBe(true);
  });

  it('delta de entrega vs período anterior em pontos percentuais', () => {
    const r = reduceSms(baseInput({
      sent: [sent({ messageSid: 'a' }), sent({ messageSid: 'b' })],
      statuses: [status({ messageSid: 'a' }), status({ messageSid: 'b' })], // 100%
      prevStatusCounts: { delivered: 9, undelivered: 1, failed: 0 }, // 90%
    }));
    expect(r.kpis.deliveryRate).toBe(1);
    expect(r.kpis.deliveryRatePrev).toBe(0.9);
    expect(r.kpis.deliveryRateDeltaPp).toBe(10);
  });

  it('alerta de callbacks: >20% dos envios de 2h..1h atrás sem status', () => {
    const at = new Date(now.getTime() - 90 * 60_000); // 1h30 atrás
    const r = reduceSms(baseInput({
      sent: [
        ...Array.from({ length: 4 }, (_, i) => sent({ messageSid: `ok${i}`, occurredAt: at })),
        ...Array.from({ length: 2 }, (_, i) => sent({ messageSid: `nx${i}`, occurredAt: at })),
      ],
      statuses: Array.from({ length: 4 }, (_, i) => status({ messageSid: `ok${i}`, occurredAt: new Date(at.getTime() + 5000) })),
    }));
    expect(r.alerts.recentPendingRatio).toBeCloseTo(2 / 6, 4);
    expect(r.alerts.callbacksSuspect).toBe(true);
  });

  it('vendas dos disparos: totais, AOV, série diária BRT e quebra por campanha', () => {
    const rows: SmsSaleRow[] = [
      // 2026-07-08T01:00Z = 2026-07-07 22:00 BRT → dia 07 em BRT
      { grossUsd: 100, campaignKey: 'neuromind-reposicao-01', productName: 'NeuroMind 6', orderedAt: new Date('2026-07-08T01:00:00Z') },
      { grossUsd: 50, campaignKey: 'neuromind-reposicao-01', productName: 'NeuroMind 3', orderedAt: new Date('2026-07-08T15:00:00Z') },
      { grossUsd: 70, campaignKey: null, productName: null, orderedAt: new Date('2026-07-08T16:00:00Z') },
    ];
    const r = reduceSmsSales(rows);
    expect(r.sales).toBe(3);
    expect(r.grossUsd).toBe(220);
    expect(r.aovUsd).toBeCloseTo(73.33, 2);
    expect(r.daily).toEqual([
      { date: '2026-07-07', sales: 1, grossUsd: 100 },
      { date: '2026-07-08', sales: 2, grossUsd: 120 },
    ]);
    expect(r.byCampaign).toEqual([{ campaignKey: 'neuromind-reposicao-01', sales: 2, grossUsd: 150 }]);
    expect(r.recent.length).toBe(3);
  });

  it('vendas dos disparos: vazio não explode (AOV null)', () => {
    const r = reduceSmsSales([]);
    expect(r.sales).toBe(0);
    expect(r.grossUsd).toBe(0);
    expect(r.aovUsd).toBeNull();
    expect(r.daily).toEqual([]);
  });

  it('amostra <5 envios recentes não dispara alerta de callback', () => {
    const at = new Date(now.getTime() - 90 * 60_000);
    const r = reduceSms(baseInput({
      sent: [sent({ messageSid: 'a', occurredAt: at }), sent({ messageSid: 'b', occurredAt: at })],
    }));
    expect(r.alerts.recentPendingRatio).toBeNull();
    expect(r.alerts.callbacksSuspect).toBe(false);
  });
});
