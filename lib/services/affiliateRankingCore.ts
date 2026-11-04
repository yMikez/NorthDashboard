// Ranking de afiliados (aba Afiliados › Ranking) — parte pura, sem banco.
//
// A nota de cada afiliado é calculada no navegador (public/src/pages/
// affiliate-ranking-engine.js) a partir do agregado afiliado × dia que o
// servidor monta aqui. As regras do modelo estão em docs/kb/ranking-afiliados.md.
//
// Fonte: dados_oficiais.afiliados_pedidos (1 linha por venda JVZoo/Vupim,
// publicada pelo time de dados com a mesma publicação dos outros dados
// oficiais). Cada venda já vem com o FE de origem, o afiliado do FE, o
// reembolso por dias, as taxas de alerta/disputa, o custo real da Full Stack e
// o call center atribuído.

/** Campos de cada linha afiliado × dia, na ordem que a página espera. */
export const CAMPOS = [
  'fes', 'funil', 'liq_funil', 'dev30', 'dev10', 'dev60', 'tx10', 'tx60',
  'rt1', 'rt3', 'rt5', 'rt7', 'rt14', 'rt21', 'rt30', 'rt45',
  'vendas', 'disputas', 'custo_fs', 'funil_coberto', 'liq_call', 'bruto_call',
] as const;
export type Campo = (typeof CAMPOS)[number];

/** Linha que sai do SQL do agregado (afiliado = "JVZoo <id>" / "Vupim <id>"). */
export type LinhaDia = { afiliado: string; dia: string } & Partial<Record<Campo, number | string | null>>;

/** Conta de plataforma no cadastro do dash (Affiliate + AffiliatePartner). */
export interface ContaCadastro {
  slug: string;
  externalId: string;
  nickname: string | null;
  partnerId: string | null;
  partnerName: string | null;
}

export interface RankingPayload {
  gerado: string;
  publicacaoId: number | null;
  d0: string;
  d1: string;
  campos: readonly Campo[];
  /** [conta, nome, plataforma] */
  afs: [string, string, string][];
  /** [índice da conta em afs, dias desde d0, ...valores na ordem de campos] */
  rows: number[][];
  /** conta → [partnerId, nome do parceiro]: a página junta as contas do mesmo parceiro. */
  parceiros: Record<string, [string, string]>;
}

const PLATAFORMA: Record<string, string> = { jvzoo: 'JVZoo', vupim: 'Vupim' };

/**
 * Chave da conta igual à do agregado ("JVZoo 123", "Vupim <id>"). Na Vupim o
 * dash guardou por um tempo o id com prefixo "VP" (34 caracteres): a chave usa
 * o id sem o prefixo, como a plataforma manda.
 */
export function contaDe(slug: string, externalId: string): string | null {
  const pl = PLATAFORMA[slug.toLowerCase()];
  if (!pl || !externalId) return null;
  const id = pl === 'Vupim' && /^VP.{32}$/.test(externalId) ? externalId.slice(2) : externalId;
  return `${pl} ${id}`;
}

/** Nomes e parceiros por conta, a partir do cadastro de afiliados do dash. */
export function mapearContas(contas: ContaCadastro[]): {
  nomes: Record<string, string>;
  parceiros: Record<string, [string, string]>;
} {
  const nomes: Record<string, string> = {};
  const parceiros: Record<string, [string, string]> = {};
  for (const c of contas) {
    const k = contaDe(c.slug, c.externalId);
    if (!k) continue;
    if (c.nickname && !nomes[k]) nomes[k] = c.nickname;
    if (c.partnerId) parceiros[k] = [c.partnerId, c.partnerName || c.nickname || k];
  }
  return { nomes, parceiros };
}

const DIA_MS = 86_400_000;
const diaUtc = (s: string) => Date.parse(`${s}T12:00:00Z`);
const num = (v: unknown) => {
  const x = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
};

