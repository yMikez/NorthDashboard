// Handlers dos endpoints que o dashboard EXPÕE pro NorthScale Afiliados
// (contrato §6 webhook e §7 metrics), independentes do Next.js: recebem
// uma requisição mínima + dependências injetáveis e devolvem
// {status, body, headers}. As rotas em app/api/integrations/* só adaptam
// pra NextResponse. Assim os testes cobrem auth, idempotência, formato e
// cache sem subir servidor nem banco.

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  parseAffiliateState, pickFirstHeader, resolvePeriod,
  type AffiliateStateInput, type AffiliateMetricsOut,
} from './affiliateMappingCore';
import type { ApplyResult } from './affiliateMapping';
import type { MetricsCache } from './affiliateMetricsExport';

export interface HandlerResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface IntegrationRequest {
  header(name: string): string | null;
  json(): Promise<unknown>;
}

// ---------------------------------------------------------------------
// X-Api-Key em tempo constante (espelho do ApiKeyGuard deles: sha256 dos
// dois lados + timingSafeEqual, independente do tamanho).
// ---------------------------------------------------------------------
export function checkIntegrationKey(received: string | null | undefined, expected: string | null | undefined): boolean {
  const exp = (expected ?? '').trim();
  if (!exp) return false;
  const rec = pickFirstHeader(received);
  if (!rec) return false;
  const a = createHash('sha256').update(rec).digest();
  const b = createHash('sha256').update(exp).digest();
  return timingSafeEqual(a, b);
}

export type AuthOutcome = { ok: true } | { ok: false; response: HandlerResponse };

export async function authorizeIntegration(req: { header(name: string): string | null }, inboundKey: () => Promise<string | null>): Promise<AuthOutcome> {
  const expected = await inboundKey();
  if (!expected) {
    return { ok: false, response: { status: 503, body: { statusCode: 503, message: 'Integração não configurada no servidor', error: 'Service Unavailable' } } };
  }
  if (!checkIntegrationKey(req.header('x-api-key'), expected)) {
    return { ok: false, response: { status: 401, body: { statusCode: 401, message: 'Chave de integração inválida', error: 'Unauthorized' } } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// POST …/webhook — affiliate.updated
// ---------------------------------------------------------------------
export interface WebhookDeps {
  inboundKey: () => Promise<string | null>;
  applyState: (state: AffiliateStateInput) => Promise<ApplyResult>;
  // Auditoria (IngestLog). Best-effort: erro aqui não muda a resposta.
  log?: (entry: { eventId: string | null; attempt: string | null; body: unknown; ok: boolean; note: string | null }) => Promise<void>;
}

/**
 * Regras do contrato: 2xx sempre que o evento foi processado OU
 * deliberadamente ignorado (corpo inválido, evento desconhecido, estado
 * mais antigo); não-2xx só quando "não consegui agora, mande de novo"
 * (erro de banco). Corpo = estado COMPLETO → substituição, nunca acréscimo.
 */
export async function handleAffiliateWebhook(req: IntegrationRequest, deps: WebhookDeps): Promise<HandlerResponse> {
  const auth = await authorizeIntegration(req, deps.inboundKey);
  if (!auth.ok) return auth.response;

  const eventId = pickFirstHeader(req.header('x-event-id')) || null;
  const attempt = pickFirstHeader(req.header('x-webhook-attempt')) || null;
  const eventType = pickFirstHeader(req.header('x-event-type')) || null;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await safeLog(deps, { eventId, attempt, body: null, ok: false, note: 'corpo não é JSON' });
    // Reenviar o mesmo corpo quebrado não ajuda — 200 + ignored (§6).
    return { status: 200, body: { ok: true, ignored: 'invalid-json' } };
  }
  const bodyEvent = body && typeof body === 'object' ? (body as Record<string, unknown>).event : undefined;
  const ev = typeof bodyEvent === 'string' ? bodyEvent : eventType;
  if (ev && ev !== 'affiliate.updated') {
    await safeLog(deps, { eventId, attempt, body, ok: true, note: `evento ignorado: ${ev}` });
    return { status: 200, body: { ok: true, ignored: 'unknown-event', event: ev } };
  }
  const parsed = parseAffiliateState(body);
  if (!parsed.ok) {
    await safeLog(deps, { eventId, attempt, body, ok: false, note: parsed.error });
    return { status: 200, body: { ok: true, ignored: 'invalid-payload', error: parsed.error } };
  }
  try {
    const result = await deps.applyState(parsed.state);
    await safeLog(deps, {
      eventId, attempt, body, ok: true,
      note: `${result.action}${parsed.dropped.length ? ` · ${parsed.dropped.length} plataforma(s) descartada(s)` : ''}`,
    });
    return {
      status: 200,
      body: {
        ok: true,
        affiliate_id: parsed.state.affiliateId,
        action: result.action,
        added: result.added.length,
        removed: result.removed.length,
        transferred: result.transferred.length,
        reprocessed_orders: result.reprocess?.ordersUpdated ?? 0,
        dropped: parsed.dropped,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safeLog(deps, { eventId, attempt, body, ok: false, note: `erro: ${message}` });
    return { status: 500, body: { ok: false, error: 'processing failed', retry: true } };
  }
}

async function safeLog(deps: WebhookDeps, entry: Parameters<NonNullable<WebhookDeps['log']>>[0]): Promise<void> {
  if (!deps.log) return;
  try { await deps.log(entry); } catch { /* auditoria é best-effort */ }
}

// ---------------------------------------------------------------------
// GET …/metrics?period=7d|30d|mtd|custom&from=&to=
// ---------------------------------------------------------------------
export interface MetricsDeps {
  inboundKey: () => Promise<string | null>;
  compute: (start: Date, end: Date) => Promise<AffiliateMetricsOut[]>;
  cache: MetricsCache;
  now?: () => Date;
}

/**
 * Resposta = LISTA JSON (formato principal do contrato; o envelope {data}
 * também seria aceito, mas a lista não deixa margem). Metadados vão em
 * headers (X-Period-*, X-Cache) pra não poluir o corpo.
 */
export async function handleAffiliateMetrics(url: URL, req: { header(name: string): string | null }, deps: MetricsDeps): Promise<HandlerResponse> {
  const auth = await authorizeIntegration(req, deps.inboundKey);
  if (!auth.ok) return auth.response;
  const now = deps.now ? deps.now() : new Date();
  const period = resolvePeriod(url.searchParams.get('period'), url.searchParams.get('from'), url.searchParams.get('to'), now);
  if (!period.ok) return { status: 400, body: { statusCode: 400, message: period.error, error: 'Bad Request' } };

  // Janela móvel termina em AGORA — a chave de cache é o dia/período, e o
  // TTL curto (5 min) limita o atraso das vendas recém-chegadas.
  const key = `${period.period}|${period.from}|${period.to}`;
  const headers = {
    'X-Period': period.period,
    'X-Period-From': period.from,
    'X-Period-To': period.to,
    'X-Period-Start': period.start.toISOString(),
    'X-Period-End': period.end.toISOString(),
  };
  const hit = deps.cache.get(key);
  if (hit) return { status: 200, body: hit.body, headers: { ...headers, 'X-Cache': 'HIT', 'X-Cache-At': new Date(hit.at).toISOString() } };
  const body = await deps.compute(period.start, period.end);
  deps.cache.set(key, body);
  return { status: 200, body, headers: { ...headers, 'X-Cache': 'MISS' } };
}
