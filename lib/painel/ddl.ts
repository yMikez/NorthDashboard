// Schema `painel`: o que as telas de métricas leem quando METRICS_SOURCE=oficial.
//
// Junta o dado validado do time de dados (schema dados_oficiais, carregado
// de hora em hora pelo Douglas) com o resto do public:
//
//   - Order (JVZoo), CallCenterSale (Logicall + Tauk) e SalesboundTransaction:
//     as linhas dessas fontes vêm 100% do dados_oficiais; o public só COMPLETA
//     colunas que o oficial não tem (COGS, frete, potes, etapa…), casando pela
//     chave natural. Nunca juntar por id: o public tem linhas da mesma venda
//     com outro id, que dobrariam (regra do Douglas).
//   - Tempo real: depois da última venda carregada no oficial, entram as que
//     chegaram pelo IPN no public (só onde chave e horário batem nos dois
//     lados — JVZoo, Logicall e SalesBound). A carga seguinte as substitui.
//     A Tauk fica de fora: a chave é outra e o horário do public está 4–5h
//     à frente do oficial, então o corte por horário duplicaria vendas.
//   - Product e Affiliate: o cadastro do public + o que só o oficial tem.
//   - Todo o resto: view de passagem pro public (o cliente Prisma de leitura
//     usa ?schema=painel, então TODA tabela precisa existir aqui).
//   - daily_metrics e lead_summary: as mesmas MVs do public, sobre as views.
//
// Enums: o Prisma qualifica todo cast de enum com o schema da conexão
// ($1::"painel"."OrderStatus"), e o Postgres NÃO compara um enum com um
// DOMAIN sobre ele. Então o painel tem CÓPIAS dos enums (mesmos valores, na
// mesma ordem) e toda coluna de enum das views sai convertida pra cópia.
//
// Tudo aqui é puro: recebe o retrato do banco (introspecção em sync.ts) e
// devolve os comandos SQL. Não é migração do Prisma de propósito — o
// `prisma migrate deploy` roda sozinho no deploy e o dados_oficiais é de
// outro dono.

export interface Column { name: string; type: string }

export interface PainelSnapshot {
  /** Tabelas e views do public (sem _prisma_migrations), colunas em ordem, tipo qualificado. */
  publicTables: Record<string, Column[]>;
  /** Colunas das tabelas do dados_oficiais (só as que existem lá). */
  oficialTables: Record<string, string[]>;
  /** Enums do public com os valores na ordem (viram cópias no painel). */
  enums: Record<string, string[]>;
  /** MVs do public, na ordem de criação; definição sem schema (search_path=public). */
  matviews: Array<{ name: string; definition: string; indexes: string[] }>;
}

export interface PainelOptions {
  /**
   * Sessão do funil (funnelSessionId/parentExternalId): 'painel' mantém a
   * nossa (padrão — a definição do Douglas derruba o lift de upsells e a
   * decisão está em aberto); 'oficial' usa a dele.
   */
  sessao: 'painel' | 'oficial';
  /** Completar com as vendas que chegaram depois da última carga do oficial. */
  tempoReal: boolean;
}

export const DEFAULT_PAINEL_OPTIONS: PainelOptions = { sessao: 'painel', tempoReal: true };

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const PUB = 'public';
const OFI = 'dados_oficiais';

/**
 * Tipagem das colunas no schema novo: enum do public vira a cópia do painel
 * (via text); o resto mantém o tipo do public.
 */
class Typing {
  constructor(private schema: string, private enums: Record<string, string[]>) {}

  private enumOf(type: string): { name: string; array: boolean } | null {
    const m = /^public\.(?:"([^"]+)"|(\w+))$/.exec(type);
    if (!m) return null;
    const name = m[1] ?? m[2];
    if (this.enums[name]) return { name, array: false };
    if (name.startsWith('_') && this.enums[name.slice(1)]) return { name: name.slice(1), array: true };
    return null;
  }

  /** Expressão já no tipo final da coluna do painel. `fromOficial`: veio do dados_oficiais (pode ter outro tipo). */
  cast(expr: string, col: Column, fromOficial: boolean): string {
    const e = this.enumOf(col.type);
    if (e) return e.array ? `(${expr})::text[]::${q(this.schema)}.${q(e.name)}[]` : `(${expr})::text::${q(this.schema)}.${q(e.name)}`;
    return fromOficial ? `(${expr})::${col.type}` : expr;
  }

  /** NULL tipado (coluna que um dos lados não tem). */
  nil(col: Column): string { return this.cast('NULL', col, true); }

  /** Coluna do public sem regra especial (branch "só public"). */
  plain(alias: string, col: Column): string { return this.cast(`${alias}.${q(col.name)}`, col, false); }
}

