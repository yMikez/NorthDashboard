// Parser PURO da resposta de GET /api/retencao do SendTrace (contrato
// proposto em RESPOSTA_SENDTRACE.md §4 e aceito por eles em 25/09).
//
// Formato esperado:
//   { "itens": [ { id, transacao_id, plataforma, email, degrau_oferecido,
//                  degrau_aceito, valor_preservado_usd, status,
//                  ocorrido_em, atualizado_em } ],
//     "next_updated_since": "2026-09-22T14:03:00Z" }
//
// Regra: item inválido é DESCARTADO com motivo — nunca derruba a página
// inteira. Um campo que eles renomeiem quebra uma linha, não a sincronização.
// Aceita alguns apelidos porque o endpoint ainda não existe do lado deles e
// o contrato foi escrito antes da implementação.

export type RetentionStatus = 'oferecido' | 'aceito' | 'recusado';

export interface RetentionItem {
  externalId: string;
  transactionId: string;
  platform: string;
  email: string | null;
  stepOffered: string | null;
  stepAccepted: string | null;
  preservedUsd: number;
  status: RetentionStatus;
  occurredAt: Date;
  sourceUpdatedAt: Date;
  raw: unknown;
}

export interface RetentionPage {
  items: RetentionItem[];
  dropped: Array<{ id: string; reason: string }>;
  nextUpdatedSince: string | null;
}

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const pick = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return null;
};

const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const money = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100) / 100;
};

/** Normaliza o status; tolera o vocabulário em inglês. */
export function parseStatus(v: unknown): RetentionStatus | null {
  const s = (str(v) ?? '').toLowerCase();
  if (!s) return null;
  if (s.startsWith('aceit') || s === 'accepted') return 'aceito';
  if (s.startsWith('recus') || s === 'declined' || s === 'rejected') return 'recusado';
  if (s.startsWith('ofer') || s === 'offered') return 'oferecido';
  return null;
}

export function parseRetentionPage(body: unknown): RetentionPage {
  const out: RetentionPage = { items: [], dropped: [], nextUpdatedSince: null };
  if (!body || typeof body !== 'object') {
    out.dropped.push({ id: '?', reason: 'resposta não é um objeto JSON' });
    return out;
  }
  const b = body as Record<string, unknown>;
  out.nextUpdatedSince = pick(b, ['next_updated_since', 'proximo_updated_since']);
  const list = Array.isArray(b.itens) ? b.itens : Array.isArray(b.items) ? b.items : null;
  if (!list) {
    out.dropped.push({ id: '?', reason: 'resposta sem a lista `itens`' });
    return out;
  }

  for (const item of list) {
    if (!item || typeof item !== 'object') { out.dropped.push({ id: '?', reason: 'item não é objeto' }); continue; }
    const it = item as Record<string, unknown>;
    const externalId = pick(it, ['id', 'retencao_id', 'external_id']);
    if (!externalId) { out.dropped.push({ id: '?', reason: 'sem id' }); continue; }
    const transactionId = pick(it, ['transacao_id', 'transaction_id', 'externalId', 'pedido_id']);
    if (!transactionId) { out.dropped.push({ id: externalId, reason: 'sem transacao_id — não dá pra auditar por pedido' }); continue; }
    const platform = (pick(it, ['plataforma', 'platform']) ?? '').toLowerCase();
    if (!platform) { out.dropped.push({ id: externalId, reason: 'sem plataforma' }); continue; }
    const status = parseStatus(it.status);
    if (!status) { out.dropped.push({ id: externalId, reason: `status desconhecido: ${String(it.status)}` }); continue; }
    const occurredAt = date(it.ocorrido_em ?? it.occurred_at ?? it.data);
    if (!occurredAt) { out.dropped.push({ id: externalId, reason: 'ocorrido_em inválido' }); continue; }
    // Sem atualizado_em o pull incremental não anda; cai no ocorrido_em.
    const sourceUpdatedAt = date(it.atualizado_em ?? it.updated_at) ?? occurredAt;

    out.items.push({
      externalId,
      transactionId,
      platform,
      email: pick(it, ['email', 'cliente_email']),
      stepOffered: pick(it, ['degrau_oferecido', 'step_offered']),
      stepAccepted: pick(it, ['degrau_aceito', 'step_accepted']),
      // Recusado não preserva nada, mesmo que mandem valor.
      preservedUsd: status === 'aceito' ? money(it.valor_preservado_usd ?? it.preserved_usd) : 0,
      status,
      occurredAt,
      sourceUpdatedAt,
      raw: item,
    });
  }
  return out;
}

/** Maior `atualizado_em` da página — marcador do próximo pull (inclusivo). */
export function maxSourceUpdatedAt(items: RetentionItem[]): Date | null {
  let max: Date | null = null;
  for (const i of items) if (!max || i.sourceUpdatedAt > max) max = i.sourceUpdatedAt;
  return max;
}
