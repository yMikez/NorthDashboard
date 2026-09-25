// /api/admin/recovery-affiliates
//   GET  → lista afiliados marcados como recuperação.
//   POST → marca um afiliado (externalId + plataforma) como recuperação com %.
//          { affiliateExternalId, platformSlug, commissionPct, note?,
//            nickname?, createIfMissing? }
//
// Auth: sessão ADMIN (o formulário da aba) OU bearer INGEST_SECRET (curl) —
// o mesmo par das outras rotas de escrita (logicall-sync, backfills,
// integration-settings). Esta era a única exceção, e a API.md já dizia que a
// chave de operação abre tudo.
//
// commissionPct vem em PERCENTUAL (30) e é guardado como fração.
//
// createIfMissing pré-cadastra o parceiro ANTES da primeira venda (acordo
// fechado, tráfego ainda não começou). Sem isso a marcação só é possível
// depois da primeira venda — e essa primeira leva entra contada como front.
// O formulário da aba não manda essa flag: lá um ID inexistente continua
// sendo erro, que é o que protege contra dígito errado.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { clearResponseCache } from '@/lib/cache/responseCache';
import { listRecoveryAffiliates, upsertRecoveryAffiliate } from '@/lib/services/recovery';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** null = autorizado; devolve quem agiu pro log (bearer não tem usuário). */
async function authorize(req: Request): Promise<{ denied: NextResponse } | { actorId: string }> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return { actorId: 'bearer' };
  const auth = await requireAdmin();
  return auth.ok ? { actorId: auth.user.id } : { denied: auth.response };
}

export async function GET(req: Request) {
  const who = await authorize(req);
  if ('denied' in who) return who.denied;
  return NextResponse.json({ affiliates: await listRecoveryAffiliates() });
}

export async function POST(req: Request) {
  const who = await authorize(req);
  if ('denied' in who) return who.denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const affiliateExternalId = typeof body.affiliateExternalId === 'string' ? body.affiliateExternalId.trim() : '';
  const platformSlug = typeof body.platformSlug === 'string' ? body.platformSlug.trim() : '';
  const pctNum = typeof body.commissionPct === 'number' ? body.commissionPct : Number(body.commissionPct);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const nickname = typeof body.nickname === 'string' && body.nickname.trim() ? body.nickname.trim() : null;
  const createIfMissing = body.createIfMissing === true;

  if (!affiliateExternalId) return NextResponse.json({ error: 'affiliateExternalId obrigatório' }, { status: 400 });
  if (!platformSlug) return NextResponse.json({ error: 'platformSlug obrigatório' }, { status: 400 });
  if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
    return NextResponse.json({ error: 'commissionPct deve estar entre 0 e 100' }, { status: 400 });
  }

  const res = await upsertRecoveryAffiliate({
    affiliateExternalId,
    platformSlug,
    commissionPct: Math.round((pctNum / 100) * 10000) / 10000, // percent → fração
    note,
    nickname,
    createIfMissing,
  });
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 });

  // Derruba o cache de respostas pra mudança de % refletir já no
  // /api/metrics/recovery (TTL 30s seria confuso logo após salvar).
  clearResponseCache();

  logger.info(
    { actorId: who.actorId, affiliateExternalId, platformSlug, pct: pctNum, nickname, contaCriada: res.created === true },
    'admin.recovery-affiliates.upsert',
  );
  return NextResponse.json({ ok: true, conta_criada: res.created === true });
}
