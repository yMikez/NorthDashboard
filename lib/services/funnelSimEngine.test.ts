// Conta do motor da tela (public/src/pages/funnel-sim-engine.js) contra a planilha
// "BIFI - North Scale" de 20/11/2026: cenário realista −146.941,54; simulação +29.942,26.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Etapa = { id: string; preco: number; conv: number; cpa: number };
type Calc = (p: Record<string, number>, e: Etapa[]) => { rb: number; funil: number; final: number; cpa: number };

function carregaMotor(): Calc {
  const src = readFileSync(join(process.cwd(), 'public/src/pages/funnel-sim-engine.js'), 'utf8');
  const win: { NSFunnelSim?: { calcula: Calc } } = {};
  new Function('window', src)(win);
  if (!win.NSFunnelSim) throw new Error('motor não registrou window.NSFunnelSim');
  return win.NSFunnelSim.calcula;
}

const ETAPAS: Etapa[] = [
  ['FE', 294, 100, 230], ['OTO1', 220, 18, 0], ['OTO2', 174, 7.9, 0], ['OTO3', 174, 1.4, 0],
  ['DS1', 144, 5.2, 0], ['DS2', 68, 1.1, 0], ['DS3', 57, 0.4, 0],
].map(([id, preco, conv, cpa]) => ({ id: id as string, preco: preco as number, conv: conv as number, cpa: cpa as number }));
const BASE = { vendas: 10000, reemb: 12, cb: 4, alerta: 10, taxas: 2, fee: 7.9, ff: 9, cc: 5 };

describe('calcula (motor do Simulador de Funil)', () => {
  const calcula = carregaMotor();
  it('bate com o cenário realista da planilha', () => {
    const r = calcula(BASE, ETAPAS);
    expect(r.rb).toBeCloseTo(3582460, 2);
    expect(r.cpa).toBeCloseTo(2300000, 2);
    expect(r.final).toBeCloseTo(-146941.54, 2);
  });
  it('bate com a simulação da planilha (OTO1 23%, reembolso 10%, alertas 9%)', () => {
    const e = ETAPAS.map((x) => (x.id === 'OTO1' ? { ...x, conv: 23 } : x));
    const r = calcula({ ...BASE, reemb: 10, alerta: 9 }, e);
    expect(r.funil).toBeCloseTo(-154680.74, 2);
    expect(r.final).toBeCloseTo(29942.26, 2);
  });
});
