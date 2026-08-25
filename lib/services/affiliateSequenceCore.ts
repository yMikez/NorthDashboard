// Núcleo PURO da visão em SEQUÊNCIA de janelas (Janela 1..K de N dias),
// Evolução · Comentários e Saúde da empresa. Inspirado no ranking HTML do
// usuário (ranking-afiliados-agosto-2026 (1).html): tabela por janela,
// cards de evolução com tag + barras + ranks + texto, linha do tempo com
// notas por janela, dinâmica retidos/novos/churn, risco de concentração e
// lista de reativação. Todo texto é gerado por REGRAS a partir dos números
// (determinístico, testável) — nada de IA aqui.
//
// Regras de classificação (ordem importa):
//   novo → churn → intermitente → breakout (vs PICO anterior, com piso) →
//   queda forte (vs pico, com "recuperação parcial" quando a última sobe) →
//   volátil (qualquer par de passos opostos ≥ 50%/35%) → estagnado →
//   crescimento → queda → estável.

import { pctDelta, round2, round4, type WindowMetrics, type WindowRange } from './affiliateAnalysisCore';

export type SeqTag = 'novo' | 'churn' | 'breakout' | 'crescimento' | 'estavel' | 'estagnado' | 'volatil' | 'queda' | 'queda_forte';

export const SEQ_TAG_LABELS: Record<SeqTag, string> = {
  breakout: 'Breakout', crescimento: 'Crescimento', estavel: 'Estável / saudável', estagnado: 'Estagnado',
  volatil: 'Volátil', queda: 'Queda', queda_forte: 'Queda forte', churn: 'Saiu do radar', novo: 'Novo entrante',
};

/** Receita mínima da última janela pra "breakout" significar algo. */
export const BREAKOUT_MIN_USD = 1000;

/** K janelas consecutivas de `days` dias terminando em lastIdx; índice 0 = mais antiga. */
export function sequenceRanges(days: number, count: number, lastIdx: number): WindowRange[] {
  const out: WindowRange[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const to = lastIdx - i * days;
    out.push({ from: to - days + 1, to });
  }
  return out;
}

const usd0 = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const usd2 = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (f: number) => (Math.abs(f) * 100).toFixed(1).replace('.', ',') + '%';
const signed = (f: number) => (f >= 0 ? '+' : '−') + pct1(f);
const rankStr = (r: number | null) => (r == null ? '—' : `#${r}`);

export interface EntitySeries {
  key: string;
  name: string;
  /** Uma posição por janela (0 = mais antiga). null = sem venda na janela. */
  metrics: Array<WindowMetrics | null>;
  ranks: Array<number | null>;
}

export interface Narrative {
  tag: SeqTag;
  title: string;
  text: string;
  /** Δ% receita entre janelas consecutivas (null quando uma delas está vazia). */
  deltas: Array<number | null>;
}

function present(m: WindowMetrics | null): m is WindowMetrics {
  return !!m && m.revenue > 0;
}

/**
 * Classifica a trajetória de receita ao longo das janelas e escreve o
 * comentário (título + texto) no tom do relatório do usuário.
 */
