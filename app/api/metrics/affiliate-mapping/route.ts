// GET /api/metrics/affiliate-mapping — leitura (sem ações) da integração
// com o NorthScale Afiliados pra quem tem as abas de afiliados/plataformas:
// fila de não mapeados, afiliados mapeados e o resumo de status. Ações
// (sync/backfill) ficam em /api/admin/affiliate-mapping.

import { NextResponse } from 'next/server';
import { requireAnyTab } from '@/lib/auth/guard';
import { getAffiliateSyncStatus } from '@/lib/services/affiliateMappingSync';
import { listUnmappedAffiliates, listMappedAffiliates, mappingCounts } from '@/lib/services/affiliateMapping';
import { getAffiliatesInboundKey } from '@/lib/services/integrationSettings';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAnyTab(['leaderboard', 'all-affiliates', 'affiliate-analysis', 'platforms', 'transactions']);
  if (!auth.ok) return auth.response;
  try {
    const inbound = Boolean(await getAffiliatesInboundKey());
    const [status, counts, unmapped, mapped] = await Promise.all([
      getAffiliateSyncStatus(inbound), mappingCounts(), listUnmappedAffiliates(), listMappedAffiliates(),
    ]);
    return NextResponse.json({ status, counts, unmapped, mapped, isAdmin: auth.user.role === 'ADMIN' });
  } catch (err) {
    logger.error({ err }, 'metrics/affiliate-mapping failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
