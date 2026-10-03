// Catálogo da aba VSLs: etapas do funil, chave da página e formato do pitch.
// Puro (sem banco) — usado pelo servidor, pelo loader e pelos testes.

export const VSL_STAGES = [
  { id: 'UP01', label: 'Upsell 1', productType: 'UPSELL', step: 2 },
  { id: 'UP02', label: 'Upsell 2', productType: 'UPSELL', step: 3 },
  { id: 'UP03', label: 'Upsell 3', productType: 'UPSELL', step: 4 },
  { id: 'DOWN01', label: 'Downsell 1', productType: 'DOWNSELL', step: 2 },
  { id: 'DOWN02', label: 'Downsell 2', productType: 'DOWNSELL', step: 3 },
  { id: 'DOWN03', label: 'Downsell 3', productType: 'DOWNSELL', step: 4 },
] as const;

export type VslStage = (typeof VSL_STAGES)[number]['id'];

export function isVslStage(s: unknown): s is VslStage {
  return typeof s === 'string' && VSL_STAGES.some((x) => x.id === s);
}

export function stageSpec(stage: VslStage) {
  return VSL_STAGES.find((s) => s.id === stage)!;
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
}

/** glycoeden-up01-jvzoo — vai no snippet e na URL do script. */
export function pageKeyFor(family: string, stage: VslStage, platform: string): string {
  return `${slug(family) || 'produto'}-${stage.toLowerCase()}-${slug(platform) || 'plataforma'}`;
}

export const PAGE_KEY_RE = /^[a-z0-9]{1,40}-(?:up|down)0[1-3]-[a-z0-9]{1,40}$/;

/** 327 → "5:27"; 3725 → "1:02:05". */
export function formatPitch(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** "5:27" | "05:27" | "1:02:05" | "327" → segundos; null se inválido. */
export function parsePitch(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 && raw <= 6 * 3600 ? raw : null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (/^\d+$/.test(t)) return parsePitch(Number(t));
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(t);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s > 59 || (m[1] != null && mi > 59)) return null;
  return parsePitch(h * 3600 + mi * 60 + s);
}
