// Configuração de integrações (chave Logicall, comissões dos parceiros).
//
//   GET /api/admin/integration-settings         → lista (segredos mascarados)
//   PUT /api/admin/integration-settings         → { key, value } (value vazio = apaga)
//
// Auth: sessão ADMIN (form da aba) OU bearer INGEST_SECRET. Chaves aceitas
// estão em SETTING_KEYS — nada além disso entra.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import {
  SETTING_KEYS, isAllowedSettingKey, setSetting, deleteSetting, listSettingsMasked,
} from '@/lib/services/integrationSettings';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorized(req: Request): Promise<NextResponse | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return null;
  const auth = await requireAdmin();
  return auth.ok ? null : auth.response;
}

export async function GET(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  return NextResponse.json({
    settings: await listSettingsMasked(),
    keys: Object.values(SETTING_KEYS),
    envOverrides: {
      [SETTING_KEYS.logicallApiKey]: Boolean(process.env.LOGICALL_API_KEY),
      [SETTING_KEYS.logicallCommissionPct]: Boolean(process.env.LOGICALL_COMMISSION_PCT),
      [SETTING_KEYS.taukCommissionPct]: Boolean(process.env.TAUK_COMMISSION_PCT),
    },
  });
}

export async function PUT(req: Request) {
  const denied = await authorized(req);
  if (denied) return denied;
  let body: { key?: unknown; value?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!isAllowedSettingKey(key)) {
    return NextResponse.json({ error: 'chave não permitida', allowed: Object.values(SETTING_KEYS) }, { status: 400 });
  }
  const value = typeof body.value === 'string' ? body.value.trim() : '';
  if (key.endsWith('.commissionPct') && value) {
    // Setting é SEMPRE percentual (campo da UI rotulado em %): "35" = 35%.
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: 'comissão em PERCENTUAL, número entre 0 e 100 (ex.: 35)' }, { status: 400 });
    }
  }
  if (!value) {
    await deleteSetting(key);
    logger.info({ key }, 'integration setting cleared');
    return NextResponse.json({ ok: true, key, cleared: true });
  }
  await setSetting(key, value);
  logger.info({ key }, 'integration setting saved');
  return NextResponse.json({ ok: true, key });
}
