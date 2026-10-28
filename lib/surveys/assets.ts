// Fotos das páginas de pesquisa: as que vêm no código (public/survey-assets)
// e as enviadas pelo dash (SurveyAsset, servidas em /api/survey/asset/<id>).

export const SURVEY_ASSET_MAX_BYTES = 1_500_000;
export const SURVEY_ASSET_URL_RE = /^\/api\/survey\/asset\/([\w-]{8,40})$/;
export const SURVEY_STATIC_IMAGE_RE = /^\/survey-assets\/[\w.-]+$/;

export const surveyAssetUrl = (id: string) => `/api/survey/asset/${id}`;

/** Caminho de foto que a página aceita (as do código ou uma enviada pelo dash). */
export function isSurveyImagePath(p: unknown): p is string {
  return typeof p === 'string' && (SURVEY_STATIC_IMAGE_RE.test(p) || SURVEY_ASSET_URL_RE.test(p));
}

/** Tipo pelo conteúdo (não pelo nome nem pelo que o navegador diz): só WebP, PNG e JPEG. */
export function sniffImage(buf: Uint8Array): 'image/webp' | 'image/png' | 'image/jpeg' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 8 && buf[0] === 0x89 && ascii(1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}
