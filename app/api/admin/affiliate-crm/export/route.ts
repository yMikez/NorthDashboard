// Export da régua no formato que a ferramenta de WhatsApp importa
// (colunas §2.10 do playbook + valor/segmento/ciclo).
//
//   GET /api/admin/affiliate-crm/export?segment=dormente&pending=1
//
// O padrão (pending=1) é a rotina do playbook: quem está devendo toque
// NESTE ciclo. Quem já foi tocado não sai de novo, e quem vendeu de novo
// sumiu da lista sozinho — é o que a régua em CSV não conseguia garantir.
//
// Leva WhatsApp de parceiro: é dado pessoal. Rota gated por aba, download
// registrado no log, e o arquivo não entra no repositório.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { crmCsv, crmOptionsFromQuery } from '@/lib/services/affiliateCrm';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const auth = await requireTab('affiliate-crm');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);
  const opts = crmOptionsFromQuery(searchParams);
  // Sem parâmetro explícito, o export é a fila de pendentes.
  if (!searchParams.has('pending')) opts.pendingOnly = true;
  try {
    const { csv, count, anchorDay } = await crmCsv(opts);
    logger.info({ who: auth.user.email ?? auth.user.id, count, segment: opts.segment ?? 'todos' }, '[crm] download do export');
    const name = `crm-afiliados-${opts.segment ?? 'fila'}-${anchorDay}.csv`;
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error({ err }, 'admin/affiliate-crm/export failed');
    return NextResponse.json({ error: 'export failed' }, { status: 500 });
  }
}
