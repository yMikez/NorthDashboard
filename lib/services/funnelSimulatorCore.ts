// Simulador de Funil (aba Análise › Simulador de Funil) — parte pura, testável.
//
// A tela recebe uma base diária por plataforma × família do FE × dia do FE (safra)
// × etapa do funil e calcula tudo no navegador (período, plataforma, metas e etapas
// mudam sem voltar ao servidor). Aqui ficam: a etapa fina (FE, Bump, OTO1–3, DS1–3),
// a família pelo nome do produto do FE e o empacotamento em linhas compactas.
// Regras: docs/kb/simulador-funil.md.

export const ETAPAS = ['FE', 'Bump', 'OTO1', 'OTO2', 'OTO3', 'DS1', 'DS2', 'DS3'] as const;
export type Etapa = (typeof ETAPAS)[number];
export const PLATAFORMAS = ['JVZoo', 'Vupim'] as const;

/** Somas por linha, na ordem em que vão para a tela (depois de plataforma, produto, dia, etapa). */
export const CAMPOS = [
  'vendas', 'bruto', 'fee', 'cpa', 'reemb', 'cb', 'alerta', 'taxas', 'bruto_prev',
  'custo_fs', 'bruto_fs', 'call_bruto', 'call_liq',
] as const;

/** Linha agregada como vem do banco (uma por combinação de chaves cruas). */
export interface SimDbRow {
  plataforma: string;
  produto_fe: string | null;
  dia: string;              // YYYY-MM-DD (dia do FE: JVZoo Nova York, Vupim Brasília)
  e_fe: boolean;
  etapa: string | null;     // etapa grossa do afiliados_pedidos (FE, Upsell, Downsell, Outros)
  etapa_jvz: string | null; // etapa da gold da JVZoo (rawMetadata.etapa do Order)
  tipo_v: string | null;    // productType do Order da Vupim
  passo_v: number | null;   // funnelStep da Vupim como ela mandou (OTO N = N; Last Chance N = N+1)
  vendas: number; bruto: number; fee: number; cpa: number;
  reemb: number; cb: number; alerta: number; taxas: number; bruto_prev: number;
  custo_fs: number; bruto_fs: number; call_bruto: number; call_liq: number;
}

export interface SimBase {
  gerado: string;
  de: string;
  ate: string;
  fonte: string;
  plataformas: string[];
  campos: string[];
  produtos: string[];
  etapas: string[];
  /** [plataforma, produto, dia (dias desde `de`), etapa, ...CAMPOS] */
  linhas: number[][];
}

/** Nomes das famílias como a operação usa (chave = nome sem espaços, minúsculo). */
const NOMES: Record<string, string> = {
  neurorecall: 'NeuroRecall', neuromindpro: 'Neuro Mind Pro', memovancepro: 'Memovance Pro', flushpril: 'FlushPril',
  glycoeden: 'Glyco Eden', cognizil: 'Cognizil', neuropulsepro: 'NeuroPulse Pro', lungfresh: 'LungFresh',
  honeyflush: 'Honey Flush', hawaiianharmony: 'Hawaiian Harmony', horsepeakgelatin: 'Horse Peak Gelatin',
  thermoburnpro: 'Thermo Burn Pro', honeypril: 'HoneyPril', retraburn: 'RetraBurn', heartflush: 'Heart Flush',
};

/** Família pelo nome do produto do FE: corta no primeiro "(", "/", " - ", "·" ou "N Bottles". */
export function familia(nome: string | null | undefined): { chave: string; nome: string } | null {
  if (!nome) return null;
  const base = nome
    .replace(/\[[^\]]*\]/g, ' ')            // "[FUNNEL]Neuro Recall"
    .replace(/^\s*\d+\s*B\s*\|\s*/i, '')    // "6B | GLYCO EDEN"
    .replace(/\s*(\(|\/|\s-\s|·|\d+\s*bottles?\b).*$/i, '')
    .trim();
  if (!base) return null;
  const chave = base.toLowerCase().replace(/\s+/g, '');
  return { chave, nome: NOMES[chave] ?? base };
}

