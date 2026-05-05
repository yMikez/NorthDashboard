// /api/admin/networks/[id]/affiliates
//   POST → vincula afiliados à network. Aceita 2 formatos no body:
//
//     { affiliateIds: string[] }
//       → IDs internos do nosso DB (afiliados que já apareceram em vendas).
//         Usado pelo modo "buscar afiliados conhecidos".
//
//     { byExternal: [{ platformSlug, externalId, nickname? }] }
//       → ID externo + plataforma. Find-or-create do Affiliate row, depois
//         link. Permite pré-cadastrar afiliado ANTES da primeira venda;
//         quando o webhook chegar, upsertOrder faz upsert por
//         (platformId, externalId) e encontra o row já criado, mantendo
//         o NetworkAffiliate link intacto.
//
// Idempotência: NetworkAffiliate.affiliateId é UNIQUE global, então
// afiliado não pode estar em 2 networks ao mesmo tempo. P2002 vira
// conflict com explicação.

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guard';
import { audit } from '@/lib/services/networkAuditLog';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ExternalAffInput {
  platformSlug: string;
  externalId: string;
  nickname?: string | null;
}

interface AttachBody {
  affiliateIds?: unknown;
  byExternal?: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: networkId } = await params;

  let body: AttachBody;
  try { body = (await req.json()) as AttachBody; }
  catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }

  const ids = Array.isArray(body.affiliateIds)
    ? body.affiliateIds.filter((x): x is string => typeof x === 'string') : [];

  const externals: ExternalAffInput[] = Array.isArray(body.byExternal)
    ? body.byExternal
        .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
        .map((x) => ({
          platformSlug: typeof x.platformSlug === 'string' ? x.platformSlug.trim().toLowerCase() : '',
          externalId: typeof x.externalId === 'string' ? x.externalId.trim() : '',
          nickname: typeof x.nickname === 'string' && x.nickname.trim() ? x.nickname.trim() : null,
        }))
        .filter((x) => x.platformSlug && x.externalId)
    : [];

  if (ids.length === 0 && externals.length === 0) {
    return NextResponse.json({ error: 'nenhum afiliado fornecido' }, { status: 400 });
  }

  const network = await db.network.findUnique({ where: { id: networkId }, select: { id: true } });
  if (!network) return NextResponse.json({ error: 'network not found' }, { status: 404 });

  const attached: string[] = [];
  const conflicts: Array<{ affiliateId?: string; externalId?: string; platformSlug?: string; reason: string }> = [];

  // Caminho 1: IDs internos.
  for (const affiliateId of ids) {
    try {
      await db.networkAffiliate.create({
        data: { networkId, affiliateId, attachedByUserId: auth.user.id },
      });
      attached.push(affiliateId);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          conflicts.push({ affiliateId, reason: 'já vinculado a uma network' });
        } else if (err.code === 'P2003') {
          conflicts.push({ affiliateId, reason: 'affiliate não existe' });
        } else {
          conflicts.push({ affiliateId, reason: `db error: ${err.code}` });
        }
      } else {
        throw err;
      }
    }
  }

  // Caminho 2: pré-cadastro por external. Find-or-create Affiliate, depois link.
  for (const ext of externals) {
    const platform = await db.platform.findUnique({
      where: { slug: ext.platformSlug },
      select: { id: true },
    });
    if (!platform) {
      conflicts.push({
        externalId: ext.externalId,
        platformSlug: ext.platformSlug,
        reason: `plataforma desconhecida: ${ext.platformSlug}`,
      });
      continue;
    }

    try {
      const affiliate = await db.affiliate.upsert({
        where: { platformId_externalId: { platformId: platform.id, externalId: ext.externalId } },
        create: {
          platformId: platform.id,
          externalId: ext.externalId,
          nickname: ext.nickname,
          // Pré-cadastro: ainda não houve venda. firstSeenAt = agora marca
          // o momento do registro manual; lastOrderAt fica null até a
          // primeira venda real chegar via webhook.
          firstSeenAt: new Date(),
        },
        update: {
          // Se já existia, só completa nickname caso esteja vazio. Não
          // sobrescreve dados de vendas (lastOrderAt, etc.).
          nickname: ext.nickname ?? undefined,
        },
        select: { id: true },
      });

      try {
        await db.networkAffiliate.create({
          data: { networkId, affiliateId: affiliate.id, attachedByUserId: auth.user.id },
        });
        attached.push(affiliate.id);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          conflicts.push({
            externalId: ext.externalId,
            platformSlug: ext.platformSlug,
            reason: 'já vinculado a outra network',
          });
        } else {
          throw err;
        }
      }
    } catch (err) {
      logger.error({ err, ext }, '[networks.attach byExternal] failed');
      conflicts.push({
        externalId: ext.externalId,
        platformSlug: ext.platformSlug,
        reason: 'erro ao registrar afiliado',
      });
    }
  }

  if (attached.length > 0) {
    await audit({
      actorUserId: auth.user.id,
      entityType: 'NETWORK_AFFILIATE',
      entityId: networkId,
      action: 'attach',
      after: { attached, conflicts },
    });
    logger.info(
      { actorId: auth.user.id, networkId, attachedCount: attached.length, externals: externals.length },
      'admin.networks.attach',
    );
  }

  return NextResponse.json({ attached, conflicts });
}
