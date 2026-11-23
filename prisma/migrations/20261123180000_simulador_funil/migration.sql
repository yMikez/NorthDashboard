-- Simulador de Funil (2026-11-23): análises salvas com nome (aba Análise ›
-- Simulador de Funil). Só cria uma tabela nova; não mexe em nada existente.

-- CreateTable
CREATE TABLE "FunnelSimulation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" TEXT,
    "params" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FunnelSimulation_updatedAt_idx" ON "FunnelSimulation"("updatedAt");
