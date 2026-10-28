// Catálogo da rede no NorthAffiliates (API de leitura, chave nsk_…): produtos
// liberados, foto, mockups dos kits (2/3/6 frascos), versões da VSL e
// materiais. Hoje a aba Pesquisas usa pra mostrar o que existe e achar o
// mockup do produto; as imagens do NeuroRecall ainda vêm do repositório do
// Atlas (o produto não está no catálogo).
//
// Contrato (doc "API de leitura da rede", 2026-10-28):
//   GET {base}/catalog   Authorization: Bearer nsk_…   (300 req/min por chave)
//   Links de arquivo (image/kits/materials) valem 30 MINUTOS — guardar o id,
//   nunca o link; pra usar, baixar e servir do nosso lado.

import { getNetworkCatalogKey, getNetworkCatalogUrl } from './integrationSettings';

export interface CatalogKit { packSize: number; url: string }

export interface CatalogProduct {
  id: string;
  name: string;
  niche: string | null;
  status: string | null;
  image: string | null;
  kits: CatalogKit[];
  offers: number;
  materials: Record<string, number>;
  updatedAt: string | null;
}

export interface CatalogResult {
  network: string | null;
  generatedAt: string | null;
  products: CatalogProduct[];
}

export class CatalogNotConfiguredError extends Error {}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v != null && !Array.isArray(v);
const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
const fileUrl = (v: unknown) => (isObj(v) ? s(v.downloadUrl) ?? s(v.url) : null);

/** Normaliza o /catalog (puro — testável sem rede). */
export function parseCatalog(body: unknown, network: string | null = null): CatalogResult {
  const b = isObj(body) ? body : {};
  const products = (Array.isArray(b.products) ? b.products : []).filter(isObj).map((p): CatalogProduct => {
    const materials: Record<string, number> = {};
    const offers = Array.isArray(p.offers) ? p.offers.filter(isObj) : [];
    for (const o of offers) {
      for (const m of (Array.isArray(o.materials) ? o.materials : []).filter(isObj)) {
        const t = s(m.type) ?? 'OUTRO';
        materials[t] = (materials[t] ?? 0) + 1;
      }
    }
    return {
      id: s(p.id) ?? '',
      name: s(p.name) ?? '',
      niche: s(p.niche),
      status: isObj(p.release) ? s(p.release.status) : null,
      image: fileUrl(p.image),
      kits: (Array.isArray(p.kits) ? p.kits : []).filter(isObj)
        .map((k) => ({ packSize: Number(k.packSize), url: fileUrl(k) ?? '' }))
        .filter((k) => Number.isInteger(k.packSize) && k.url)
        .sort((x, y) => x.packSize - y.packSize),
      offers: offers.length,
      materials,
      updatedAt: s(p.updatedAt),
    };
  }).filter((p) => p.id && p.name);
  return { network, generatedAt: s(b.generatedAt), products };
}

/** Nome do produto sem espaço/caixa/"Pro": "Neuro Mind Pro" ≈ "NeuroMind Pro". */
export const catalogNameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

async function call(path: string): Promise<unknown> {
  const key = await getNetworkCatalogKey();
  if (!key) throw new CatalogNotConfiguredError('chave da API do NorthAffiliates não configurada');
  const base = await getNetworkCatalogUrl();
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = isObj(body) ? s(body.code) : null;
    throw new Error(`NorthAffiliates ${res.status}${code ? ` ${code}` : ''}`);
  }
  return body;
}

export async function fetchNetworkCatalog(): Promise<CatalogResult> {
  const [info, catalog] = await Promise.all([call(''), call('/catalog')]);
  const network = isObj(info) && isObj(info.network) ? s(info.network.name) : null;
  return parseCatalog(catalog, network);
}
