// Núcleo PURO da cobertura de estorno por plataforma (DS1 "Dado com
// contexto": leitura parcial é identificada junto ao resultado).
//
// O caso que motivou: a BuyGoods parou de mandar evento de estorno — 90 dias
// com 29 mil vendas aprovadas e ZERO reembolso registrado. O reembolso dela
// aparece como 0% e o total da operação fica subestimado, sem nada na tela
// dizendo isso. Toda plataforma com volume real tem algum estorno num mês;
// silêncio total com volume alto é falha de ingestão, não excelência.
//
// O sinal é derivado do dado, então some sozinho quando a ingestão voltar.

export interface RefundCoverageInput {
  platform: string;
  displayName: string;
  /** vendas aprovadas na janela (por data da compra) */
  sales: number;
  /** eventos de estorno ou chargeback registrados na janela (por data do evento) */
  refundEvents: number;
}

export interface RefundCoverageRow extends RefundCoverageInput {
  /** true = volume suficiente e nenhum estorno: leitura PARCIAL */
  silent: boolean;
}

/**
 * Abaixo disso, zero estorno pode ser normal (base pequena). 200 vendas num
 * mês sem nenhum reembolso não acontece em nutra com afiliado.
 */
export const MIN_SALES_FOR_SILENCE = 200;

export function detectRefundSilence(rows: RefundCoverageInput[], minSales = MIN_SALES_FOR_SILENCE): RefundCoverageRow[] {
  return rows.map((r) => ({ ...r, silent: r.sales >= minSales && r.refundEvents === 0 }));
}

/** Plataformas silenciosas que caem dentro do filtro atual (vazio = todas). */
export function silentInScope(rows: RefundCoverageRow[], platformFilter: string[] | null | undefined): RefundCoverageRow[] {
  const scope = platformFilter && platformFilter.length ? new Set(platformFilter) : null;
  return rows.filter((r) => r.silent && (!scope || scope.has(r.platform)));
}
