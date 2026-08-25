// Parser dos query params da Análise de afiliados — compartilhado pelas
// rotas /api/metrics/affiliate-analysis, /explain e /sequence. Vive fora
// de route.ts de propósito: o Next só aceita exports HTTP em arquivos de
// rota (o next-types-plugin falha o build com export extra).

import { csvParam } from './queryParams';
import { isValidWindow } from '../services/affiliateAnalysisCore';

export interface ParsedAnalysisParams {
  window: number | null;       // 1..90 (presets 3/7/15/30/60 ou personalizado)
  count: number;               // janelas em sequência (2..8)
  anchor: string | undefined;  // YYYY-MM-DD: último dia da janela (personalizado); undefined = ontem/hoje
  view: 'partner' | 'platform';
  includeInternal: boolean;
  includeToday: boolean;
  platformSlugs?: string[];
  families?: string[];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
// Dia de calendário real (2026-02-30 não passa) e ano plausível — o input
// type=date do Chrome emite anos parciais (0002, 0020, 0202) enquanto o
// usuário digita; sem o piso cada tecla virava uma query de 700 dias.
function validAnchor(raw: string): string | undefined {
  if (!YMD.test(raw)) return undefined;
  const t = Date.parse(raw + 'T00:00:00Z');
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== raw) return undefined;
  if (Number.parseInt(raw.slice(0, 4), 10) < 2024) return undefined;
  return raw;
}

export function parseAnalysisParams(searchParams: URLSearchParams): ParsedAnalysisParams {
  const window = Number.parseInt(searchParams.get('window') ?? '7', 10);
  const countRaw = Number.parseInt(searchParams.get('count') ?? '3', 10);
  const anchorRaw = (searchParams.get('anchor') ?? '').trim();
  return {
    window: isValidWindow(window) ? window : null,
    count: Number.isInteger(countRaw) ? Math.min(Math.max(countRaw, 2), 8) : 3,
    anchor: validAnchor(anchorRaw),
    view: searchParams.get('view') === 'platform' ? 'platform' : 'partner',
    includeInternal: searchParams.get('internal') === '1',
    includeToday: searchParams.get('today') === '1',
    platformSlugs: csvParam(searchParams.get('platforms')),
    families: csvParam(searchParams.get('families')),
  };
}