const selectList = (cols: Column[], expr: (c: Column) => string) =>
  cols.map((c) => `${expr(c)} AS ${q(c.name)}`).join(',\n    ');

// ---------- Order ----------

/** O oficial não tem (vazio = "não temos", não zero): completa com o public. */
export const ORDER_FILL_FROM_PUBLIC = [
  'customerId', 'country', 'state', 'city', 'vendorAccount', 'funnelStep', 'campaignKey',
  'cogsUsd', 'fulfillmentUsd', 'bottlesShipped', 'mappedAffiliateId',
];
/** Classificação do catálogo: o painel vence. */
export const ORDER_PUBLIC_WINS = ['productType', 'classificationPending'];
/** Sessão do funil: o painel vence enquanto PainelOptions.sessao = 'painel'. */
export const ORDER_SESSION = ['funnelSessionId', 'parentExternalId'];

function orderExpr(col: Column, ofi: Set<string>, opts: PainelOptions, t: Typing): string {
  const c = q(col.name);
  if (!ofi.has(col.name)) return t.plain('p', col);
  const d = `d.${c}`;
  const p = `p.${c}`;
  let e: string;
  if (col.name === 'billingType') e = `CASE WHEN ${d}::text = 'UNKNOWN' THEN COALESCE(${p}, ${d}) ELSE ${d} END`;
  else if (col.name === 'originalGrossUsd') e = `COALESCE(${d}, d."grossAmountUsd")`;
  else if (ORDER_FILL_FROM_PUBLIC.includes(col.name)) e = `COALESCE(${d}, ${p})`;
  else if (ORDER_PUBLIC_WINS.includes(col.name)) e = `COALESCE(${p}, ${d})`;
  else if (opts.sessao === 'painel' && ORDER_SESSION.includes(col.name)) e = `COALESCE(${p}, ${d})`;
  else e = d;
  return t.cast(e, col, true);
}

export function orderViewSql(schema: string, cols: Column[], ofiCols: string[], opts: PainelOptions, t: Typing): string {
  const ofi = new Set(ofiCols);
  const plain = selectList(cols, (c) => t.plain('p', c));
  const ofiPlatform = `SELECT op.id FROM ${OFI}."Platform" op`;
  const parts = [
    `SELECT\n    ${selectList(cols, (c) => orderExpr(c, ofi, opts, t))}\n  FROM ${OFI}."Order" d\n  LEFT JOIN ${PUB}."Order" p ON p."platformId" = d."platformId" AND p."externalId" = d."externalId"`,
    // Plataformas que o oficial não cobre: seguem 100% do public.
    `SELECT\n    ${plain}\n  FROM ${PUB}."Order" p\n  WHERE p."platformId" NOT IN (${ofiPlatform})`,
  ];
  if (opts.tempoReal) {
    parts.push(
      `SELECT\n    ${plain}\n  FROM ${PUB}."Order" p\n  WHERE p."platformId" IN (${ofiPlatform})\n`
      + `    AND p."orderedAt" > (SELECT max(x."orderedAt") FROM ${OFI}."Order" x)\n`
      + `    AND NOT EXISTS (SELECT 1 FROM ${OFI}."Order" x WHERE x."platformId" = p."platformId" AND x."externalId" = p."externalId")`,
    );
  }
  return `CREATE VIEW ${q(schema)}."Order" AS\n  ${parts.join('\n  UNION ALL\n  ')}`;
}

// ---------- CallCenterSale ----------

/** Fontes de call center que vêm do oficial. */
export const OFICIAL_CALL_CENTER = ['logicall', 'tauk'];
/** Só a Logicall tem chave e horário iguais nos dois lados (ver cabeçalho). */
export const TEMPO_REAL_CALL_CENTER = ['logicall'];
export const CALL_CENTER_FILL_FROM_PUBLIC = [
  'email', 'firstName', 'lastName', 'phone', 'address', 'fulfillmentStatus',
  'family', 'bottles', 'state', 'country', 'agentName',
];

const sqlList = (xs: string[]) => xs.map(lit).join(', ');

/**
 * Ponte da Tauk: a venda oficial (chave tauk:<sale_id>, sem e-mail) e a do
 * webhook (chave e-mail|data, com e-mail) não têm chave em comum. O que as
 * liga é o valor + o horário EXATO, ao segundo, com o do webhook 4h à frente
 * (5h fora do horário de verão americano). Medido em 2026-10-27: 4.557 das
 * 4.615 vendas do webhook casam 1:1. Só vale quando há exatamente um
 * candidato; o dado do oficial vence sempre (quando o e-mail chegar lá, a
 * ponte deixa de ser usada sozinha).
 */
export const TAUK_PONTE_HORAS = [4, 5];

