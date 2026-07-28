// Monitor de call center (aba Produtos) — contador de vendas/dia por
// produto vigiado (CallCenterWatch), por plataforma.
//
// Regra operacional (usuário, 2026-07-28):
//   ≥ 30 vendas/dia  → hora de CONECTAR A TAUK (call center de recuperação)
//   ≥ 100 vendas/dia → hora de INTEGRAR A SALESBOUND (call center de cross-sell)
//
// "Vendas/dia" = pedidos FRONTEND APROVADOS da família na plataforma,
// bucketados em dia BRT. O nível dispara pela MÉDIA DOS ÚLTIMOS 3 DIAS
// COMPLETOS — reage rápido a rampa real sem alarmar com pico de 1 dia.
// A tabela mostra também hoje (parcial), ontem e a média 7d pra contexto.
//
// Match de família: igualdade NORMALIZADA (minúsculas, sem espaços e
// pontuação) — "RetraBurn" == "Retra Burn". Igualdade estrita depois de
// normalizar, NUNCA substring ("Lumicept" não pode engolir "Lumicept
// Gummies"). Watch com family NULL = todas as famílias da plataforma.

import { db } from '../db';

export const TAUK_THRESHOLD_PER_DAY = 30;
export const SALESBOUND_THRESHOLD_PER_DAY = 100;

const BRT_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

