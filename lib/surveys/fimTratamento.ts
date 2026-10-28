// Pesquisa "fim do tratamento": quem está com o estoque acabando (desenho do
// usuário, 2026-10-27; regra de venda revista em 2026-10-28).
//
// Dois públicos, pelo total de frascos comprados:
//   parcial  — 2 ou 3 frascos: na compra ouviu que o plano é de 6 meses; a
//              copy puxa pra completar o plano.
//   completo — 6 ou mais: a copy puxa pro uso sem constância (dose perdida =
//              dia que não contou), e pula a pergunta 1 (que é "por que não 6").
//
// Aqui mora o que é IGUAL pra todo produto: perguntas, texto padrão (inglês —
// o cliente é dos EUA), validação, a regra da tela final e o cálculo dos
// preços que a copy mostra. O que muda por produto (nome, foto, opções da
// pergunta 4, ofertas e preços, cupons, frases reescritas) vem da variante no
// banco (SurveyVariant.config). Produto novo = nova variante, sem código.

export const FIM_TRATAMENTO = 'fim-tratamento';

export const Q1_OPTS = ['testar', 'dinheiro', 'outra_pessoa', 'nao_sabia'] as const;
export const Q3_OPTS = ['todo_dia', 'maioria', 'esquece', 'parou'] as const;
export const Q3B_OPTS = ['medico', 'mal_estar', 'sem_diferenca', 'orcamento', 'outro'] as const;
export const Q4_FIXED = ['nada', 'cedo'] as const;
export const Q5_OPTS = ['mensal', 'desconto', 'progresso', 'nao_continuar'] as const;
/** "pick up to 2" — mais que isso o servidor corta. */
export const Q5_MAX = 2;
export const COMMENT_MAX = 2000;

export type Q1 = (typeof Q1_OPTS)[number];
export type Q3 = (typeof Q3_OPTS)[number];
export type Q3b = (typeof Q3B_OPTS)[number];
export type Q5 = (typeof Q5_OPTS)[number];
export type Segment = 'parcial' | 'completo';

export interface SurveyAnswers {
  /** Clicou em "Reorder now" na abertura: vai direto pro pedido. */
  atalho?: boolean;
  /** Só no público parcial. */
  q1?: Q1;
  /** Satisfação 1–5. */
  q2?: number;
  q3?: Q3;
  /** Só pra quem respondeu q3 = 'parou'. */
  q3b?: Q3b;
  /** Ids das opções da variante + 'nada' / 'cedo'. */
  q4?: string[];
  q5?: Q5[];
  comentario?: string;
  /** Viu a oferta e clicou em "Not now". */
  dispensou?: boolean;
}

/** cs = só agradecimento + CS liga; obrigado = nenhuma oferta configurada. */
export type Outcome = 'cs' | 'recorrencia' | 'oferta' | 'cupom' | 'obrigado';
export type CsReason = 'nota_minima' | 'parou_medico' | 'parou_mal_estar';
/** Botão do checkout: assinatura mensal, kit no preço de recompra, kit com cupom. */
export type CheckoutKind = 'assinatura' | 'kit' | 'cupom';

export interface SurveyVariantConfig {
  productName: string;
  /** Cor de destaque da página (hex). */
  accent?: string;
  /** Foto dos frascos (caminho em /survey-assets/). */
  image?: string | null;
  /** Tamanho do plano recomendado na compra, em frascos. */
  planBottles?: number;
  daysPerBottle?: number;
  /** Plano incompleto que recebe a pesquisa (frascos comprados). */
  eligibleBottles?: number[];
  /** Quem comprou o plano inteiro ou mais (≥ N frascos) também recebe; null = não. */
  fullPlanFrom?: number | null;
  /** Parâmetro de rastreio do checkout que volta no postback (Vupim: src). */
  trackingParam?: string;
  /** Preço normal do front por kit (frascos → US$): base do "instead of the regular". */
  frontPrices?: Record<string, number>;
  offers?: {
    /** 1 frasco por mês: 1ª cobrança com desconto, depois o preço normal da assinatura. */
    assinatura?: { url: string | null; firstPrice: number; monthlyPrice: number } | null;
    /** Kits de recompra (frascos → link e preço). */
    kits?: Record<string, { url: string | null; price: number }>;
  };
  /** Cupons por faixa (10/15/20%). kits = link da oferta já com desconto, se existir. */
  coupons?: { pct: number; code: string | null; kits?: Record<string, string | null> }[];
  /** Se o checkout aceita cupom pelo link (ex.: "coupon"), o código vai aplicado. */
  couponParam?: string | null;
  /** O preço do cupom fica reservado por N dias depois da pesquisa. */
  couponValidDays?: number;
  /** Opções da pergunta 4 (resultados percebidos), próprias do produto. */
  q4?: { id: string; label: string }[];
  /** Frases reescritas pra este produto (chaves de DEFAULT_COPY, com @segmento opcional). */
  copy?: Record<string, string>;
}

