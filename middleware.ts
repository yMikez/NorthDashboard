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
// pra /index.html. Mantenha em sync com ROUTES no public/src/app.jsx.
// Rotas desconhecidas continuam dando 404 (sinaliza erro real).
const SPA_ROUTES = new Set([
  '/',
  '/overview',
  '/funnel',
  '/vsl',
  '/refund-cohorts',
  '/leaderboard',
  '/all-affiliates',
  '/affiliate-analysis',
  '/affiliate-crm',
  '/networks',
  '/products',
  '/transactions',
  '/platforms',
  '/health',
  '/users',
  '/recovery',
  '/tauk',
  '/leads',
  '/surveys',
  '/net-profit',
  // Abas removidas em 2026-10-03: link salvo abre a Visão geral (a SPA cai
  // no overview pra rota desconhecida) em vez de 404.
  '/costs',
  '/custos',
  '/sms',
  '/copy-optimizer',
  // /chat foi MIGRADO pra Next.js native route (app/chat/page.tsx)
  // com TS + Tailwind + shadcn. Não rewriter — deixa o Next.js servir.
]);

// Domínio público das pesquisas (checkin.<domínio>/<variante>/<token>): ali
// só existe a página do quiz — qualquer outro caminho cai na tela de link
// inválido. As APIs desse domínio são filtradas no Caddy (só /api/survey/*).
const SURVEY_HOSTS = new Set(
  (process.env.SURVEY_HOSTS ?? 'checkin.healthnwellnes.com').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
);
const SURVEY_PATH_RE = /^\/([a-z0-9-]{1,60})\/([A-Za-z0-9_-]{16,64})\/?$/;

function surveyHost(req: NextRequest): NextResponse {
  // Fotos dos produtos (public/survey-assets) — o resto do public/ não existe aqui.
  if (/^\/survey-assets\/[\w.-]+$/.test(req.nextUrl.pathname)) return NextResponse.next();
  const m = SURVEY_PATH_RE.exec(req.nextUrl.pathname);
  const url = req.nextUrl.clone();
  url.pathname = '/api/survey/page';
  url.search = m ? `?slug=${m[1]}&t=${m[2]}` : '?slug=';
  return NextResponse.rewrite(url);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (SURVEY_HOSTS.has(host)) return surveyHost(req);
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
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
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
  // /api/ fora do matcher: o middleware não faz nada lá (PUBLIC_PREFIXES) e,
  // passando por ele, o Next clona o corpo do POST com teto de 10 MB — upload
  // de anexo maior chegava CORTADO no handler, sem erro (somas erradas).
  matcher: ['/((?!_next/static|_next/image|api/).*)'],
};
