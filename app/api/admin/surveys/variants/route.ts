// Cadastro das pesquisas (aba Pesquisas → "Configurar"). Só ADMIN: o que
// entra aqui é preço e link de checkout que o cliente vê.
//
//   GET   /api/admin/surveys/variants                → todas, com a configuração + texto padrão
//   POST  /api/admin/surveys/variants  { slug, name, family, productName?, from? }
//         pesquisa nova copiada de `from` (nasce desligada)
//   PATCH /api/admin/surveys/variants  { slug, active?, name?, family?, config? }
//
// A configuração passa por sanitizeVariantConfig (lib/surveys/variantConfig.ts).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import {
  createSurveyVariant, listSurveyVariantsAdmin, surveyCopyDefaults, updateSurveyVariant,
} from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ variants: await listSurveyVariantsAdmin(), copyDefaults: surveyCopyDefaults() });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await bodyOf(req);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const res = await createSurveyVariant(body);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logger.info({ slug: res.variant.slug, from: body.from, by: auth.user.email }, 'survey variant created');
  return NextResponse.json({ variant: res.variant });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = await bodyOf(req);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const res = await updateSurveyVariant(String(body.slug ?? ''), {
    active: body.active, name: body.name, family: body.family, config: body.config,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logger.info({ slug: res.variant.slug, version: res.variant.version, by: auth.user.email }, 'survey variant updated');
  return NextResponse.json({ variant: res.variant });
}