export function narrateEntity(s: EntitySeries, labels: string[], cpaThresholds?: { healthyMinUsd: number; attentionMinUsd: number }): Narrative {
  const K = s.metrics.length;
  const L = K - 1;
  const rev = s.metrics.map((m) => (present(m) ? m.revenue : null));
  const deltas: Array<number | null> = rev.map((v, i) => (i === 0 || v == null || rev[i - 1] == null ? null : pctDelta(v, rev[i - 1]!)));
  const presentIdx = rev.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
  const first = presentIdx[0] ?? -1;
  const lastPresent = presentIdx.length ? presentIdx[presentIdx.length - 1] : -1;
  const last = s.metrics[L];
  const lbl = (i: number) => labels[i] ?? `Janela ${i + 1}`;
  const trajectory = () => rev.map((v) => (v == null ? '—' : usd0(v))).join(' → ');
  const rankPath = () => s.ranks.map(rankStr).join(' → ');
  const single = K === 2; // uma transição só: sem "consistente"/"sem sinal"

  // Comentário de CPA/saúde da margem (última janela com venda).
  const lastM = lastPresent >= 0 ? s.metrics[lastPresent]! : null;
  const presentMetrics = s.metrics.filter(present);
  const statuses = presentMetrics.map((m) => m.cpaStatus);
  const cpaLine = (() => {
    if (!lastM || lastM.netAfterCpa == null) return '';
    const n = lastM.netAfterCpa;
    const c = lastM.cpaPerFe;
    const allHealthy = statuses.length > 0 && statuses.every((x) => x === 'saudavel');
    const allBad = statuses.length > 1 && statuses.every((x) => x === 'renegociar');
    if (lastM.cpaStatus === 'renegociar') {
      return ` Atenção: Net após CPA ${n < 0 ? 'negativo' : 'baixo'} (${usd2(n)} por FE) com o CPA atual de ${usd0(c)}${allBad ? ' — em todas as janelas' : ''}: ${n < 0 ? 'opera no vermelho por venda; renegociar antes de escalar mais tráfego' : 'renegociar antes que uma piora na aprovação vire prejuízo'}.`;
    }
    if (lastM.cpaStatus === 'atencao') {
      return ` Ponto de atenção: status "atenção" — Net após CPA de ${usd2(n)} por FE, margem no limite com o CPA de ${usd0(c)}.`;
    }
    if (allHealthy && statuses.length > 1) return ` Net após CPA saudável (${usd2(n)} por FE${cpaThresholds ? `, acima do limiar de ${usd0(cpaThresholds.healthyMinUsd)}` : ''}) em todas as janelas — folga de margem.`;
    return ` Net após CPA saudável na última janela (${usd2(n)} por FE).`;
  })();
  const approvalLine = (() => {
    if (first < 0 || lastPresent <= first) return '';
    const a = s.metrics[first]!.approvalRate;
    const b = s.metrics[lastPresent]!.approvalRate;
    if (s.metrics[first]!.realOrders < 10 || s.metrics[lastPresent]!.realOrders < 10 || Math.abs(b - a) < 0.05) return '';
    return b > a ? ` Aprovação melhorou bastante (${pct1(a)} → ${pct1(b)}).` : ` Aprovação caiu (${pct1(a)} → ${pct1(b)}) — vale olhar a qualidade do tráfego.`;
  })();
  const meta = ` Rank: ${rankPath()}.`;

  // 1. Novo: só existe na última janela.
  if (K >= 2 && lastPresent === L && first === L) {
    const strong = (s.ranks[L] ?? 99) <= 10;
    return {
      tag: 'novo', deltas,
      title: strong ? 'Novo entrante — estreia forte' : 'Novo entrante',
      text: `Apareceu na ${lbl(L)} já em ${rankStr(s.ranks[L])} (${usd0(last!.revenue)}, ${last!.sales} pedidos${last!.realOrders >= 10 ? `, aprovação ${pct1(last!.approvalRate)}` : ''}).${cpaLine} Ainda não há histórico para avaliar consistência — acompanhar de perto nas próximas janelas.`,
    };
  }
  // 2. Churn: sumiu na(s) última(s) janela(s).
  if (first >= 0 && lastPresent < L) {
    const gone = L - lastPresent;
    const peakIdx = presentIdx.reduce((b, i) => (rev[i]! > rev[b]! ? i : b), presentIdx[0]);
    return {
      tag: 'churn', deltas,
      title: gone >= 2 ? 'Saiu do radar — churn total' : 'Sumiu na última janela',
      text: `Fez ${usd0(rev[peakIdx]!)} na ${lbl(peakIdx)} (${rankStr(s.ranks[peakIdx])})${lastPresent !== peakIdx ? `, ${usd0(rev[lastPresent]!)} na ${lbl(lastPresent)}` : ''} e zero pedidos desde então (${gone === 1 ? 'última janela' : `${gone} janelas`}). Vale confirmar se parou de rodar tráfego, teve problema de conta/link ou migrou de operação.`,
    };
  }
  if (!present(last) || first < 0) {
    return { tag: 'estavel', deltas, title: 'Sem dados suficientes', text: 'Sem vendas nas janelas analisadas.' };
  }
  // 3. Intermitente: buraco no meio da série (vendeu, sumiu, voltou).
  if (lastPresent - first + 1 > presentIdx.length) {
    const gaps = rev.map((v, i) => (v == null && i > first && i < lastPresent ? lbl(i) : null)).filter((x): x is string => !!x);
    return {
      tag: 'volatil', deltas,
      title: 'Intermitente — aparece e some',
      text: `Vendeu em ${presentIdx.map((i) => lbl(i)).join(', ')} e ficou sem nenhuma venda em ${gaps.join(', ')}. Última janela: ${usd0(last.revenue)} (${rankStr(s.ranks[L])}). Padrão de campanha ligada/desligada — vale entender se é decisão do afiliado ou problema de tráfego.${cpaLine}${meta}`,
    };
  }

  const dLast = deltas[L];
  const earlierIdx = presentIdx.filter((i) => i < L);
  const maxEarlier = earlierIdx.length ? Math.max(...earlierIdx.map((i) => rev[i]!)) : 0;
  const peakIdx = presentIdx.reduce((b, i) => (rev[i]! > rev[b]! ? i : b), presentIdx[0]);
  const overall = first < L && rev[first] != null ? pctDelta(last.revenue, rev[first]!) : null;

  // 4. Breakout: última janela ≥ 3× o PICO anterior e receita relevante.
  if (maxEarlier > 0 && last.revenue >= 3 * maxEarlier && last.revenue >= BREAKOUT_MIN_USD) {
    const tiny = maxEarlier < BREAKOUT_MIN_USD;
    const from = rev[L - 1] ?? maxEarlier;
    return {
      tag: 'breakout', deltas,
      title: tiny ? `Breakout — de quase zero a ${rankStr(s.ranks[L])}` : `Breakout — disparada de ${pct1(pctDelta(last.revenue, from) ?? 0)}`,
      text: `${tiny ? `Praticamente inexistente antes (${usd0(maxEarlier)} no melhor caso)` : `Saiu de ${usd0(from)}`} e ${tiny ? 'disparou' : 'foi'} para ${usd0(last.revenue)} (${last.sales} pedidos) na ${lbl(L)}, ${rankStr(s.ranks[L])} no ranking${(s.ranks[L] ?? 99) === 1 ? ' — liderança isolada' : ''}.${approvalLine}${cpaLine} Vale entender o que mudou na operação (criativo novo, público novo, aumento de budget) para replicar com outros afiliados, e monitorar se o volume é sustentável ou um pico pontual.${meta}`,
    };
  }
  // 5. Queda forte vs pico (com recuperação parcial quando a última sobe).
  // Pico no MEIO com a última janela de volta ao patamar inicial é um
  // espeto ("pico e queda"), não queda forte — deixa pra regra 6.
  const spike = peakIdx > first && Math.abs(last.revenue - rev[first]!) / Math.max(rev[first]!, 1) < 0.35;
  if (maxEarlier > 0 && last.revenue <= 0.4 * maxEarlier && !spike) {
    const netUp = lastM && s.metrics[peakIdx]?.netAfterCpa != null && lastM.netAfterCpa != null && lastM.netAfterCpa > s.metrics[peakIdx]!.netAfterCpa!;
    const recovering = dLast != null && dLast >= 0.5;
    const trough = recovering ? rev[L - 1]! : last.revenue;
    return {
      tag: 'queda_forte', deltas,
      title: recovering ? `Queda forte, com recuperação parcial na ${lbl(L)}` : `Queda forte — de ${rankStr(s.ranks[peakIdx])} para ${rankStr(s.ranks[L])}`,
      text: `Era ${rankStr(s.ranks[peakIdx])} na ${lbl(peakIdx)} (${usd0(rev[peakIdx]!)}) e derreteu para ${usd0(trough)}${recovering ? ` na ${lbl(L - 1)}, recuperando parte na ${lbl(L)} (${usd0(last.revenue)}, ${signed(dLast!)}) — ainda ${pct1(pctDelta(last.revenue, rev[peakIdx]!) ?? 0)} abaixo do pico` : ` na ${lbl(L)} (${signed(pctDelta(last.revenue, rev[peakIdx]!) ?? 0)})`}. ${netUp ? 'Curioso: o Net após CPA melhorou porque o CPA caiu mais que a receita — vende bem menos, mas o pouco que vende é mais lucrativo. ' : ''}Vale entender se reduziu investimento de propósito ou perdeu tração.${approvalLine}${cpaLine}${meta}`,
    };
  }
  // 6. Volátil: passos opostos grandes em qualquer ponto da série.
  const steps = deltas.map((d, i) => ({ d, i })).filter((x): x is { d: number; i: number } => x.d != null);
  for (let j = 1; j < steps.length; j++) {
    const a = steps[j - 1]; const b = steps[j];
    if (a.d >= 0.5 && b.d <= -0.35) {
      const base = rev[a.i - 1]!;
      const backToStart = Math.abs(rev[b.i]! - base) / Math.max(base, 1) < 0.35;
      const tail = b.i < L ? ` Depois: ${rev.slice(b.i + 1).map((v) => (v == null ? '—' : usd0(v))).join(' → ')}.` : '';
      return {
        tag: 'volatil', deltas,
        title: backToStart && b.i === L ? 'Pico e queda — voltou quase ao ponto de partida' : 'Pico e queda',
        text: `Saltou ${signed(a.d)} na ${lbl(a.i)} (${usd0(rev[a.i]!)}) e devolveu ${pct1(b.d)} na ${lbl(b.i)} (${usd0(rev[b.i]!)})${backToStart ? ', voltando perto do patamar anterior' : ''}.${tail}${approvalLine}${cpaLine}${meta}`,
      };
    }
    if (a.d <= -0.35 && b.d >= 0.5) {
      return {
        tag: 'volatil', deltas,
        title: 'Queda e recuperação',
        text: `Caiu ${pct1(a.d)} na ${lbl(a.i)} e recuperou ${signed(b.d)} na ${lbl(b.i)} (${usd0(rev[b.i]!)}); última janela ${usd0(last.revenue)}. Oscilação grande entre janelas — vale entender o que muda de uma pra outra (budget, aprovação, oferta).${approvalLine}${cpaLine}${meta}`,
      };
    }
  }
  // 7. Estagnado: caiu e ficou parado.
  if (K >= 3 && deltas[L - 1] != null && dLast != null && deltas[L - 1]! <= -0.2 && Math.abs(dLast) < 0.1) {
    return {
      tag: 'estagnado', deltas,
      title: 'Estagnado depois de uma queda',
      text: `Caiu ${pct1(deltas[L - 1]!)} na ${lbl(L - 1)} e ficou praticamente parado desde então (${signed(dLast)}), em ${usd0(last.revenue)}${s.ranks[L] === s.ranks[L - 1] ? ` — segue em ${rankStr(s.ranks[L])} há duas janelas seguidas` : ''}.${approvalLine}${cpaLine}${meta}`,
    };
  }
  const consecutive = steps.map((x) => x.d);
  // 8. Crescimento.
  if ((overall != null && overall >= 0.5) || (consecutive.length >= 1 && consecutive.every((d) => d >= 0.25))) {
    const stabilized = !single && dLast != null && Math.abs(dLast) < 0.1 && (deltas[L - 1] ?? 0) >= 0.5;
    return {
      tag: 'crescimento', deltas,
      title: stabilized ? 'Cresceu forte e estabilizou em novo patamar' : single ? `Crescimento de ${signed(overall ?? 0)}` : 'Crescimento forte e consistente',
      text: `${trajectory()}${overall != null ? ` (${signed(overall)} no período)` : ''}, ${rankStr(s.ranks[first])} → ${rankStr(s.ranks[L])}.${stabilized ? ' Manteve o patamar na última janela.' : ' Afiliado em ascensão — vale dar atenção/incentivo.'}${approvalLine}${cpaLine}${meta}`,
    };
  }
  // 9. Queda.
  if ((overall != null && overall <= -0.25) || (consecutive.length >= 2 && consecutive.every((d) => d <= -0.15))) {
    return {
      tag: 'queda', deltas,
      title: single ? `Queda de ${pct1(overall ?? 0)}` : 'Queda consistente, sem sinal de recuperação',
      text: `${trajectory()} (${overall != null ? signed(overall) : '—'} no período), ${rankStr(s.ranks[first])} → ${rankStr(s.ranks[L])}. Vale entender o motivo (tráfego, oferta, concorrência) antes de continuar investindo CPA nele.${approvalLine}${cpaLine}${meta}`,
    };
  }
  // 10. Estável.
  const healthyAll = statuses.length === presentMetrics.length && statuses.length > 0 && statuses.every((x) => x === 'saudavel') && lastM?.netAfterCpa != null;
  return {
    tag: 'estavel', deltas,
    title: healthyAll ? 'Estável e saudável' : 'Estável',
    text: `${rankPath()}, receita ${trajectory()}${consecutive.length ? ` (${consecutive.map(signed).join(' e ')})` : ''}.${healthyAll ? ' Operação constante e com folga de margem — nenhuma ação necessária, só manter.' : ''}${approvalLine}${cpaLine}`,
  };
}

