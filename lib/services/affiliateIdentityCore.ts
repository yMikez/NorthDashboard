// Núcleo PURO da identidade unificada de afiliados (sem DB) — normalização
// de nomes/e-mails, heurística de pseudo-afiliado interno e sugestões de
// vínculo entre contas de plataformas diferentes.
//
// Contexto: cada plataforma cria uma conta própria pra mesma pessoa
// ("Eduardo Godoy" na JVZoo, "edugodoy16235294" na Digistore). Só a JVZoo
// manda e-mail; o resto é nome/nick. Então: e-mail = vínculo automático,
// nome idêntico = sugestão média, sobrenome/token em comum = sugestão
// baixa. A decisão final é sempre do admin.

export interface IdentityAffiliate {
  id: string;
  platformSlug: string;
  externalId: string;
  nickname: string | null;
  email: string | null;
  partnerId: string | null;
  isInternal: boolean | null;
  lastOrderAt: Date | null;
}

export type LinkReason = 'email' | 'nome' | 'token';
export type LinkConfidence = 'alta' | 'media' | 'baixa';

export interface LinkSuggestion {
  a: IdentityAffiliate;
  b: IdentityAffiliate;
  reason: LinkReason;
  confidence: LinkConfidence;
  evidence: string;
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e && e.includes('@') ? e : null;
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "Eduardo Godoy" → "eduardogodoy"; "edugodoy16235294" → "edugodoy16235294". */
export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return stripAccents(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Palavras que aparecem em nome de empresa/loja de qualquer um — casar por
// elas geraria par falso ("XM Group LLC" ↔ "Health Group").
const TOKEN_STOPWORDS = new Set([
  'group', 'company', 'media', 'digital', 'marketing', 'agency', 'ltda', 'limited', 'holdings',
  'online', 'oficial', 'official', 'store', 'shop', 'health', 'fitness', 'global', 'world', 'brasil',
  'brazil', 'business', 'negocios', 'solutions', 'services', 'traffic', 'affiliate', 'afiliado',
  'partner', 'partners', 'network', 'team', 'studio', 'studios', 'innovations', 'consulting',
  'commerce', 'trading', 'enterprises', 'international', 'corporation', 'ventures', 'capital',
]);

// Nicks genéricos que várias pessoas usam — nome igual aqui não é evidência.
const GENERIC_NAMES = new Set([
  ...TOKEN_STOPWORDS,
  'admin', 'administrator', 'afiliado', 'afiliados', 'affiliates', 'test', 'teste', 'default', 'vendor',
  'owner', 'sales', 'vendas', 'promo', 'promocao', 'organic', 'organico', 'direct', 'direto', 'none', 'null',
]);

/** Tokens "fortes" do nome (≥ 5 letras, sem dígitos, sem stopword). */
export function nameTokens(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const out = new Set<string>();
  for (const t of stripAccents(raw).toLowerCase().split(/[^a-z]+/)) {
    if (t.length >= 5 && !GENERIC_NAMES.has(t)) out.add(t);
  }
  return [...out];
}

// Pseudo-afiliados: tracking interno de produto/orgânico que as plataformas
// registram como "afiliado" (nick = família + número, códigos de campanha,
// ID "0"). Não são parceiros — saem do ranking por padrão.
const INTERNAL_PATTERNS: RegExp[] = [
  /^0$/,
  // família + (opcional) número: "neuromindpro12", "glycoeden6". Sufixo de
  // LETRAS não conta ("hawaiianads", "neuromindproreviews" são afiliados reais).
  /^(neuromindpro|neuromind|glycoeden|glycopulse|thermoburnpro|thermoburn|maxvitalize|fleximmuneguard|fleximmune|nightcalm|digestflow|hawaiian)\d*$/i,
  /^\d{3,5}-[A-Z]{4,}(-|$)/,      // 6296-WGHTLBLND-…
  /^(organic|organico|direct|direto|none|null|internal|interno|test|teste)$/i,
];

export function isInternalGuess(a: { externalId: string; nickname: string | null }): boolean {
  const candidates = [a.externalId, a.nickname ?? ''].map((s) => s.trim()).filter(Boolean);
  return candidates.some((s) => INTERNAL_PATTERNS.some((re) => re.test(s)));
}

/** Decisão manual (isInternal) vence; NULL cai na heurística. */
export function effectiveInternal(a: { externalId: string; nickname: string | null; isInternal: boolean | null }): boolean {
  return a.isInternal ?? isInternalGuess(a);
}

function displayOf(a: IdentityAffiliate): string {
  return a.nickname?.trim() || a.externalId;
}

function pairKey(a: IdentityAffiliate, b: IdentityAffiliate): string {
  return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
}

const CONFIDENCE_RANK: Record<LinkConfidence, number> = { alta: 3, media: 2, baixa: 1 };

/**
 * Pares de contas (plataformas DIFERENTES) que provavelmente são a mesma
 * pessoa. Ignora internos e pares já no mesmo parceiro. Um par recebe só a
 * melhor razão (email > nome > token).
 */
export function suggestLinks(affs: IdentityAffiliate[], opts: { max?: number } = {}): LinkSuggestion[] {
  const max = opts.max ?? 200;
  const pool = affs.filter((a) => !effectiveInternal(a));
  const best = new Map<string, LinkSuggestion>();
  const consider = (a: IdentityAffiliate, b: IdentityAffiliate, reason: LinkReason, confidence: LinkConfidence, evidence: string) => {
    if (a.id === b.id || a.platformSlug === b.platformSlug) return;
    if (a.partnerId && b.partnerId && a.partnerId === b.partnerId) return;
    const key = pairKey(a, b);
    const cur = best.get(key);
    if (cur && CONFIDENCE_RANK[cur.confidence] >= CONFIDENCE_RANK[confidence]) return;
    best.set(key, { a, b, reason, confidence, evidence });
  };

  // 1. e-mail idêntico
  const byEmail = new Map<string, IdentityAffiliate[]>();
  for (const a of pool) {
    const e = normalizeEmail(a.email);
    if (!e) continue;
    byEmail.set(e, [...(byEmail.get(e) ?? []), a]);
  }
  for (const [email, list] of byEmail) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      consider(list[i], list[j], 'email', 'alta', `mesmo e-mail: ${email}`);
    }
  }