function taukPonteSql(): string {
  const horarios = TAUK_PONTE_HORAS.map((h) => `d."purchasedAt" + interval '${h} hours'`).join(', ');
  return `  LEFT JOIN LATERAL (\n`
    + `    SELECT (array_agg(c.id))[1] AS id, count(*) AS n FROM (\n`
    + `      SELECT t.id FROM ${PUB}."CallCenterSale" t\n`
    + `      WHERE d.provider = 'tauk' AND t.provider = 'tauk' AND t."amountUsd" = d."amountUsd"\n`
    + `        AND t."purchasedAt" IN (${horarios})\n`
    + `      LIMIT 2) c\n`
    + `  ) tkc ON true\n`
    + `  LEFT JOIN ${PUB}."CallCenterSale" tk ON tkc.n = 1 AND tk.id = tkc.id`;
}

export function callCenterViewSql(schema: string, cols: Column[], ofiCols: string[], opts: PainelOptions, t: Typing): string {
  const ofi = new Set(ofiCols);
  const expr = (col: Column) => {
    if (!ofi.has(col.name)) return t.plain('p', col);
    const c = q(col.name);
    return t.cast(CALL_CENTER_FILL_FROM_PUBLIC.includes(col.name) ? `COALESCE(d.${c}, p.${c}, tk.${c})` : `d.${c}`, col, true);
  };
  const plain = selectList(cols, (c) => t.plain('p', c));
  const parts = [
    `SELECT\n    ${selectList(cols, expr)}\n  FROM ${OFI}."CallCenterSale" d\n  LEFT JOIN ${PUB}."CallCenterSale" p ON p."externalKey" = d."externalKey"\n${taukPonteSql()}\n  WHERE d.provider IN (${sqlList(OFICIAL_CALL_CENTER)})`,
    `SELECT\n    ${plain}\n  FROM ${PUB}."CallCenterSale" p\n  WHERE p.provider NOT IN (${sqlList(OFICIAL_CALL_CENTER)})`,
  ];
  if (opts.tempoReal) {
    for (const prov of TEMPO_REAL_CALL_CENTER) {
      parts.push(
        `SELECT\n    ${plain}\n  FROM ${PUB}."CallCenterSale" p\n  WHERE p.provider = ${lit(prov)}\n`
        + `    AND p."purchasedAt" > (SELECT max(x."purchasedAt") FROM ${OFI}."CallCenterSale" x WHERE x.provider = ${lit(prov)})\n`
        + `    AND NOT EXISTS (SELECT 1 FROM ${OFI}."CallCenterSale" x WHERE x."externalKey" = p."externalKey")`,
      );
    }
  }
  return `CREATE VIEW ${q(schema)}."CallCenterSale" AS\n  ${parts.join('\n  UNION ALL\n  ')}`;
}

// ---------- SalesboundTransaction ----------

export const SALESBOUND_FILL_FROM_PUBLIC = ['email', 'phone', 'family', 'bottles', 'merchant', 'sourcePlatform', 'clientTxnId'];

export function salesboundViewSql(schema: string, cols: Column[], ofiCols: string[], opts: PainelOptions, t: Typing): string {
  const ofi = new Set(ofiCols);
  const expr = (col: Column) => {
    if (!ofi.has(col.name)) return t.plain('p', col);
    const c = q(col.name);
    // Itens: os do painel quando ele tem (vêm classificados com família/potes).
    if (col.name === 'items') {
      return t.cast(`CASE WHEN jsonb_typeof(p.${c}::jsonb) = 'array' AND jsonb_array_length(p.${c}::jsonb) > 0 THEN p.${c} ELSE d.${c} END`, col, true);
    }
    return t.cast(SALESBOUND_FILL_FROM_PUBLIC.includes(col.name) ? `COALESCE(d.${c}, p.${c})` : `d.${c}`, col, true);
  };
  const parts = [
    `SELECT\n    ${selectList(cols, expr)}\n  FROM ${OFI}."SalesboundTransaction" d\n  LEFT JOIN ${PUB}."SalesboundTransaction" p ON p."transactionId" = d."transactionId"`,
  ];
  if (opts.tempoReal) {
    // O horário do public fica 1–2h ANTES do oficial (webhook em Eastern):
    // o corte por horário só pode atrasar uma venda, nunca duplicar.
    parts.push(
      `SELECT\n    ${selectList(cols, (c) => t.plain('p', c))}\n  FROM ${PUB}."SalesboundTransaction" p\n`
      + `  WHERE p."txnAt" > (SELECT max(x."txnAt") FROM ${OFI}."SalesboundTransaction" x)\n`
      + `    AND NOT EXISTS (SELECT 1 FROM ${OFI}."SalesboundTransaction" x\n`
      + `      WHERE x."transactionId" = p."transactionId" OR (p."clientTxnId" IS NOT NULL AND x."clientTxnId" = p."clientTxnId"))`,
    );
  }
  return `CREATE VIEW ${q(schema)}."SalesboundTransaction" AS\n  ${parts.join('\n  UNION ALL\n  ')}`;
}

