// Parser dos query params da Análise de afiliados — compartilhado pelas
// rotas /api/metrics/affiliate-analysis e /explain. Vive fora de route.ts
// de propósito: o Next só aceita exports HTTP em arquivos de rota (o
// next-types-plugin falha o build com export extra).

import { csvParam } from './queryParams';
import { isWindowDays, type WindowDays } from '../services/affiliateAnalysisCore';

export interface ParsedAnalysisParams {
  window: WindowDays | null;
  view: 'partner' | 'platform';
  includeInternal: boolean;
  includeToday: boolean;
  platformSlugs?: string[];
  families?: string[];
}

export function parseAnalysisParams(searchParams: URLSearchParams): ParsedAnalysisParams {
  const window = Number.parseInt(searchParams.get('window') ?? '7', 10);
  return {
    window: isWindowDays(window) ? window : null,
    view: searchParams.get('view') === 'platform' ? 'platform' : 'partner',
    includeInternal: searchParams.get('internal') === '1',
    includeToday: searchParams.get('today') === '1',
    platformSlugs: csvParam(searchParams.get('platforms')),
    families: csvParam(searchParams.get('families')),
  };
}