/**
 * Texto padrão. Chave com "@completo" (ou "@completo_constante", pra quem
 * tomou todo dia) vale só pro público de 6+ frascos. Variáveis entre chaves:
 * {nome} {frascos} {dias} {faltam} {plano} {produto} {total} {kit}
 * {preco_kit} {preco_pote} {preco_regular_pote} {preco_1o} {preco_mes}
 * {desconto} {cupom} {preco_cupom} {validade}.
 */
export const DEFAULT_COPY: Record<string, string> = {
  'page.title': '{produto} · Check-in',
  'nav.back': 'Back',
  'nav.continue': 'Continue',
  'nav.step': 'Question {n} of {total}',

  'intro.title': "{nome}, you're about to finish bottle {frascos} of your {plano}-month {produto} plan.",
  'intro.body': "Before you run out, we'd love to hear how these {dias} days went. {total} quick questions, about 1 minute.",
  'intro.title@completo': '{nome}, your {produto} is about to run out.',
  'intro.body@completo': "Before it does, we'd love to hear how these {dias} days went. {total} quick questions, about 1 minute.",
  'intro.cta': "Tell us how it's going",
  'intro.atalho': 'Already know you want more? Reorder now →',

  'q1.title': 'When you ordered, what made you start with {frascos} bottles instead of the full {plano}?',
  'q1.testar': "I wanted to see how I'd feel first",
  'q1.dinheiro': 'The full plan was too much to spend at once',
  'q1.outra_pessoa': "It's for someone else and I wasn't sure they'd take it",
  'q1.nao_sabia': "I didn't know {plano} months was recommended",

  'q2.title': 'After {dias} days, how do you feel about {produto}?',
  'q2.low': "1 = I'm disappointed",
  'q2.high': "5 = I'm glad I started",

  'q3.title': 'How have the daily doses been going?',
  'q3.todo_dia': 'Every day, no misses',
  'q3.maioria': 'Most days',
  'q3.esquece': "I forget more than I'd like",
  'q3.parou': 'I stopped taking it',

  'q3b.title': 'What made you stop?',
  'q3b.medico': 'My doctor advised against it',
  'q3b.mal_estar': "It didn't agree with me",
  'q3b.sem_diferenca': "I didn't notice a difference",
  'q3b.orcamento': "I couldn't keep it in my budget",
  'q3b.outro': 'Something else',

  'q4.title': 'In these {dias} days, what have you noticed?',
  'q4.hint': 'Pick any that apply.',
  'q4.nada': 'Nothing yet',
  'q4.cedo': "It's too early to tell, I've only had {dias} days",

  'q5.title': "You're at month {frascos} of {plano}. What would help you finish the plan?",
  'q5.title@completo': 'Your bottles run out in about a week. What would help you keep going?',
  'q5.hint': 'Pick up to 2.',
  'q5.mensal': 'Spreading the cost: 1 bottle a month, delivered',
  'q5.mensal@completo': '1 bottle a month, delivered, so I never run out',
  'q5.desconto': 'A discount on the remaining {faltam} bottles',
  'q5.desconto@completo': 'A discount on my next bottles',
  'q5.progresso': 'Seeing a bit more progress first',
  'q5.nao_continuar': "I'm not planning to continue",
  'q5.comentario': "Anything you'd like our care team to know? (optional)",
  'q5.enviar': 'Send my answers',

  'end.cs.title': 'Thank you for telling us, {nome}.',
  'end.cs.body': 'Someone from our care team will reach out within 24 hours to help you personally.',

  // Recorrência: 1 frasco por mês, 1º mês com desconto.
  'end.recorrencia.title': 'Finish your {plano}-month plan, one bottle at a time',
  'end.recorrencia.body': "When you ordered, we recommended the full {plano} months, because {produto} is made for steady, daily use. You're at month {frascos}, right where many people stop too early. Get your next bottles one a month: your first month is just {preco_1o}, then {preco_mes} a month. Skip or cancel anytime.",
  'end.recorrencia.cta': 'Continue my plan for {preco_1o}',
  'end.recorrencia.alt': 'Prefer all {kit} bottles now? {preco_kit}',
  'end.recorrencia.title@completo': 'Never run out, or miss a day, again',
  'end.recorrencia.body@completo': "Most missed doses aren't a choice: a busy week, a trip, a bottle that ran out before the next one arrived. With 1 bottle a month, the next one is at your door before the last one ends. First month {preco_1o}, then {preco_mes} a month. Skip or cancel anytime.",
  'end.recorrencia.body@completo_constante': 'You took it every day, which is exactly how {produto} is meant to be used. Keep that streak going without thinking about it: 1 bottle a month, at your door before the last one ends. First month {preco_1o}, then {preco_mes} a month. Skip or cancel anytime.',
  'end.recorrencia.cta@completo': 'Start for {preco_1o}',

  // Oferta: kit no preço de recompra (já promocional).
  'end.oferta.title': "Don't stop at month {frascos}",
  'end.oferta.body': "Your plan was built for {plano} months of daily use. That's why we recommended it when you ordered, and stopping now means starting over later. As a returning customer you already get a promotional reorder price: {kit} bottles for {preco_kit}, just {preco_pote} per bottle instead of the regular {preco_regular_pote}.",
  'end.oferta.cta': 'Complete my plan for {preco_kit}',
  'end.oferta.alt': 'Or 1 bottle a month, first month {preco_1o}',
  'end.oferta.title@completo': 'Make up for the days you missed',
  'end.oferta.body@completo': "Even with the best intentions, doses get missed, and {produto} is made for steady, daily use. If you skipped days along the way, your {plano} months aren't complete yet. Keep going at your promotional reorder price: {kit} bottles for {preco_kit}, just {preco_pote} per bottle instead of the regular {preco_regular_pote}.",
  'end.oferta.body@completo_constante': "You took it every day, and that's exactly how {produto} is meant to be used. Don't break the streak now. Keep going at your promotional reorder price: {kit} bottles for {preco_kit}, just {preco_pote} per bottle instead of the regular {preco_regular_pote}.",
  'end.oferta.cta@completo': 'Keep going for {preco_kit}',

  // Cupom: kit no preço de recompra − {desconto}%.
  'end.cupom.title': 'Your last {kit} bottles, {desconto}% off',
  'end.cupom.body': 'Your reorder price is already lower than the regular price: {preco_pote} per bottle instead of {preco_regular_pote}. With code {cupom} you save another {desconto}%: {kit} bottles for {preco_cupom}, and your {plano}-month plan is complete. This price is reserved for you for {validade} days.',
  'end.cupom.cta': 'Complete my plan for {preco_cupom}',
  'end.cupom.alt': 'Or 1 bottle a month, first month {preco_1o}',
  'end.cupom.title@completo': 'Keep going, {desconto}% off',
  'end.cupom.body@completo': 'Missed doses add up, and this is the easiest way to make your plan count. Your reorder price is already lower than the regular price, and with code {cupom} you save another {desconto}%: {kit} bottles for {preco_cupom}. Reserved for you for {validade} days.',
  'end.cupom.body@completo_constante': "You've been consistent, so let's keep it that way. Your reorder price is already lower than the regular price, and with code {cupom} you save another {desconto}%: {kit} bottles for {preco_cupom}. Reserved for you for {validade} days.",
  'end.cupom.cta@completo': 'Keep going for {preco_cupom}',

  'end.dispensar': 'Not now',

  'end.obrigado.title': 'Thank you, {nome}.',
  'end.obrigado.body': 'Your answers help us make {produto} better for you.',
  'end.obrigado.followup': "We'll check in with you in 30 days to see how you're doing.",

  'invalid.title': 'This link is no longer active',
  'invalid.body': 'If you need help with your order, just reply to the email we sent you.',
};

