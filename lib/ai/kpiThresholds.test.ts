// Os limiares da IA precisam ser OS DA TELA. overview.jsx é JSX clássico
// (sem módulo): recortamos o literal KPI_THRESHOLDS, avaliamos as funções
// `state` e comparamos ponto a ponto com classifyKpi — inclusive nas
// fronteiras, onde >= × > muda o veredito.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KPI_THRESHOLDS, classifyKpi, renderThresholdsPrompt, type KpiKey, type KpiState } from './kpiThresholds';

const OVERVIEW = readFileSync(resolve(__dirname, '../../public/src/pages/overview.jsx'), 'utf8').replace(/\r\n/g, '\n');

/** Recorta o literal {…} depois de `marker`, pulando strings/template e comentários. */
function sliceObjectLiteral(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`não achei ${marker}`);
  let i = src.indexOf('{', at);
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (src[i] !== '\n') i++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('literal não fecha');
}

type ScreenThresholds = Record<string, { state: (v: number) => KpiState }>;
const screen = new Function(`return (${sliceObjectLiteral(OVERVIEW, 'const KPI_THRESHOLDS =')});`)() as ScreenThresholds;

/** Grade densa + as fronteiras exatas e vizinhas (onde >= × > diverge). */
function probes(key: KpiKey): number[] {
  const t = KPI_THRESHOLDS[key];
  const scale = t.unit === 'fraction' ? 1 : 100;
  const grid = Array.from({ length: 601 }, (_, k) => (k / 2000) * scale);
  const eps = 1e-9 * scale;
  const edges = [t.warnAt, t.dangerAt].flatMap((e) => [e - eps, e, e + eps]);
  return [...grid, ...edges, -scale, 2 * scale];
}

describe('KPI_THRESHOLDS × overview.jsx', () => {
  for (const key of ['approvalRate', 'refundRate', 'cbRate', 'estimatedMarginPct'] as const) {
    it(`${key}: mesmo estado da tela em toda a régua`, () => {
      expect(screen[key], `${key} sumiu do overview.jsx`).toBeDefined();
      for (const v of probes(key)) expect(classifyKpi(key, v), `${key}(${v})`).toBe(screen[key].state(v));
    });
  }

  it('monitor 7d do card "Reembolso por pedidos" (inline no JSX) = refunds7dPct', () => {
    const m = OVERVIEW.match(/split\.refunds7d\.pct (>=?) (\d+(?:\.\d+)?) \? 'danger' : split\.refunds7d\.pct (>=?) (\d+(?:\.\d+)?) \? 'warn'/);
    expect(m, 'régua do monitor 7d mudou de formato no overview.jsx').not.toBeNull();
    const t = KPI_THRESHOLDS.refunds7dPct;
    expect(Number(m![2])).toBe(t.dangerAt);
    expect(Number(m![4])).toBe(t.warnAt);
    expect(m![1] === '>=').toBe(t.inclusive);
    expect(m![3] === '>=').toBe(t.inclusive);
    const alert = OVERVIEW.match(/alert=\{\(split\?\.refunds7d\?\.pct \?\? 0\) > (\d+(?:\.\d+)?)\}/);
    expect(Number(alert?.[1])).toBe(t.dangerAt);
  });

  it('alerta do card de chargeback acende na fronteira "ruim"', () => {
    const m = OVERVIEW.match(/alert=\{kpis\.cbRate (>=?) (\d*\.\d+)\}/);
    expect(Number(m?.[2])).toBe(KPI_THRESHOLDS.cbRate.dangerAt);
    expect(m?.[1] === '>=').toBe(KPI_THRESHOLDS.cbRate.inclusive);
  });
});

describe('renderThresholdsPrompt', () => {
  const text = renderThresholdsPrompt();

  it('texto sai das constantes, em %, com o campo e a unidade do campo', () => {
    expect(text).toContain('Taxa de aprovação (get_overview.kpis.approvalRate, fração 0–1): ok ≥ 90%; atenção entre 85% e 90%; ruim < 85%.');
    expect(text).toContain('Chargeback (get_overview.kpis.cbRate, fração 0–1): ok < 1%; atenção entre 1% e 2%; ruim ≥ 2%.');
    expect(text).toContain('(get_profit_split.refunds.valuePct, pontos percentuais): ok ≤ 8%; atenção entre 8% e 10%; ruim > 10%.');
    expect(text).toContain('Margem estimada (get_overview.kpis.estimatedMarginPct, pontos percentuais): ok ≥ 10%; atenção entre 5% e 10%; ruim < 5%.');
  });

  it('régua de CPA fica fora (vem do banco via get_profit_model)', () => {
    expect(text).toContain('get_profit_model');
    expect(text).not.toMatch(/healthyMinUsd\s*=\s*\d/);
  });
});
