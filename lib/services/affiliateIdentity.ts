// Identidade unificada de afiliados — camada de banco.
//
//   AffiliatePartner (pessoa) 1:N Affiliate (conta por plataforma)
//
// Vínculo automático só por E-MAIL (chave objetiva). Nome/nick idêntico e
// token em comum viram SUGESTÕES no painel admin — a decisão é humana.
// Toda mutação limpa o cache de respostas (o ranking unificado depende).

import { db } from '../db';
import { Prisma, type AffiliateOrigin } from '@prisma/client';
import { clearResponseCache } from '../cache/responseCache';
import { logger } from '../logger';
import {
  normalizeEmail,
  suggestLinks,
  pickPartnerName,
  effectiveInternal,
  isInternalGuess,
  type IdentityAffiliate,
  type LinkSuggestion,
} from './affiliateIdentityCore';

const AFF_SELECT = {
  id: true, externalId: true, nickname: true, email: true, partnerId: true, isInternal: true,
  lastOrderAt: true, platform: { select: { slug: true } },
} as const;

type AffRow = Prisma.AffiliateGetPayload<{ select: typeof AFF_SELECT }>;

function toIdentity(a: AffRow): IdentityAffiliate {
  return {
    id: a.id, platformSlug: a.platform.slug, externalId: a.externalId, nickname: a.nickname,
    email: a.email, partnerId: a.partnerId, isInternal: a.isInternal, lastOrderAt: a.lastOrderAt,
  };
}

export type IdentityAccount = IdentityAffiliate & { internal: boolean; internalGuess: boolean; revenue30d: number };

export interface PartnerOrigin { type: AffiliateOrigin; ref: string | null }

export interface PartnerView {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  origin: PartnerOrigin | null;
  accounts: IdentityAccount[];
  revenue30d: number;
}

const ORIGIN_TYPES: AffiliateOrigin[] = ['INDICACAO', 'INSTAGRAM', 'PLATAFORMA', 'OUTRO'];

/**
 * Valida a origem: tipo do enum (ou null = limpar); INDICACAO exige quem
 * indicou; PLATAFORMA exige slug de uma Platform existente; INSTAGRAM e
 * OUTRO aceitam ref livre (opcional pro Instagram).
 */
export async function normalizeOrigin(type: string | null | undefined, ref: string | null | undefined): Promise<{ originType: AffiliateOrigin | null; originRef: string | null } | undefined> {
  if (type === undefined) return undefined; // não mexe
  if (type === null || type === '') return { originType: null, originRef: null };
  const t = String(type).toUpperCase() as AffiliateOrigin;
  if (!ORIGIN_TYPES.includes(t)) throw new Error('origem inválida (indicacao | instagram | plataforma | outro)');
  const r = (ref ?? '').trim();
  if (t === 'INDICACAO' && !r) throw new Error('indicação: informe quem indicou');
  if (t === 'PLATAFORMA') {
    const slug = r.toLowerCase();
    const p = await db.platform.findUnique({ where: { slug }, select: { slug: true } });
    if (!p) throw new Error(`plataforma "${r}" não existe no dashboard`);
    return { originType: t, originRef: slug };
  }
  if (t === 'OUTRO' && !r) throw new Error('outro: descreva a origem');
  return { originType: t, originRef: r || null };
}

export function originOf(p: { originType: AffiliateOrigin | null; originRef: string | null } | null | undefined): PartnerOrigin | null {
  return p?.originType ? { type: p.originType, ref: p.originRef } : null;
}

export type IdentitySuggestion = Omit<LinkSuggestion, 'a' | 'b'> & { a: IdentityAccount; b: IdentityAccount };

export interface AffiliateIdentityList {
  partners: PartnerView[];
  unlinked: IdentityAccount[];
  suggestions: IdentitySuggestion[];
  dismissedCount: number;
  stats: { partners: number; linkedAccounts: number; unlinkedAccounts: number; withEmail: number; internal: number };
}

