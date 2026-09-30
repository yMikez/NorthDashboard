// Checagem de números dos blocos (respond_with_blocks) contra o que as
// tools devolveram de fato no turno (ResultStore + contas do calc).
//
// Número "sem fonte" = o modelo digitou/calculou de cabeça. O motor devolve
// a lista UMA vez pro modelo corrigir (via calc) antes de entregar.
//
// Conservador de propósito — falso positivo custa uma rodada e confunde o
// modelo; então:
//   - lê "$154,318", "$ 154.318", "US$ 1.234,56", "12.4%", "+8.2%", "1,241",
//     "$1.2M", "154,3 mil" (vírgula/ponto ambíguos geram as DUAS leituras);
//   - candidatos = toda folha numérica dos resultados do turno + contas do
//     calc, com variantes ×100 (fração exibida como %) e ÷100;
//   - tolerância = max(0,5% relativo, meia unidade do último dígito exibido)
//     — "$154.3K" casa com 154,318; "$160,000" não;
//   - sinal ignorado ("caiu 8,2%" pode vir sem o menos);
//   - fora da checagem: anos (2000–2100), datas/horas, e inteiros pequenos
//     sem unidade (≤ 31: dias, janelas, posição, contagem de itens citados).

import { formatCell } from '../chat/format';
import type { ResultStore } from './resultStore';

export interface GroundingReport {
  /** Números exibidos que não batem com nenhum resultado (texto como aparece). */
  unmatched: string[];
  /** Quantos números foram conferidos. */
  checked: number;
}

interface Reading { value: number; g: number }
export interface ShownNumber {
  text: string;
  readings: Reading[];
  /** true = inteiro pequeno/ano/zero sem unidade — não é conferido. */
  ignored: boolean;
}

// ── Leitura dos números exibidos ─────────────────────────────────────────

const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?\b/g, // 2026-09-30, ISO
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,                              // 30/09, 30/09/2026
  /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:h|BRT)?\b/gi,                       // 14:05, 14:05h
  /\b\d{1,2}h\d{2}\b/gi,                                               // 14h05
  /\b\d+(?:º|ª|°)/g,                                                   // 1º, 2ª
];

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/^(milhões|milhão|mi)\b/i, 1e6],
  [/^mil\b/i, 1e3],
  [/^bi\b/i, 1e9],
  [/^[kK](?![A-Za-z])/, 1e3],
  [/^M(?![A-Za-z])/, 1e6],
  [/^B(?![A-Za-z])/, 1e9],
];

function decimalsOf(s: string): number {
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Leituras possíveis do corpo numérico ("1,241" → 1241 ou 1.241). */
export function readingsOf(body: string): Reading[] {
  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;
  const plain = (s: string): Reading => ({ value: Number(s), g: 10 ** -decimalsOf(s) });
  if (!dots && !commas) return [plain(body)];
  if (dots && commas) {
    const lastDot = body.lastIndexOf('.');
    const lastComma = body.lastIndexOf(',');
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    const [intPart, fracPart] = [body.slice(0, Math.max(lastDot, lastComma)), body.slice(Math.max(lastDot, lastComma) + 1)];
    if (intPart.includes(dec) || !/^\d{1,3}([.,]\d{3})*$/.test(intPart)) return [];
    return [plain(`${intPart.split(thou).join('')}.${fracPart}`)];
  }
  const sep = dots ? '.' : ',';
  const count = dots || commas;
  const grouped = new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(body);
  if (count > 1) return grouped ? [plain(body.split(sep).join(''))] : [];
  // Um separador só: "12,5"/"12.5" é decimal; "1,241"/"154.318" é ambíguo.
  const asDecimal = plain(body.replace(',', '.'));
  return grouped ? [plain(body.replace(sep, '')), asDecimal] : [asDecimal];
}

function stripDates(text: string): string {
  let t = text;
  for (const re of DATE_PATTERNS) t = t.replace(re, (m) => ' '.repeat(m.length));
  return t;
}

/** Números num texto exibido (valor de KPI, delta, insight, célula). */
export function parseShownNumbers(text: string): ShownNumber[] {
  const src = stripDates(text);
  const out: ShownNumber[] = [];
  let i = 0;
  while (i < src.length) {
    if (!/\d/.test(src[i]) || (i > 0 && /[A-Za-z0-9_]/.test(src[i - 1]))) { i++; continue; }
    let j = i + 1;
    while (j < src.length && (/\d/.test(src[j]) || (/[.,]/.test(src[j]) && /\d/.test(src[j + 1] ?? '')))) j++;
    const body = src.slice(i, j);
    // Moeda e sinal antes (ignorando espaços): só servem pro texto exibido
    // e pra saber que o número tem unidade.
    let startText = i;
    let k = i - 1;
    while (k >= 0 && src[k] === ' ') k--;
    let currency = false;
    if (k >= 0 && src[k] === '$') {
      currency = true;
      startText = src.slice(Math.max(0, k - 2), k) === 'US' ? k - 2 : src[k - 1] === 'R' ? k - 1 : k;
      k = startText - 1;
      while (k >= 0 && src[k] === ' ') k--;
    }
    if (k >= 0 && /[+\-−]/.test(src[k])) startText = k;
    // Multiplicador e unidade depois.
    let rest = src.slice(j);
    const sp = rest.match(/^\s?/)![0].length;
    let mult = 1;
    let end = j;
    for (const [re, m] of MULTIPLIERS) {
      const hit = re.exec(rest.slice(sp));
      if (hit) { mult = m; end = j + sp + hit[0].length; rest = src.slice(end); break; }
    }
    const unit = /^\s?(%|pp\b|p\.p\.)/.exec(rest);
    const percent = !!unit;
    if (unit) end += unit[0].length;
    // Número grudado em letra ("30d", "3x", "v2") não é valor exibido.
    if (!unit && mult === 1 && /^[A-Za-z]/.test(src.slice(j))) { i = j; continue; }
    const readings = readingsOf(body).map((r) => ({ value: r.value * mult, g: r.g * mult }));
    if (!readings.length) { i = j; continue; }
    const plainInt = !currency && !percent && mult === 1 && !/[.,]/.test(body);
    const v = readings[0].value;
    const ignored = plainInt && (v <= 31 || (v >= 2000 && v <= 2100));
    out.push({ text: text.slice(startText, end).trim(), readings, ignored });
    i = end;
  }
  return out;
}

// ── Candidatos ───────────────────────────────────────────────────────────

const MAX_LEAVES = 2_000_000;
const NUMERIC = /^[-+]?\d+(\.\d+)?$/;

function collect(value: unknown, out: number[], depth: number): void {
  if (out.length >= MAX_LEAVES || depth > 14) return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) out.push(Math.abs(value));
    return;
  }
  if (typeof value === 'string') {
    if (value.length <= 24 && NUMERIC.test(value)) out.push(Math.abs(Number(value)));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collect(v, out, depth + 1);
  }
}

