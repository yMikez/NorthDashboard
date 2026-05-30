// Modelo de AOV — PORTADO VERBATIM de calculadoraAOV.html (Downloads/Upsell01,
// linhas 298-424). Funções puras, sem I/O. A lógica é idêntica ao .html
// standalone (golden vectors travados em aov-math.test.ts) — qualquer
// divergência quebra teste.
//
//  AOV = FrontPrice + Σ (conv_i * Ticket_i)
//  conv_i = take-rate (0..1) do upsell i medida sobre as orders do front.

const EPS = 1e-9;

export interface UpsellStage {
  name: string; // 'UP1' | 'UP2' | 'UP3'
  price: number; // ticket do upsell
  floor: number; // piso de conversão (0..1)
}

export interface AovInputs {
  front: number; // Front AOV
  orders: number; // base orders (projeções de volume; não entra no AOV em si)
  target: number; // target AOV
  up: UpsellStage[]; // os 3 stages
}

export type ScenarioStatus = 'ok' | 'over' | 'below';

export interface Scenario {
  label: string;
  desc: string;
  targetIdx: number[]; // índices dos stages que sobem
  convs: number[]; // vetor de conversões resultante
  reqConv: number; // conversão exigida (single-step) ou lift (combinado)
  status: ScenarioStatus;
  aov: number;
  effort: number; // soma dos aumentos acima do piso (menor = mais fácil)
  feasible: boolean;
}

/** AOV dado um vetor de conversões [c1,c2,c3]. */
export function aovFromConvs(d: AovInputs, convs: number[]): number {
  return d.front + d.up.reduce((sum, u, i) => sum + convs[i] * u.price, 0);
}

/**
 * Gera os 5 cenários canônicos: foco em UP1, UP2, UP3, UP2+UP3, distribuído.
 * Conversões válidas: piso ≤ c ≤ 1.
 */
export function buildScenarios(d: AovInputs): Scenario[] {
  const floors = d.up.map((u) => u.floor);
  const scenarios: Scenario[] = [];

  // Single-step: sobe só a etapa alvo (índice t), demais no piso.
  const singleStep = (t: number, label: string, desc: string): Scenario => {
    const convs = floors.slice();
    const fixed =
      d.front + d.up.reduce((s, u, i) => (i === t ? s : s + floors[i] * u.price), 0);
    const need = d.target - fixed;
    const reqConv = d.up[t].price > 0 ? need / d.up[t].price : Infinity;
    convs[t] = reqConv;

    let status: ScenarioStatus = 'ok';
    if (reqConv < floors[t] - EPS) status = 'below';
    else if (reqConv > 1 + EPS) status = 'over';
    return { label, desc, targetIdx: [t], convs, reqConv, status, aov: 0, effort: 0, feasible: false };
  };

  scenarios.push(singleStep(0, 'Foco em UP1', 'Aumenta apenas a conversão da UP1; UP2 e UP3 no piso.'));
  scenarios.push(singleStep(1, 'Foco em UP2', 'Aumenta apenas a conversão da UP2; UP1 e UP3 no piso.'));
  scenarios.push(singleStep(2, 'Foco em UP3', 'Aumenta apenas a conversão da UP3; UP1 e UP2 no piso.'));

  // UP2 + UP3 sobem juntas (lift igual), UP1 no piso.
  {
    const convs = floors.slice();
    const fixed = d.front + floors[0] * d.up[0].price;
    const need = d.target - fixed;
    const denom = d.up[1].price + d.up[2].price;
    const lift = denom > 0 ? (need - floors[1] * d.up[1].price - floors[2] * d.up[2].price) / denom : Infinity;
    convs[1] = floors[1] + lift;
    convs[2] = floors[2] + lift;

    let status: ScenarioStatus = 'ok';
    if (lift < -EPS) status = 'below';
    else if (convs[1] > 1 + EPS || convs[2] > 1 + EPS) status = 'over';
    scenarios.push({
      label: 'Foco em UP2 + UP3',
      desc: 'Sobe UP2 e UP3 com lift igual; UP1 permanece no piso.',
      targetIdx: [1, 2], convs, reqConv: lift, status, aov: 0, effort: 0, feasible: false,
    });
  }

  // Distribuído: UP1 + UP2 + UP3 sobem juntas (lift igual a partir dos pisos).
  {
    const convs = floors.slice();
    const need = d.target - d.front;
    const denom = d.up[0].price + d.up[1].price + d.up[2].price;
    const lift = denom > 0
      ? (need - floors.reduce((s, f, i) => s + f * d.up[i].price, 0)) / denom
      : Infinity;
    d.up.forEach((_, i) => (convs[i] = floors[i] + lift));

    let status: ScenarioStatus = 'ok';
    if (lift < -EPS) status = 'below';
    else if (convs.some((c) => c > 1 + EPS)) status = 'over';
    scenarios.push({
      label: 'Distribuído (UP1 + UP2 + UP3)',
      desc: 'Distribui o aumento igualmente entre as três etapas.',
      targetIdx: [0, 1, 2], convs, reqConv: lift, status, aov: 0, effort: 0, feasible: false,
    });
  }

  // Esforço: soma do aumento de conversão acima do piso. Menor = mais fácil.
  for (const s of scenarios) {
    s.aov = aovFromConvs(d, s.convs);
    s.effort = s.convs.reduce((sum, c, i) => sum + Math.max(0, c - floors[i]), 0);
    s.feasible = s.status === 'ok';
  }

  return scenarios;
}

export interface AovComputation {
  baselineAov: number;
  gap: number;
  scenarios: Scenario[];
  easiestLabel: string | null;
}

/**
 * Espelha o render() do .html: baseline (todos no piso), gap vs target, os 5
 * cenários, e o mais fácil entre os viáveis (menor effort; empate → primeiro).
 */
export function computeAov(d: AovInputs): AovComputation {
  const scenarios = buildScenarios(d);
  const baselineAov = aovFromConvs(d, d.up.map((u) => u.floor));
  const gap = d.target - baselineAov;
  const feasible = scenarios.filter((s) => s.feasible);
  const easiest = feasible.length
    ? feasible.reduce((a, b) => (a.effort <= b.effort ? a : b))
    : null;
  return { baselineAov, gap, scenarios, easiestLabel: easiest ? easiest.label : null };
}