/** Monta o payload compacto (o mesmo formato do af_dia.json do painel de afiliados). */
export function montarPayload(
  linhas: LinhaDia[],
  nomes: Record<string, string>,
  parceiros: Record<string, [string, string]>,
  gerado: string,
  publicacaoId: number | null,
): RankingPayload {
  const contas = [...new Set(linhas.map((l) => l.afiliado))].sort();
  const ix = new Map(contas.map((a, i) => [a, i]));
  const dias = linhas.map((l) => l.dia).sort();
  const d0 = dias[0] ?? gerado.slice(0, 10);
  const d1 = dias[dias.length - 1] ?? d0;
  const t0 = diaUtc(d0);
  const usadas: Record<string, [string, string]> = {};
  for (const a of contas) if (parceiros[a]) usadas[a] = parceiros[a];
  return {
    gerado,
    publicacaoId,
    d0,
    d1,
    campos: CAMPOS,
    afs: contas.map((a) => [a, nomes[a] ?? '', a.split(' ', 1)[0]]),
    rows: linhas.map((l) => [
      ix.get(l.afiliado)!,
      Math.round((diaUtc(l.dia) - t0) / DIA_MS),
      ...CAMPOS.map((k) => num(l[k])),
    ]),
    parceiros: usadas,
  };
}

// ---------- Premissas (pesos, metas, bônus e penalidades) ----------
// Compartilhadas por todos (tabela AffiliateScoreConfig). Só admin muda.

export interface Premissas {
  pesos: Record<'re60' | 'lpf' | 'fes' | 'aov', number>;
  ajustes: Record<'vol' | 're' | 'cb' | 'prej', number>;
  metas: Record<
    | 're9' | 're7' | 'lpf9' | 'lpf7' | 'fesA' | 'fesB' | 'fesC' | 'aov9' | 'aov7'
    | 'volIni' | 'volMax' | 'reBIni' | 'reBMax' | 'cbIni' | 'cbMax' | 'prejIni' | 'prejMax',
    number
  >;
}

/** Modelo oficial de 28/10/2026 com os ajustes de 03 e 04/11 (pesos 45/25/20/10). */
export const PREMISSAS_PADRAO: Premissas = {
  pesos: { re60: 45, lpf: 25, fes: 20, aov: 10 },
  ajustes: { vol: 5, re: 5, cb: 10, prej: 50 },
  metas: {
    re9: 16, re7: 23, lpf9: 5, lpf7: -15, fesA: 400, fesB: 120, fesC: 40, aov9: 410, aov7: 380,
    volIni: 12, volMax: 50, reBIni: 16, reBMax: 8, cbIni: 2, cbMax: 4, prejIni: 30, prejMax: 90,
  },
};

function limpa<K extends string>(padrao: Record<K, number>, entrada: unknown, min: number, max: number): Record<K, number> {
  const src = entrada && typeof entrada === 'object' ? (entrada as Record<string, unknown>) : {};
  const out = { ...padrao };
  for (const k of Object.keys(padrao) as K[]) {
    const v = Number(src[k]);
    if (src[k] !== undefined && src[k] !== null && Number.isFinite(v)) out[k] = Math.min(max, Math.max(min, v));
  }
  return out;
}

/** Aceita só as chaves conhecidas, com números finitos em faixas seguras; o resto volta ao padrão. */
export function sanitizarPremissas(entrada: unknown): Premissas {
  const src = entrada && typeof entrada === 'object' ? (entrada as Record<string, unknown>) : {};
  return {
    pesos: limpa(PREMISSAS_PADRAO.pesos, src.pesos, 0, 100),
    ajustes: limpa(PREMISSAS_PADRAO.ajustes, src.ajustes, 0, 100),
    metas: limpa(PREMISSAS_PADRAO.metas, src.metas, -1000, 100_000),
  };
}

// ---------- Pedidos do afiliado ----------

const CONTA_RE = /^(JVZoo|Vupim) [A-Za-z0-9_-]{1,64}$/;

/** ?contas=JVZoo 123,Vupim abc → lista validada (máx. 50 contas). */
export function parseContas(q: string | null): string[] {
  if (!q) return [];
  return [...new Set(q.split(',').map((s) => s.trim()).filter((s) => CONTA_RE.test(s)))].slice(0, 50);
}

export const isDiaIso = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(diaUtc(s));
