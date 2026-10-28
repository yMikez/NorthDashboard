// GET /api/survey/go?t=&o=assinatura|kit|cupom   (público)
//
// Botão do checkout na tela final: registra o clique e redireciona pro link
// da variante com o rastreio src=qz_<resposta>, que volta no postback da
// venda (Order.trackingId). O kit e a faixa do cupom vêm do convite e da
// resposta — a página não escolhe preço.

import { NextResponse } from 'next/server';
import { surveyCheckoutRedirect } from '@/lib/services/surveys';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const target = await surveyCheckoutRedirect(url.searchParams.get('t') ?? '', url.searchParams.get('o') ?? '');
    if (target) return NextResponse.redirect(target, 302);
  } catch (err) {
    logger.error({ err }, 'survey checkout redirect failed');
  }
  return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