// ---------- Cadastro (Product, Affiliate) e passagem ----------

/** O cadastro do public vence; do oficial entra só o que o public não tem (pela chave natural). */
export function catalogViewSql(schema: string, table: string, cols: Column[], ofiCols: string[], t: Typing): string {
  const ofi = new Set(ofiCols);
  return `CREATE VIEW ${q(schema)}.${q(table)} AS\n`
    + `  SELECT\n    ${selectList(cols, (c) => t.plain('p', c))}\n  FROM ${PUB}.${q(table)} p\n  UNION ALL\n`
    + `  SELECT\n    ${selectList(cols, (c) => (ofi.has(c.name) ? t.cast(`d.${q(c.name)}`, c, true) : t.nil(c)))}\n  FROM ${OFI}.${q(table)} d\n`
    + `  WHERE NOT EXISTS (SELECT 1 FROM ${PUB}.${q(table)} p WHERE p."platformId" = d."platformId" AND p."externalId" = d."externalId")`;
}

export function passThroughSql(schema: string, table: string, cols: Column[], t: Typing): string {
  return `CREATE VIEW ${q(schema)}.${q(table)} AS SELECT\n    ${selectList(cols, (c) => t.plain('p', c))}\n  FROM ${PUB}.${q(table)} p`;
}

// ---------- MVs ----------

/** Índice da MV do public reapontado pro schema novo (o único é o que permite o CONCURRENTLY). */
export function retargetIndex(indexdef: string, schema: string, mv: string): string {
  return indexdef.replace(/\sON\s+(?:(?:public|"public")\.)?(?:"[^"]+"|\w+)\s+USING/i, ` ON ${q(schema)}.${q(mv)} USING`);
}

// ---------- Montagem ----------

/**
 * Comandos que montam o schema `schema` do zero (numa transação só). A
 * definição das MVs vem sem schema: o SET LOCAL search_path faz ela resolver
 * as views e os enums daqui. A troca pelo `painel` em uso é o swapSql().
 */
export function buildPainelDdl(s: PainelSnapshot, schema: string, opts: PainelOptions = DEFAULT_PAINEL_OPTIONS): string[] {
  const t = new Typing(schema, s.enums);
  const out: string[] = [
    `DROP SCHEMA IF EXISTS ${q(schema)} CASCADE`,
    `CREATE SCHEMA ${q(schema)}`,
  ];
  for (const [name, labels] of Object.entries(s.enums).sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`CREATE TYPE ${q(schema)}.${q(name)} AS ENUM (${labels.map(lit).join(', ')})`);
  }

  for (const [table, cols] of Object.entries(s.publicTables).sort(([a], [b]) => a.localeCompare(b))) {
    const ofi = s.oficialTables[table];
    if (table === 'Order' && ofi) out.push(orderViewSql(schema, cols, ofi, opts, t));
    else if (table === 'CallCenterSale' && ofi) out.push(callCenterViewSql(schema, cols, ofi, opts, t));
    else if (table === 'SalesboundTransaction' && ofi) out.push(salesboundViewSql(schema, cols, ofi, opts, t));
    else if ((table === 'Product' || table === 'Affiliate') && ofi) out.push(catalogViewSql(schema, table, cols, ofi, t));
    else out.push(passThroughSql(schema, table, cols, t));
  }

  out.push(`SET LOCAL search_path = ${q(schema)}, ${PUB}`);
  for (const mv of s.matviews) {
    const body = mv.definition.trim().replace(/;\s*$/, '');
    out.push(`CREATE MATERIALIZED VIEW ${q(schema)}.${q(mv.name)} AS\n${body}`);
    for (const ix of mv.indexes) out.push(retargetIndex(ix, schema, mv.name));
  }
  return out;
}

/** Troca o schema montado pelo `painel` em uso, numa tacada só (dentro da mesma transação). */
export function swapSql(built: string, hash: string): string[] {
  return [
    `DROP SCHEMA IF EXISTS painel_velho CASCADE`,
    `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'painel') THEN EXECUTE 'ALTER SCHEMA painel RENAME TO painel_velho'; END IF; END $$`,
    `ALTER SCHEMA ${q(built)} RENAME TO painel`,
    `DROP SCHEMA IF EXISTS painel_velho CASCADE`,
    `COMMENT ON SCHEMA painel IS 'ddl:${hash}'`,
  ];
}
