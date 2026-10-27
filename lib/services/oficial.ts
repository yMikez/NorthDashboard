// Resultado oficial por plataforma — os números do painel de dados do
// Douglas, LIDOS do que ele publica (dados_oficiais.dq_big_numbers_diario),
// não recalculados aqui: assim os dois painéis mostram sempre o mesmo número,
// e quando ele muda uma regra (ex.: SalesBound 65/35 → 60/40 desde 01/08) o
// dashboard acompanha sem deploy.
//
// Uma linha por plataforma e dia, cada uma no dia da SUA fonte (JVZoo em Nova
// York, Logicall no Pacífico, SalesBound em Chicago, Tauk em UTC). O seletor
// de período (BRT) filtra pelo dia-rótulo: "1 a 30/09" = os dias 1 a 30 de
// cada fonte, como o painel do Douglas soma. Sinais: descontos negativos;
// líquido = vendas + reembolsos + parcela + outros.

import { Prisma } from '@prisma/client';
import { db, metricsSource } from '../db';

export type OficialChave = 'jvzoo' | 'logicall' | 'tauk' | 'salesbound';

/** Nome no dq_* → chave usada no dashboard. */
export const OFICIAL_PLATAFORMAS: Record<string, OficialChave> = {
  JVZoo: 'jvzoo', Logicall: 'logicall', Tauk: 'tauk', SalesBound: 'salesbound',
};

export interface OficialLinha {
  chave: OficialChave;
  plataforma: string;
  fuso: string;
  /** Períodos de acerto tocados (mês na JVZoo, quinzena na Logicall/SalesBound, semana na Tauk). */
  periodos: string[];
  pedidos: number;
  vendas: number;
  reembolsos: number;
  /** CPA (JVZoo) ou parcela do parceiro (call centers). Negativo. */
  parcela: number;
  taxa: number;
  chargebacks: number;
  /** Taxa retida/preventiva/de chargeback (JVZoo) ou taxa de processamento + chargeback (call centers). Negativo. */
  outros: number;
  liquido: number;
  /** Só Logicall: reserva de 10% e o saldo depois dela. */
  reserva: number | null;
  saldoAReceber: number | null;
  /** Fulfillment ainda não informado (Tauk): o líquido é antes dele. */
  fulfillmentAConfirmar: boolean;
  liquidoSobreVendas: number | null;
}

export interface OficialResultado {
  /** Leitura oficial ligada (METRICS_SOURCE=oficial). A faixa só aparece com ela. */
  ativo: boolean;
  publicacao: { id: number; publicadoEm: string; fontesAte: string | null } | null;
  diaInicio: string;
  diaFim: string;
  plataformas: OficialLinha[];
  total: Omit<OficialLinha, 'chave' | 'plataforma' | 'fuso' | 'periodos' | 'fulfillmentAConfirmar'>;
}

