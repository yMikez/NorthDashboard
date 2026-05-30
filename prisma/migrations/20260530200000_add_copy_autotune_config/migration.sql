-- Copy Optimizer Fase 7: config global do auto-tune (singleton). Insere a row
-- 'global' com os defaults — o app sempre lê dela (fallback pros defaults no
-- código se por algum motivo não existir).

CREATE TABLE "CopyAutotuneConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "cooldownH" INTEGER NOT NULL DEFAULT 12,
    "windowH" INTEGER NOT NULL DEFAULT 48,
    "minSample" INTEGER NOT NULL DEFAULT 30,
    "liftThresholdPp" INTEGER NOT NULL DEFAULT 5,
    "adverseThresholdPp" INTEGER NOT NULL DEFAULT -5,
    "globalTargetAov" DECIMAL(10,2) NOT NULL DEFAULT 220,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopyAutotuneConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "CopyAutotuneConfig" ("id") VALUES ('global')
ON CONFLICT ("id") DO NOTHING;