  // 2. nome/nick idêntico (normalizado; ≥ 4 chars; não só dígitos; não genérico)
  const byName = new Map<string, IdentityAffiliate[]>();
  for (const a of pool) {
    const names = new Set([normalizeName(a.nickname), normalizeName(a.externalId)]);
    for (const n of names) {
      if (n.length < 4 || /^\d+$/.test(n) || GENERIC_NAMES.has(n)) continue;
      byName.set(n, [...(byName.get(n) ?? []), a]);
    }
  }
  for (const [name, list] of byName) {
    const uniq = [...new Map(list.map((a) => [a.id, a])).values()];
    for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
      consider(uniq[i], uniq[j], 'nome', 'media', `mesmo nome: "${name}"`);
    }
  }

  // 3. token forte em comum (sobrenome etc.) — só quando o token é raro
  const byToken = new Map<string, IdentityAffiliate[]>();
  for (const a of pool) {
    for (const t of nameTokens(a.nickname ?? '')) {
      byToken.set(t, [...(byToken.get(t) ?? []), a]);
    }
  }
  for (const [token, list] of byToken) {
    if (list.length > 8) continue; // genérico demais
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      consider(list[i], list[j], 'token', 'baixa', `"${token}" aparece nos dois nomes (${displayOf(list[i])} ↔ ${displayOf(list[j])})`);
    }
  }

  // 3b. token forte de um nome EMBUTIDO no nick do outro ("Eduardo Godoy" ↔
  // "edugodoy16235294": o sobrenome "godoy" está dentro do nick). Só letras,
  // token raro, e o nick precisa ser maior que o token.
  const letters = (a: IdentityAffiliate) => normalizeName(a.nickname ?? '').replace(/[0-9]/g, '');
  const tokenCount = (t: string) => byToken.get(t)?.length ?? 0;
  for (const a of pool) {
    const toks = nameTokens(a.nickname ?? '').filter((t) => tokenCount(t) <= 8);
    if (!toks.length) continue;
    for (const b of pool) {
      if (a.id === b.id || a.platformSlug === b.platformSlug) continue;
      const lb = letters(b);
      if (lb.length < 6) continue;
      const hit = toks.find((t) => lb !== t && lb.includes(t) && !nameTokens(b.nickname ?? '').includes(t));
      if (hit) consider(a, b, 'token', 'baixa', `"${hit}" (de ${displayOf(a)}) está dentro de "${displayOf(b)}"`);
    }
  }

  const recency = (s: LinkSuggestion) => Math.max(s.a.lastOrderAt?.getTime() ?? 0, s.b.lastOrderAt?.getTime() ?? 0);
  return [...best.values()]
    .sort((x, y) => CONFIDENCE_RANK[y.confidence] - CONFIDENCE_RANK[x.confidence] || recency(y) - recency(x))
    .slice(0, max);
}

/** Nome de exibição pra um parceiro novo: nick mais recente que não pareça ID. */
export function pickPartnerName(accounts: IdentityAffiliate[]): string {
  const sorted = [...accounts].sort((a, b) => (b.lastOrderAt?.getTime() ?? 0) - (a.lastOrderAt?.getTime() ?? 0));
  const named = sorted.find((a) => a.nickname && !/^\d+$/.test(a.nickname.trim()));
  return (named?.nickname ?? sorted[0]?.nickname ?? sorted[0]?.externalId ?? 'Parceiro').trim();
}