/** Etapa fina da venda. Sem informação suficiente, cai na primeira etapa do tipo. */
export function etapaFina(r: Pick<SimDbRow, 'plataforma' | 'e_fe' | 'etapa' | 'etapa_jvz' | 'tipo_v' | 'passo_v'>): Etapa | null {
  if (r.e_fe) return 'FE';
  if (r.plataforma === 'JVZoo' && r.etapa_jvz && (ETAPAS as readonly string[]).includes(r.etapa_jvz)) return r.etapa_jvz as Etapa;
  if (r.plataforma === 'Vupim') {
    const n = r.passo_v;
    if (r.tipo_v === 'BUMP') return 'Bump';
    if (r.tipo_v === 'UPSELL') return n != null && n >= 1 && n <= 3 ? (`OTO${n}` as Etapa) : 'OTO1';
    if (r.tipo_v === 'DOWNSELL') return n != null && n >= 2 && n <= 4 ? (`DS${n - 1}` as Etapa) : 'DS1';
  }
  const g = (r.etapa ?? '').toLowerCase();
  if (g === 'outros') return 'Bump';
  if (g === 'upsell') return 'OTO1';
  if (g === 'downsell') return 'DS1';
  return null;
}

const diasEntre = (de: string, dia: string) => Math.round((Date.parse(dia + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 864e5);
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Empacota as linhas do banco: resolve família e etapa, junta o que caiu na mesma
 * chave e descarta famílias com menos de `minFes` FEs no histórico todo.
 */
export function empacotarBase(rows: SimDbRow[], opts: { de: string; gerado: string; fonte: string; minFes?: number }): SimBase {
  const minFes = opts.minFes ?? 20;
  // família pelo nome do FE; o nome mostrado é o da chave com mais FEs
  const fes = new Map<string, number>();
  const nomes = new Map<string, Map<string, number>>();
  const resolvidas: { pl: number; fam: string; dia: string; et: Etapa; r: SimDbRow }[] = [];
  for (const r of rows) {
    const pl = (PLATAFORMAS as readonly string[]).indexOf(r.plataforma);
    const f = familia(r.produto_fe);
    const et = etapaFina(r);
    if (pl < 0 || !f || !et) continue;
    resolvidas.push({ pl, fam: f.chave, dia: r.dia, et, r });
    if (et === 'FE') {
      fes.set(f.chave, (fes.get(f.chave) ?? 0) + Number(r.vendas));
      const m = nomes.get(f.chave) ?? new Map<string, number>();
      m.set(f.nome, (m.get(f.nome) ?? 0) + Number(r.vendas));
      nomes.set(f.chave, m);
    }
  }
  const chaves = [...fes.entries()].filter(([, n]) => n >= minFes).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const idx = new Map(chaves.map((k, i) => [k, i]));
  const agg = new Map<string, number[]>();
  let ate = opts.de;
  for (const x of resolvidas) {
    const pi = idx.get(x.fam);
    if (pi == null || x.dia < opts.de) continue;
    if (x.dia > ate) ate = x.dia;
    const chave = [x.pl, pi, diasEntre(opts.de, x.dia), ETAPAS.indexOf(x.et)].join('|');
    const v = agg.get(chave) ?? new Array(CAMPOS.length).fill(0);
    CAMPOS.forEach((c, i) => { v[i] += Number(x.r[c]) || 0; });
    agg.set(chave, v);
  }
  const linhas = [...agg.entries()]
    .map(([k, v]) => [...k.split('|').map(Number), ...v.map((n, i) => (i === 0 ? Math.round(n) : r2(n)))])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const produtos = chaves.map((k) => [...(nomes.get(k) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? k);
  return {
    gerado: opts.gerado, de: opts.de, ate, fonte: opts.fonte,
    plataformas: [...PLATAFORMAS], campos: ['plataforma', 'produto', 'dia', 'etapa', ...CAMPOS],
    produtos, etapas: [...ETAPAS], linhas,
  };
}

// ---------- análises salvas ----------

export interface SimulacaoEntrada { name: string; product: string | null; params: unknown; summary: unknown }

/** Valida o corpo de POST/PUT. Devolve o erro em texto ou a entrada limpa. */
export function validarSimulacao(body: unknown): { ok: true; valor: SimulacaoEntrada } | { ok: false; erro: string } {
  if (!body || typeof body !== 'object') return { ok: false, erro: 'corpo inválido' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  if (!name) return { ok: false, erro: 'Dê um nome para a análise.' };
  if (!b.params || typeof b.params !== 'object') return { ok: false, erro: 'params obrigatório' };
  const tamanho = JSON.stringify(b.params).length + JSON.stringify(b.summary ?? {}).length;
  if (tamanho > 200_000) return { ok: false, erro: 'análise grande demais' };
  const product = typeof b.product === 'string' && b.product.trim() ? b.product.trim().slice(0, 120) : null;
  return { ok: true, valor: { name, product, params: b.params, summary: b.summary ?? {} } };
}
