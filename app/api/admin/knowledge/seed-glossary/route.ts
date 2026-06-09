// POST /api/admin/knowledge/seed-glossary
//
// Seed idempotente do "Glossário de métricas analíticas" + nota sobre
// limitação de visitor tracking no KnowledgeEntry. Match por title (não
// tem UNIQUE no schema, então busca + upsert manual). Bearer-auth
// (INGEST_SECRET) pra poder ser chamado via curl em produção sem login.
//
// O efeito é imediato no chat: getKnowledgePromptBlock invalida cache
// quando o conteúdo muda, e o systemPrompt() inclui os entries enabled
// na próxima chamada de IA.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { invalidateKnowledgeCache } from '@/lib/services/knowledge';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GLOSSARY_TITLE = 'Glossário de métricas analíticas';
const GLOSSARY_CONTENT = `Definições padrão das métricas analíticas. Todas relativas ao timeframe selecionado na página.

## Pedidos & Conversões
- **Orders** — total de pedidos no período: \`COUNT(orders)\`.
- **Conversions** — visitantes únicos que finalizaram um pedido. Definição padrão: \`COUNT(DISTINCT visitor_id WHERE order placed)\`. **No NorthScale**: proxy = \`COUNT(DISTINCT funnelSessionId)\` (uma sessão de funil amarrada por sessid2/funnelSessionId no IPN). Não temos visitor_id upstream.
- **Customers** — clientes distintos: \`COUNT(DISTINCT customer_id)\`.

## Vendas
- **Gross Sales** — vendas brutas antes de qualquer dedução (excluindo taxas de processamento da plataforma).
- **New Sales** — vendas one-time (não recorrentes).
- **Recurring Sales** — vendas de assinatura.
- **Net Sales** — \`Gross Sales − (Commissions + Refunds + Chargebacks + COGS + Taxes)\`.

## Refunds & Chargebacks
- **Refund Rate** — \`(Total Refund Amount / Total Order Amount) × 100\`. No NorthScale: razão sobre order count (refunded / total) é a forma alternativa que o painel mostra.
- **Chargeback Rate** — \`(Number of Chargebacks / Total Orders) × 100\`.
- **Total Chargebacks & Refunds** — \`Refund Amount + Chargeback Amount\` (combinado).

## Taxas & Comissões
- **Taxes** — \`Taxes Amount − Voided Taxes Amount\`.
- **Commissions Net** — \`Commissions Amount − Voided Commissions Amount\`.
- **Commissions Count Net** — \`Total Commissions Count − Voided Commissions Count\`.

## Médias por pedido/cliente
- **AOV (Average Order Value)** — \`Gross Sales / Conversions\`. O painel usa \`gross / sessões aprovadas\` (sessões = funnelSessionId) — mesma fórmula sob nosso proxy de Conversions.
- **Avg LTV** — \`Net Sales / Customers\`.

## EPC / EPO — Vendor (NorthScale)
- **EPC (Earnings Per Click)** — \`Net Sales / Visitors\`. **NÃO computado no NorthScale** — sem tracking de visitor (ver limitação abaixo).
- **EPO (Earnings Per Order)** — \`Net Sales / Conversions\`. Computado.

## EPC / EPO — Afiliado
- **Affiliate EPC** — \`Commissions Net / Visitors\`. **NÃO computado** — sem visitor.
- **Affiliate EPO** — \`Commissions Net / Conversions\`. Computado.

## Conversion Rates (não computáveis)
- **Conversion Rate** — \`(Unique Orders / Unique Visitors) × 100\`. Sem visitor tracking, não computado.
- **Checkout Conversion Rate** — \`(Unique Orders / Unique Checkout Visitors) × 100\`. Idem.

## Resumo do que ESTÁ vs NÃO ESTÁ disponível

| Métrica | Disponível? |
|---|---|
| Orders, Conversions, Customers | Sim |
| Gross Sales, Net Sales, New, Recurring | Sim |
| Refund Rate, Chargeback Rate | Sim |
| Taxes, Commissions Net | Sim |
| AOV, Avg LTV | Sim |
| EPO (vendor + afiliado) | Sim |
| EPC (vendor + afiliado) | **Não** — falta visitor tracking |
| Conversion Rate, Checkout CVR | **Não** — falta visitor tracking |`;

const VISITOR_LIMITATION_TITLE = 'Limitação: NorthScale não recebe dados de visitantes';
const VISITOR_LIMITATION_CONTENT = `O NorthScale recebe dados **apenas via IPN webhooks** das 3 plataformas integradas (ClickBank INS, Digistore24, BuyGoods). Cada webhook reporta um pedido concretizado — venda nova, refund ou chargeback.

**Não recebemos**:
- \`visitor_id\` / cookie de visita
- Sessões de checkout abandonadas
- Cliques de afiliados (CTR não é mensurável daqui)
- Page views / impression-level events

**Consequência**: métricas do glossário padrão cujo denominador é "Visitors" — **Conversion Rate**, **EPC (vendor)**, **Affiliate EPC**, **Checkout Conversion Rate** — não são computáveis com os dados que temos.

**Proxies que o NorthScale usa quando "Visitors" seria o ideal**:

- "**Conversions**" = \`COUNT(DISTINCT funnelSessionId)\` — sessão de funil é uma sequência FE+UPs+DWs amarrada por sessid2 (BG) / funnelSessionId (CB/Digistore). Aproxima "uma jornada de compra única".
- "**AOV**" = \`Gross Sales / Conversions\` (sob esse proxy). Mesma fórmula do glossário padrão, denominador diferente.
- "**EPO**" = \`Net Sales / Conversions\` — análogo do EPC mas por pedido (que temos), não por clique (que não temos).

**Regra de conduta**: se o usuário pedir métricas que dependem de "Visitors", explique de forma transparente que não temos tracking upstream e ofereça a métrica análoga baseada em conversões/pedidos. Não invente número que não existe.`;

interface SeedResult {
  title: string;
  action: 'created' | 'updated' | 'unchanged';
  id: string;
}

async function upsertEntry(title: string, content: string, sortOrder: number): Promise<SeedResult> {
  const existing = await db.knowledgeEntry.findFirst({
    where: { title, source: 'manual' },
    select: { id: true, content: true },
  });
  if (existing) {
    if (existing.content === content) {
      return { title, action: 'unchanged', id: existing.id };
    }
    const updated = await db.knowledgeEntry.update({
      where: { id: existing.id },
      data: { content, enabled: true, sortOrder },
      select: { id: true },
    });
    return { title, action: 'updated', id: updated.id };
  }
  const created = await db.knowledgeEntry.create({
    data: { title, content, enabled: true, source: 'manual', sortOrder },
    select: { id: true },
  });
  return { title, action: 'created', id: created.id };
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? null;
  if (!checkIngestSecret(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const results: SeedResult[] = await Promise.all([
      upsertEntry(GLOSSARY_TITLE, GLOSSARY_CONTENT, 10),
      upsertEntry(VISITOR_LIMITATION_TITLE, VISITOR_LIMITATION_CONTENT, 11),
    ]);
    invalidateKnowledgeCache();
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    logger.error({ err }, 'knowledge/seed-glossary failed');
    return NextResponse.json(
      { error: 'seed failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
