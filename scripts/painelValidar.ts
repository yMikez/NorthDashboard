// Conferência da leitura oficial: roda os serviços das telas sobre a fonte
// atual (METRICS_SOURCE) e imprime os big numbers + o tempo de cada um.
// Rodar duas vezes — public e oficial — e comparar:
//
//   METRICS_SOURCE=public  npx tsx scripts/painelValidar.ts > public.json
//   METRICS_SOURCE=oficial PAINEL_READY_FILE=<arquivo existente> npx tsx scripts/painelValidar.ts > oficial.json
//
// Também confere a regra do Douglas (nenhuma JVZoo vinda do public fora do
// tempo real) quando a fonte é a oficial. Não imprime dado de cliente.

import { Prisma } from '@prisma/client';
import { db, dbRead, metricsSource } from '../lib/db';
import { getOverview, getFunnel, getPlatforms } from '../lib/services/metrics';
import { getRefundCohorts } from '../lib/services/refundCohorts';
import { getCallCenterSales } from '../lib/services/callCenterSales';
import { getOficialResultado } from '../lib/services/oficial';

const brt = (d: string, end = false) => new Date(`${d}T${end ? '23:59:59.999' : '00:00:00.000'}-03:00`);
const PERIODOS = [
  { nome: 'set/26', start: brt('2026-09-01'), end: brt('2026-09-30', true) },
  { nome: 'out/26', start: brt('2026-10-01'), end: brt('2026-10-19', true) },
];

async function timed<T>(label: string, f: () => Promise<T>, tempos: Record<string, number>): Promise<T> {
  const t0 = Date.now();
  const r = await f();
  tempos[label] = Date.now() - t0;
  return r;
}

async function main() {
  const out: Record<string, unknown> = { fonte: metricsSource() };
  const tempos: Record<string, number> = {};
  for (const p of PERIODOS) {
    const f = { startDate: p.start, endDate: p.end };
    const ov = await timed(`overview ${p.nome}`, () => getOverview(f), tempos);
    const fu = await timed(`funil ${p.nome}`, () => getFunnel(f), tempos);
    const pl = await timed(`plataformas ${p.nome}`, () => getPlatforms(f), tempos);
    const rc = await timed(`reembolsos ${p.nome}`, () => getRefundCohorts(f, 30), tempos);
    const cc = await timed(`callcenter ${p.nome}`, () => getCallCenterSales(f), tempos);
    const of = await timed(`oficial ${p.nome}`, () => getOficialResultado(p.start, p.end), tempos);
    const jv = pl.platforms.find((x) => x.slug === 'jvzoo');
    const k = ov.kpis;
    out[p.nome] = {
      overview: { gross: k.gross, net: k.net, approved: k.approvedCount, aov: k.aov, approvalRate: k.approvalRate, refundRate: k.refundRate, cbRate: k.cbRate },
      funil: fu.summary,
      jvzoo: jv ? { receita: jv.totalRevenue, pedidos: jv.totalOrders, aprovacao: jv.approvalRate, sincronizado: jv.lastSyncAt } : null,
      reembolsoCoorte30: rc.totals,
      callcenter: cc.providers.map((x) => ({ p: x.provider, vendas: x.sales, receita: x.grossUsd, liquido: x.netUsd })),
      oficial: of.plataformas.map((x) => ({ p: x.chave, liquido: x.liquido, vendas: x.vendas, pedidos: x.pedidos })),
    };
  }
  if (metricsSource() === 'oficial') {
    const [dup] = await dbRead.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n FROM (SELECT 1 FROM "Order" GROUP BY "platformId", "externalId" HAVING count(*) > 1) x`);
    const [jv] = await db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n FROM painel."Order" o JOIN painel."Platform" p ON p.id = o."platformId"
      WHERE p.slug = 'jvzoo' AND NOT EXISTS (SELECT 1 FROM dados_oficiais."Order" d WHERE d.id = o.id)
        AND o."orderedAt" <= (SELECT max("orderedAt") FROM dados_oficiais."Order")`);
    out.conferencia = { pedidosDuplicados: dup.n, jvzooDoPublicAntesDaUltimaCarga: jv.n };
  }
  out.tempoMs = tempos;
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await db.$disconnect(); if (dbRead !== db) await dbRead.$disconnect(); });