// ── Saúde da empresa ────────────────────────────────────────────────────

export interface WindowTotals {
  revenue: number;
  sales: number;
  active: number;
  concentrationTop10: number; // fração
  topShare2: number;          // fração dos 2 primeiros
  topNames: string[];         // 2 primeiros
}

export interface EntityWindowRow { key: string; name: string; revenue: number; sales: number }

export interface Transition {
  from: number;
  to: number;
  retained: number;
  newCount: number;
  churnCount: number;
  revenueNew: number;
  revenueChurn: number;
  revenueRetainedBefore: number;
  revenueRetainedAfter: number;
  retainedChangePct: number | null;
  topGainers: Array<{ name: string; delta: number }>;
  topLosers: Array<{ name: string; delta: number }>;
  topNew: Array<{ name: string; revenue: number }>;
  note: string;
}

/**
 * Causa da variação total: compara MAGNITUDES — o que os retidos ganharam/
 * perderam vs o saldo líquido de aquisição (novos − churn).
 */
export function explainTransition(t: { revenueNew: number; revenueChurn: number; revenueRetainedBefore: number; revenueRetainedAfter: number; churnCount: number; newCount: number; retained: number; topGainers: Array<{ name: string }>; topLosers: Array<{ name: string }>; topNew: Array<{ name: string }> }): { cause: 'retained-down' | 'churn' | 'retained-up' | 'new' | 'flat'; note: string } {
  const retainedDelta = t.revenueRetainedAfter - t.revenueRetainedBefore;
  const acqNet = t.revenueNew - t.revenueChurn;
  const total = retainedDelta + acqNet;
  const names = (l: Array<{ name: string }>) => l.map((x) => x.name).join(', ');
  const small = Math.abs(total) < Math.max(1, 0.03 * (t.revenueRetainedBefore + t.revenueChurn));
  if (small) {
    return { cause: 'flat', note: `Base estável: ${t.retained} retidos, ${t.newCount} novos (${usd0(t.revenueNew)}) e ${t.churnCount} que saíram (${usd0(t.revenueChurn)}).` };
  }
  if (total < 0) {
    if (retainedDelta <= acqNet) {
      return { cause: 'retained-down', note: `A queda no total não veio de perda de afiliados — veio da queda de receita entre quem continuou ativo (${usd0(retainedDelta)}${t.topLosers.length ? `, puxada por ${names(t.topLosers)}` : ''}); o saldo de novos − churn foi ${usd0(acqNet)}.` };
    }
    return { cause: 'churn', note: `A queda veio principalmente de afiliados que pararam (${t.churnCount} contas levaram ${usd0(t.revenueChurn)}, novos trouxeram só ${usd0(t.revenueNew)}); quem continuou variou ${usd0(retainedDelta)}.` };
  }
  if (retainedDelta >= acqNet) {
    return { cause: 'retained-up', note: `O crescimento veio principalmente de quem já estava ativo escalando o próprio volume (${usd0(retainedDelta)}${t.topGainers.length ? `: ${names(t.topGainers)}` : ''}), não de aquisição (saldo novos − churn ${usd0(acqNet)}).` };
  }
  return { cause: 'new', note: `O crescimento veio principalmente de afiliados novos (${usd0(t.revenueNew)}${t.topNew.length ? `: ${names(t.topNew)}` : ''}, contra ${usd0(t.revenueChurn)} perdidos com churn); quem continuou variou ${usd0(retainedDelta)}.` };
}

