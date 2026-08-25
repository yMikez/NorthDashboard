// Identidade unificada de afiliados (admin).
//
//   GET  /api/admin/affiliate-identity
//        → parceiros (com contas), contas soltas, sugestões de vínculo, stats
//   POST /api/admin/affiliate-identity  { action, ... }
//        link     { affiliateIds: string[], partnerId?, displayName?, email?, phone? }
//        unlink   { affiliateId }
//        update   { partnerId, displayName?, email?, phone?, notes?, originType?, originRef? }  (originType null limpa a origem)
//        internal { affiliateId, value: true|false|null }
//        backfill {}   ← importa affiliate_email (JVZoo) e auto-vincula por e-mail
//        dismiss  { affiliateIds: [a, b] }   ← "Ignorar" sugestão
//        restore_dismissed {}

import { NextResponse } from 'next/server';
import { requireAnyTab } from '@/lib/auth/guard';
import {
  listAffiliateIdentity, linkAffiliates, unlinkAffiliate, updatePartner, setAffiliateInternal, backfillAffiliateEmails,
  dismissSuggestion, restoreDismissed,
} from '@/lib/services/affiliateIdentity';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Qualquer usuário com acesso às abas de afiliados pode unificar contas e
// preencher contato/origem (decisão do usuário, 2026-08-25).
const TABS = ['affiliate-analysis', 'leaderboard', 'all-affiliates'] as const;

export async function GET() {
  const auth = await requireAnyTab([...TABS]);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await listAffiliateIdentity());
}

interface Body {
  action?: string;
  affiliateIds?: unknown;
  affiliateId?: unknown;
  partnerId?: unknown;
  displayName?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
  originType?: unknown;
  originRef?: unknown;
  value?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const strOrNull = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' ? v : undefined);

export async function POST(req: Request) {
  const auth = await requireAnyTab([...TABS]);
  if (!auth.ok) return auth.response;
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  try {
    switch (body.action) {
      case 'link': {
        const ids = Array.isArray(body.affiliateIds) ? body.affiliateIds.filter((x): x is string => typeof x === 'string') : [];
        const res = await linkAffiliates({
          affiliateIds: ids, partnerId: str(body.partnerId) ?? null,
          displayName: str(body.displayName) ?? null, email: strOrNull(body.email), phone: strOrNull(body.phone), notes: strOrNull(body.notes),
          originType: strOrNull(body.originType), originRef: strOrNull(body.originRef),
        });
        return NextResponse.json({ ok: true, ...res });
      }
      case 'unlink': {
        const id = str(body.affiliateId);
        if (!id) return NextResponse.json({ error: 'affiliateId obrigatório' }, { status: 400 });
        await unlinkAffiliate(id);
        return NextResponse.json({ ok: true });
      }
      case 'update': {
        const id = str(body.partnerId);
        if (!id) return NextResponse.json({ error: 'partnerId obrigatório' }, { status: 400 });
        await updatePartner(id, {
          displayName: str(body.displayName), email: strOrNull(body.email), phone: strOrNull(body.phone), notes: strOrNull(body.notes),
          originType: strOrNull(body.originType), originRef: strOrNull(body.originRef),
        });
        return NextResponse.json({ ok: true });
      }
      case 'internal': {
        const id = str(body.affiliateId);
        if (!id) return NextResponse.json({ error: 'affiliateId obrigatório' }, { status: 400 });
        const v = body.value === null ? null : body.value === true ? true : body.value === false ? false : undefined;
        if (v === undefined) return NextResponse.json({ error: 'value deve ser true, false ou null' }, { status: 400 });
        await setAffiliateInternal(id, v);
        return NextResponse.json({ ok: true });
      }
      case 'backfill': {
        const res = await backfillAffiliateEmails();
        return NextResponse.json({ ok: true, ...res });
      }
      case 'dismiss': {
        const ids = Array.isArray(body.affiliateIds) ? body.affiliateIds.filter((x): x is string => typeof x === 'string') : [];
        if (ids.length !== 2) return NextResponse.json({ error: 'affiliateIds deve ter exatamente 2 contas' }, { status: 400 });
        await dismissSuggestion(ids[0], ids[1]);
        return NextResponse.json({ ok: true });
      }
      case 'restore_dismissed': {
        const count = await restoreDismissed();
        return NextResponse.json({ ok: true, restored: count });
      }
      default:
        return NextResponse.json({ error: 'action inválida' }, { status: 400 });
    }
  } catch (err) {
    logger.error({ err, action: body.action }, '[affiliate-identity] falhou');
    return NextResponse.json({ error: err instanceof Error ? err.message : 'erro' }, { status: 400 });
  }
}