export interface OficialDiaRow {
  plataforma: string;
  fuso: string;
  periodos: string[] | null;
  pedidos: number | null;
  vendas: number | null;
  reembolsos: number | null;
  parcela: number | null;
  taxa: number | null;
  chargebacks: number | null;
  outros: number | null;
  liquido: number | null;
  reserva: number | null;
  saldo_a_receber: number | null;
  fulfillment_nulo: boolean | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const n0 = (v: number | null | undefined) => (v == null ? 0 : Number(v));
const ORDEM: OficialChave[] = ['jvzoo', 'logicall', 'tauk', 'salesbound'];

/** Dia BRT (YYYY-MM-DD) de um instante — o rótulo que o seletor de período mostra. */
export function brtDia(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function oficialSql(diaInicio: string, diaFim: string): Prisma.Sql {
  return Prisma.sql`
    SELECT plataforma, min(fuso) AS fuso,
           array_agg(DISTINCT periodo ORDER BY periodo) AS periodos,
           sum(pedidos)::float8 AS pedidos, sum(vendas)::float8 AS vendas,
           sum(reembolsos)::float8 AS reembolsos, sum(parcela)::float8 AS parcela,
           sum(taxa)::float8 AS taxa, sum(chargebacks)::float8 AS chargebacks,
           sum(outros)::float8 AS outros, sum(liquido)::float8 AS liquido,
           sum(reserva)::float8 AS reserva, sum(saldo_a_receber)::float8 AS saldo_a_receber,
           bool_and(fulfillment IS NULL) AS fulfillment_nulo
    FROM dados_oficiais.dq_big_numbers_diario
    WHERE publicacao_id = (SELECT max(publicacao_id) FROM dados_oficiais.dq_big_numbers_diario)
      AND dia BETWEEN ${diaInicio}::date AND ${diaFim}::date
    GROUP BY plataforma`;
}

export function reduceOficial(rows: OficialDiaRow[]): { plataformas: OficialLinha[]; total: OficialResultado['total'] } {
  const plataformas: OficialLinha[] = [];
  for (const r of rows) {
    const chave = OFICIAL_PLATAFORMAS[r.plataforma];
    if (!chave) continue;
    const vendas = r2(n0(r.vendas));
    const liquido = r2(n0(r.liquido));
    plataformas.push({
      chave, plataforma: r.plataforma, fuso: r.fuso, periodos: r.periodos ?? [],
      pedidos: n0(r.pedidos), vendas,
      reembolsos: r2(n0(r.reembolsos)), parcela: r2(n0(r.parcela)), taxa: r2(n0(r.taxa)),
      chargebacks: r2(n0(r.chargebacks)), outros: r2(n0(r.outros)), liquido,
      reserva: r.reserva == null ? null : r2(r.reserva),
      saldoAReceber: r.saldo_a_receber == null ? null : r2(r.saldo_a_receber),
      fulfillmentAConfirmar: chave === 'tauk' && r.fulfillment_nulo === true,
      liquidoSobreVendas: vendas !== 0 ? Math.round((liquido / vendas) * 10_000) / 10_000 : null,
    });
  }
  plataformas.sort((a, b) => ORDEM.indexOf(a.chave) - ORDEM.indexOf(b.chave));
  const sum = (k: 'pedidos' | 'vendas' | 'reembolsos' | 'parcela' | 'taxa' | 'chargebacks' | 'outros' | 'liquido') =>
    r2(plataformas.reduce((s, p) => s + p[k], 0));
  const vendas = sum('vendas');
  const liquido = sum('liquido');
  const comReserva = plataformas.filter((p) => p.reserva != null);
  return {
    plataformas,
    total: {
      pedidos: sum('pedidos'), vendas, reembolsos: sum('reembolsos'), parcela: sum('parcela'), taxa: sum('taxa'),
      chargebacks: sum('chargebacks'), outros: sum('outros'), liquido,
      reserva: comReserva.length ? r2(comReserva.reduce((s, p) => s + (p.reserva ?? 0), 0)) : null,
      saldoAReceber: comReserva.length ? r2(comReserva.reduce((s, p) => s + (p.saldoAReceber ?? 0), 0)) : null,
      liquidoSobreVendas: vendas !== 0 ? Math.round((liquido / vendas) * 10_000) / 10_000 : null,
    },
  };
}

export async function getOficialResultado(
  startDate: Date,
  endDate: Date,
  opts: { chaves?: OficialChave[] } = {},
): Promise<OficialResultado> {
  const diaInicio = brtDia(startDate);
  const diaFim = brtDia(endDate);
  const [rows, pub] = await Promise.all([
    db.$queryRaw<OficialDiaRow[]>(oficialSql(diaInicio, diaFim)),
    db.$queryRaw<Array<{ id: number; publicado_em: Date; fontes_ate: Date | null }>>(Prisma.sql`
      SELECT publicacao_id AS id, publicado_em, fontes_ate FROM dados_oficiais._publicacao
      ORDER BY publicado_em DESC LIMIT 1`),
  ]);
  const chaves = opts.chaves ? new Set(opts.chaves) : null;
  const { plataformas, total } = reduceOficial(chaves ? rows.filter((r) => chaves.has(OFICIAL_PLATAFORMAS[r.plataforma])) : rows);
  const p = pub[0];
  return {
    ativo: metricsSource() === 'oficial',
    publicacao: p ? { id: Number(p.id), publicadoEm: new Date(p.publicado_em).toISOString(), fontesAte: p.fontes_ate ? new Date(p.fontes_ate).toISOString() : null } : null,
    diaInicio, diaFim, plataformas, total,
  };
}

// ---------- Cargas (Saúde / "Sincronizado") ----------

export interface OficialCarga {
  tabela: string;
  ultimaOkEm: string | null;
  ultimoStatus: string | null;
  /** Primeira linha do erro da última carga que falhou (sem payload). */
  ultimoErro: string | null;
  falhas24h: number;
  /** Linhas lidas na última carga ok. */
  linhas: number | null;
}

export async function getOficialCargas(): Promise<{ cargas: OficialCarga[]; publicacao: OficialResultado['publicacao'] }> {
  const [rows, pub] = await Promise.all([
    db.$queryRaw<Array<{ tabela: string; ultima_ok: Date | null; ultimo_status: string | null; ultimo_erro: string | null; falhas_24h: number; linhas: number | null }>>(Prisma.sql`
      SELECT tabela,
             max(fim) FILTER (WHERE status = 'ok') AS ultima_ok,
             (array_agg(status ORDER BY inicio DESC))[1] AS ultimo_status,
             (array_agg(erro ORDER BY inicio DESC) FILTER (WHERE status <> 'ok'))[1] AS ultimo_erro,
             count(*) FILTER (WHERE status <> 'ok' AND inicio > now() - interval '24 hours')::int AS falhas_24h,
             (array_agg(linhas_bigquery ORDER BY fim DESC) FILTER (WHERE status = 'ok'))[1]::float8 AS linhas
      FROM dados_oficiais._cargas
      GROUP BY tabela ORDER BY tabela`),
    db.$queryRaw<Array<{ id: number; publicado_em: Date; fontes_ate: Date | null }>>(Prisma.sql`
      SELECT publicacao_id AS id, publicado_em, fontes_ate FROM dados_oficiais._publicacao
      ORDER BY publicado_em DESC LIMIT 1`),
  ]);
  const p = pub[0];
  return {
    cargas: rows.map((r) => ({
      tabela: r.tabela,
      ultimaOkEm: r.ultima_ok ? new Date(r.ultima_ok).toISOString() : null,
      ultimoStatus: r.ultimo_status,
      ultimoErro: r.ultimo_erro ? r.ultimo_erro.split(/\r?\n/)[0].slice(0, 200) : null,
      falhas24h: Number(r.falhas_24h),
      linhas: r.linhas == null ? null : Number(r.linhas),
    })),
    publicacao: p ? { id: Number(p.id), publicadoEm: new Date(p.publicado_em).toISOString(), fontesAte: p.fontes_ate ? new Date(p.fontes_ate).toISOString() : null } : null,
  };
}

/**
 * "Sincronizado" das plataformas que vêm do oficial (hoje só a JVZoo): a
 * última carga ok da tabela Order. Platform.lastSyncAt nunca é gravado.
 */
export async function oficialLastSyncBySlug(): Promise<Map<string, Date>> {
  const rows = await db.$queryRaw<Array<{ slug: string; at: Date | null }>>(Prisma.sql`
    SELECT p.slug, (SELECT max(c.fim) FROM dados_oficiais._cargas c WHERE c.tabela = 'Order' AND c.status = 'ok') AS at
    FROM dados_oficiais."Platform" p`);
  return new Map(rows.filter((r) => r.at).map((r) => [r.slug, new Date(r.at as Date)]));
}
