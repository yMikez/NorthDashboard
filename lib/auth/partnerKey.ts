// Chave de PARCEIRO — acesso só de LEITURA aos endpoints de integração
// (/api/integrations/*), sem tocar em nada que escreve.
//
// Por que existe: a "chave de operação" (INGEST_SECRET) abre todas as rotas
// /api/admin/*, inclusive backfills, mudança de premissas e delete. Entregar
// ela pra um sistema parceiro (SendTrace, BI de terceiro) seria dar a chave
// mestra — e ela é a MESMA que o n8n usa pra ingestão, então rotacionar
// depois derrubaria a entrada de vendas. A chave de parceiro resolve os dois
// problemas: escopo de leitura e rotação independente.
//
// Onde fica: IntegrationSetting `partner.<nome>.apiKey` (ou env
// PARTNER_<NOME>_API_KEY, que vence). Header: `X-Api-Key`.

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdmin } from './guard';
import { checkIngestSecret } from '../ingest/auth';
import { getPartnerApiKeys } from '../services/integrationSettings';

export type PartnerCaller = { kind: 'partner'; name: string } | { kind: 'ops' } | { kind: 'admin'; userId: string };

function sameKey(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Aceita, nesta ordem: X-Api-Key de parceiro · bearer INGEST_SECRET (ops) ·
 * sessão ADMIN (pra testar pelo navegador). 401 quando nada bate.
 */
export async function requirePartnerRead(
  req: Request,
): Promise<{ ok: true; caller: PartnerCaller } | { ok: false; response: NextResponse }> {
  const apiKey = req.headers.get('x-api-key')?.trim();
  if (apiKey) {
    const keys = await getPartnerApiKeys();
    for (const [name, expected] of keys) {
      if (sameKey(apiKey, expected)) return { ok: true, caller: { kind: 'partner', name } };
    }
    return { ok: false, response: NextResponse.json({ error: 'chave de parceiro inválida' }, { status: 401 }) };
  }

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return { ok: true, caller: { kind: 'ops' } };

  const auth = await requireAdmin();
  if (auth.ok) return { ok: true, caller: { kind: 'admin', userId: auth.user.id } };
  return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
}

export function callerLabel(caller: PartnerCaller): string {
  return caller.kind === 'partner' ? `partner:${caller.name}` : caller.kind;
}
