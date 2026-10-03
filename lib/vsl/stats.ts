// Estatística do teste A/B de VSL. Puro e determinístico (mesma entrada →
// mesma saída: o sorteio de Monte Carlo usa semente fixa).
//
// Métrica: conversões ÷ visitas de cada braço (aceite = clique em comprar,
// ou venda confirmada quando a plataforma permite casar visita e venda).
// - intervalo de 95% de Wilson por braço;
// - lift relativo vs controle (braço A) e p-valor do teste z de duas proporções;
// - "chance de ser o melhor": posterior Beta(c+1, n−c+1) aproximada por
//   normal, 20 mil sorteios com semente fixa;
// - amostra necessária pra detectar +20% relativo sobre o controle
//   (α 5% bicaudal, poder 80%).

export interface ArmInput {
  id: string;
  label: string;
  visits: number;
  conversions: number;
  /** false = braço sem tráfego (peso 0): aparece, mas fica fora do veredito */
  active?: boolean;
}

export interface ArmStats extends ArmInput {
  rate: number;
  ci95: [number, number];
  /** relativo ao controle (0.12 = +12%); null no próprio controle */
  liftVsControl: number | null;
  pValueVsControl: number | null;
  probBeatControl: number | null;
  probBest: number;
}

export type AbVerdict = 'insufficient' | 'leader' | 'no_difference' | 'running';

export interface AbResult {
  arms: ArmStats[];
  controlId: string | null;
  leaderId: string | null;
  verdict: AbVerdict;
  message: string;
  /** visitas por braço pra detectar +20% sobre o controle */
  neededVisitsPerArm: number | null;
}

export const AB_MIN_VISITS = 200;
export const AB_MIN_CONVERSIONS = 20;
export const AB_DECIDE_PROB = 0.95;

const Z_975 = 1.959964;
const Z_80 = 0.841621;

/** Φ(x) — erro < 1.5e-7 (Abramowitz-Stegun 26.2.17). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export function wilson(conversions: number, visits: number): [number, number] {
  if (visits <= 0) return [0, 0];
  const p = conversions / visits;
  const z2 = Z_975 * Z_975;
  const den = 1 + z2 / visits;
  const center = (p + z2 / (2 * visits)) / den;
  const half = (Z_975 * Math.sqrt((p * (1 - p)) / visits + z2 / (4 * visits * visits))) / den;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function betaMoments(c: number, n: number): { mean: number; sd: number } {
  const a = c + 1;
  const b = n - c + 1;
  const mean = a / (a + b);
  const v = (a * b) / ((a + b) * (a + b) * (a + b + 1));
  return { mean, sd: Math.sqrt(v) };
}

/** mulberry32 — PRNG de 32 bits com semente. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function probabilityBest(arms: ArmInput[], draws = 20000, seed = 20261003): number[] {
  if (arms.length === 0) return [];
  if (arms.length === 1) return [1];
  const m = arms.map((a) => betaMoments(Math.min(a.conversions, a.visits), Math.max(0, a.visits)));
  const next = rng(seed);
  const wins = new Array(arms.length).fill(0);
  for (let d = 0; d < draws; d++) {
    let best = -Infinity;
    let who = 0;
    for (let i = 0; i < arms.length; i++) {
      // Box-Muller
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const x = m[i].mean + m[i].sd * z;
      if (x > best) { best = x; who = i; }
    }
    wins[who]++;
  }
  return wins.map((w) => w / draws);
}

/** Visitas por braço pra detectar +lift relativo sobre a taxa base. */
export function neededVisits(baseRate: number, relativeLift = 0.2): number | null {
  if (!(baseRate > 0) || baseRate >= 1) return null;
  const p1 = baseRate;
  const p2 = Math.min(0.999, p1 * (1 + relativeLift));
  const pBar = (p1 + p2) / 2;
  const num = Z_975 * Math.sqrt(2 * pBar * (1 - pBar)) + Z_80 * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((num * num) / ((p2 - p1) * (p2 - p1)));
}

