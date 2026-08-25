import { describe, expect, it } from 'vitest';
import { funnelTransition, funnelWindowNote, type FunnelScope } from './funnelSequence';

const scope = (fe: number, up1Take: number, up2Take: number, feTicket = 100, up1Ticket = 150, up2Ticket = 200): FunnelScope => {
  const up1 = Math.round(fe * up1Take); const up2 = Math.round(fe * up2Take);
  const feRev = fe * feTicket; const up1Rev = up1 * up1Ticket; const up2Rev = up2 * up2Ticket;
  const total = feRev + up1Rev + up2Rev;
  return {
    stages: [
      { id: 'FE', label: 'Frontend', volume: fe, revenue: feRev, takeRate: 1 },
      { id: 'UP1', label: 'UP1', volume: up1, revenue: up1Rev, takeRate: fe ? up1 / fe : 0 },
      { id: 'UP2', label: 'UP2', volume: up2, revenue: up2Rev, takeRate: fe ? up2 / fe : 0 },
    ],
    summary: { feGroups: fe, totalGroups: fe, totalRevenue: total, aov: fe ? total / fe : 0, aovFEOnly: feTicket, aovWithUpsell: fe ? total / fe : 0, revenueLiftFromUpsells: fe ? total / feRev - 1 : 0 },
  };
};

describe('funnelTransition', () => {
  it('decomposição volume × AOV fecha e aponta o estágio que mais mexeu', () => {
    const prev = scope(100, 0.4, 0.2);
    const cur = scope(100, 0.3, 0.2); // UP1 caiu 10pp, mesmo volume
    const t = funnelTransition(prev, cur, 0, 1);
    expect(t.volumeEffect + t.aovEffect).toBeCloseTo(t.revenueDelta, 1);
    expect(t.volumeEffect).toBe(0);
    expect(t.topStage?.id).toBe('UP1');
    expect(t.topStage?.takePp).toBeCloseTo(-0.1, 4);
    expect(t.topStage?.takeEffectUsd).toBeCloseTo(-0.1 * 100 * 150, 0);
    expect(t.note).toMatch(/Puxada pelo AOV de sessão/);
    expect(t.note).toMatch(/UP1: take rate 40,0% → 30,0%/);
  });
  it('volume dominante com take rates estáveis', () => {
    const t = funnelTransition(scope(100, 0.4, 0.2), scope(150, 0.41, 0.2), 0, 1);
    expect(Math.abs(t.volumeEffect)).toBeGreaterThan(Math.abs(t.aovEffect));
    expect(t.note).toMatch(/Puxada pelo volume de FEs 100 → 150/);
    expect(t.note).toMatch(/Take rates por estágio estáveis/);
    expect(t.tone).toBe('pos');
  });
  it('sem base: primeira janela com vendas', () => {
    const t = funnelTransition(scope(0, 0, 0), scope(20, 0.5, 0.1), 0, 1);
    expect(t.note).toMatch(/Primeira janela com vendas/);
    expect(t.fePct).toBeNull();
  });
});

describe('funnelWindowNote', () => {
  it('ponto de partida com take rates; janela seguinte lê a transição', () => {
    const s = [scope(100, 0.4, 0.2), scope(60, 0.4, 0.2)];
    const tr = [funnelTransition(s[0], s[1], 0, 1)];
    expect(funnelWindowNote(0, s, tr).text).toMatch(/Take rates: UP1 40,0% · UP2 20,0%/);
    const n = funnelWindowNote(1, s, tr);
    expect(n.tone).toBe('neg');
    expect(n.title).toBe('▼ Caiu no volume de FEs');
  });
});