/** Texto da chave: variante@segmento → padrão@segmento → variante → padrão. */
export function copyText(cfg: SurveyVariantConfig, key: string, segment?: string): string {
  if (segment) {
    const seg = `${key}@${segment}`;
    const hit = cfg.copy?.[seg] ?? DEFAULT_COPY[seg];
    if (hit != null) return hit;
  }
  return cfg.copy?.[key] ?? DEFAULT_COPY[key] ?? '';
}

export function segmentOf(cfg: SurveyVariantConfig, bottles: number): Segment {
  const full = cfg.fullPlanFrom ?? null;
  return full != null && bottles >= full ? 'completo' : 'parcial';
}

/** Perguntas na ordem (a 3b entra no meio só pra quem parou). */
export function questionOrder(segment: Segment): string[] {
  return segment === 'completo' ? ['q2', 'q3', 'q4', 'q5'] : ['q1', 'q2', 'q3', 'q4', 'q5'];
}

/**
 * Kit oferecido: no parcial, o que falta pro plano (2 → 4, 3 → 3); no
 * completo, o maior kit (6). Sem o tamanho exato, o kit disponível mais perto.
 */
export function kitSizeFor(cfg: SurveyVariantConfig, segment: Segment, bottles: number): number | null {
  const sizes = Object.entries(cfg.offers?.kits ?? {})
    .filter(([, k]) => k && k.price > 0)
    .map(([s]) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  if (!sizes.length) return null;
  if (segment === 'completo') return sizes[sizes.length - 1];
  const want = Math.max((cfg.planBottles ?? 6) - bottles, 1);
  return sizes.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), sizes[0]);
}

