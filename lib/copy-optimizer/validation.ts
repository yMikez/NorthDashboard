// Validação PURA dos inputs de AffiliateCopyRule (create/patch). Sem I/O —
// testável isolada. As rotas admin chamam esses validadores antes de tocar o DB.

export type Result<T> = { error: string } | { value: T };

export interface RuleCreateValue {
  key: string;
  keyType: 'id' | 'name';
  black2Pct: number;
  enabled: boolean;
  autotune: boolean;
  minPct: number;
  maxPct: number;
  stepPct: number;
  targetAov: number | null;
}

// Campos editáveis num PATCH. key/keyType são identidade — não mudam.
export type RulePatchValue = Partial<Omit<RuleCreateValue, 'key' | 'keyType'>>;

function asInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}

function pctInRange(n: number): boolean {
  return n >= 0 && n <= 100;
}

/** Valida targetAov: null/ausente ok, senão número > 0. */
function parseTargetAov(v: unknown): Result<number | null> {
  if (v === null || v === undefined || v === '') return { value: null };
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return { error: 'targetAov deve ser número > 0 ou null' };
  return { value: Math.round(n * 100) / 100 };
}

/** Coerência entre min/max/step. Exportado pra rota revalidar pós-merge. */
export function railsError(minPct: number, maxPct: number, stepPct: number): string | null {
  if (!pctInRange(minPct)) return 'minPct deve estar entre 0 e 100';
  if (!pctInRange(maxPct)) return 'maxPct deve estar entre 0 e 100';
  if (minPct > maxPct) return 'minPct não pode ser maior que maxPct';
  if (stepPct < 1 || stepPct > 100) return 'stepPct deve estar entre 1 e 100';
  return null;
}

export function validateRuleCreate(raw: unknown): Result<RuleCreateValue> {
  if (typeof raw !== 'object' || raw === null) return { error: 'body inválido' };
  const b = raw as Record<string, unknown>;

  const key = typeof b.key === 'string' ? b.key.trim() : '';
  if (!key) return { error: 'key obrigatória' };

  if (b.keyType !== 'id' && b.keyType !== 'name') {
    return { error: "keyType deve ser 'id' ou 'name'" };
  }
  const keyType = b.keyType;

  const black2Pct = asInt(b.black2Pct);
  if (black2Pct === null || !pctInRange(black2Pct)) {
    return { error: 'black2Pct deve ser inteiro entre 0 e 100' };
  }

  const minPct = b.minPct === undefined ? 0 : asInt(b.minPct);
  const maxPct = b.maxPct === undefined ? 80 : asInt(b.maxPct);
  const stepPct = b.stepPct === undefined ? 5 : asInt(b.stepPct);
  if (minPct === null || maxPct === null || stepPct === null) {
    return { error: 'min/max/stepPct devem ser inteiros' };
  }
  const railsErr = railsError(minPct, maxPct, stepPct);
  if (railsErr) return { error: railsErr };

  const targetAov = parseTargetAov(b.targetAov);
  if ('error' in targetAov) return { error: targetAov.error };

  return {
    value: {
      key,
      keyType,
      black2Pct,
      enabled: asBool(b.enabled, true),
      autotune: asBool(b.autotune, false),
      minPct,
      maxPct,
      stepPct,
      targetAov: targetAov.value,
    },
  };
}

export function validateRulePatch(raw: unknown): Result<RulePatchValue> {
  if (typeof raw !== 'object' || raw === null) return { error: 'body inválido' };
  const b = raw as Record<string, unknown>;
  const out: RulePatchValue = {};

  if ('black2Pct' in b) {
    const n = asInt(b.black2Pct);
    if (n === null || !pctInRange(n)) return { error: 'black2Pct deve ser inteiro entre 0 e 100' };
    out.black2Pct = n;
  }
  if ('enabled' in b) out.enabled = asBool(b.enabled, true);
  if ('autotune' in b) out.autotune = asBool(b.autotune, false);

  if ('minPct' in b) {
    const n = asInt(b.minPct);
    if (n === null) return { error: 'minPct deve ser inteiro' };
    out.minPct = n;
  }
  if ('maxPct' in b) {
    const n = asInt(b.maxPct);
    if (n === null) return { error: 'maxPct deve ser inteiro' };
    out.maxPct = n;
  }
  if ('stepPct' in b) {
    const n = asInt(b.stepPct);
    if (n === null) return { error: 'stepPct deve ser inteiro' };
    out.stepPct = n;
  }

  // Rails só são checados quando todos os três estão definidos (combina o que
  // veio no patch com o que já existe — a rota resolve os ausentes antes).
  if (out.minPct !== undefined && out.maxPct !== undefined && out.stepPct !== undefined) {
    const railsErr = railsError(out.minPct, out.maxPct, out.stepPct);
    if (railsErr) return { error: railsErr };
  }

  if ('targetAov' in b) {
    const t = parseTargetAov(b.targetAov);
    if ('error' in t) return { error: t.error };
    out.targetAov = t.value;
  }

  if (Object.keys(out).length === 0) return { error: 'nada pra atualizar' };
  return { value: out };
}
