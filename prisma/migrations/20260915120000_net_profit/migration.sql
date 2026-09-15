-- Lucro real (aba admin): parâmetros vigentes + projeções salvas.

-- CreateTable
CREATE TABLE "NetProfitParams" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "params" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "NetProfitParams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetProfitScenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "params" JSONB NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "NetProfitScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NetProfitScenario_createdAt_idx" ON "NetProfitScenario"("createdAt");
