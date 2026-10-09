// Backfill do telefone de cliente a partir dos IPNs guardados em IngestLog.
// O conector passou a gravar Customer.phone em 2026-10-09; os clientes
// anteriores ganham o número do aviso mais recente que tinha telefone.
//
// Casa por e-mail normalizado (não pelo id do pedido): o externalId do log e
// o do pedido nem sempre coincidem (Cartpanda é 1 pedido por item, Digistore
// tem linha extra de estorno), mas o e-mail do comprador está em todo aviso.
// Só preenche quem está sem telefone — idempotente e não sobrescreve número
// que chegou depois pelo conector.

import { Prisma } from '@prisma/client';
import { db } from '../db';

// Mesma regra de lib/shared/phone.ts (só dígitos, sem "00", 7–15 dígitos).
const norm = (expr: string) => `CASE WHEN length(regexp_replace(regexp_replace(COALESCE(${expr}, ''), '\\D', '', 'g'), '^00', '')) BETWEEN 7 AND 15
  THEN regexp_replace(regexp_replace(${expr}, '\\D', '', 'g'), '^00', '') END`;

// Onde cada plataforma manda e-mail e telefone do comprador (conferido nos
// IngestLogs de produção em 2026-10-09). Constantes — nunca vêm de fora.
export const PHONE_SOURCES: Record<string, { email: string; phone: string }> = {
  buygoods: { email: `l.payload->>'customer_emailaddress'`, phone: norm(`l.payload->>'customer_phone'`) },
  jvzoo: { email: `l.payload->>'customer_email'`, phone: norm(`l.payload->>'customer_phone'`) },
  digistore24: {
    email: `COALESCE(NULLIF(l.payload->>'buyer_email', ''), l.payload->>'email')`,
    phone: `COALESCE(${norm(`l.payload->>'buyer_address_phone_no'`)}, ${norm(`l.payload->>'address_phone_no'`)}, ${norm(`l.payload->>'billing_phone_no'`)})`,
  },
  cartpanda: {
    email: `COALESCE(NULLIF(l.payload#>>'{order,customer,email}', ''), l.payload#>>'{order,email}')`,
    phone: `COALESCE(${norm(`l.payload#>>'{order,customer,phone}'`)}, ${norm(`l.payload#>>'{order,phone}'`)})`,
  },
  clickbank: {
    email: `COALESCE(NULLIF(l.payload#>>'{customer,billing,email}', ''), l.payload#>>'{customer,shipping,email}')`,
    phone: `COALESCE(${norm(`l.payload#>>'{customer,billing,phoneNumber}'`)}, ${norm(`l.payload#>>'{customer,shipping,phoneNumber}'`)})`,
  },
  salesbound: { email: `l.payload->>'emailAddress'`, phone: norm(`l.payload->>'phoneNumber'`) },
};

/** Telefone mais recente por e-mail nos IPNs de uma plataforma. */
function bestPhoneCte(slug: string): Prisma.Sql {
  const s = PHONE_SOURCES[slug];
  return Prisma.sql`
    WITH src AS (
      SELECT lower(trim(${Prisma.raw(s.email)})) AS email, ${Prisma.raw(s.phone)} AS phone, l."receivedAt" AS at
      FROM "IngestLog" l
      WHERE l."platformSlug" = ${slug}
    ),
    best AS (
      SELECT DISTINCT ON (email) email, phone
      FROM src
      WHERE email LIKE '%@%' AND phone IS NOT NULL
      ORDER BY email, at DESC
    )`;
}

export function customerPhoneBackfillSql(slug: string): { count: Prisma.Sql; update: Prisma.Sql } {
  if (slug === 'salesbound') {
    return {
      count: Prisma.sql`${bestPhoneCte(slug)}
        SELECT COUNT(*)::int AS n FROM "SalesboundTransaction" t JOIN best ON best.email = lower(trim(t.email)) WHERE t.phone IS NULL`,
      update: Prisma.sql`${bestPhoneCte(slug)}
        UPDATE "SalesboundTransaction" t SET phone = best.phone
        FROM best WHERE best.email = lower(trim(t.email)) AND t.phone IS NULL`,
    };
  }
  return {
    count: Prisma.sql`${bestPhoneCte(slug)}
      SELECT COUNT(*)::int AS n
      FROM "Customer" c JOIN "Platform" pl ON pl.id = c."platformId" AND pl.slug = ${slug}
      JOIN best ON best.email = lower(trim(c.email))
      WHERE c.phone IS NULL`,
    update: Prisma.sql`${bestPhoneCte(slug)}
      UPDATE "Customer" c SET phone = best.phone
      FROM best, "Platform" pl
      WHERE pl.slug = ${slug} AND c."platformId" = pl.id AND best.email = lower(trim(c.email)) AND c.phone IS NULL`,
  };
}

export async function backfillCustomerPhones(dryRun: boolean) {
  const out: Record<string, number> = {};
  for (const slug of Object.keys(PHONE_SOURCES)) {
    const q = customerPhoneBackfillSql(slug);
    if (dryRun) {
      const [r] = await db.$queryRaw<Array<{ n: number }>>(q.count);
      out[slug] = r?.n ?? 0;
    } else {
      out[slug] = await db.$executeRaw(q.update);
    }
  }
  return { dryRun, updated: out, total: Object.values(out).reduce((a, b) => a + b, 0) };
}
