// CRM de afiliados — lista da régua e ações do operador.
//
//   GET  /api/admin/affiliate-crm?segment=&tier=&pending=1&phone=0&q=
//   POST /api/admin/affiliate-crm  { action, ... }
//        touch        { crmKey, cycleKey, segment, touchpoint, tag?, notes? }
//        touch_batch  { items: [...] }               ← "marquei a lista toda"
//        untouch      { crmKey, cycleKey, touchpoint }
//        profile      { crmKey, phone?, tier?, notes?, optOut? }
//        config       { ...parâmetros }              ← ADMIN only
//
// Aba própria ('affiliate-crm'): quem opera o WhatsApp não precisa ver
// receita nem margem da operação, e a permissão por aba já resolve isso.
// Os PARÂMETROS da régua ficam com o admin — é decisão de operação.

import { NextResponse } from 'next/server';
import { requireAdmin, requireTab } from '@/lib/auth/guard';
import {
  listAffiliateCrm, recordTouch, recordTouchBatch, undoTouch, saveCrmProfile, saveCrmConfig, crmOptionsFromQuery,
  type TouchInput,
} from '@/lib/services/affiliateCrm';
import { TIERS, type Tier } from '@/lib/services/affiliateCrmCore';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strOrNull = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' ? v : undefined);

function parseTier(v: unknown): Tier | null {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v) ? (v as Tier) : null;
}

export async function GET(req: Request) {
  const auth = await requireTab('affiliate-crm');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  try {
    return NextResponse.json(await listAffiliateCrm(crmOptionsFromQuery(searchParams)));
  } catch (err) {
    logger.error({ err }, 'admin/affiliate-crm GET failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}

interface Body {
  action?: string;
  crmKey?: unknown;
  cycleKey?: unknown;
  segment?: unknown;
  touchpoint?: unknown;
  tag?: unknown;
  notes?: unknown;
  origin?: unknown;
  items?: unknown;
  phone?: unknown;
  tier?: unknown;
  optOut?: unknown;
  config?: unknown;
}

function touchFromBody(b: Record<string, unknown>, createdBy: string | null): TouchInput | null {
  const crmKey = str(b.crmKey); const cycleKey = str(b.cycleKey); const touchpoint = str(b.touchpoint);
  if (!crmKey || !cycleKey || !touchpoint) return null;
  return {
    crmKey, cycleKey, touchpoint,
    segment: str(b.segment) ?? 'desconhecido',
    tag: strOrNull(b.tag) ?? null,
    notes: strOrNull(b.notes) ?? null,
    origin: str(b.origin) ?? 'manual',
    createdBy,
  };
}

export async function POST(req: Request) {
  const auth = await requireTab('affiliate-crm');
  if (!auth.ok) return auth.response;
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  const who = auth.user.email ?? auth.user.id ?? null;

  try {
    switch (body.action) {
      case 'touch': {
        const t = touchFromBody(body as Record<string, unknown>, who);
        if (!t) return NextResponse.json({ error: 'crmKey, cycleKey e touchpoint são obrigatórios' }, { status: 400 });
        await recordTouch(t);
        return NextResponse.json({ ok: true });
      }
      case 'touch_batch': {
        if (!Array.isArray(body.items) || !body.items.length) {
          return NextResponse.json({ error: 'items vazio' }, { status: 400 });
        }
        if (body.items.length > 500) return NextResponse.json({ error: 'no máximo 500 por vez' }, { status: 400 });
        const items: TouchInput[] = [];
        for (const raw of body.items) {
          const t = raw && typeof raw === 'object' ? touchFromBody(raw as Record<string, unknown>, who) : null;
          if (t) items.push(t);
        }
        if (!items.length) return NextResponse.json({ error: 'nenhum item válido' }, { status: 400 });
        const n = await recordTouchBatch(items);
        return NextResponse.json({ ok: true, registrados: n });
      }
      case 'untouch': {
        const crmKey = str(body.crmKey); const cycleKey = str(body.cycleKey); const touchpoint = str(body.touchpoint);
        if (!crmKey || !cycleKey || !touchpoint) return NextResponse.json({ error: 'parâmetros incompletos' }, { status: 400 });
        const n = await undoTouch(crmKey, cycleKey, touchpoint);
        return NextResponse.json({ ok: true, removidos: n });
      }
      case 'profile': {
        const crmKey = str(body.crmKey);
        if (!crmKey) return NextResponse.json({ error: 'crmKey obrigatório' }, { status: 400 });
        const patch: Parameters<typeof saveCrmProfile>[0] = { crmKey };
        if ('phone' in body) patch.phone = strOrNull(body.phone) ?? null;
        if ('tier' in body) patch.tier = body.tier === null ? null : parseTier(body.tier);
        if ('notes' in body) patch.notes = strOrNull(body.notes) ?? null;
        if ('optOut' in body) patch.optOut = !!body.optOut;
        await saveCrmProfile(patch);
        return NextResponse.json({ ok: true });
      }
      case 'config': {
        // Parâmetro da régua é decisão de operação — só admin muda.
        const adm = await requireAdmin();
        if (!adm.ok) return adm.response;
        const cfg = body.config && typeof body.config === 'object' ? body.config as Record<string, number | number[]> : {};
        const saved = await saveCrmConfig(cfg);
        logger.info({ who, patch: cfg }, '[crm] parâmetros alterados');
        return NextResponse.json({ ok: true, config: saved });
      }
      default:
        return NextResponse.json({ error: `ação desconhecida: ${String(body.action)}` }, { status: 400 });
    }
  } catch (err) {
    logger.error({ err, action: body.action }, 'admin/affiliate-crm POST failed');
    return NextResponse.json({ error: 'falhou' }, { status: 500 });
  }
}
