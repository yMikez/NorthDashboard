// GET /api/survey/asset/<id>   (público — a foto do produto na página da pesquisa)
// Foto enviada pelo dash (SurveyAsset). O id nunca muda de conteúdo: cache longo.

import { NextResponse } from 'next/server';
import { getSurveyAssetBytes } from '@/lib/services/surveyAssets';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w-]{8,40}$/.test(id)) return new NextResponse(null, { status: 404 });
  try {
    const a = await getSurveyAssetBytes(id);
    if (!a) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(a.bytes), {
      status: 200,
      headers: {
        'Content-Type': a.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    logger.error({ err, id }, 'survey asset failed');
    return new NextResponse(null, { status: 500 });
  }
}
