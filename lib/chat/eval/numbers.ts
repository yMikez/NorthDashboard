// Leitura dos números ESCRITOS numa resposta do chat — formato US
// ($1,234.56 / 12.3%, decisão do dono) e pt-BR ("$ 154.318", "12,4%",
// "US$ 1,2 mil") —, com a PRECISÃO com que foram escritos.
//
// A precisão é o que torna a nota justa: "$ 154,3 mil" está certo pra
// 154.318 (o valor arredonda pra ele) e "$ 150 mil" não. Regra de acerto:
//   |escrito − esperado| ≤ max(granularidade/2, tol.abs, tol.rel·|esperado|)
// granularidade = 10^-casas × multiplicador (mil/k = 1e3, mi/M = 1e6, bi = 1e9).
// Separador único seguido de exatamente 3 dígitos é AMBÍGUO ("1.234" = mil
// duzentos e trinta e quatro em pt-BR, ou 1,234 em US): as duas leituras
// ficam e basta uma casar.

export type NumberUnit = 'usd' | 'brl' | 'pct' | 'pp' | null;

export interface NumberReading {
  value: number;
  /** Menor passo que a forma escrita distingue (0,01 em "12,34"; 1000 em "12 mil"). */
  granularity: number;
}

export interface WrittenNumber {
  raw: string;
  index: number;
  end: number;
  unit: NumberUnit;
  readings: NumberReading[];
  /** Inteiro 2000–2100 sem unidade: provável ano, não métrica. */
  yearLike: boolean;
}

const MULTIPLIERS: Record<string, number> = {
  mil: 1e3,
  k: 1e3,
  mi: 1e6,
  mm: 1e6,
  mn: 1e6,
  m: 1e6,
  milhao: 1e6,
  milhoes: 1e6,
  'milhão': 1e6,
  'milhões': 1e6,
  bi: 1e9,
  bilhao: 1e9,
  bilhoes: 1e9,
  'bilhão': 1e9,
  'bilhões': 1e9,
};

// Grupo de milhar: ponto, vírgula, espaço fino/nbsp (Intl fr/pt). Espaço
// comum NÃO — "7 30" numa lista viraria setecentos e trinta.
// (construído por código: caractere invisível no fonte seria armadilha de revisão)
const GROUP_SPACES = String.fromCharCode(0xa0, 0x202f);
const BODY = String.raw`\d{1,3}(?:[.,` + GROUP_SPACES + String.raw`]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
const GROUP_SPACES_RE = new RegExp(`[${GROUP_SPACES}]`, 'g');
const NUMBER_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.,])` +
    // Sinal e moeda em qualquer ordem ("−$5", "$ -5"); o match nunca começa
    // em espaço (o índice aponta pro primeiro caractere do número).
    String.raw`(?:([-−+])\s?)?(?:(US\$|U\$|R\$|USD|\$)\s?)?([-−+])?` +
    `(${BODY})` +
    String.raw`(?:\s?(mil|milh[õo]es|milh[ãa]o|bilh[õo]es|bilh[ãa]o|mi|bi|mm|mn|MM|k|K|M))?` +
    String.raw`(?:\s?(%|p\.p\.|p\.p|pp|USD|d[óo]lares))?` +
    String.raw`(?![\p{L}\p{N}_])`,
  'gu',
);

// Datas e horas não são métricas: mascaradas antes (mesmo comprimento, pra
// os índices continuarem valendo no texto original).
const MASKS = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /\b\d{1,2}h\d{2}\b/g,
];

function maskDates(text: string): string {
  let out = text;
  for (const re of MASKS) out = out.replace(re, (m) => ' '.repeat(m.length));
  return out;
}

