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
  dismissSuggestion, restoreDismissed, type AffiliateIdentityList,
} from '@/lib/services/affiliateIdentity';
import { isPortfolioScoped, portfolioAffiliateIds } from '@/lib/portfolio/scope';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Qualquer usuário com acesso às abas de afiliados pode unificar contas e
// preencher contato/origem (decisão do usuário, 2026-08-25).
const TABS = ['affiliate-analysis', 'leaderboard', 'all-affiliates'] as const;

/**
 * Carteira de afiliados: quem tem função vê só as pessoas da carteira dele
 * (com contato) e não recebe sugestões de vínculo — elas cruzam contas de
 * fora. Unificar/desvincular/marcar interno segue com a operação.
 */
function scopeIdentityList(list: AffiliateIdentityList, allowed: Set<string>): AffiliateIdentityList {
  const partners = list.partners.filter((p) => p.accounts.some((a) => allowed.has(a.id)));
  const unlinked = list.unlinked.filter((a) => allowed.has(a.id));
  return {
    partners,
    unlinked,
    suggestions: [],
    dismissedCount: 0,
    stats: {
      partners: partners.length,
      linkedAccounts: partners.reduce((n, p) => n + p.accounts.length, 0),
      unlinkedAccounts: unlinked.length,
      withEmail: partners.reduce((n, p) => n + p.accounts.filter((a) => a.email).length, 0),
      internal: 0,
    },
  };
}

export async function GET() {
  const auth = await requireAnyTab([...TABS]);
  if (!auth.ok) return auth.response;
  const list = await listAffiliateIdentity();
  if (!isPortfolioScoped(auth.user)) return NextResponse.json(list);
  return NextResponse.json(scopeIdentityList(list, new Set(await portfolioAffiliateIds(auth.user))));
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
  // Carteira: quem tem função só atualiza contato/origem de quem é dele.
  if (isPortfolioScoped(auth.user)) {
    const pid = str(body.partnerId);
    if (body.action !== 'update' || !pid) {
      return NextResponse.json({ error: 'unificar contas fica com a operação' }, { status: 403 });
    }
    const allowed = new Set(await portfolioAffiliateIds(auth.user));
    const accounts = await db.affiliate.findMany({ where: { partnerId: pid }, select: { id: true } });
    if (!accounts.some((a) => allowed.has(a.id))) {
      return NextResponse.json({ error: 'afiliado fora da sua carteira' }, { status: 403 });
    }
  }
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
