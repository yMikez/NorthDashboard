-- Ofertas de recompra do NeuroRecall criadas pelo usuário na Vupim (2026-10-28).
-- Todas recorrentes: o kit de N frascos entrega e cobra de novo a cada N
-- meses (a página diz isso sob o botão). A assinatura de 1 frasco não tem
-- 1ª cobrança diferente ($49 desde o primeiro mês). Daqui pra frente, links e
-- preços se editam na aba Pesquisas ("Ofertas e textos").
UPDATE "SurveyVariant"
SET "config" = jsonb_set("config", '{offers}', '{
      "assinatura": { "url": "https://vupim.com/c/neurorecall-1-bottle-keep-treatment", "firstPrice": 49, "monthlyPrice": 49 },
      "kits": {
        "2": { "url": "https://vupim.com/c/neurorecall-2-bottles-keep-treatment", "price": 138, "everyMonths": 2 },
        "3": { "url": "https://vupim.com/c/neurorecall-3-bottles-keep-treatment", "price": 192, "everyMonths": 3 },
        "4": { "url": "https://vupim.com/c/neurorecall-4-bottles-keep-treatment", "price": 207, "everyMonths": 4 },
        "6": { "url": "https://vupim.com/c/neurorecall-6-bottles-complete-treatment", "price": 234, "everyMonths": 6 }
      }
    }'::jsonb),
    "version" = "version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'neurorecall';