/** Corpo numérico → leituras possíveis (1 ou 2 quando ambíguo). */
export function interpretBody(body: string): NumberReading[] {
  const clean = body.replace(GROUP_SPACES_RE, ' ');
  const hasSpaceGroups = clean.includes(' ');
  const noSpace = clean.replace(/ /g, '');
  const dots = (noSpace.match(/\./g) ?? []).length;
  const commas = (noSpace.match(/,/g) ?? []).length;

  const read = (intPart: string, frac: string): NumberReading => ({
    value: Number(`${intPart || '0'}.${frac || '0'}`),
    granularity: frac ? 10 ** -frac.length : 1,
  });

  if (dots && commas) {
    // Os dois presentes: o ÚLTIMO é o decimal.
    const decSep = noSpace.lastIndexOf('.') > noSpace.lastIndexOf(',') ? '.' : ',';
    const groupSep = decSep === '.' ? ',' : '.';
    const [intPart, frac = ''] = noSpace.split(groupSep).join('').split(decSep);
    return [read(intPart, frac)];
  }
  const sep = dots ? '.' : commas ? ',' : null;
  if (!sep) return [read(noSpace, '')];
  if ((dots || commas) > 1) {
    // Separador repetido só pode ser grupo de milhar: 1.234.567.
    return [read(noSpace.split(sep).join(''), '')];
  }
  const [intPart, frac] = noSpace.split(sep);
  if (hasSpaceGroups) return [read(intPart, frac)]; // "1 234,5": espaço já é o grupo
  if (frac.length === 3 && intPart !== '0') {
    return [read(`${intPart}${frac}`, ''), read(intPart, frac)];
  }
  return [read(intPart, frac)];
}

function unitOf(currency: string | undefined, suffix: string | undefined): NumberUnit {
  if (suffix === '%') return 'pct';
  if (suffix && /^p\.?p\.?$/i.test(suffix)) return 'pp';
  if (currency === 'R$') return 'brl';
  if (currency || (suffix && /usd|d[óo]lares/i.test(suffix))) return 'usd';
  return null;
}

/** Todos os números escritos no texto, na ordem, com unidade e precisão. */
export function extractNumbers(text: string): WrittenNumber[] {
  const masked = maskDates(text);
  const out: WrittenNumber[] = [];
  for (const m of masked.matchAll(NUMBER_RE)) {
    const [raw, sign1, currency, sign2, body, mult, suffix] = m;
    const sign = sign1 ?? sign2;
    const negative = sign === '-' || sign === '−';
    const factor = mult ? MULTIPLIERS[mult.toLowerCase()] ?? MULTIPLIERS[mult] ?? 1 : 1;
    const readings = interpretBody(body).map((r) => ({
      value: (negative ? -1 : 1) * r.value * factor,
      granularity: r.granularity * factor,
    }));
    const unit = unitOf(currency, suffix);
    const plain = readings.length === 1 && readings[0].granularity === 1 && !mult;
    out.push({
      raw: raw.trim(),
      index: m.index ?? 0,
      end: (m.index ?? 0) + raw.length,
      unit,
      readings,
      yearLike: plain && unit === null && !negative && readings[0].value >= 2000 && readings[0].value <= 2100,
    });
  }
  return out;
}

export interface MatchTolerance {
  abs?: number;
  rel?: number;
}

/**
 * O número escrito corresponde ao esperado? Alguma leitura precisa cair
 * dentro de max(g/2, tol.abs, tol.rel·|e|). `integerOnly`: contagem exige a
 * forma exata (sem "1,2 mil" pra 1.234). `absolute`: compara em módulo
 * ("queda de 5%" pra −5%).
 */
export function numberMatches(
  w: WrittenNumber,
  expected: number,
  tol: MatchTolerance = {},
  opts: { integerOnly?: boolean; absolute?: boolean } = {},
): boolean {
  if (!Number.isFinite(expected)) return false;
  const e = opts.absolute ? Math.abs(expected) : expected;
  return w.readings.some((r) => {
    if (opts.integerOnly && r.granularity > 1) return false;
    const v = opts.absolute ? Math.abs(r.value) : r.value;
    const allowed = Math.max(r.granularity / 2, tol.abs ?? 0, (tol.rel ?? 0) * Math.abs(e));
    return Math.abs(v - e) <= allowed + 1e-9;
  });
}
