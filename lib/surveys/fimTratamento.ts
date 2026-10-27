// Pesquisa "fim do tratamento": quem comprou 2 ou 3 frascos e está com o
// estoque acabando (desenho do usuário, 2026-10-27).
//
// Aqui mora o que é IGUAL pra todo produto: as perguntas, o texto padrão (em
// inglês — o cliente é dos EUA), a validação das respostas e a regra que
// escolhe a tela final. O que muda por produto (nome, opções da pergunta 4,
// links de checkout, cupom e qualquer frase reescrita) vem da variante no
// banco (SurveyVariant.config). Criar a página de outro produto = nova
// variante, sem código.

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

export interface SurveyAnswers {
  /** Clicou em "Reorder now" na abertura: responde só a pergunta 1 e vai pro pedido. */
  atalho?: boolean;
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

export type Outcome = 'cs' | 'recorrencia' | 'cupom' | 'obrigado';
export type CsReason = 'nota_baixa' | 'parou_medico' | 'parou_mal_estar';

export interface SurveyVariantConfig {
  productName: string;
  /** Cor de destaque da página (hex). */
  accent?: string;
  /** Tamanho do plano completo em frascos. */
  planBottles?: number;
  daysPerBottle?: number;
  /** Quem recebe: total de frascos comprados do produto. */
  eligibleBottles?: number[];
  /** Links de checkout por desfecho; null = desfecho indisponível. */
  checkout?: { recorrencia?: string | null; cupom?: string | null };
  /** Parâmetro de rastreio do checkout que volta no postback (Vupim: src). */
  trackingParam?: string;
  coupon?: { code?: string | null; pct?: number | null; validDays?: number };
  /** Opções da pergunta 4 (resultados percebidos), próprias do produto. */
  q4?: { id: string; label: string }[];
  /** Frases reescritas pra este produto (chaves de DEFAULT_COPY). */
  copy?: Record<string, string>;
}

/**
 * Texto padrão. Variáveis entre chaves: {nome}, {frascos}, {dias}, {faltam},
 * {plano}, {produto}, {desconto}, {cupom}, {validade}.
 */
export const DEFAULT_COPY: Record<string, string> = {
  'page.title': '{produto} · Check-in',
  'nav.back': 'Back',
  'nav.continue': 'Continue',
  'nav.step': 'Question {n} of 5',

  'intro.title': "{nome}, you're about to finish bottle {frascos} of your {plano}-month {produto} plan.",
  'intro.body': "Before you run out, we'd love to hear how these {dias} days went. 5 quick questions, about 1 minute.",
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
  'q5.hint': 'Pick up to 2.',
  'q5.mensal': 'Spreading the cost: 1 bottle a month, delivered',
  'q5.desconto': 'A discount on the remaining {faltam} bottles',
  'q5.progresso': 'Seeing a bit more progress first',
  'q5.nao_continuar': "I'm not planning to continue",
  'q5.comentario': "Anything you'd like our care team to know? (optional)",
  'q5.enviar': 'Send my answers',

  'end.cs.title': 'Thank you for telling us, {nome}.',
  'end.cs.body': 'Someone from our care team will reach out within 24 hours to help you personally.',

  'end.recorrencia.title': "Let's finish your {plano}-month plan together",
  'end.recorrencia.body': 'Your next {faltam} bottles arrive one a month, so you never pay for the whole plan at once. Skip or cancel anytime.',
  'end.recorrencia.cta': 'Continue my plan',

  'end.cupom.title': 'Your remaining {faltam} bottles, {desconto}% off',
  'end.cupom.body': "You've done {frascos} of {plano} months. Complete your plan with code {cupom}, valid for {validade} days.",
  'end.cupom.cta': 'Complete my plan',

  'end.dispensar': 'Not now',

  'end.obrigado.title': 'Thank you, {nome}.',
  'end.obrigado.body': 'Your answers help us make {produto} better for you.',
  'end.obrigado.followup': "We'll check in with you in 30 days to see how you're doing.",

  'invalid.title': 'This link is no longer active',
  'invalid.body': 'If you need help with your order, just reply to the email we sent you.',
};

export function copyText(cfg: SurveyVariantConfig, key: string): string {
  return cfg.copy?.[key] ?? DEFAULT_COPY[key] ?? '';
}

export interface SurveyContext {
  firstName: string | null;
  /** Frascos que a pessoa comprou (2 ou 3). */
  bottles: number;
}

export type SurveyVars = Record<string, string>;

export function surveyVars(cfg: SurveyVariantConfig, ctx: SurveyContext): SurveyVars {
  const plan = cfg.planBottles ?? 6;
  const perBottle = cfg.daysPerBottle ?? 30;
  return {
    nome: ctx.firstName?.trim() ?? '',
    frascos: String(ctx.bottles),
    dias: String(ctx.bottles * perBottle),
    faltam: String(Math.max(plan - ctx.bottles, 0)),
    plano: String(plan),
    produto: cfg.productName,
    desconto: cfg.coupon?.pct != null ? String(cfg.coupon.pct) : '',
    cupom: cfg.coupon?.code ?? '',
    validade: String(cfg.coupon?.validDays ?? 7),
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
      const v = value.trim().slice(0, COMMENT_MAX);
      return { key, value: v };
    }
    default:
      return null;
  }
}