function brtDay(d: Date): string {
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export function normalizeFamilyKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type CallCenterLevel = 'ok' | 'tauk' | 'salesbound';

export interface CallCenterWatchRow {
  id: string;
  platformSlug: string;
  family: string | null;
}

export interface CallCenterOrderRow {
  platformSlug: string;
  family: string | null;
  productName: string;
  orderedAt: Date;
}

export interface CallCenterProductRow {
  watchId: string;
  platformSlug: string;
  // Nome exibido: família do catálogo quando casou; senão o nome do watch
  // (dormente — produto ainda não vendeu/nasceu).
  family: string;
  // true = watch existe mas nenhuma venda/família casou na janela.
  dormant: boolean;
  // true = linha derivada de um watch de plataforma inteira (family NULL).
  // Remover essa linha remove o monitor da PLATAFORMA — a UI avisa.
  wildcard: boolean;
  today: number;
  yesterday: number;
  avg3d: number;
  avg7d: number;
  peak7d: number;
  level: CallCenterLevel;
}

export interface CallCenterResponse {
  thresholds: { tauk: number; salesbound: number };
  rows: CallCenterProductRow[];
  alerts: CallCenterProductRow[];
}

export function levelFor(avg3d: number): CallCenterLevel {
  if (avg3d >= SALESBOUND_THRESHOLD_PER_DAY) return 'salesbound';
  if (avg3d >= TAUK_THRESHOLD_PER_DAY) return 'tauk';
  return 'ok';
}

// Reducer puro (testável). `orders` = pedidos FE aprovados da janela
// (últimos 8 dias BRT); `now` injetável.
export function reduceCallCenter(
  watches: CallCenterWatchRow[],
  orders: CallCenterOrderRow[],
  now: Date,
): CallCenterResponse {
  const today = brtDay(now);
  const dayNAgo = (n: number) => brtDay(new Date(now.getTime() - n * DAY_MS));

  // (plataforma|famKey) → { displayName, porDia }. fromNullFamily marca
  // agregações derivadas do NOME do produto (catálogo sem família) — só
  // essas aceitam match por prefixo (fallback do watch explícito).
  interface Agg { display: string; byDay: Map<string, number>; fromNullFamily: boolean }
  const byFamily = new Map<string, Agg>();
  for (const o of orders) {
    const famDisplay = o.family ?? o.productName;
    const key = `${o.platformSlug}|${normalizeFamilyKey(famDisplay)}`;
    const day = brtDay(o.orderedAt);
    const a = byFamily.get(key) ?? { display: famDisplay, byDay: new Map<string, number>(), fromNullFamily: o.family == null };
    a.byDay.set(day, (a.byDay.get(day) ?? 0) + 1);
    byFamily.set(key, a);
  }

  const metricsFor = (watchId: string, platformSlug: string, display: string, agg: Agg | null, wildcard: boolean): CallCenterProductRow => {
    const count = (day: string) => agg?.byDay.get(day) ?? 0;
    let sum3 = 0;
    let sum7 = 0;
    let peak = 0;
    for (let i = 1; i <= 7; i++) {
      const c = count(dayNAgo(i));
      if (i <= 3) sum3 += c;
      sum7 += c;
      if (c > peak) peak = c;
    }
    const avg3d = Math.round((sum3 / 3) * 10) / 10;
    return {
      watchId,
      platformSlug,
      family: display,
      dormant: agg === null,
      wildcard,
      today: count(today),
      yesterday: count(dayNAgo(1)),
      avg3d,
      avg7d: Math.round((sum7 / 7) * 10) / 10,
      peak7d: peak,
      level: levelFor(avg3d),
    };
  };

  // Chaves cobertas por watch EXPLÍCITO, por plataforma — o wildcard pula
  // essas famílias (senão explícito+wildcard duplicariam linha e alerta).
  const explicitKeys = new Set<string>();
  for (const w of watches) {
    if (w.family != null) explicitKeys.add(`${w.platformSlug}|${normalizeFamilyKey(w.family)}`);
  }

  const rows: CallCenterProductRow[] = [];
  for (const w of watches) {
    if (w.family != null) {
      const wKey = normalizeFamilyKey(w.family);
      const key = `${w.platformSlug}|${wKey}`;
      let agg = byFamily.get(key) ?? null;
      let display = agg?.display ?? w.family;
      if (!agg) {
        // Fallback pra produto que o catálogo ainda não classificou
        // (family NULL → agregado pelo NOME do SKU): match por PREFIXO,
        // só nessas chaves ("heartflush" casa "heartflushtrialpack").
        // Famílias reais do catálogo seguem por igualdade estrita.
        const merged = new Map<string, number>();
        for (const [k, a] of byFamily) {
          if (!a.fromNullFamily || !k.startsWith(`${w.platformSlug}|${wKey}`)) continue;
          for (const [day, c] of a.byDay) merged.set(day, (merged.get(day) ?? 0) + c);
        }
        if (merged.size > 0) {
          agg = { display: w.family, byDay: merged, fromNullFamily: true };
          display = w.family;
        }
      }
      rows.push(metricsFor(w.id, w.platformSlug, display, agg, false));
    } else {
      // Wildcard: uma linha por família vista na plataforma na janela
      // (menos as já cobertas por watch explícito).
      const prefix = `${w.platformSlug}|`;
      let any = false;
      for (const [key, agg] of byFamily) {
        if (!key.startsWith(prefix) || explicitKeys.has(key)) continue;
        any = true;
        rows.push(metricsFor(w.id, w.platformSlug, agg.display, agg, true));
      }
      if (!any) {
        rows.push(metricsFor(w.id, w.platformSlug, 'Todos os produtos', null, true));
      }
    }
  }

  rows.sort((a, b) => b.avg3d - a.avg3d || a.family.localeCompare(b.family));
  return {
    thresholds: { tauk: TAUK_THRESHOLD_PER_DAY, salesbound: SALESBOUND_THRESHOLD_PER_DAY },
    rows,
    alerts: rows.filter((r) => r.level !== 'ok'),
  };
}

export async function getCallCenter(): Promise<CallCenterResponse> {
  const now = new Date();
  // 8 dias BRT cobrem hoje (parcial) + 7 completos.
  const windowStart = new Date(now.getTime() - 8 * DAY_MS);

  const [watches, orders] = await Promise.all([
    db.callCenterWatch.findMany({
      where: { enabled: true },
      select: { id: true, platformSlug: true, family: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.order.findMany({
      where: {
        status: 'APPROVED',
        productType: 'FRONTEND',
        orderedAt: { gte: windowStart, lte: now },
        // Cobrança recorrente NÃO é venda nova — rebill mensal de assinatura
        // inflaria o contador e dispararia Tauk falso. JVZoo marca rebill no
        // eventType ('bill'/'uncancel-rebill'); Digistore usa paySequenceNo>1.
        eventType: { notIn: ['bill', 'uncancel-rebill'] },
        OR: [{ paySequenceNo: null }, { paySequenceNo: { lte: 1 } }],
      },
      select: {
        orderedAt: true,
        platform: { select: { slug: true } },
        product: { select: { family: true, name: true } },
      },
    }),
  ]);

  return reduceCallCenter(
    watches,
    orders.map((o) => ({
      platformSlug: o.platform.slug,
      family: o.product.family,
      productName: o.product.name,
      orderedAt: o.orderedAt,
    })),
    now,
  );
}
