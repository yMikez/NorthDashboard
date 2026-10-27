-- Pesquisas / quiz pós-compra (2026-10-27). Primeira variante: NeuroMind Pro,
-- "fim do tratamento" (quem comprou 2 ou 3 frascos e está com o estoque
-- acabando). Ver lib/surveys/fimTratamento.ts.

-- CreateTable
CREATE TABLE "SurveyVariant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "phone" TEXT,
    "bottles" INTEGER NOT NULL,
    "stockUntil" TIMESTAMP(3) NOT NULL,
    "originPlatform" TEXT,
    "channel" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "variantVersion" INTEGER NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "outcome" TEXT,
    "followUp" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "checkoutAt" TIMESTAMP(3),
    "checkoutOutcome" TEXT,
    "csReason" TEXT,
    "csStatus" TEXT,
    "csDueAt" TIMESTAMP(3),
    "csNote" TEXT,
    "csUpdatedAt" TIMESTAMP(3),
    "sendtraceTicketId" TEXT,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SurveyVariant_slug_key" ON "SurveyVariant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyInvite_token_key" ON "SurveyInvite"("token");

-- CreateIndex
CREATE INDEX "SurveyInvite_variantId_createdAt_idx" ON "SurveyInvite"("variantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyInvite_variantId_email_stockUntil_key" ON "SurveyInvite"("variantId", "email", "stockUntil");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_inviteId_key" ON "SurveyResponse"("inviteId");

-- CreateIndex
CREATE INDEX "SurveyResponse_variantId_startedAt_idx" ON "SurveyResponse"("variantId", "startedAt");

-- CreateIndex
CREATE INDEX "SurveyResponse_csStatus_idx" ON "SurveyResponse"("csStatus");

-- AddForeignKey
ALTER TABLE "SurveyInvite" ADD CONSTRAINT "SurveyInvite_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "SurveyVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "SurveyInvite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "SurveyVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Variante NeuroMind Pro. Links de checkout (Vupim) e cupom entram quando o
-- usuário mandar: sem link, a recorrência/cupom não aparece e a pesquisa
-- termina no agradecimento.
INSERT INTO "SurveyVariant" ("id", "slug", "template", "name", "family", "active", "version", "config", "updatedAt")
VALUES (
  'sv_neuromind_pro', 'neuromind-pro', 'fim-tratamento', 'NeuroMind Pro · fim do tratamento', 'NeuroMindPro', true, 1,
  '{
    "productName": "NeuroMind Pro",
    "accent": "#2c5282",
    "planBottles": 6,
    "daysPerBottle": 30,
    "eligibleBottles": [2, 3],
    "checkout": { "recorrencia": null, "cupom": null },
    "trackingParam": "src",
    "coupon": { "code": null, "pct": null, "validDays": 7 },
    "q4": [
      { "id": "nomes", "label": "Remembering names and words more easily" },
      { "id": "foco", "label": "Feeling more focused" },
      { "id": "clareza", "label": "Clearer thinking during the day" }
    ]
  }'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;
