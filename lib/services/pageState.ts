// Funnel page-state beacon: as páginas de Upsell 01 reportam seu estado de copy
// (black/white/...) e guardamos só o ÚLTIMO por (plataforma, productKey).
// Exibido nos cards de Produto. Ver app/api/page-state (beacon) e
// app/api/metrics/page-states (leitura).

import { db } from '../db';

// Plataformas conhecidas — valida o beacon (open endpoint) sem travar a
// adição de novas no futuro (é só editar aqui).
const KNOWN_PLATFORMS = new Set(['clickbank', 'digistore24', 'buygoods', 'cartpanda']);

const MAX_PLATFORM = 32;
const MAX_PRODUCT = 64;
const MAX_STATE = 24;
const MAX_URL = 512;

export interface RecordPageStateInput {
  platform: string;
  product: string;
  state: string;
  pageUrl?: string | null;
}

export type RecordResult =
  | { ok: true }
  | { ok: false; error: string };

/** Normaliza + valida o beacon e faz upsert do último estado. */
export async function recordPageState(input: RecordPageStateInput): Promise<RecordResult> {
  const platform = String(input.platform ?? '').trim().toLowerCase();
  const product = String(input.product ?? '').trim();
  const state = String(input.state ?? '').trim().toLowerCase();
  const pageUrl = input.pageUrl ? String(input.pageUrl).trim().slice(0, MAX_URL) : null;

  if (!platform || platform.length > MAX_PLATFORM) return { ok: false, error: 'invalid platform' };
  if (!KNOWN_PLATFORMS.has(platform)) return { ok: false, error: 'unknown platform' };
  if (!product || product.length > MAX_PRODUCT) return { ok: false, error: 'invalid product' };
  if (!state || state.length > MAX_STATE) return { ok: false, error: 'invalid state' };

  const now = new Date();
  await db.funnelPageState.upsert({
    where: { platformSlug_productKey: { platformSlug: platform, productKey: product } },
    create: { platformSlug: platform, productKey: product, state, pageUrl, reportedAt: now },
    update: { state, pageUrl, reportedAt: now },
  });
  return { ok: true };
}

export interface PageStateRow {
  platform: string;
  product: string;
  state: string;
  pageUrl: string | null;
  reportedAt: string; // ISO
}

/** Lista todos os estados atuais (último por plataforma+produto). */
export async function listPageStates(): Promise<PageStateRow[]> {
  const rows = await db.funnelPageState.findMany({
    orderBy: { reportedAt: 'desc' },
    select: { platformSlug: true, productKey: true, state: true, pageUrl: true, reportedAt: true },
  });
  return rows.map((r) => ({
    platform: r.platformSlug,
    product: r.productKey,
    state: r.state,
    pageUrl: r.pageUrl,
    reportedAt: r.reportedAt.toISOString(),
  }));
}
