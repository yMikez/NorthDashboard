-- Eixo de EVENTO dos estornos. Os cards de reembolso da Visão Geral e a
-- lista de transações filtrada por refunded/chargeback passam a consultar
-- por refundedAt/chargebackAt (quando o estorno ACONTECEU) em vez de
-- orderedAt (quando a venda aconteceu). Na Digistore o refund é linha extra
-- carimbada com a data da venda original — sem este eixo o estorno de hoje
-- caía semanas atrás e o dia atual aparecia zerado.
--
-- Só linhas estornadas têm valor não-nulo, então o índice é pequeno.

-- CreateIndex
CREATE INDEX "Order_refundedAt_idx" ON "Order"("refundedAt");

-- CreateIndex
CREATE INDEX "Order_chargebackAt_idx" ON "Order"("chargebackAt");