export const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Preço normal por frasco: o kit do front do mesmo tamanho ou o maior menor que ele. */
export function regularPerBottle(cfg: SurveyVariantConfig, kit: number): number | null {
  const fronts = Object.entries(cfg.frontPrices ?? {})
    .map(([s, p]) => [Number(s), p] as const)
    .filter(([s, p]) => s > 0 && p > 0 && s <= kit)
    .sort((a, b) => b[0] - a[0]);
  return fronts.length ? round2(fronts[0][1] / fronts[0][0]) : null;
}

export function couponPrice(cfg: SurveyVariantConfig, kit: number | null, pct: number): number | null {
  const price = kit != null ? cfg.offers?.kits?.[String(kit)]?.price : null;
  return price ? round2(price * (1 - pct / 100)) : null;
}

export interface SurveyContext {
  firstName: string | null;
  /** Frascos que a pessoa comprou. */
  bottles: number;
}

export type SurveyVars = Record<string, string>;

export function surveyVars(cfg: SurveyVariantConfig, ctx: SurveyContext): SurveyVars {
  const plan = cfg.planBottles ?? 6;
  const perBottle = cfg.daysPerBottle ?? 30;
  const segment = segmentOf(cfg, ctx.bottles);
  const kit = kitSizeFor(cfg, segment, ctx.bottles);
  const kitPrice = kit != null ? cfg.offers?.kits?.[String(kit)]?.price ?? null : null;
  const regular = kit != null ? regularPerBottle(cfg, kit) : null;
  const sub = cfg.offers?.assinatura;
  return {
    nome: ctx.firstName?.trim() ?? '',
    frascos: String(ctx.bottles),
    dias: String(ctx.bottles * perBottle),
    faltam: String(Math.max(plan - ctx.bottles, 0)),
    plano: String(plan),
    produto: cfg.productName,
    total: String(questionOrder(segment).length),
    kit: kit != null ? String(kit) : '',
    preco_kit: kitPrice != null ? usd(kitPrice) : '',
    preco_pote: kitPrice != null && kit ? usd(round2(kitPrice / kit)) : '',
    preco_regular_pote: regular != null ? usd(regular) : '',
    preco_1o: sub ? usd(sub.firstPrice) : '',
    preco_mes: sub ? usd(sub.monthlyPrice) : '',
    validade: String(cfg.couponValidDays ?? 7),
  };
}

/** Variáveis de uma faixa de cupom (somadas às de surveyVars). */
export function couponVars(cfg: SurveyVariantConfig, ctx: SurveyContext, pct: number): SurveyVars {
  const kit = kitSizeFor(cfg, segmentOf(cfg, ctx.bottles), ctx.bottles);
  const price = couponPrice(cfg, kit, pct);
  return {
    desconto: String(pct),
    cupom: cfg.coupons?.find((c) => c.pct === pct)?.code ?? '',
    preco_cupom: price != null ? usd(price) : '',
  };
}

