// Edge middleware com 2 responsabilidades:
//
// 1. AUTH GATE: protege rotas HTML redirecionando pra /login quando
//    cookie de sessão está ausente. Não valida o cookie (sem acesso a DB
//    no Edge) — só checa presença. Validade é verificada no Route Handler
//    via getSessionUser().
//
// 2. SPA REWRITE: a app só tem 2 page handlers (app/page.tsx,
//    app/login/page.tsx). Toda navegação interna (/networks, /users,
//    /funnel, ...) é client-side via pushState. Sem rewrite, refresh
//    nessas URLs daria 404 do Next.js. Solução: pra rotas SPA conhecidas
//    (autenticadas), rewriter pra /index.html — Next.js serve o arquivo
//    estático de public/, o SPA boota e lê location.pathname pra rotear.
//    URL no browser não muda (rewrite ≠ redirect).
//
// API routes seguem caminho próprio: cada /api/metrics/* tem seu
// requireTab, /api/admin/* tem requireAdmin, /api/ingest/* tem X-Ingest-Secret.
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
  '/src/',           // SPA chunks estáticos servidos por public/src/*
  '/styles/',
  '/favicon.ico',
];

const PUBLIC_FILE_RE = /\.(?:svg|png|jpg|jpeg|gif|ico|css|js|woff2?|ttf|map|html)$/i;

// Rotas que o SPA reconhece. Refresh em qualquer uma delas faz rewrite
// pra /index.html. Mantenha em sync com ROUTES no public/index.html.
// Rotas desconhecidas continuam dando 404 (sinaliza erro real).
const SPA_ROUTES = new Set([
  '/',
  '/overview',
  '/funnel',
  '/leaderboard',
  '/all-affiliates',
  '/networks',
  '/products',
  '/transactions',
  '/platforms',
  '/health',
  '/costs',
  '/insights',
  '/users',
  '/network',          // partner shell base
]);

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

  // Rota SPA conhecida (com session válida) → serve o index.html mantendo
  // a URL. SPA lê pathname e roteia client-side.
  if (SPA_ROUTES.has(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/index.html';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
