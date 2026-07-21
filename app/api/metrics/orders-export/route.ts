// GET /api/metrics/orders-export — download CSV da lista de transações.
// Tab-gated ('transactions'). MESMOS parâmetros do /api/metrics/orders
// (datas + filtros de dimensão + status/product_type/search), mas sem
// paginação: pagina o getOrders internamente (1000/página) até esgotar —
// o CSV sai com TODAS as linhas do filtro, não só as 500 da tela.
//
// Sem respondCached de propósito: payload grande, download esporádico —
// cachear strings de megabytes por 30s só gastaria memória.

import { NextResponse } from 'next/server';
import { getOrders } from '@/lib/services/metrics';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import { csvParam, stagesParam } from '@/lib/shared/queryParams';
import { buildCsv } from '@/lib/shared/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Teto de segurança (memória/latência). Acima disso o CSV é truncado e a
// última linha avisa — refine o filtro de período pra exportar tudo.
const EXPORT_MAX_ROWS = 50_000;

const BRT_FMT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

export async function GET(req: Request) {
  const auth = await requireTab('transactions');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(req.url);

  const startRaw = searchParams.get('start_date');
  const endRaw = searchParams.get('end_date');
  if (!startRaw || !endRaw) {
    return NextResponse.json({ error: 'start_date and end_date are required' }, { status: 400 });
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'invalid date format' }, { status: 400 });
  }

  const filters = {
    startDate,
    endDate,
    platformSlugs: csvParam(searchParams.get('platforms')),
    countries: csvParam(searchParams.get('countries')),
    productExternalIds: csvParam(searchParams.get('products')),
    productFamilies: csvParam(searchParams.get('families')),
    productTypes: stagesParam(searchParams.get('stages')),
  };
  const options = {
    status: searchParams.get('status') ?? undefined,
    productType: searchParams.get('product_type') ?? undefined,
    search: searchParams.get('search') ?? undefined,
  };

  try {
    const all: Awaited<ReturnType<typeof getOrders>>['orders'] = [];
    let total = 0;
    for (let offset = 0; all.length < EXPORT_MAX_ROWS; ) {
      const page = await getOrders(filters, { ...options, limit: 1000, offset });
      total = page.total;
      all.push(...page.orders);
      offset += page.orders.length;
      if (page.orders.length === 0 || offset >= page.total) break;
    }

    const rows: Array<Array<string | number | null>> = all.map((o) => [
      BRT_FMT.format(new Date(o.orderedAt)),
      o.platformSlug,
      o.externalId,
      o.parentExternalId,
      o.productName,
      o.productType,
      o.affiliateNickname ?? o.affiliateExternalId,
      o.affiliateExternalId,
      o.country,
      o.paymentMethod,
      o.status,
      o.grossAmountUsd,
      o.fees,
      o.netAmountUsd,
      o.cpaPaidUsd,
    ]);
    if (total > all.length) {
      rows.push([`EXPORT TRUNCADO: ${all.length} de ${total} linhas — refine o período/filtros pra exportar o restante`]);
    }

    const csv = buildCsv(
      [
        'Data (BRT)', 'Plataforma', 'Pedido', 'Sessão', 'Produto', 'Etapa',
        'Afiliado', 'Afiliado ID', 'País', 'Pagamento', 'Status',
        'Gross USD', 'Fees USD', 'Net USD', 'CPA USD',
      ],
      rows,
    );

    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    logger.info({ rows: all.length, total }, 'orders export csv');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="transacoes_${ymd(startDate)}_${ymd(endDate)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error({ err }, 'metrics/orders-export failed');
    return NextResponse.json({ error: 'export failed' }, { status: 500 });
  }
}
