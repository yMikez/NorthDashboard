// Lê o código de embed do VTurb colado no dash. Guarda SÓ os ids que
// importam (conta, player, proporção) — nunca o HTML colado: o script que
// vai pra página é montado por nós, sempre apontando pro domínio do VTurb.

export interface VturbEmbed {
  accountId: string;
  playerId: string;
  scriptUrl: string;
  /** padding-top do placeholder (133.333 = 3:4 vertical, 56.25 = 16:9). */
  aspectPct: number | null;
}

const SCRIPT_RE =
  /https:\/\/scripts\.converteai\.net\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/players\/([0-9a-f]{24})\/(v\d{1,2})\/player\.js/i;
const ELEMENT_ID_RE = /\bid\s*=\s*["']vid-([0-9a-f]{24})["']/i;
const PADDING_RE = /padding\s*:\s*([\d.]+)%\s+0(?:px)?\s+0/i;

export function parseVturbEmbed(raw: unknown): { ok: true; embed: VturbEmbed } | { ok: false; error: string } {
  const code = typeof raw === 'string' ? raw.trim() : '';
  if (!code) return { ok: false, error: 'Cole o código de embed do VTurb.' };
  if (code.length > 20_000) return { ok: false, error: 'Código grande demais — cole só o embed do player.' };

  const m = SCRIPT_RE.exec(code);
  if (!m) {
    return ELEMENT_ID_RE.test(code)
      ? { ok: false, error: 'Faltou a parte do <script> com o player.js (scripts.converteai.net/…/player.js). Cole o embed inteiro.' }
      : { ok: false, error: 'Não achei um player do VTurb aqui. O código precisa ter o endereço scripts.converteai.net/…/players/…/player.js.' };
  }
  const accountId = m[1].toLowerCase();
  const playerId = m[2].toLowerCase();
  const version = m[3].toLowerCase();

  const el = ELEMENT_ID_RE.exec(code);
  if (el && el[1].toLowerCase() !== playerId) {
    return { ok: false, error: `O elemento é vid-${el[1]} mas o script é do player ${playerId}. Copie o embed de novo no VTurb.` };
  }

  let aspectPct: number | null = null;
  const p = PADDING_RE.exec(code);
  if (p) {
    const v = Number(p[1]);
    if (Number.isFinite(v) && v >= 20 && v <= 300) aspectPct = Math.round(v * 1000) / 1000;
  }

  return {
    ok: true,
    embed: {
      accountId,
      playerId,
      scriptUrl: `https://scripts.converteai.net/${accountId}/players/${playerId}/${version}/player.js`,
      aspectPct,
    },
  };
}

/** "vertical" (3:4, 9:16), "horizontal" (16:9) ou "quadrado". */
export function aspectLabel(aspectPct: number | null | undefined): string {
  if (aspectPct == null) return '—';
  if (aspectPct > 110) return 'vertical';
  if (aspectPct < 90) return 'horizontal';
  return 'quadrado';
}
