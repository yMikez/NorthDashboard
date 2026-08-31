// Cost-of-goods + fulfillment calculation. Reads ProductFamilyCost +
// FulfillmentRate e produz o custo que cada venda incorre.
//
// COGS        = (bottles + bonusBottles) × unitCostUsd da família
// Fulfillment = tarifa do (fornecedor da família, família, bracket de potes)
//
// Roteamento de fornecedor: cada família tem ProductFamilyCost.fulfillmentSupplier
// ('redrock' p/ funil NeuroMind: NeuroMindPro/NightCalm/FlexImmuneGuard,
// 'shipoffers' p/ o resto). A tarifa de frete é específica por fornecedor
// (RedRock e ShipOffers têm preços diferentes pro mesmo nº de potes).
//
// Ambos snapshotados em Order.cogsUsd / Order.fulfillmentUsd na ingestão.
// Refund: empresa come o custo (produto já enviado).

import { db } from '../db';

// TEMP (2026-07-30): ShipOffers PAUSADA — não envia nada por enquanto.
// Tudo (incl. famílias sem cadastro) roteia pra RedRock. Quando a
// ShipOffers voltar, reverter pra 'shipoffers' + rodar o cutover inverso.
// EXPORTADA como fonte única: metrics/fulfillment/fulfillmentHealth
// importam daqui — fallback duplicado já causou fantasma de "ShipOffers"
// na distribuição depois do cutover.
export const DEFAULT_SUPPLIER = 'redrock';

interface FamilyCost {
  unitCostUsd: number;
  supplier: string;
}
interface RateRow {
  supplier: string;
  family: string;
  bottlesMax: number;
  priceUsd: number;
}

interface CostsCache {
  // family → { unitCostUsd, supplier }
  byFamily: Map<string, FamilyCost>;
  // Custo médio entre famílias catalogadas — fallback pra SKU de família
  // ainda não cadastrada (não zera o COGS).
  averageUnitCost: number | null;
  // Todas as tarifas, ordenadas por bottlesMax ASC. Lookup filtra por
  // supplier + family (com fallback family='_default').
  rates: RateRow[];
  loadedAt: number;
}
let cache: CostsCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCache(): Promise<CostsCache> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const [families, rates] = await Promise.all([
    db.productFamilyCost.findMany(),
    db.fulfillmentRate.findMany({ orderBy: { bottlesMax: 'asc' } }),
  ]);
  const byFamily = new Map<string, FamilyCost>(
    families.map((f) => [
      f.family,
      { unitCostUsd: Number(f.unitCostUsd), supplier: f.fulfillmentSupplier },
    ]),
  );
  const values = Array.from(byFamily.values())
    .map((v) => v.unitCostUsd)
    .filter((v) => v > 0);
  const averageUnitCost = values.length > 0
    ? values.reduce((s, v) => s + v, 0) / values.length
    : null;
  cache = {
    byFamily,
    averageUnitCost,
    rates: rates.map((r) => ({
      supplier: r.supplier,
      family: r.family,
      bottlesMax: r.bottlesMax,
      priceUsd: Number(r.priceUsd),
    })),
    loadedAt: Date.now(),
  };
  return cache;
}

export function invalidateCogsCache(): void {
  cache = null;
}

export interface CogsResult {
  cogsUsd: number;
  fulfillmentUsd: number;
  totalBottles: number;
  supplier: string; // fornecedor resolvido (transparência / debug)
  // false = custo IRRESOLVÍVEL (família fora do catálogo de custos, potes
  // desconhecidos, componente de combo sem custo). O caller grava NULL no
  // pedido + classificationPending=true — nunca $0 falso nem média
  // silenciosa (decisão 2026-08-31; a média inflava lucro sem aviso).
  resolved: boolean;
}

export interface ComboComponentInput { family: string; bottles: number }

/**
 * Resolve a tarifa de frete pro fornecedor + família + total de potes.
 * Tenta rows family-specific; cai pro family='_default' do supplier.
 * "Primeiro bottlesMax >= total" (rows já ASC). Acima do maior bracket
 * (combos enormes) usa o maior disponível como fallback conservador.
 */
