// Fotos das pesquisas (aba Pesquisas → Configurar → Foto do produto). Só ADMIN.
//
//   GET    /api/admin/surveys/assets              → fotos enviadas + as do código, com onde cada uma é usada
//   POST   /api/admin/surveys/assets  { name, dataBase64, width?, height? }
//          (o dash já reduz no navegador: até 640 px, WebP ou PNG; até 1,5 MB)
//   DELETE /api/admin/surveys/assets?id=<id>      → só foto enviada e sem uso

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { deleteSurveyImage, listSurveyImages, saveSurveyImage } from '@/lib/services/surveyAssets';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ images: await listSurveyImages() });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const res = await saveSurveyImage({ ...body, by: auth.user.email });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logger.info({ id: res.image.id, size: res.image.size, by: auth.user.email }, 'survey image uploaded');
  return NextResponse.json({ image: res.image });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const res = await deleteSurveyImage(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  logger.info({ id, by: auth.user.email }, 'survey image deleted');
  return NextResponse.json({ ok: true });
}