/** Retidos/novos/churn entre duas janelas consecutivas (só quem vendeu). */
export function transitionBetween(prev: EntityWindowRow[], cur: EntityWindowRow[], from: number, to: number): Transition {
  const p = new Map(prev.filter((r) => r.revenue > 0 || r.sales > 0).map((r) => [r.key, r]));
  const c = new Map(cur.filter((r) => r.revenue > 0 || r.sales > 0).map((r) => [r.key, r]));
  let retained = 0; let before = 0; let after = 0;
  const moves: Array<{ name: string; delta: number }> = [];
  for (const [k, r] of p) {
    const q = c.get(k);
    if (q) { retained++; before += r.revenue; after += q.revenue; moves.push({ name: q.name, delta: q.revenue - r.revenue }); }
  }
  const churn = [...p.values()].filter((r) => !c.has(r.key));
  const fresh = [...c.values()].filter((r) => !p.has(r.key));
  const revenueNew = fresh.reduce((n, r) => n + r.revenue, 0);
  const revenueChurn = churn.reduce((n, r) => n + r.revenue, 0);
  const retainedChangePct = before > 0 ? round4((after - before) / before) : null;
  moves.sort((a, b) => b.delta - a.delta);
  const topGainers = moves.filter((m) => m.delta > 0).slice(0, 3);
  const topLosers = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);
  const topNew = fresh.sort((a, b) => b.revenue - a.revenue).slice(0, 3).map((r) => ({ name: r.name, revenue: r.revenue }));
  const base = {
    from, to, retained, newCount: fresh.length, churnCount: churn.length,
    revenueNew: round2(revenueNew), revenueChurn: round2(revenueChurn),
    revenueRetainedBefore: round2(before), revenueRetainedAfter: round2(after), retainedChangePct,
    topGainers, topLosers, topNew,
  };
  return { ...base, note: explainTransition(base).note };
}

