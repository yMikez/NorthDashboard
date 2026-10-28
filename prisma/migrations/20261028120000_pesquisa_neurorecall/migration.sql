-- Pesquisa de fim do tratamento (2026-10-28): a primeira página passa a ser do
-- NeuroRecall, sempre com oferta (exceto nota 1, médico e mal-estar).
--
-- 1) Faixa do cupom escolhida (10/15/20) quando a tela final é de cupom.
ALTER TABLE "SurveyResponse" ADD COLUMN "couponPct" INTEGER;

-- 2) NeuroMind Pro sai do ar (fica a linha, sem convites novos).
UPDATE "SurveyVariant" SET "active" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "slug" = 'neuromind-pro';

-- 3) Variante NeuroRecall. Preços = proposta (front da Vupim: 2 = $158,
--    3 = $207, 6 = $294); links e códigos de cupom entram quando as ofertas
--    forem criadas na Vupim — sem link, a oferta não aparece.
INSERT INTO "SurveyVariant" ("id", "slug", "template", "name", "family", "active", "version", "config", "updatedAt")
VALUES (
  'sv_neurorecall', 'neurorecall', 'fim-tratamento', 'NeuroRecall · fim do tratamento', 'NeuroRecall', true, 1,
  '{
    "productName": "NeuroRecall",
    "accent": "#136e94",
    "image": "/survey-assets/neurorecall.webp",
    "planBottles": 6,
    "daysPerBottle": 30,
    "eligibleBottles": [2, 3],
    "fullPlanFrom": 6,
    "trackingParam": "src",
    "frontPrices": { "2": 158, "3": 207, "6": 294 },
    "offers": {
      "assinatura": { "url": null, "firstPrice": 39, "monthlyPrice": 49 },
      "kits": {
        "3": { "url": null, "price": 177 },
        "4": { "url": null, "price": 216 },
        "6": { "url": null, "price": 264 }
      }
    },
    "coupons": [
      { "pct": 10, "code": null },
      { "pct": 15, "code": null },
      { "pct": 20, "code": null }
    ],
    "couponParam": null,
    "couponValidDays": 7,
    "q4": [
      { "id": "nomes", "label": "Remembering names and words more easily" },
      { "id": "foco", "label": "Feeling more focused" },
      { "id": "clareza", "label": "Clearer thinking during the day" }
    ]
  }'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;