function pairKeyOf(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function listAffiliateIdentity(): Promise<AffiliateIdentityList> {
  // Parceiro sem conta nenhuma (corrida entre dois IPNs, desvínculo antigo)
  // não serve pra nada — some daqui em vez de poluir a lista. Só os com
  // mais de 1 min: um linkAffiliates em andamento cria o parceiro antes de
  // vincular as contas, e um GET concorrente não pode apagá-lo no meio.
  await db.affiliatePartner.deleteMany({ where: { affiliates: { none: {} }, createdAt: { lt: new Date(Date.now() - 60_000) } } });
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [affs, partners, dismissed, rev30] = await Promise.all([
    db.affiliate.findMany({ select: AFF_SELECT, orderBy: { lastOrderAt: { sort: 'desc', nulls: 'last' } } }),
    db.affiliatePartner.findMany({ orderBy: { updatedAt: 'desc' } }),
    db.affiliateLinkDismiss.findMany({ select: { affiliateAId: true, affiliateBId: true } }),
    db.order.groupBy({
      by: ['affiliateId'],
      where: { status: 'APPROVED', orderedAt: { gte: since30 }, affiliateId: { not: null } },
      _sum: { grossAmountUsd: true },
    }),
  ]);
  const revById = new Map<string, number>();
  for (const r of rev30) if (r.affiliateId) revById.set(r.affiliateId, Number(r._sum.grossAmountUsd ?? 0));
  const enrich = (a: IdentityAffiliate): IdentityAccount => ({
    ...a, internal: effectiveInternal(a), internalGuess: isInternalGuess(a), revenue30d: Math.round((revById.get(a.id) ?? 0) * 100) / 100,
  });
  const ids = affs.map(toIdentity);
  const byPartner = new Map<string, IdentityAccount[]>();
  for (const a of ids) if (a.partnerId) byPartner.set(a.partnerId, [...(byPartner.get(a.partnerId) ?? []), enrich(a)]);
  const partnerViews: PartnerView[] = partners.map((p) => {
    const accounts = (byPartner.get(p.id) ?? []).sort((x, y) => y.revenue30d - x.revenue30d);
    return {
      id: p.id, displayName: p.displayName, email: p.email, phone: p.phone, notes: p.notes, origin: originOf(p),
      accounts, revenue30d: Math.round(accounts.reduce((n, a) => n + a.revenue30d, 0) * 100) / 100,
    };
  }).sort((x, y) => y.revenue30d - x.revenue30d);
  const unlinked = ids.filter((a) => !a.partnerId).map(enrich).sort((x, y) => y.revenue30d - x.revenue30d);
  const dismissedKeys = new Set(dismissed.map((d) => `${d.affiliateAId}|${d.affiliateBId}`));
  const suggestions = suggestLinks(ids)
    .filter((s) => !dismissedKeys.has(pairKeyOf(s.a.id, s.b.id).join('|')))
    .map((s) => ({ ...s, a: enrich(s.a), b: enrich(s.b) }));
  return {
    partners: partnerViews,
    unlinked,
    suggestions,
    dismissedCount: dismissed.length,
    stats: {
      partners: partners.length,
      linkedAccounts: ids.filter((a) => a.partnerId).length,
      unlinkedAccounts: unlinked.length,
      withEmail: ids.filter((a) => a.email).length,
      internal: ids.filter((a) => effectiveInternal(a)).length,
    },
  };
}

/** "Ignorar" uma sugestão: o par some da lista até ser restaurado. */
export async function dismissSuggestion(aId: string, bId: string): Promise<void> {
  const [affiliateAId, affiliateBId] = pairKeyOf(aId, bId);
  await db.affiliateLinkDismiss.upsert({
    where: { affiliateAId_affiliateBId: { affiliateAId, affiliateBId } },
    create: { affiliateAId, affiliateBId },
    update: {},
  });
}

export async function restoreDismissed(): Promise<number> {
  const r = await db.affiliateLinkDismiss.deleteMany({});
  return r.count;
}

/**
 * Vincula contas a um parceiro.
 *   - COM partnerId: move SÓ as contas listadas pra ele (parceiros de
 *     origem que ficarem vazios são apagados; os demais ficam intactos).
 *   - SEM partnerId: FUSÃO — reaproveita o parceiro que alguma das contas
 *     já tenha (as contas dos outros parceiros migram junto) ou cria um novo.
 *     Uma conta só cria parceiro quando vem com contato (nome/e-mail/fone).
 */
export async function linkAffiliates(input: {
  affiliateIds: string[];
  partnerId?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  originType?: string | null;
  originRef?: string | null;
}): Promise<{ partnerId: string; linked: number; merged: number }> {
  const ids = [...new Set(input.affiliateIds.filter((x) => typeof x === 'string' && x))];
  if (!ids.length) throw new Error('nenhuma conta informada');
  const found = await db.affiliate.findMany({ where: { id: { in: ids } }, select: AFF_SELECT });
  if (found.length !== ids.length) throw new Error('conta não encontrada');
  // Na ordem em que o admin selecionou — o parceiro da PRIMEIRA conta é o
  // que sobrevive numa fusão (a UI mostra isso antes de confirmar).
  const accounts = ids.map((id) => found.find((a) => a.id === id)!);
  const contactGiven = {
    displayName: input.displayName?.trim() || undefined,
    email: normalizeEmail(input.email) ?? undefined,
    phone: input.phone?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
  };
  const origin = await normalizeOrigin(input.originType, input.originRef);
  const hasContact = !!(contactGiven.displayName || contactGiven.email || contactGiven.phone || contactGiven.notes || (origin && origin.originType));

  let partnerId = input.partnerId ?? null;
  if (partnerId) {
    const exists = await db.affiliatePartner.findUnique({ where: { id: partnerId }, select: { id: true } });
    if (!exists) throw new Error('parceiro não encontrado');
  } else {
    const existing = [...new Set(accounts.map((a) => a.partnerId).filter((x): x is string => !!x))];
    if (existing.length) {
      partnerId = existing[0];
    } else {
      if (ids.length < 2 && !hasContact) throw new Error('pra criar um parceiro novo informe pelo menos 2 contas (ou um contato)');
      const created = await db.affiliatePartner.create({
        data: {
          displayName: contactGiven.displayName || pickPartnerName(accounts.map(toIdentity)),
          email: contactGiven.email ?? accounts.map((a) => normalizeEmail(a.email)).find(Boolean) ?? null,
          phone: contactGiven.phone ?? null,
          notes: contactGiven.notes ?? null,
          ...(origin ?? {}),
        },
        select: { id: true },
      });
      partnerId = created.id;
    }
  }

  const others = [...new Set(accounts.map((a) => a.partnerId).filter((x): x is string => !!x && x !== partnerId))];
  const merge = !input.partnerId; // sem partnerId explícito = fusão de parceiros
  await db.$transaction(async (tx) => {
    await tx.affiliate.updateMany({ where: { id: { in: ids } }, data: { partnerId } });
    if (others.length && merge) {
      // Fusão: contas dos OUTROS parceiros migram junto e eles somem.
      await tx.affiliate.updateMany({ where: { partnerId: { in: others } }, data: { partnerId } });
      await tx.affiliatePartner.deleteMany({ where: { id: { in: others } } });
    } else if (others.length) {
      // Mover conta: só apaga parceiro de origem que ficou vazio.
      await tx.affiliatePartner.deleteMany({ where: { id: { in: others }, affiliates: { none: {} } } });
    }
    // Contato: só grava o que veio preenchido — nunca apaga e-mail/telefone
    // que o parceiro já tinha (o vínculo manual manda os campos vazios).
    if (hasContact) {
      await tx.affiliatePartner.update({
        where: { id: partnerId! },
        data: {
          ...(contactGiven.displayName ? { displayName: contactGiven.displayName } : {}),
          ...(contactGiven.email ? { email: contactGiven.email } : {}),
          ...(contactGiven.phone ? { phone: contactGiven.phone } : {}),
          ...(contactGiven.notes ? { notes: contactGiven.notes } : {}),
          ...(origin && origin.originType ? origin : {}),
        },
      });
    }
  });
  clearResponseCache();
  return { partnerId: partnerId!, linked: ids.length, merged: merge ? others.length : 0 };
}

export async function unlinkAffiliate(affiliateId: string): Promise<void> {
  const a = await db.affiliate.findUnique({ where: { id: affiliateId }, select: { partnerId: true } });
  if (!a) throw new Error('conta não encontrada');
  if (!a.partnerId) return;
  await db.$transaction(async (tx) => {
    await tx.affiliate.update({ where: { id: affiliateId }, data: { partnerId: null } });
    const left = await tx.affiliate.count({ where: { partnerId: a.partnerId! } });
    if (left === 0) await tx.affiliatePartner.delete({ where: { id: a.partnerId! } });
  });
  clearResponseCache();
}

export async function updatePartner(id: string, patch: {
  displayName?: string; email?: string | null; phone?: string | null; notes?: string | null;
  originType?: string | null; originRef?: string | null;
}): Promise<void> {
  const data: Prisma.AffiliatePartnerUpdateInput = {};
  const origin = await normalizeOrigin(patch.originType, patch.originRef);
  if (origin) { data.originType = origin.originType; data.originRef = origin.originRef; }
  if (patch.displayName !== undefined) {
    const n = patch.displayName.trim();
    if (!n) throw new Error('nome não pode ficar vazio');
    data.displayName = n;
  }
  if (patch.email !== undefined) {
    if (patch.email && !normalizeEmail(patch.email)) throw new Error('e-mail inválido');
    data.email = normalizeEmail(patch.email);
  }
  if (patch.phone !== undefined) data.phone = patch.phone?.trim() || null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
  await db.affiliatePartner.update({ where: { id }, data });
  clearResponseCache();
}

export async function setAffiliateInternal(affiliateId: string, value: boolean | null): Promise<void> {
  await db.affiliate.update({ where: { id: affiliateId }, data: { isInternal: value } });
  clearResponseCache();
}

/**
 * Conta com e-mail conhecido → entra no parceiro de outra conta com o mesmo
 * e-mail (ou cria um parceiro se houver ≥ 2 contas soltas com ele). Chamado
 * pelo ingest (JVZoo) e pelo backfill. Devolve o partnerId quando vinculou.
 */
export async function autoLinkAffiliateByEmail(affiliateId: string, rawEmail: string): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;
  const siblings = await db.affiliate.findMany({
    where: { email, id: { not: affiliateId } },
    select: { id: true, partnerId: true },
  });
  if (!siblings.length) return null;
  const partnerId = siblings.find((s) => s.partnerId)?.partnerId ?? null;
  const ids = [affiliateId, ...siblings.map((s) => s.id)];
  const res = await linkAffiliates(partnerId ? { affiliateIds: [affiliateId], partnerId } : { affiliateIds: ids, email });
  return res.partnerId;
}

