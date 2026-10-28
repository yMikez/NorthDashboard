-- A assinatura de 1 frasco do NeuroRecall passou a US$ 69/mês na Vupim
-- (usuário, 2026-10-28). Sem isso a página mostraria US$ 49 e a Vupim
-- cobraria US$ 69. Daqui pra frente o preço se edita na aba Pesquisas.
UPDATE "SurveyVariant"
SET "config" = jsonb_set(
      jsonb_set("config", '{offers,assinatura,monthlyPrice}', '69'::jsonb),
      '{offers,assinatura,firstPrice}', '69'::jsonb),
    "version" = "version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'neurorecall'
  AND ("config" #>> '{offers,assinatura,monthlyPrice}')::numeric = 49;