function lookupFulfillment(
  rates: RateRow[],
  supplier: string,
  family: string,
  totalBottles: number,
): number {
  const pick = (fam: string) =>
    rates
      .filter((r) => r.supplier === supplier && r.family === fam)
      .sort((a, b) => a.bottlesMax - b.bottlesMax);
  let scoped = pick(family);
  if (scoped.length === 0) scoped = pick('_default');
  if (scoped.length === 0) return 0;
  const bracket = scoped.find((b) => b.bottlesMax >= totalBottles);
  return bracket ? bracket.priceUsd : scoped[scoped.length - 1].priceUsd;
}

/**
 * Resolve supplier seguindo a cadeia de fallback:
 *   1) override do SKU (Product.fulfillmentSupplier)
 *   2) default da família (ProductFamilyCost.fulfillmentSupplier)
 *   3) DEFAULT_SUPPLIER ('shipoffers')
 *
 * Exportado pra reuso em endpoints de métrica que computam a distribuição
 * de supplier on-the-fly (não usam snapshot — refletem reconfigurações
 * imediatas no painel de fulfillment).
 */
export async function resolveSupplier(
  family: string | null,
  productOverride: string | null | undefined,
): Promise<string> {
  if (productOverride) return productOverride;
  if (!family) return DEFAULT_SUPPLIER;
  const c = await getCache();
  return c.byFamily.get(family)?.supplier ?? DEFAULT_SUPPLIER;
}

export async function calcCogs(
  family: string | null,
  bottles: number | null,
  bonusBottles: number | null,
  productSupplierOverride?: string | null,
  comboComponents?: ComboComponentInput[] | null,
): Promise<CogsResult> {
  const c = await getCache();

  // Combo multi-família: COGS = Σ custo unitário do componente × potes do
  // componente (sem cadastrar custo por permutação); frete pelo TOTAL de
  // potes, com a tarifa da 1ª família componente cadastrada ('_default'
  // como fallback). Qualquer componente sem custo → irresolvível.
  if (comboComponents && comboComponents.length >= 2) {
    const totalBottles = comboComponents.reduce((s2, x) => s2 + x.bottles, 0);
    const supplier = productSupplierOverride
      ?? comboComponents.map((x) => c.byFamily.get(x.family)?.supplier).find((x) => x != null)
      ?? DEFAULT_SUPPLIER;
    let sum = 0;
    for (const comp of comboComponents) {
      const unit = c.byFamily.get(comp.family)?.unitCostUsd;
      if (unit == null) {
        return { cogsUsd: 0, fulfillmentUsd: 0, totalBottles, supplier, resolved: false };
      }
      sum += unit * comp.bottles;
    }
    const rateFamily = comboComponents.find((x) => c.byFamily.has(x.family))?.family ?? (family ?? '_default');
    const fulfillmentUsd = round2(lookupFulfillment(c.rates, supplier, rateFamily, totalBottles));
    return { cogsUsd: round2(sum), fulfillmentUsd, totalBottles, supplier, resolved: true };
  }

  const totalBottles = (bottles ?? 0) + (bonusBottles ?? 0);
  if (!family || totalBottles <= 0) {
    return { cogsUsd: 0, fulfillmentUsd: 0, totalBottles, supplier: DEFAULT_SUPPLIER, resolved: false };
  }
  const fc = c.byFamily.get(family);
  // Custo unitário: SÓ o cadastrado. (A média entre famílias saiu em
  // 2026-08-31 — família sem custo agora é explicitamente irresolvível.)
  const unitCost = fc?.unitCostUsd;
  // Supplier: override por SKU vence default da família. Sem override e sem
  // família cadastrada cai pro DEFAULT_SUPPLIER.
  const supplier = productSupplierOverride
    ?? fc?.supplier
    ?? DEFAULT_SUPPLIER;
  if (unitCost == null) {
    return { cogsUsd: 0, fulfillmentUsd: 0, totalBottles, supplier, resolved: false };
  }
  const cogsUsd = round2(totalBottles * unitCost);
  const fulfillmentUsd = round2(
    lookupFulfillment(c.rates, supplier, family, totalBottles),
  );
  return { cogsUsd, fulfillmentUsd, totalBottles, supplier, resolved: true };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
