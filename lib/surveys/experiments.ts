// Teste A/B dentro de uma pesquisa (pedido do usuário, 2026-10-28).
//
// A = a pesquisa como está (SurveyVariant.config, ao vivo). B, C, D = cópias
// inteiras da configuração, editadas no dash — testa texto, preço, link,
// cupom, foto. O que decide QUEM recebe (frascos elegíveis, dias por frasco,
// parâmetro de rastreio) é da pesquisa e vale igual pra todas as versões.
//
// O sorteio acontece na 1ª abertura do link (hash de teste + convite, pelos
// pesos) e fica gravado no convite: a pessoa vê sempre a mesma versão.

import { createHash } from 'node:crypto';
import { DEFAULT_COPY, type SurveyVariantConfig } from './fimTratamento';
import { sanitizeVariantConfig } from './variantConfig';

export const ARM_KEYS = ['A', 'B', 'C', 'D'] as const;
export const CONTROL_ARM = 'A';

export interface ExperimentArm {
  key: string;
  name: string;
  /** Peso relativo do sorteio (50/50, 70/30…). */
  weight: number;
  /** Sem config = controle (a pesquisa como está). */
  config?: SurveyVariantConfig | null;
  /** Só na A, gravado ao encerrar: a pesquisa naquele momento (base do "o que mudou" no histórico). */
  snapshot?: SurveyVariantConfig | null;
}

export type ArmsResult = { ok: true; arms: ExperimentArm[] } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v != null && !Array.isArray(v);

/** Valida as versões vindas do dash. A 1ª é sempre o controle (sem config). */
export function sanitizeArms(raw: unknown): ArmsResult {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > ARM_KEYS.length) {
    return { ok: false, error: `O teste precisa de 2 a ${ARM_KEYS.length} versões` };
  }
  const arms: ExperimentArm[] = [];
  for (const [i, a] of raw.entries()) {
    const key = ARM_KEYS[i];
    const r = isObj(a) ? a : {};
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : i === 0 ? 'Atual' : `Versão ${key}`;
    const weight = Number(r.weight ?? 50);
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
      return { ok: false, error: `Versão ${key}: peso de 1 a 100` };
    }
    if (i === 0) {
      arms.push({ key, name, weight });
      continue;
    }
    const res = sanitizeVariantConfig(r.config);
    if (!res.ok) return { ok: false, error: `Versão ${key}: ${res.error}` };
    arms.push({ key, name, weight, config: res.config });
  }
  return { ok: true, arms };
}

export function armsOf(raw: unknown): ExperimentArm[] {
  return Array.isArray(raw) ? (raw as ExperimentArm[]) : [];
}

/** Configuração que a pessoa vê na versão `arm` (público e rastreio vêm da pesquisa). */
export function armConfig(base: SurveyVariantConfig, arm: ExperimentArm | null | undefined): SurveyVariantConfig {
  if (!arm?.config) return base;
  return {
    ...arm.config,
    eligibleBottles: base.eligibleBottles,
    fullPlanFrom: base.fullPlanFrom,
    daysPerBottle: base.daysPerBottle,
    trackingParam: base.trackingParam,
  };
}

/** Sorteio fixo pelos pesos: o mesmo convite cai sempre na mesma versão. */
export function pickArm(arms: readonly ExperimentArm[], seed: string): string {
  const total = arms.reduce((s, a) => s + Math.max(0, a.weight), 0);
  if (!arms.length || total <= 0) return CONTROL_ARM;
  const h = parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) / 0x100000000;
  let acc = 0;
  for (const a of arms) {
    acc += Math.max(0, a.weight);
    if (h * total < acc) return a.key;
  }
  return arms[arms.length - 1].key;
}

// ---------- o que muda entre as versões ----------