const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, '')}%`;

export function abStats(input: ArmInput[], opts: { minVisits?: number; minConversions?: number } = {}): AbResult {
  const minVisits = opts.minVisits ?? AB_MIN_VISITS;
  const minConversions = opts.minConversions ?? AB_MIN_CONVERSIONS;
  const arms = input.map((a) => ({ ...a, visits: Math.max(0, a.visits), conversions: Math.max(0, Math.min(a.conversions, a.visits)) }));
  if (arms.length === 0) {
    return { arms: [], controlId: null, leaderId: null, verdict: 'insufficient', message: 'Sem braços.', neededVisitsPerArm: null };
  }
  const control = arms[0];
  const pc = control.visits ? control.conversions / control.visits : 0;
  // Veredito só entre os braços que recebem tráfego.
  const activeIdx = arms.map((a, i) => (a.active === false ? -1 : i)).filter((i) => i >= 0);
  const pActive = probabilityBest(activeIdx.map((i) => arms[i]));
  const probs = arms.map(() => 0);
  activeIdx.forEach((i, k) => { probs[i] = pActive[k]; });

  const out: ArmStats[] = arms.map((a, i) => {
    const rate = a.visits ? a.conversions / a.visits : 0;
    let lift: number | null = null;
    let pValue: number | null = null;
    let beat: number | null = null;
    if (i > 0 && control.visits > 0 && a.visits > 0) {
      lift = pc > 0 ? rate / pc - 1 : null;
      const pooled = (a.conversions + control.conversions) / (a.visits + control.visits);
      const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.visits + 1 / control.visits));
      pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(rate - pc) / se)) : 1;
      const mc = betaMoments(control.conversions, control.visits);
      const ma = betaMoments(a.conversions, a.visits);
      beat = normalCdf((ma.mean - mc.mean) / Math.sqrt(ma.sd * ma.sd + mc.sd * mc.sd));
    }
    return {
      ...a,
      rate,
      ci95: wilson(a.conversions, a.visits),
      liftVsControl: lift,
      pValueVsControl: pValue,
      probBeatControl: beat,
      probBest: probs[i],
    };
  });

  const pool = activeIdx.length ? activeIdx.map((i) => out[i]) : out;
  const leader = pool.reduce((best, a) => (a.probBest > best.probBest ? a : best), pool[0]);
  const needed = neededVisits(pc > 0 ? pc : pool.reduce((s, a) => s + a.conversions, 0) / Math.max(1, pool.reduce((s, a) => s + a.visits, 0)));
  const smallest = Math.min(...pool.map((a) => a.visits));
  const totalConv = pool.reduce((s, a) => s + a.conversions, 0);

  let verdict: AbVerdict;
  let message: string;
  if (pool.length < 2 || smallest < minVisits || totalConv < minConversions) {
    verdict = 'insufficient';
    const target = Math.max(minVisits, needed ?? minVisits);
    message = `Amostra pequena: o braço com menos visitas tem ${smallest}. Deixe rodar até ~${target.toLocaleString('en-US')} visitas por braço antes de decidir.`;
  } else if (leader.probBest >= AB_DECIDE_PROB) {
    verdict = 'leader';
    const vs = leader.id === control.id ? '' : ` (${leader.liftVsControl != null ? (leader.liftVsControl >= 0 ? '+' : '') + pct(leader.liftVsControl) : '—'} vs ${control.label})`;
    message = `${leader.label} tem ${pct(leader.probBest)} de chance de ser a melhor${vs}. Dá pra encerrar e aplicar.`;
  } else if (needed != null && smallest >= 2 * needed && leader.probBest < 0.8) {
    verdict = 'no_difference';
    message = `Sem diferença relevante depois de ${smallest.toLocaleString('en-US')} visitas por braço — as VSLs convertem parecido. Mantenha a mais simples ou teste outra ideia.`;
  } else {
    verdict = 'running';
    message = `Ainda sem vencedor: ${leader.label} lidera com ${pct(leader.probBest)} de chance de ser a melhor. Para decidir, precisa passar de ${pct(AB_DECIDE_PROB)}.`;
  }

  return { arms: out, controlId: control.id, leaderId: leader.id, verdict, message, neededVisitsPerArm: needed };
}
