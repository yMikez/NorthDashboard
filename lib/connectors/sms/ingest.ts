// Normalização dos eventos de telemetria SMS (Mautic → n8n → Twilio).
// Discrimina os 5 formatos pelo `event_type` e converte pro shape do
// model SmsEvent / SmsCampaign.
//
// Validação DE PROPÓSITO frouxa: campo faltando vira null, campo extra
// fica só no `raw` — o gateway evolui e a ingestão não pode quebrar
// (regra do briefing: nunca rejeitar payload por schema estrito).

export type SmsEventKind = 'sms_sent' | 'sms_skipped' | 'sms_status' | 'sms_stop';

const EVENT_KINDS = new Set<string>(['sms_sent', 'sms_skipped', 'sms_status', 'sms_stop']);

export interface SmsEventRow {
  eventType: SmsEventKind;
  messageSid: string | null;
  campaign: string | null;
  brand: string | null;
  subIndex: number | null;
  status: string | null;
  errorCode: number | null;
  reason: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  occurredAt: Date;
}

export interface SmsCatalogCampaign {
  mauticId: number;
  name: string;
  slug: string | null;
  isPublished: boolean;
  category: string | null;
  mauticCreatedAt: Date | null;
  mauticModifiedAt: Date | null;
  raw: Record<string, unknown>;
}

export type ParsedSmsPayload =
  | { kind: 'event'; row: SmsEventRow }
  | { kind: 'catalog'; syncedAt: Date; campaigns: SmsCatalogCampaign[] }
  | { kind: 'unknown'; eventType: string };

// Convenção de vínculo catálogo ↔ eventos: o slug entre colchetes no name
// da campanha do Mautic ("Reposição NeuroMind [neuromind-reposicao-01]")
// é igual ao campo `campaign` dos eventos.
const SLUG_RE = /\[([a-z0-9-]+)\]/;

export function extractCampaignSlug(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = SLUG_RE.exec(name);
  return m ? m[1] : null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function int(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return fallback;
}

// Timestamp tolerante: inválido/ausente cai pro relógio do servidor —
// perder o horário exato é melhor que perder o evento.
function date(v: unknown, fallback?: Date): Date | null {
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback ?? null;
}

export function parseSmsPayload(data: Record<string, unknown>): ParsedSmsPayload {
  const eventType = str(data.event_type) ?? 'unknown';

  if (eventType === 'campaign_catalog') {
    const syncedAt = date(data.synced_at, new Date()) as Date;
    const list = Array.isArray(data.campaigns) ? data.campaigns : [];
    const campaigns: SmsCatalogCampaign[] = [];
    for (const item of list) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
      const c = item as Record<string, unknown>;
      const mauticId = int(c.mautic_id);
      const name = str(c.name);
      // Sem id não tem chave de upsert; sem name não tem o que exibir.
      if (mauticId == null || name == null) continue;
      campaigns.push({
        mauticId,
        name,
        slug: extractCampaignSlug(name),
        isPublished: bool(c.is_published, true),
        category: str(c.category),
        mauticCreatedAt: date(c.created),
        mauticModifiedAt: date(c.modified),
        raw: c,
      });
    }
    return { kind: 'catalog', syncedAt, campaigns };
  }

  if (!EVENT_KINDS.has(eventType)) {
    return { kind: 'unknown', eventType };
  }

  const kind = eventType as SmsEventKind;
  const row: SmsEventRow = {
    eventType: kind,
    messageSid: str(data.message_sid),
    campaign: str(data.campaign),
    brand: str(data.brand),
    subIndex: int(data.sub_index),
    status: kind === 'sms_status' ? str(data.status) : null,
    errorCode: kind === 'sms_status' ? int(data.error_code) : null,
    reason: kind === 'sms_skipped' ? str(data.reason) : null,
    // sent/status: `to` é o lead, `from` é o nosso número.
    // sms_stop: `from` é o lead, `to` é o NOSSO número (identifica a marca).
    fromNumber: str(data.from),
    toNumber: str(data.to),
    occurredAt: date(data.occurred_at, new Date()) as Date,
  };
  return { kind: 'event', row };
}