const usd = (n: number | null | undefined) => (n == null ? '—' : `US$ ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Diferenças legíveis de `other` pra `base` (o que o teste está testando). */
export function configDiff(base: SurveyVariantConfig, other: SurveyVariantConfig): string[] {
  const out: string[] = [];
  if (base.productName !== other.productName) out.push(`Nome do produto: "${base.productName}" → "${other.productName}"`);
  if (!same(base.image, other.image)) out.push('Foto');
  if (!same(base.accent, other.accent)) out.push('Cor de destaque');
  if (!same(base.planBottles, other.planBottles)) out.push(`Plano: ${base.planBottles ?? 6} → ${other.planBottles ?? 6} frascos`);

  const sa = base.offers?.assinatura ?? null;
  const sb = other.offers?.assinatura ?? null;
  if (!sa !== !sb) out.push(sb ? 'Assinatura: passa a existir' : 'Assinatura: sai');
  else if (sa && sb) {
    if (sa.monthlyPrice !== sb.monthlyPrice) out.push(`Assinatura: ${usd(sa.monthlyPrice)} → ${usd(sb.monthlyPrice)} por mês`);
    if (sa.firstPrice !== sb.firstPrice) out.push(`Assinatura, 1ª cobrança: ${usd(sa.firstPrice)} → ${usd(sb.firstPrice)}`);
    if (sa.url !== sb.url) out.push('Assinatura: outro link');
  }

  const ka = base.offers?.kits ?? {};
  const kb = other.offers?.kits ?? {};
  const sizes = [...new Set([...Object.keys(ka), ...Object.keys(kb)])].sort((x, y) => Number(x) - Number(y));
  for (const n of sizes) {
    const a = ka[n];
    const b = kb[n];
    if (!a) { out.push(`Kit de ${n}: novo (${usd(b?.price)})`); continue; }
    if (!b) { out.push(`Kit de ${n}: sai`); continue; }
    if (a.price !== b.price) out.push(`Kit de ${n}: ${usd(a.price)} → ${usd(b.price)}`);
    if (!same(a.everyMonths, b.everyMonths)) out.push(`Kit de ${n}: cobrança ${a.everyMonths ? `a cada ${a.everyMonths} meses` : 'única'} → ${b.everyMonths ? `a cada ${b.everyMonths} meses` : 'única'}`);
    if (a.url !== b.url) out.push(`Kit de ${n}: outro link`);
  }

  if (!same(base.frontPrices, other.frontPrices)) out.push('Preço do front usado na comparação');
  if (!same(base.coupons, other.coupons)) {
    const pa = (base.coupons ?? []).filter((c) => c.code).map((c) => `${c.pct}%`).join('/') || 'nenhum';
    const pb = (other.coupons ?? []).filter((c) => c.code).map((c) => `${c.pct}%`).join('/') || 'nenhum';
    out.push(pa === pb ? 'Cupons: outros códigos ou links' : `Cupons: ${pa} → ${pb}`);
  }
  if ((base.couponValidDays ?? 7) !== (other.couponValidDays ?? 7)) out.push(`Cupom reservado: ${base.couponValidDays ?? 7} → ${other.couponValidDays ?? 7} dias`);
  if (!same(base.q4, other.q4)) out.push('Opções da pergunta 4');

  const ca = base.copy ?? {};
  const cb = other.copy ?? {};
  const keys = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].sort();
  const textOf = (c: Record<string, string>, k: string) => c[k] ?? DEFAULT_COPY[k] ?? DEFAULT_COPY[k.split('@')[0]];
  const changed = keys.filter((k) => textOf(ca, k) !== textOf(cb, k));
  for (const k of changed.slice(0, 12)) out.push(`Texto: ${k}`);
  if (changed.length > 12) out.push(`… e mais ${changed.length - 12} textos`);
  return out;
}

// ---------- estatística ----------

/** erf (Abramowitz–Stegun 7.1.26, erro < 1.5e-7). */
function erf(x: number): number {
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}

export interface ProportionTest {
  /** Taxa da versão ÷ taxa do controle − 1 (null quando o controle é 0). */
  lift: number | null;
  /** 1 − p-valor bilateral do teste z de duas proporções (0 a 1). */
  confidence: number;
}

/** Controle x1/n1 contra versão x2/n2. null = sem gente suficiente pra dizer nada. */
export function proportionTest(x1: number, n1: number, x2: number, n2: number): ProportionTest | null {
  if (n1 < 1 || n2 < 1) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  const lift = p1 > 0 ? p2 / p1 - 1 : null;
  if (!(se > 0)) return { lift, confidence: 0 };
  const z = Math.abs(p2 - p1) / se;
  return { lift, confidence: erf(z / Math.SQRT2) };
}
