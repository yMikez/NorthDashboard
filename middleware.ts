// Edge middleware: protege rotas HTML (/, /index.html, /xyz) redirecionando
// pra /login quando o cookie de sessão está ausente. Não valida o cookie
// (sem acesso a DB no Edge) — só checa presença. Validade é verificada
// no Route Handler via getSessionUser().
//
// API routes seguem caminho próprio: cada /api/metrics/* tem seu requireTab,
// /api/admin/* tem requireAdmin (ou bearer), /api/ingest/* tem X-Ingest-Secret.
// Middleware NÃO interfere em /api/* — deixa o handler decidir o status.

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'ns_session';

// Paths que continuam públicos mesmo sem sessão.
const PUBLIC_PREFIXES = [
  '/login',
  '/api/',           // todas as APIs decidem auth no handler
  '/_next/',
  '/assets/',
  '/uploads/',
  '/src/',           // SPA estático em /public/src/* serve via Next; mas o
                     // shell.html só carrega depois do redirect, então só os
                     // arquivos de SUPORTE (img, css, etc) deviam estar aqui.
                     // O index.html principal vai ser servido via app/page.tsx
                     // (a ser implementado na Fase 2). Por enquanto preserva
                     // acesso aos chunks do SPA.
  '/favicon.ico',
];

const PUBLIC_FILE_RE = /\.(?:svg|png|jpg|jpeg|gif|ico|css|js|woff2?|ttf|map)$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (PUBLIC_FILE_RE.test(pathname)) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE);
  if (!cookie?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
