// Reenvio das IPNs de vendedor das contas de REDE ao NorthAffiliates
// (POST {API}/api/integrations/networks/jvzoo-ipn), a partir do IngestLog.
//
// Por quê: o nó "NorthAffiliates (redes)" do workflow "Reporting JVzoo" ficou
// em rascunho de 16/10 a 22/10/2026 e as vendas das redes não chegaram lá. O
// retry do n8n não serve — roda o workflow inteiro e manda e-mail/SMS de novo
// ao comprador. O NorthAffiliates não duplica (idempotente por transação) e
// usa os valores da hora da venda.
//
// Mesmo formato do nó do n8n: o corpo da IPN em form-urlencoded, X-Api-Key =
// JVZOO_IPN_FORWARD_KEY. Padrão é SIMULAÇÃO; só envia com send=true.

import { Prisma } from '@prisma/client';
import { db } from '../db';
import { getAffiliatesApiUrl, getJvzooIpnForwardKey } from './integrationSettings';

const REQUEST_TIMEOUT_MS = 15_000;
export const JVZOO_IPN_FORWARD_PATH = '/api/integrations/networks/jvzoo-ipn';

/** Corpo form-urlencoded como o nó "Code in JavaScript" do n8n monta. */
export function ipnFormBody(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? '' : String(v))}`)
    .join('&');
}

/** IPNs JVZoo das contas, em ordem de chegada (venda antes do estorno). */
export function replayCandidatesSql(since: Date, accounts: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT ON ("externalId", "eventType") id, "externalId", "eventType", "receivedAt",
           payload->>'affiliate_id' AS account, payload
    FROM "IngestLog"
    WHERE source = 'n8n-jvzoo' AND "platformSlug" = 'jvzoo'
      AND "receivedAt" >= ${since}
      AND "eventType" <> 'test'
      AND "externalId" IS NOT NULL
      AND payload->>'affiliate_id' = ANY(${accounts}::text[])
    ORDER BY "externalId", "eventType", "receivedAt"`;
}

export interface ReplayItem {
  logId: string;
  transactionId: string;
  eventType: string;
  receivedAt: string;
  account: string;
  status?: number;
  ok?: boolean;
  response?: string;
}

export interface ReplayResult {
  mode: 'dry-run' | 'send';
  since: string;
  accounts: string[];
  url: string;
  items: ReplayItem[];
  sent: number;
  failed: number;
  stoppedReason: string | null;
}

export class ReplayNotConfiguredError extends Error {
  constructor() {
    super('Reenvio: chave JVZOO_IPN_FORWARD_KEY (ou setting affiliates.jvzooIpnForwardApiKey) não configurada');
    this.name = 'ReplayNotConfiguredError';
  }
}

export async function replayNetworkIpns(opts: {
  since: Date;
  accounts: string[];
  send: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ReplayResult> {
  const url = `${await getAffiliatesApiUrl()}${JVZOO_IPN_FORWARD_PATH}`;
  const rows = await db.$queryRaw<Array<{
    id: string; externalId: string; eventType: string; receivedAt: Date; account: string; payload: Record<string, unknown>;
  }>>(replayCandidatesSql(opts.since, opts.accounts));
  rows.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const result: ReplayResult = {
    mode: opts.send ? 'send' : 'dry-run',
    since: opts.since.toISOString(),
    accounts: opts.accounts,
    url,
    items: rows.map((r) => ({
      logId: r.id, transactionId: r.externalId, eventType: r.eventType, receivedAt: r.receivedAt.toISOString(), account: r.account,
    })),
    sent: 0,
    failed: 0,
    stoppedReason: null,
  };
  if (!opts.send || rows.length === 0) return result;

  const key = await getJvzooIpnForwardKey();
  if (!key) throw new ReplayNotConfiguredError();
  const fetchImpl = opts.fetchImpl ?? fetch;
  for (let i = 0; i < rows.length; i++) {
    const item = result.items[i];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Api-Key': key, 'User-Agent': 'NorthScale-Dashboard/1.0 (replay)' },
        body: ipnFormBody(rows[i].payload),
        signal: ctrl.signal,
      });
      item.status = res.status;
      item.ok = res.ok;
      item.response = (await res.text()).slice(0, 200);
    } catch (err) {
      item.ok = false;
      item.response = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    if (item.ok) result.sent++;
    else result.failed++;
    // Chave errada / não configurada do lado deles: as próximas falhariam igual.
    if (item.status === 401 || item.status === 403 || item.status === 503) {
      result.stoppedReason = `HTTP ${item.status} — conferir a chave/configuração do NorthAffiliates`;
      break;
    }
  }
  return result;
}