export interface HealthNote { index: number; tone: 'neutral' | 'pos' | 'neg'; title: string; text: string }

/** Nota da janela i na linha do tempo (usa a transição i−1 → i quando existe). */
export function healthNote(i: number, totals: WindowTotals[], transitions: Transition[], labels: string[]): HealthNote {
  const t = totals[i];
  if (t.revenue <= 0) {
    return { index: i, tone: 'neutral', title: '■ Sem vendas', text: `Nenhuma venda de afiliado nesta janela (${labels[i] ?? `Janela ${i + 1}`}).` };
  }
  const prev = i > 0 ? totals[i - 1] : null;
  if (!prev || prev.revenue <= 0) {
    const conc = t.topNames.length >= 2
      ? (t.topShare2 >= 0.5 ? `Já com risco de concentração: só os 2 primeiros (${t.topNames.join(' + ')}) respondem por ${pct1(t.topShare2)} de toda a receita de afiliados.` : `Top 10 com ${pct1(t.concentrationTop10)} da receita; os 2 primeiros (${t.topNames.join(' + ')}) com ${pct1(t.topShare2)}.`)
      : `${t.topNames[0] ?? 'Um afiliado'} responde por toda a receita.`;
    return {
      index: i, tone: 'neutral',
      title: prev ? '▲ Início da série' : (t.topShare2 >= 0.5 ? '⚠ Ponto de partida concentrado' : 'Ponto de partida'),
      text: `${prev ? 'Primeira janela com vendas: ' : ''}${usd0(t.revenue)} em ${t.sales} pedidos com ${t.active} afiliados ativos. ${conc}`,
    };
  }
  const tr = transitions.find((x) => x.to === i);
  const d = pctDelta(t.revenue, prev.revenue) ?? 0;
  const base = `Receita ${d >= 0 ? 'subiu' : 'caiu'} ${pct1(d)} (${usd0(prev.revenue)} → ${usd0(t.revenue)}) e a base ativa foi de ${prev.active} para ${t.active}.`;
  if (!tr) return { index: i, tone: d >= 0.1 ? 'pos' : d <= -0.1 ? 'neg' : 'neutral', title: d >= 0.1 ? '▲ Crescimento' : d <= -0.1 ? '▼ Queda' : '■ Estável', text: base };
  const cause = explainTransition(tr).cause;
  if (d <= -0.1) {
    if (cause === 'retained-down') {
      return { index: i, tone: 'neg', title: '▼ Queda no total — mas não é perda de afiliados', text: `${base} Os ${tr.newCount} novos trouxeram ${usd0(tr.revenueNew)} contra ${usd0(tr.revenueChurn)} levados pelos ${tr.churnCount} que saíram. A causa real da queda foi a retração de ${tr.retainedChangePct != null ? pct1(tr.retainedChangePct) : usd0(tr.revenueRetainedAfter - tr.revenueRetainedBefore)} entre quem continuou ativo${tr.topLosers.length ? ` (${tr.topLosers.map((x) => x.name).join(', ')})` : ''}.` };
    }
    return { index: i, tone: 'neg', title: '▼ Queda puxada por perda de afiliados', text: `${base} ${tr.churnCount} afiliados pararam e levaram ${usd0(tr.revenueChurn)}; os ${tr.newCount} novos trouxeram ${usd0(tr.revenueNew)}${tr.retainedChangePct != null ? `; quem continuou variou ${signed(tr.retainedChangePct)}` : ''}.` };
  }
  if (d >= 0.1) {
    const fromRetained = cause === 'retained-up';
    return {
      index: i, tone: 'pos',
      title: fromRetained ? '▲ Crescimento vindo de quem já rodava' : '▲ Crescimento puxado por afiliados novos',
      text: `${base} ${fromRetained ? `Os retidos cresceram ${tr.retainedChangePct != null ? signed(tr.retainedChangePct) : usd0(tr.revenueRetainedAfter - tr.revenueRetainedBefore)}${tr.topGainers.length ? ` (${tr.topGainers.map((x) => x.name).join(', ')})` : ''} — não foi aquisição.` : `Os ${tr.newCount} novos trouxeram ${usd0(tr.revenueNew)}${tr.topNew.length ? ` (${tr.topNew.map((x) => x.name).join(', ')})` : ''}, contra ${usd0(tr.revenueChurn)} de churn.`} Concentração do Top 10 em ${pct1(t.concentrationTop10)}${t.concentrationTop10 > prev.concentrationTop10 + 0.02 ? ', reforçando a dependência de poucos parceiros-chave' : ''}.`,
    };
  }
  return { index: i, tone: 'neutral', title: '■ Estável', text: `${base} ${tr.retained} retidos, ${tr.newCount} novos (${usd0(tr.revenueNew)}), ${tr.churnCount} saíram (${usd0(tr.revenueChurn)}).` };
}

