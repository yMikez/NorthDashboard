-- Aba VSLs: visita de teste descartada pela equipe sai de todas as métricas
-- (rastreio, compra confirmada, A/B, quadro por afiliado).
ALTER TABLE "VslVisit" ADD COLUMN "discardedAt" TIMESTAMP(3);
