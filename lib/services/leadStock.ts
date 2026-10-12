// Potes e estoque de um lead (aba Leads). Regra do usuário (2026-10-12): todo
// pote tem 30 cápsulas e o cliente toma 1 por dia → cada pote dura 30 dias,
// em todos os produtos.
//
// A MESMA regra roda em SQL na MV lead_summary (migração
// 20261012120000_lead_bottles_stock) — mudou aqui, muda lá.
//
// Estoque por PRODUTO (família): compras do mesmo produto entram em fila (a
// nova começa quando a anterior acaba, ou na data da compra se o estoque já
// tinha zerado). Fechado: acaba em max_k(data_k + 30 × potes da compra k em
// diante). Produtos diferentes correm em paralelo.

export const DAYS_PER_BOTTLE = 30;
const DAY_MS = 86_400_000;

/**
 * Tauk não informa potes: estimativa pelo valor da venda, nas faixas de preço
 * da Logicall (mesmo tipo de venda por telefone; medianas 2 potes ≈ US$ 158,
 * 3 ≈ 207, 6 ≈ 294, 12 ≈ 389). 0 = sem estimativa.
 */
export function estimateBottlesFromAmount(usd: number): number {
  if (!(usd > 0)) return 0;
  if (usd < 120) return 1;
  if (usd < 182) return 2;
  if (usd < 250) return 3;
  if (usd < 345) return 6;
  return 12;
}

export interface BottlePurchase {
  family: string | null;
  at: Date;
  bottles: number;
  estimated: boolean;
}

export interface FamilyStock {
  family: string;
  bottles: number;
  estimatedBottles: number;
  purchases: number;
  firstAt: string;
  lastAt: string;
  stockUntil: string;
  /** Dias de produto que ainda restam hoje (0 = acabou). */
  daysLeft: number;
}

export interface LeadStock {
  bottles: number;
  estimatedBottles: number;
  /** Quando o ÚLTIMO produto acaba (null = nenhum pote conhecido). */
  stockUntil: string | null;
  daysLeft: number;
  families: FamilyStock[];
}

export function leadStock(purchases: BottlePurchase[], now = new Date()): LeadStock {
  const byFamily = new Map<string, BottlePurchase[]>();
  for (const p of purchases) {
    if (!(p.bottles > 0)) continue;
    const fam = (p.family ?? '').trim() || '—';
    const list = byFamily.get(fam) ?? [];
    list.push(p);
    byFamily.set(fam, list);
  }
  const families: FamilyStock[] = [];
  for (const [family, list] of byFamily) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let until = 0;
    for (const p of list) until = Math.max(until, p.at.getTime()) + p.bottles * DAYS_PER_BOTTLE * DAY_MS;
    families.push({
      family,
      bottles: list.reduce((s, p) => s + p.bottles, 0),
      estimatedBottles: list.filter((p) => p.estimated).reduce((s, p) => s + p.bottles, 0),
      purchases: list.length,
      firstAt: list[0].at.toISOString(),
      lastAt: list[list.length - 1].at.toISOString(),
      stockUntil: new Date(until).toISOString(),
      daysLeft: Math.max(0, Math.ceil((until - now.getTime()) / DAY_MS)),
    });
  }
  families.sort((a, b) => (a.stockUntil < b.stockUntil ? 1 : -1));
  const last = families[0];
  return {
    bottles: families.reduce((s, f) => s + f.bottles, 0),
    estimatedBottles: families.reduce((s, f) => s + f.estimatedBottles, 0),
    stockUntil: last ? last.stockUntil : null,
    daysLeft: last ? last.daysLeft : 0,
    families,
  };
}
