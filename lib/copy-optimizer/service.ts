// Camada de serviço do Copy Optimizer — orquestra DB + lógica pura.
//
// decideCopy: resolve a venda (Order) pelo order_id_global, extrai afiliado +
// email, e delega a decisão pra decideLayer(). recordCopyView: grava o que o
// lead efetivamente viu. Ambos chamados server-to-server pelo funnel-renderer.

import { db } from '@/lib/db';
import { getRulesCached } from './rules';
import { decideLayer, isValidEmail, isCopyLayer, type CopyLayer } from './decision';

// Platform.id da BuyGoods é estável — resolve 1x e memoiza no processo.
let buygoodsPlatformId: string | null = null;
async function getBuygoodsPlatformId(): Promise<string | null> {
  if (buygoodsPlatformId) return buygoodsPlatformId;
  const p = await db.platform.findUnique({
    where: { slug: 'buygoods' },
    select: { id: true },
  });
  buygoodsPlatformId = p?.id ?? null;
  return buygoodsPlatformId;
}

/** Layer de fallback global, configurável via env COPY_DEFAULT_LAYER. */
export function defaultLayer(): CopyLayer {
  const v = (process.env.COPY_DEFAULT_LAYER ?? 'black1').trim();
  return isCopyLayer(v) ? v : 'black1';
}

export interface DecideCopyResult {
  found: boolean;
  layer: CopyLayer;
  order_id_global: string;
  aff_id: string | null;
  aff_name: string | null;
  email: string | null;
  email_valid: boolean;
  bucket: number | null;
  pct_applied: number;
  decided_at: string;
}

/**
 * Decide a copy pro lead. Se a venda ainda não foi ingerida (IPN assíncrono
 * via n8n) ou a plataforma não existe, devolve found=false + layer de fallback
 * — o funil sempre renderiza algo.
 */
export async function decideCopy(orderIdGlobalRaw: string): Promise<DecideCopyResult> {
  const orderIdGlobal = (orderIdGlobalRaw ?? '').trim();
  const fallback = defaultLayer();
  const decidedAt = new Date().toISOString();

  const miss = (): DecideCopyResult => ({
    found: false,
    layer: fallback,
    order_id_global: orderIdGlobal,
    aff_id: null,
    aff_name: null,
    email: null,
    email_valid: false,
    bucket: null,
    pct_applied: 0,
    decided_at: decidedAt,
  });

  if (!orderIdGlobal) return miss();

  const platformId = await getBuygoodsPlatformId();
  if (!platformId) return miss();

  // Qualquer order da sessão serve pra pegar afiliado/cliente; ordena por
  // funnelStep ASC (FE primeiro, funnelStep=1) pra preferir o frontend.
  const order = await db.order.findFirst({
    where: { platformId, parentExternalId: orderIdGlobal },
    orderBy: { funnelStep: 'asc' },
    select: {
      affiliate: { select: { externalId: true, nickname: true } },
      customer: { select: { email: true } },
    },
  });
  if (!order) return miss();

  const affId = order.affiliate?.externalId ?? null;
  const affName = order.affiliate?.nickname ?? null;
  const email = order.customer?.email ?? null;
  const emailValid = isValidEmail(email);

  const rules = await getRulesCached();
  const decision = decideLayer({
    orderIdGlobal,
    affId,
    affName,
    emailValid,
    rules,
    defaultLayer: fallback,
  });

  return {
    found: true,
    layer: decision.layer,
    order_id_global: orderIdGlobal,
    aff_id: affId,
    aff_name: affName,
    email,
    email_valid: emailValid,
    bucket: decision.bucket,
    pct_applied: decision.pctApplied,
    decided_at: decidedAt,
  };
}

export interface RecordCopyViewInput {
  orderIdGlobal: string;
  layer: string;
  affId?: string | null;
  affName?: string | null;
  bucket?: number | null;
  pageUrl?: string | null;
  referrer?: string | null;
  sessid2?: string | null;
}

/** Grava uma visualização de copy. Append-only; não precisa ser idempotente. */
export async function recordCopyView(input: RecordCopyViewInput): Promise<void> {
  await db.copyView.create({
    data: {
      orderIdGlobal: input.orderIdGlobal.trim(),
      layer: input.layer.trim(),
      affId: input.affId ?? null,
      affName: input.affName ?? null,
      bucket: input.bucket ?? null,
      pageUrl: input.pageUrl ?? null,
      referrer: input.referrer ?? null,
      sessid2: input.sessid2 ?? null,
    },
  });
}
