// GET /api/admin/northaffiliates/catalog   (ADMIN)
//
// Catálogo da rede no NorthAffiliates (produtos, mockups dos kits, VSLs e
// materiais), lido com a chave nsk_… guardada em integration-settings.
// Os links de imagem que voltam valem 30 minutos.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { CatalogNotConfiguredError, fetchNetworkCatalog } from '@/lib/services/northAffiliatesCatalog';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await fetchNetworkCatalog());
  } catch (err) {
    if (err instanceof CatalogNotConfiguredError) {
      return NextResponse.json({ error: 'not_configured', message: err.message }, { status: 409 });
    }
    logger.error({ err }, 'northaffiliates catalog failed');
    return NextResponse.json({ error: 'failed', message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