export function riskText(totals: WindowTotals[], transitions: Transition[]): string {
  const withSales = totals.filter((t) => t.revenue > 0);
  if (!withSales.length) return 'Sem vendas de afiliados nas janelas analisadas.';
  const concs = withSales.map((t) => t.concentrationTop10);
  const lo = Math.min(...concs); const hi = Math.max(...concs);
  const maxActive = Math.max(...withSales.map((t) => t.active));
  const avgNew = transitions.length ? transitions.reduce((n, t) => n + t.newCount, 0) / transitions.length : 0;
  const avgChurn = transitions.length ? transitions.reduce((n, t) => n + t.churnCount, 0) / transitions.length : 0;
  if (maxActive <= 10) {
    return `Base pequena: no máximo ${maxActive} afiliados ativos por janela — a concentração é natural (o Top 10 é a base inteira). Qualquer problema de aprovação, bloqueio de conta ou migração de um deles tem efeito direto no faturamento.`;
  }
  const dollars = Math.round(hi * 10);
  const churnLine = avgChurn > 0 || avgNew > 0
    ? ` Ao mesmo tempo, a cauda da base tem rotatividade: em média ${avgNew.toFixed(0)} novos e ${avgChurn.toFixed(0)} saindo a cada janela${avgChurn >= 5 ? ' — muita gente testa e não fica' : ''}.`
    : '';
  return `Risco estrutural de concentração: nas ${withSales.length} janelas, o Top 10 respondeu por ${pct1(lo)} a ${pct1(hi)} de toda a receita de afiliados — cerca de ${dollars} de cada 10 dólares dependem de só 10 parceiros. Qualquer problema de aprovação, bloqueio de conta ou migração tem efeito desproporcional no faturamento.${churnLine}`;
}