export interface OutcomeDecision {
  outcome: Outcome;
  csReason: CsReason | null;
  /** Marcou "ver mais progresso primeiro": recebe acompanhamento em 30 dias. */
  followUp: boolean;
}

/**
 * Tela final, na ordem do desenho: CS → recorrência → cupom → agradecimento.
 * A ordem é o que segura o desconto: quem marca "1 frasco por mês" E
 * "desconto" ganha a recorrência, sem cupom. Desfecho sem link configurado
 * cai pro próximo (sem cupom, quem citou dinheiro recebe a recorrência — pagar
 * por mês também resolve o dinheiro).
 */
export function decideOutcome(
  a: SurveyAnswers,
  available: { recorrencia: boolean; cupom: boolean },
): OutcomeDecision {
  const q5 = a.q5 ?? [];
  const followUp = q5.includes('progresso');
  if (a.q2 != null && a.q2 <= 2) return { outcome: 'cs', csReason: 'nota_baixa', followUp };
  if (a.q3 === 'parou' && a.q3b === 'medico') return { outcome: 'cs', csReason: 'parou_medico', followUp };
  if (a.q3 === 'parou' && a.q3b === 'mal_estar') return { outcome: 'cs', csReason: 'parou_mal_estar', followUp };

  const wantsMonthly = a.atalho === true || q5.includes('mensal');
  const moneyIssue = q5.includes('desconto') || a.q1 === 'dinheiro' || (a.q3 === 'parou' && a.q3b === 'orcamento');
  if (wantsMonthly && available.recorrencia) return { outcome: 'recorrencia', csReason: null, followUp };
  if (moneyIssue && available.cupom) return { outcome: 'cupom', csReason: null, followUp };
  if (moneyIssue && available.recorrencia) return { outcome: 'recorrencia', csReason: null, followUp };
  return { outcome: 'obrigado', csReason: null, followUp };
}

export function availableOutcomes(cfg: SurveyVariantConfig): { recorrencia: boolean; cupom: boolean } {
  return {
    recorrencia: Boolean(cfg.checkout?.recorrencia),
    cupom: Boolean(cfg.checkout?.cupom && cfg.coupon?.code && cfg.coupon?.pct),
  };
}

/** Link de checkout com o rastreio que volta no postback (src=qz_<resposta>). */
export function checkoutUrl(cfg: SurveyVariantConfig, outcome: 'recorrencia' | 'cupom', responseId: string): string | null {
  const base = cfg.checkout?.[outcome];
  if (!base) return null;
  try {
    const u = new URL(base);
    u.searchParams.set(cfg.trackingParam || 'src', `${SURVEY_TRACKING_PREFIX}${responseId}`);
    return u.toString();
  } catch {
    return null;
  }
}

export const SURVEY_TRACKING_PREFIX = 'qz_';
