// GET /api/integrations/targets — metas e taxas configuradas NO DASH.
//
// Existe pra acabar com o número repetido dos dois lados: o SendTrace lia as
// metas de reembolso/chargeback do PDF e o dash as tinha implícitas, o que já
// produziu divergência. Agora a fonte é uma só — editável em
// PATCH /api/admin/profit-config (admin).
//
// Auth: X-Api-Key de parceiro · bearer INGEST_SECRET · sessão ADMIN.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePartnerRead } from '@/lib/auth/partnerKey';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requirePartnerRead(req);
  if (!auth.ok) return auth.response;
  try {
    const [config, platforms] = await Promise.all([
      db.profitConfig.upsert({ where: { id: 'global' }, create: { id: 'global' }, update: {} }),
      db.platform.findMany({
        where: { isActive: true },
        select: { slug: true, displayName: true, feeRatePct: true, allowancePct: true, refundCbPct: true },
        orderBy: { slug: 'asc' },
      }),
    ]);
    const num = (v: unknown) => (v == null ? null : Number(v));
    return NextResponse.json({
      // Nomes conforme o contrato pedido pelo SendTrace (2026-09-22).
      reembolso_meta_d30_pct: Number(config.refundTargetD30Pct),
      reembolso_limite_d30_pct: Number(config.refundLimitD30Pct),
      chargeback_atencao_pct: Number(config.chargebackWarnPct),
      chargeback_limite_pct: Number(config.chargebackLimitPct),
      atualizado_em: config.updatedAt.toISOString(),
      // Extras úteis pra quem recalcula margem do outro lado.
      opex_pct: Number(config.opexPct),
      // Taxa de reembolso&CB por plataforma usada no modelo de lucro do dash
      // (manual; na Digistore o modelo usa a taxa REAL da coorte madura).
      plataformas: platforms.map((p) => ({
        slug: p.slug,
        nome: p.displayName,
        fee_pct: num(p.feeRatePct),
        reserva_pct: num(p.allowancePct),
        refund_cb_pct_modelo: num(p.refundCbPct),
        modelo_estorno: p.slug === 'digistore24' ? 'extra-row' : 'in-place',
      })),
    });
  } catch (err) {
    logger.error({ err }, 'integrations/targets failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