class CandidateSet {
  private sorted: Float64Array;
  constructor(base: number[]) {
    const all = new Set<number>();
    for (const v of base) {
      all.add(v);
      all.add(v * 100);
      all.add(v / 100);
    }
    this.sorted = Float64Array.from(all).sort();
  }
  hasWithin(lo: number, hi: number): boolean {
    const a = this.sorted;
    let l = 0; let h = a.length;
    while (l < h) {
      const m = (l + h) >>> 1;
      if (a[m] < lo) l = m + 1; else h = m;
    }
    return l < a.length && a[l] <= hi;
  }
}

function matchesAny(readings: Reading[], set: CandidateSet): boolean {
  return readings.some(({ value, g }) => {
    const w = Math.abs(value);
    const tol = Math.max(g / 2, 0.005 * w) + 1e-9;
    return set.hasWithin(w - tol, w + tol);
  });
}

// ── Blocos ───────────────────────────────────────────────────────────────

type AnyBlock = Record<string, unknown>;
const NUMERIC_CELL = /^[+\-−]?\s?(US\$|R\$|\$)?\s?[+\-−]?\d[\d.,]*\s?(mil|mi|milhões|milhão|bi|k|K|M|B)?\s?(%|pp|p\.p\.)?$/;

/** Número digitado numa célula (tipo number): leitura com a precisão com que foi escrito. */
function cellReading(v: number, format: string | undefined): ShownNumber | null {
  if (!Number.isFinite(v)) return null;
  const s = String(v);
  const g = s.includes('e') ? 0 : 10 ** -decimalsOf(s);
  const plainInt = (format === 'number' || format === undefined) && Number.isInteger(v);
  const ignored = plainInt && (Math.abs(v) <= 31 || (v >= 2000 && v <= 2100));
  return { text: formatCell(v, format), readings: [{ value: v, g }], ignored };
}

function shownInBlocks(blocks: unknown[]): ShownNumber[] {
  const out: ShownNumber[] = [];
  const text = (v: unknown) => { if (typeof v === 'string' && v.trim()) out.push(...parseShownNumbers(v)); };
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as AnyBlock;
    if (b.type === 'summary' && Array.isArray(b.kpis)) {
      for (const k of b.kpis as AnyBlock[]) {
        text(k?.value);
        text((k?.delta as AnyBlock | undefined)?.value);
      }
    } else if (b.type === 'insights' && Array.isArray(b.insights)) {
      for (const it of b.insights as AnyBlock[]) text(it?.value);
    } else if (b.type === 'table' && Array.isArray(b.columns) && Array.isArray(b.rows)) {
      const cols = (b.columns as AnyBlock[])
        .filter((c) => c && typeof c.key === 'string' && c.format !== 'text')
        .map((c) => ({ key: c.key as string, format: typeof c.format === 'string' ? c.format : undefined }));
      for (const row of b.rows as AnyBlock[]) {
        if (!row || typeof row !== 'object') continue;
        for (const c of cols) {
          const v = row[c.key];
          if (typeof v === 'number') {
            const r = cellReading(v, c.format);
            if (r) out.push(r);
          } else if (typeof v === 'string' && NUMERIC_CELL.test(v.trim())) {
            out.push(...parseShownNumbers(v));
          }
        }
      }
    }
  }
  return out;
}

export function verifyBlockNumbers(blocks: unknown, store: ResultStore): GroundingReport {
  if (!Array.isArray(blocks)) return { unmatched: [], checked: 0 };
  const shown = shownInBlocks(blocks).filter((s) => !s.ignored);
  if (!shown.length) return { unmatched: [], checked: 0 };
  const base: number[] = [];
  for (const r of store.all()) collect(r.value, base, 0);
  for (const v of store.calcValues().values()) if (v != null && Number.isFinite(v)) base.push(Math.abs(v));
  const set = new CandidateSet(base);
  const unmatched: string[] = [];
  for (const s of shown) {
    if (!matchesAny(s.readings, set) && !unmatched.includes(s.text)) unmatched.push(s.text);
  }
  return { unmatched, checked: shown.length };
}