export interface ReactivationEntry {
  key: string;
  name: string;
  lastActiveIndex: number;
  windowsAgo: number;      // 1 = parou na última transição ("morno")
  peakRevenue: number;
  peakSales: number;
  peakIndex: number;
  revenue: Array<number | null>;
}

/** Quem vendeu em alguma janela anterior e sumiu na última. */
export function reactivationList(series: EntitySeries[], minPeakRevenue = 500): ReactivationEntry[] {
  const out: ReactivationEntry[] = [];
  for (const s of series) {
    const K = s.metrics.length;
    const rev = s.metrics.map((m) => (present(m) ? m.revenue : null));
    if (rev[K - 1] != null) continue;
    const idx = rev.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const lastActive = idx[idx.length - 1];
    const peakIndex = idx.reduce((b, i) => (rev[i]! > rev[b]! ? i : b), idx[0]);
    if (rev[peakIndex]! < minPeakRevenue) continue;
    out.push({
      key: s.key, name: s.name, lastActiveIndex: lastActive, windowsAgo: K - 1 - lastActive,
      peakRevenue: round2(rev[peakIndex]!), peakSales: s.metrics[peakIndex]!.sales, peakIndex, revenue: rev,
    });
  }
  return out.sort((a, b) => a.windowsAgo - b.windowsAgo || b.peakRevenue - a.peakRevenue);
}
