// Expansão de consulta por sinônimos do dash (PT/EN/abreviações), feita no
// servidor antes da busca lexical. O Opus já manda 1–4 reformulações; isto
// cobre o vocabulário da operação que ele não tem como adivinhar (o doc diz
// "estorno", a pergunta diz "refund"; "D24" no chat, "Digistore24" no doc).
//
// Cada consulta original gera no máximo UMA variante com as trocas não
// ambíguas (peso 0.7) e, se houver termo ambíguo, uma variante por leitura
// (peso 0.5 cada) — "CB" é ClickBank OU chargeback e o ranking decide.
// Teto de 6 consultas no total (originais primeiro).

import { foldForMatch } from './normalize';

export interface ExpandedQuery {
  text: string;
  weight: number;
  /** Consulta como o modelo escreveu (entra na lista "todos os termos"). */
  original: boolean;
}

interface SynonymRule {
  /** Casado sobre o texto dobrado (sem acento, minúsculo). */
  match: RegExp;
  /** Leituras alternativas; mais de uma = termo ambíguo. */
  readings: string[];
}

// Ordem importa só pra legibilidade; cada regra troca o termo inteiro pela
// leitura (que já inclui o próprio termo canônico).
const RULES: SynonymRule[] = [
  { match: /\b(estornos?|reembolsos?|refunds?|devolucao|devolucoes|refunded)\b/g, readings: ['reembolso estorno refund'] },
  { match: /\b(contestacao|contestacoes|chargebacks?|disputas?|disputed)\b/g, readings: ['chargeback contestação disputa'] },
  { match: /\b(front-end|frontend|fronts?|fes?)\b/g, readings: ['front frontend FE'] },
  { match: /\b(back-end|backend)\b/g, readings: ['backend back call center recuperação'] },
  { match: /\b(take rate|taxa de conversao do upsell|conversao de upsell)\b/g, readings: ['take rate conversão de upsell'] },
  { match: /\b(upsells?|otos?|up\d{1,2})\b/g, readings: ['upsell OTO'] },
  { match: /\b(downsells?|last chance|ds\d{1,2}|down\d{1,2})\b/g, readings: ['downsell last chance'] },
  { match: /\b(d24|ds24|digistore|digistore24)\b/g, readings: ['Digistore24 Digistore'] },
  { match: /\b(bg|buygoods|buy goods)\b/g, readings: ['BuyGoods'] },
  { match: /\b(cp|cartpanda|cart panda)\b/g, readings: ['Cartpanda'] },
  { match: /\b(jvz|jvzoo)\b/g, readings: ['JVZoo'] },
  { match: /\b(clickbank)\b/g, readings: ['ClickBank'] },
  { match: /\bcb\b/g, readings: ['ClickBank', 'chargeback'] },
  { match: /\b(lucro|profit|margem)\b/g, readings: ['lucro margem profit'] },
  { match: /\b(frete|fulfillment|envio)\b/g, readings: ['fulfillment frete envio'] },
  { match: /\b(cogs|custo de produto|custo do produto)\b/g, readings: ['custo de produto COGS'] },
  { match: /\b(fuso|fusos|timezone|fuso horario)\b/g, readings: ['fuso horário timezone'] },
  { match: /\b(reserva|allowance)\b/g, readings: ['reserva allowance'] },
  { match: /\b(taxa da plataforma|fee|fees)\b/g, readings: ['taxa da plataforma fee'] },
  { match: /\b(afiliados?|affiliates?)\b/g, readings: ['afiliado affiliate'] },
  { match: /\b(coorte|cohort|coortes|cohorts)\b/g, readings: ['coorte cohort'] },
];

export const MAX_EXPANDED_QUERIES = 6;
const EXPANSION_WEIGHT = 0.7;
const AMBIGUOUS_WEIGHT = 0.5;

function applyReading(folded: string, rules: Array<{ rule: SynonymRule; reading: string }>): string {
  let out = folded;
  for (const { rule, reading } of rules) out = out.replace(rule.match, reading.toLowerCase());
  return out.replace(/\s+/g, ' ').trim();
}

/** Variantes de UMA consulta (sem a original). */
export function queryVariants(query: string): ExpandedQuery[] {
  const folded = foldForMatch(query);
  const hits = RULES.filter((r) => {
    r.match.lastIndex = 0;
    return r.match.test(folded);
  });
  if (!hits.length) return [];
  const plain = hits.filter((r) => r.readings.length === 1).map((rule) => ({ rule, reading: rule.readings[0] }));
  const ambiguous = hits.filter((r) => r.readings.length > 1);
  const out: ExpandedQuery[] = [];
  if (!ambiguous.length) {
    const text = applyReading(folded, plain);
    if (text && text !== folded) out.push({ text, weight: EXPANSION_WEIGHT, original: false });
    return out;
  }
  // Uma variante por leitura do (primeiro) termo ambíguo; as trocas não
  // ambíguas vão junto em todas.
  const amb = ambiguous[0];
  for (const reading of amb.readings) {
    const text = applyReading(folded, [...plain, { rule: amb, reading }]);
    if (text && text !== folded) out.push({ text, weight: AMBIGUOUS_WEIGHT, original: false });
  }
  return out;
}

/** Consultas originais (peso 1) + variantes, deduplicadas, teto de 6. */
export function expandQueries(queries: string[], max = MAX_EXPANDED_QUERIES): ExpandedQuery[] {
  const out: ExpandedQuery[] = [];
  const seen = new Set<string>();
  const push = (q: ExpandedQuery) => {
    const k = foldForMatch(q.text);
    if (!k || seen.has(k) || out.length >= max) return;
    seen.add(k);
    out.push(q);
  };
  for (const q of queries) push({ text: q, weight: 1, original: true });
  for (const q of queries) for (const v of queryVariants(q)) push(v);
  return out;
}

const DATE_HINT_RE =
  /\b(20\d{2}|\d{1,2}\/\d{1,2}|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|ontem|hoje|semana|mes passado|este mes|trimestre|ano passado)\b/;

/**
 * A consulta cita data/período? Aí um documento "retrato datado" (snapshot)
 * pode ser exatamente o que a pessoa quer e não é rebaixado no ranking.
 */
export function mentionsDate(query: string): boolean {
  return DATE_HINT_RE.test(foldForMatch(query));
}
