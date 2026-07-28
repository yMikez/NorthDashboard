-- CreateTable
CREATE TABLE "CallCenterWatch" (
    "id" TEXT NOT NULL,
    "platformSlug" TEXT NOT NULL,
    "family" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallCenterWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallCenterWatch_platformSlug_family_key" ON "CallCenterWatch"("platformSlug", "family");

-- CreateIndex
CREATE INDEX "CallCenterWatch_enabled_idx" ON "CallCenterWatch"("enabled");

-- Seed inicial (lista do usuário, 2026-07-28): produtos ainda SEM call
-- center. Os demais já foram integrados. Match é por nome normalizado,
-- então "RetraBurn" casa a família "Retra Burn" do Digistore.
INSERT INTO "CallCenterWatch" ("id", "platformSlug", "family") VALUES
  ('ccw_bg_hawaiian',  'buygoods',    'Hawaiian Harmony'),
  ('ccw_bg_horsepeak', 'buygoods',    'Horse Peak Gelatin'),
  ('ccw_bg_retraburn', 'buygoods',    'RetraBurn'),
  ('ccw_bg_heartflush','buygoods',    'HeartFlush'),
  ('ccw_bg_honeypril', 'buygoods',    'HoneyPril'),
  ('ccw_d24_retraburn','digistore24', 'RetraBurn'),
  ('ccw_d24_hawaiian', 'digistore24', 'Hawaiian Harmony'),
  ('ccw_jvzoo_all',    'jvzoo',       NULL);
