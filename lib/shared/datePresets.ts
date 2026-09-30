// Períodos da barra de filtros em DIA CIVIL BRT — mesma regra do
// rangeForPreset da SPA (public/src/utils.jsx): "hoje" é o dia do calendário
// em America/Sao_Paulo; o dia X vai de X 03:00Z até X+1 02:59:59.999Z.
// Usado pelo /chat, que antes calculava "30 dias" como now − 30×24h em UTC
// (31 dias, e depois das 21h BRT o fim já caía em amanhã).

export const DATE_PRESETS = [
  { id: 'today', label: 'Hoje' },
  { id: 'yesterday', label: 'Ontem' },
  { id: '7d', label: 'Últimos 7 dias' },
  { id: '30d', label: 'Últimos 30 dias' },
  { id: '90d', label: 'Últimos 90 dias' },
  { id: 'mtd', label: 'Este mês' },
  { id: 'qtd', label: 'Este trimestre' },
  { id: 'ytd', label: 'Este ano' },
] as const;

export type DatePresetId = (typeof DATE_PRESETS)[number]['id'];
export const PRESET_LABEL: Record<string, string> = {
  ...Object.fromEntries(DATE_PRESETS.map((p) => [p.id, p.label])),
  custom: 'Personalizado',
};

export interface BrtRange {
  preset: string;
  /** Primeiro dia (YYYY-MM-DD, civil BRT), inclusivo. */
  start: string;
  /** Último dia (YYYY-MM-DD, civil BRT), inclusivo. */
  end: string;
  /** Instante inicial exato (ISO) — o que as queries usam. */
  startAt: string;
  /** Instante final exato (ISO, .999). */
  endAt: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

function brtToday(now: Date): [number, number, number] {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

/** Dia civil (y, m, d — m 1-based, d pode transbordar) → 'YYYY-MM-DD'. */
function dayStr(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Intervalo de dias civis BRT [from, to] com os instantes exatos. */
export function brtRangeForDays(from: string, to: string, preset = 'custom'): BrtRange {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return {
    preset,
    start: dayStr(fy, fm, fd),
    end: dayStr(ty, tm, td),
    startAt: new Date(Date.UTC(fy, fm - 1, fd, 3, 0, 0, 0)).toISOString(),
    endAt: new Date(Date.UTC(ty, tm - 1, td, 26, 59, 59, 999)).toISOString(),
  };
}

/**
 * Período PERSONALIZADO como a SPA monta (public/src/app.jsx initialRange e
 * DateRangeChip): dia em UTC, from 00:00Z … to 23:59:59.999Z. Os presets são
 * BRT; o personalizado da SPA não — o chat segue a SPA pra responder sobre a
 * mesma janela que a tela mostra.
 */
export function spaCustomRange(from: string, to: string): BrtRange {
  return {
    preset: 'custom',
    start: from,
    end: to,
    startAt: new Date(from + 'T00:00:00.000Z').toISOString(),
    endAt: new Date(to + 'T23:59:59.999Z').toISOString(),
  };
}

/** Preset → intervalo BRT. Preset desconhecido cai em 30d (como a SPA). */
export function brtRangeForPreset(preset: string, now: Date = new Date()): BrtRange {
  const [Y, M, D] = brtToday(now);
  const today = dayStr(Y, M, D);
  const from = (() => {
    switch (preset) {
      case 'today': return today;
      case 'yesterday': return dayStr(Y, M, D - 1);
      case '7d': return dayStr(Y, M, D - 6);
      case '30d': return dayStr(Y, M, D - 29);
      case '90d': return dayStr(Y, M, D - 89);
      case 'mtd': return dayStr(Y, M, 1);
      case 'qtd': return dayStr(Y, Math.floor((M - 1) / 3) * 3 + 1, 1);
      case 'ytd': return dayStr(Y, 1, 1);
      default: return dayStr(Y, M, D - 29);
    }
  })();
  const to = preset === 'yesterday' ? dayStr(Y, M, D - 1) : today;
  const known = DATE_PRESETS.some((p) => p.id === preset);
  return brtRangeForDays(from, to, known ? preset : '30d');
}

/**
 * Filtros da SPA na querystring (mesma codificação de public/src/app.jsx:
 * range, from/to, plat, fam, co, st, aff — listas em CSV) → estado inicial.
 * Custom inválido volta pra 30d, como na SPA.
 */
export function rangeFromQuery(q: { range?: string | null; from?: string | null; to?: string | null }, now: Date = new Date()): BrtRange {
  const preset = q.range || '30d';
  if (preset === 'custom') {
    const from = q.from ?? '';
    const to = q.to ?? '';
    if (ISO_DAY.test(from) && ISO_DAY.test(to) && from <= to) {
      const r = brtRangeForDays(from, to, 'custom');
      // Dia inexistente (2026-02-30, mês 13) normaliza no Date.UTC e pode
      // inverter o intervalo — só aceita datas que voltam iguais.
      if (r.start === from && r.end === to) return r;
    }
    return brtRangeForPreset('30d', now);
  }
  return brtRangeForPreset(preset, now);
}

export function csvList(raw: string | null | undefined): string[] {
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
