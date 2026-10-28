// Caminho público da pesquisa: checkin.<domínio>/<slug>/<token>.
//
// O middleware reescreve esse caminho pra /api/survey/page, mas o handler da
// rota recebe a URL ORIGINAL do pedido (a query da reescrita não chega). Por
// isso a rota lê slug e token do caminho quando a query não traz o token.

export const SURVEY_PATH_RE = /^\/([a-z0-9-]{1,60})\/([A-Za-z0-9_-]{16,64})\/?$/;

export function surveyPageParams(url: URL): { slug: string; token: string } {
  const m = SURVEY_PATH_RE.exec(url.pathname);
  if (m && !url.searchParams.has('t')) return { slug: m[1], token: m[2] };
  return { slug: url.searchParams.get('slug') ?? '', token: url.searchParams.get('t') ?? '' };
}