/**
 * Backfill: puxa `affiliate_email` do JSON bruto das ordens JVZoo pra
 * Affiliate.email (contas anteriores a esta feature) e roda o auto-vínculo
 * por e-mail em toda a base.
 */
export async function backfillAffiliateEmails(): Promise<{ scanned: number; updated: number; linked: number; partnersCreated: number }> {
  const rows = await db.$queryRaw<Array<{ id: string; email: string | null }>>(Prisma.sql`
    SELECT DISTINCT ON (o."affiliateId")
      o."affiliateId" AS id,
      LOWER(TRIM(o."rawMetadata"->>'affiliate_email')) AS email
    FROM "Order" o
    JOIN "Affiliate" a ON a.id = o."affiliateId"
    JOIN "Platform" pl ON pl.id = o."platformId"
    WHERE pl."slug" = 'jvzoo'
      AND a.email IS NULL
      AND o."rawMetadata" ? 'affiliate_email'
      AND COALESCE(o."rawMetadata"->>'affiliate_email', '') <> ''
    ORDER BY o."affiliateId", o."orderedAt" DESC
  `);
  let updated = 0;
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    if (!email) continue;
    await db.affiliate.update({ where: { id: r.id }, data: { email } });
    updated++;
  }

  // Auto-vínculo global: e-mails com ≥ 2 contas.
  const withEmail = await db.affiliate.findMany({
    where: { email: { not: null } },
    select: { id: true, email: true, partnerId: true },
  });
  const groups = new Map<string, Array<{ id: string; partnerId: string | null }>>();
  for (const a of withEmail) {
    const e = normalizeEmail(a.email);
    if (!e) continue;
    groups.set(e, [...(groups.get(e) ?? []), { id: a.id, partnerId: a.partnerId }]);
  }
  const partnersBefore = await db.affiliatePartner.count();
  let linked = 0;
  for (const [email, list] of groups) {
    if (list.length < 2) continue;
    const partnerIds = new Set(list.map((x) => x.partnerId).filter(Boolean));
    const allSame = partnerIds.size === 1 && list.every((x) => x.partnerId);
    if (allSame) continue;
    try {
      await linkAffiliates({ affiliateIds: list.map((x) => x.id), email });
      linked += list.length;
    } catch (err) {
      logger.warn({ err, email }, '[affiliateIdentity] auto-link falhou');
    }
  }
  const partnersAfter = await db.affiliatePartner.count();
  clearResponseCache();
  return { scanned: rows.length, updated, linked, partnersCreated: Math.max(0, partnersAfter - partnersBefore) };
}
