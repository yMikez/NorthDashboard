// Cadastro das pesquisas (aba Pesquisas → "Ofertas e textos"). Só ADMIN: o
// que entra aqui é preço e link de checkout que o cliente vê.
//
//   GET   /api/admin/surveys/variants                → todas, com a configuração
//   PATCH /api/admin/surveys/variants  { slug, active?, name?, config? }
//
// A configuração passa por sanitizeVariantConfig (lib/surveys/variantConfig.ts).

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { listSurveyVariantsAdmin, updateSurveyVariant } from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ variants: await listSurveyVariantsAdmin() });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const res = await updateSurveyVariant(String(body.slug ?? ''), { active: body.active, name: body.name, config: body.config });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logger.info({ slug: res.variant.slug, version: res.variant.version, by: auth.user.email }, 'survey variant updated');
  return NextResponse.json({ variant: res.variant });
}
