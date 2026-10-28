// Validação da configuração de uma variante editada pela aba Pesquisas.
//
// O formulário do dash manda o objeto inteiro; aqui só passa o que a página
// sabe usar, com faixas sãs (preço > 0, link https, ciclo em meses). Campo
// desconhecido é descartado; valor inválido derruba o salvamento com a
// mensagem do campo — melhor não salvar do que publicar um checkout quebrado.

import { DEFAULT_COPY, type SurveyKit, type SurveyVariantConfig } from './fimTratamento';

export type ConfigResult = { ok: true; config: SurveyVariantConfig } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v != null && !Array.isArray(v);

class Invalid extends Error {}
const fail = (msg: string): never => { throw new Invalid(msg); };

function num(v: unknown, field: string, min: number, max: number, int = false): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    fail(`${field}: número de ${min} a ${max}${int ? ' (inteiro)' : ''}`);
  }
  return Math.round((n as number) * 100) / 100;
}

function optNum(v: unknown, field: string, min: number, max: number, int = false): number | null {
  return v == null || v === '' ? null : num(v, field, min, max, int);
}

function url(v: unknown, field: string): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return fail(`${field}: link inválido`);
  let u: URL;
  try { u = new URL(v.trim()); } catch { return fail(`${field}: link inválido`); }
  if (u.protocol !== 'https:') fail(`${field}: o link precisa começar com https://`);
  return u.toString();
}

function str(v: unknown, field: string, max: number, re?: RegExp): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return fail(`${field}: texto inválido`);
  const s = v.trim();
  if (s.length > max || (re && !re.test(s))) fail(`${field}: formato inválido`);
  return s;
}

function sizeKey(k: string, field: string): string {
  return String(num(k, `${field} (frascos)`, 1, 24, true));
}

export function sanitizeVariantConfig(raw: unknown): ConfigResult {
  try {
    if (!isObj(raw)) fail('configuração inválida');
    const r = raw as Record<string, unknown>;
    const out: SurveyVariantConfig = {
      productName: str(r.productName, 'Nome do produto', 80) ?? fail('Nome do produto: obrigatório'),
    };
    const accent = str(r.accent, 'Cor', 7, /^#[0-9a-f]{6}$/i);
    if (accent) out.accent = accent;
    const image = str(r.image, 'Imagem', 200, /^\/(survey-assets\/[\w.-]+|api\/survey\/asset\/[\w-]+)$/);
    if (image) out.image = image;
    out.planBottles = r.planBottles == null ? 6 : num(r.planBottles, 'Plano (frascos)', 1, 24, true);
    out.daysPerBottle = r.daysPerBottle == null ? 30 : num(r.daysPerBottle, 'Dias por frasco', 1, 90, true);
    out.eligibleBottles = Array.isArray(r.eligibleBottles)
      ? [...new Set(r.eligibleBottles.map((b) => num(b, 'Frascos que recebem', 1, 23, true)))].sort((a, b) => a - b)
      : [2, 3];
    out.fullPlanFrom = optNum(r.fullPlanFrom, 'Plano completo a partir de', 1, 24, true);
    out.trackingParam = str(r.trackingParam, 'Parâmetro de rastreio', 20, /^[a-z_][a-z0-9_]*$/i) ?? 'src';

    const fronts: Record<string, number> = {};
    if (isObj(r.frontPrices)) {
      for (const [k, v] of Object.entries(r.frontPrices)) fronts[sizeKey(k, 'Preço do front')] = num(v, `Preço do front de ${k}`, 1, 10000);
    }
    out.frontPrices = fronts;

    const offers = isObj(r.offers) ? r.offers : {};
    const sub = offers.assinatura;
    const kits: Record<string, SurveyKit> = {};
    if (isObj(offers.kits)) {
      for (const [k, v] of Object.entries(offers.kits)) {
        if (!isObj(v)) continue;
        const size = sizeKey(k, 'Kit');
        kits[size] = {
          url: url(v.url, `Link do kit de ${size}`),
          price: num(v.price, `Preço do kit de ${size}`, 1, 10000),
          everyMonths: optNum(v.everyMonths, `Ciclo do kit de ${size}`, 1, 24, true),
        };
      }
    }
    out.offers = {
      assinatura: isObj(sub) && (sub.url || sub.monthlyPrice)
        ? {
          url: url(sub.url, 'Link da assinatura'),
          monthlyPrice: num(sub.monthlyPrice, 'Assinatura: preço por mês', 1, 10000),
          // Sem 1ª cobrança diferente, vale o preço do mês.
          firstPrice: sub.firstPrice == null || sub.firstPrice === '' ? num(sub.monthlyPrice, 'Assinatura', 1, 10000) : num(sub.firstPrice, 'Assinatura: 1ª cobrança', 1, 10000),
        }
        : null,
      kits,
    };

    out.coupons = Array.isArray(r.coupons)
      ? r.coupons.filter(isObj).map((c, i) => ({
        pct: num(c.pct, `Cupom ${i + 1}: %`, 1, 90, true),
        code: str(c.code, `Cupom ${i + 1}: código`, 30, /^[A-Z0-9_-]+$/i),
        ...(isObj(c.kits) ? {
          kits: Object.fromEntries(Object.entries(c.kits).map(([k, v]) => [sizeKey(k, `Cupom ${i + 1}`), url(v, `Cupom ${i + 1}: link do kit de ${k}`)])),
        } : {}),
      }))
      : [];
    if (new Set(out.coupons.map((c) => c.pct)).size !== out.coupons.length) fail('Cupons: uma faixa de % por cupom');
    out.couponParam = str(r.couponParam, 'Parâmetro do cupom', 20, /^[a-z_][a-z0-9_]*$/i);
    out.couponValidDays = r.couponValidDays == null ? 7 : num(r.couponValidDays, 'Validade do cupom', 1, 60, true);

    out.q4 = Array.isArray(r.q4)
      ? r.q4.filter(isObj).slice(0, 8).map((o, i) => ({
        id: str(o.id, `Pergunta 4, opção ${i + 1}: id`, 30, /^[a-z0-9_]+$/) ?? fail(`Pergunta 4, opção ${i + 1}: id obrigatório`),
        label: str(o.label, `Pergunta 4, opção ${i + 1}: texto`, 120) ?? fail(`Pergunta 4, opção ${i + 1}: texto obrigatório`),
      }))
      : [];

    // Frases reescritas: só chaves que existem no texto padrão (com ou sem @público).
    const copy: Record<string, string> = {};
    if (isObj(r.copy)) {
      for (const [k, v] of Object.entries(r.copy)) {
        const base = k.split('@')[0];
        if (!(base in DEFAULT_COPY)) fail(`Texto: a chave "${k}" não existe`);
        const text = str(v, `Texto "${k}"`, 600);
        if (text) copy[k] = text;
      }
    }
    if (Object.keys(copy).length) out.copy = copy;
    return { ok: true, config: out };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}
