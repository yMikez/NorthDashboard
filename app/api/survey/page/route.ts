// GET /api/survey/page?slug=&t=   (público — o middleware reescreve
// checkin.<domínio>/<slug>/<token> pra cá)
// GET /api/survey/page?slug=&preview=1   (pré-visualização, sessão do dash)
//
// Devolve o HTML pronto da pesquisa (lib/surveys/render.ts).

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';
import { surveyPageHtml, surveyPreviewHtml } from '@/lib/services/surveys';
import { renderSurveyInvalid } from '@/lib/surveys/render';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  try {
    if (url.searchParams.get('preview') === '1') {
      const auth = await requireAuth();
      if (!auth.ok) return auth.response;
      const html = await surveyPreviewHtml(slug);
      return new NextResponse(html ?? renderSurveyInvalid(null), { status: html ? 200 : 404, headers: HEADERS });
    }
    const { status, html } = await surveyPageHtml(slug, url.searchParams.get('t') ?? '');
    return new NextResponse(html, { status, headers: HEADERS });
  } catch (err) {
    logger.error({ err, slug }, 'survey page failed');
    return new NextResponse(renderSurveyInvalid(null), { status: 500, headers: HEADERS });
  }
}
