// Consistência ENTRE tools, sem LLM (segundos, custo zero): o mesmo número
// visto por dois caminhos tem que bater. Roda antes do eval — se a camada
// de tools discorda de si mesma, o modelo não pode ser culpado pelo número.
//
//   I1 receita: overview.gross ≈ Σ platforms.totalRevenue ≈ profit_split.front.grossUsd ≈ costs.grossUsd
//   I2 receita por família: overview(F).gross ≈ families[F].grossRevenue
//   I3 AOV por família: overview(F).aov × families[F].aov — definições
//      DIFERENTES de propósito (sessão × gross/FEs): só informativo
//   I4 CPA: overview.cpa ≈ costs.cpaUsd
//   I5 AOV: funnel.summary.aov ≈ overview.aov
//   I6 afiliados: affiliates.summary.totalRevenue ≈ overview.gross

export type ToolFetcher = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface InvariantResult {
  id: string;
  title: string;
  status: 'ok' | 'diff' | 'info' | 'error';
  values: Record<string, number | null>;
  /** Maior diferença relativa entre os valores (0.01 = 1%). */
  maxRelDiff: number | null;
  detail?: string;
}

export interface InvariantRange {
  start_date: string;
  end_date: string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, k) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined), obj);
}

function errorOf(v: unknown): string | null {
  return v && typeof v === 'object' && 'error' in (v as object) ? String((v as { error: unknown }).error) : null;
}

/** Maior diferença relativa entre os valores presentes (base = maior módulo do par). */
export function maxRelDiff(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null);
  if (xs.length < 2) return null;
  let worst = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const base = Math.max(Math.abs(xs[i]), Math.abs(xs[j]));
      if (base === 0) continue;
      worst = Math.max(worst, Math.abs(xs[i] - xs[j]) / base);
    }
  }
  return Math.round(worst * 100_000) / 100_000;
}

function compareSet(id: string, title: string, values: Record<string, number | null>, tol: number, informative = false): InvariantResult {
  const diff = maxRelDiff(Object.values(values));
  if (diff == null) return { id, title, status: 'error', values, maxRelDiff: null, detail: 'menos de dois valores disponíveis' };
  return { id, title, status: informative ? 'info' : diff <= tol ? 'ok' : 'diff', values, maxRelDiff: diff };
}

export async function runInvariants(
  fetch: ToolFetcher,
  range: InvariantRange,
  opts: { tol?: number; maxFamilies?: number } = {},
): Promise<InvariantResult[]> {
  const tol = opts.tol ?? 0.005;
  const safe = async (tool: string, args: Record<string, unknown>) => {
    try {
      const v = await fetch(tool, args);
      return { v, err: errorOf(v) };
    } catch (e) {
      return { v: null, err: e instanceof Error ? e.message : String(e) };
    }
  };
  const [ov, plat, split, costs, funnel, affs, fams] = await Promise.all([
    safe('get_overview', { ...range }),
    safe('get_platforms', { ...range }),
    safe('get_profit_split', { ...range }),
    safe('get_costs_overview', { ...range }),
    safe('get_funnel', { ...range }),
    safe('get_affiliates', { ...range }),
    safe('get_families', { ...range }),
  ]);
  const out: InvariantResult[] = [];
  const errs = [ov, plat, split, costs, funnel, affs, fams].map((r) => r.err).filter(Boolean);
  if (ov.err) {
    return [{ id: 'I0', title: 'get_overview disponível', status: 'error', values: {}, maxRelDiff: null, detail: ov.err }];
  }

  const platforms = get(plat.v, 'platforms');
  const platformSum = Array.isArray(platforms)
    ? platforms.reduce((n, p) => n + (num((p as Record<string, unknown>).totalRevenue) ?? 0), 0)
    : null;
  out.push(
    compareSet('I1', 'Receita bruta: visão geral × Σ plataformas × lucro front × custos', {
      'get_overview.kpis.gross': num(get(ov.v, 'kpis.gross')),
      'Σ get_platforms.totalRevenue': plat.err ? null : platformSum,
      'get_profit_split.front.grossUsd': split.err ? null : num(get(split.v, 'front.grossUsd')),
      'get_costs_overview.kpis.grossUsd': costs.err ? null : num(get(costs.v, 'kpis.grossUsd')),
    }, tol),
  );
  out.push(
    compareSet('I4', 'CPA: visão geral × custos', {
      'get_overview.kpis.cpa': num(get(ov.v, 'kpis.cpa')),
      'get_costs_overview.kpis.cpaUsd': costs.err ? null : num(get(costs.v, 'kpis.cpaUsd')),
    }, tol),
  );
  out.push(
    compareSet('I5', 'AOV: funil × visão geral', {
      'get_funnel.summary.aov': funnel.err ? null : num(get(funnel.v, 'summary.aov')),
      'get_overview.kpis.aov': num(get(ov.v, 'kpis.aov')),
    }, tol),
  );
  out.push(
    compareSet('I6', 'Receita: Σ afiliados × visão geral', {
      'get_affiliates.summary.totalRevenue': affs.err ? null : num(get(affs.v, 'summary.totalRevenue')),
      'get_overview.kpis.gross': num(get(ov.v, 'kpis.gross')),
    }, tol),
  );

  // I2/I3 nas maiores famílias do período.
  const famList = Array.isArray(get(fams.v, 'families')) ? (get(fams.v, 'families') as Array<Record<string, unknown>>) : [];
  const top = [...famList]
    .filter((f) => typeof f.family === 'string' && (num(f.grossRevenue) ?? 0) > 0)
    .sort((a, b) => (num(b.grossRevenue) ?? 0) - (num(a.grossRevenue) ?? 0))
    .slice(0, opts.maxFamilies ?? 3);
  for (const f of top) {
    const family = f.family as string;
    const ovF = await safe('get_overview', { ...range, families: [family] });
    if (ovF.err) {
      out.push({ id: `I2:${family}`, title: `Receita da família ${family}`, status: 'error', values: {}, maxRelDiff: null, detail: ovF.err });
      continue;
    }
    out.push(
      compareSet(`I2:${family}`, `Receita da família ${family}: visão geral × famílias`, {
        'get_overview(F).kpis.gross': num(get(ovF.v, 'kpis.gross')),
        'get_families[F].grossRevenue': num(f.grossRevenue),
      }, tol),
    );
    out.push(
      compareSet(`I3:${family}`, `AOV da família ${family}: sessão (visão geral) × gross/FEs (famílias) — definições diferentes`, {
        'get_overview(F).kpis.aov': num(get(ovF.v, 'kpis.aov')),
        'get_families[F].aov': num(f.aov),
      }, tol, true),
    );
  }
  if (errs.length) {
    out.push({ id: 'I9', title: 'Tools com erro nesta rodada', status: 'error', values: {}, maxRelDiff: null, detail: errs.join(' · ') });
  }
  return out;
}