/**
 * Troca as {variáveis}. Sem primeiro nome, a frase continua natural:
 * "{nome}, you're…" vira "You're…" e "Thank you, {nome}." vira "Thank you.".
 */
export function fillText(text: string, vars: SurveyVars): string {
  let t = text;
  if (!vars.nome) {
    t = t.replace(/^\{nome\},\s*(\S)/, (_, c: string) => c.toUpperCase());
    t = t.replace(/,\s*\{nome\}/g, '');
  }
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** Primeiro nome legível a partir do nome completo ("JOHN SMITH" → "John"). */
export function firstNameOf(full: string | null | undefined): string | null {
  const first = (full ?? '').trim().split(/\s+/)[0] ?? '';
  if (!/^\p{L}[\p{L}'-]*$/u.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function q4Options(cfg: SurveyVariantConfig): { id: string; label: string }[] {
  return [
    ...(cfg.q4 ?? []),
    ...Q4_FIXED.map((id) => ({ id, label: copyText(cfg, `q4.${id}`) })),
  ];
}

export type AnswerKey = 'atalho' | 'q1' | 'q2' | 'q3' | 'q3b' | 'q4' | 'q5' | 'comentario' | 'dispensou';

/** Valida e normaliza uma resposta vinda da página. null = inválida. */
export function cleanAnswer(
  cfg: SurveyVariantConfig,
  key: string,
  value: unknown,
): { key: AnswerKey; value: SurveyAnswers[AnswerKey] } | null {
  const oneOf = <T extends string>(opts: readonly T[]) =>
    typeof value === 'string' && (opts as readonly string[]).includes(value) ? (value as T) : null;
  const manyOf = (opts: readonly string[], max: number) => {
    if (!Array.isArray(value)) return null;
    const picked = [...new Set(value.filter((v): v is string => typeof v === 'string' && opts.includes(v)))];
    return picked.length ? picked.slice(0, max) : null;
  };
  switch (key) {
    case 'atalho':
    case 'dispensou':
      return value === true ? { key, value: true } : null;
    case 'q1': { const v = oneOf(Q1_OPTS); return v ? { key, value: v } : null; }
    case 'q2': {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 5 ? { key, value: n } : null;
    }
    case 'q3': { const v = oneOf(Q3_OPTS); return v ? { key, value: v } : null; }
    case 'q3b': { const v = oneOf(Q3B_OPTS); return v ? { key, value: v } : null; }
    case 'q4': {
      const v = manyOf(q4Options(cfg).map((o) => o.id), 20);
      return v ? { key, value: v } : null;
    }
    case 'q5': {
      const v = manyOf(Q5_OPTS, Q5_MAX) as Q5[] | null;
      return v ? { key, value: v } : null;
    }
    case 'comentario': {
      if (typeof value !== 'string') return null;
      return { key, value: value.trim().slice(0, COMMENT_MAX) };
    }
    default:
      return null;
  }
}

/**
 * Faixa de cupom pelo quanto a pessoa está perto de desistir:
 *   20% — nota 2, "não vou continuar", ou parou (orçamento, sem diferença, outro)
 *   15% — objeção de dinheiro (pediu desconto, ou comprou pouco pelo preço)
 *   10% — hesitante (quer ver mais progresso, ou "nada ainda"/"cedo demais")
 *    0  — sem objeção: kit no preço de recompra, sem cupom
 */
export function couponTier(a: SurveyAnswers): number {
  const q5 = a.q5 ?? [];
  const stoppedFor = a.q3 === 'parou' ? a.q3b : undefined;
  if (a.q2 === 2 || q5.includes('nao_continuar') || stoppedFor === 'orcamento' || stoppedFor === 'sem_diferenca' || stoppedFor === 'outro') return 20;
  if (q5.includes('desconto') || a.q1 === 'dinheiro') return 15;
  if (q5.includes('progresso') || (a.q4 ?? []).some((x) => x === 'nada' || x === 'cedo')) return 10;
  return 0;
}

export interface Availability {
  assinatura: boolean;
  kit: boolean;
  /** Faixas de cupom configuradas (código + kit com preço). */
  cupons: number[];
}

export function availableOffers(cfg: SurveyVariantConfig, kit: number | null): Availability {
  const kitOffer = kit != null ? cfg.offers?.kits?.[String(kit)] : null;
  const hasKit = Boolean(kitOffer?.url && kitOffer.price > 0);
  return {
    assinatura: Boolean(cfg.offers?.assinatura?.url),
    kit: hasKit,
    cupons: hasKit
      ? (cfg.coupons ?? []).filter((c) => c.code && c.pct > 0 && c.pct < 100).map((c) => c.pct).sort((x, y) => x - y)
      : [],
  };
}

export interface OutcomeDecision {
  outcome: Outcome;
  csReason: CsReason | null;
  /** Faixa do cupom quando outcome = 'cupom'. */
  couponPct: number | null;
  /** Marcou "ver mais progresso primeiro": acompanhamento em 30 dias. */
  followUp: boolean;
}

/**
 * Tela final. Regra do usuário (2026-10-28): sempre tentar vender, a não ser
 * pra nota mínima. Quem parou por orientação médica ou porque não caiu bem
 * também vai pro CS sem oferta — vender suplemento nesse caso é risco de
 * saúde e de chargeback.
 *
 *   CS          nota 1, parou por médico, parou por mal-estar
 *   recorrência atalho "Reorder now" ou marcou "1 frasco por mês"
 *   cupom       faixa de cupom > 0 (couponTier) e cupom configurado
 *   oferta      todo o resto: kit no preço de recompra
 *
 * Desfecho sem link configurado cai pro próximo; sem nenhuma oferta, agradece.
 */
export function decideOutcome(a: SurveyAnswers, av: Availability): OutcomeDecision {
  const followUp = (a.q5 ?? []).includes('progresso');
  const base = { csReason: null, couponPct: null, followUp };
  if (a.q2 === 1) return { ...base, outcome: 'cs', csReason: 'nota_minima' };
  if (a.q3 === 'parou' && a.q3b === 'medico') return { ...base, outcome: 'cs', csReason: 'parou_medico' };
  if (a.q3 === 'parou' && a.q3b === 'mal_estar') return { ...base, outcome: 'cs', csReason: 'parou_mal_estar' };

  if ((a.atalho === true || (a.q5 ?? []).includes('mensal')) && av.assinatura) return { ...base, outcome: 'recorrencia' };
  const tier = a.atalho === true ? 0 : couponTier(a);
  if (tier > 0 && av.cupons.length) {
    // Faixa exata, ou a maior configurada abaixo dela, ou a menor que existir.
    const pct = av.cupons.includes(tier) ? tier : (av.cupons.filter((p) => p < tier).pop() ?? av.cupons[0]);
    return { ...base, outcome: 'cupom', couponPct: pct };
  }
  if (av.kit) return { ...base, outcome: 'oferta' };
  if (av.assinatura) return { ...base, outcome: 'recorrencia' };
  return { ...base, outcome: 'obrigado' };
}

/** Link de checkout com o rastreio que volta no postback (src=qz_<resposta>). */
export function checkoutUrl(
  cfg: SurveyVariantConfig,
  kind: CheckoutKind,
  responseId: string,
  opts: { kit: number | null; couponPct?: number | null },
): string | null {
  let base: string | null | undefined = null;
  let coupon: string | null = null;
  if (kind === 'assinatura') base = cfg.offers?.assinatura?.url;
  else if (opts.kit != null) {
    const kitUrl = cfg.offers?.kits?.[String(opts.kit)]?.url;
    if (kind === 'kit') base = kitUrl;
    else {
      const c = cfg.coupons?.find((x) => x.pct === opts.couponPct);
      if (!c?.code) return null;
      // Oferta já com desconto na plataforma, ou o kit com o cupom no link.
      base = c.kits?.[String(opts.kit)] ?? kitUrl;
      if (!c.kits?.[String(opts.kit)] && cfg.couponParam) coupon = c.code;
    }
  }
  if (!base) return null;
  try {
    const u = new URL(base);
    if (coupon && cfg.couponParam) u.searchParams.set(cfg.couponParam, coupon);
    u.searchParams.set(cfg.trackingParam || 'src', `${SURVEY_TRACKING_PREFIX}${responseId}`);
    return u.toString();
  } catch {
    return null;
  }
}

export const SURVEY_TRACKING_PREFIX = 'qz_';
