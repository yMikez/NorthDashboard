-- Funil (2026-11-05): etapa do upsell da Vupim + famílias sem aba no Funil.
-- Roda UMA vez (prisma migrate deploy), mas é segura se rodar de novo: cada
-- passo só mexe no que ainda não foi acertado.
--
-- 1) Etapa do upsell da Vupim. O painel (Funil de lib/services/metrics.ts)
--    usa a convenção da JVZoo: Upsell N = etapa N+1 (UP1=2, UP2=3, UP3=4) e
--    Downsell N = N+1. A Vupim manda funnelStep = N no upsell (OTO1=1,
--    OTO2 Digest Flow=2, OTO3 Night Calm=3) e N+1 no downsell (Last Chance
--    1 = 2, Last Chance 2 = 3 — já certo). Como o Funil sobe etapa < 2 pra 2,
--    o OTO2 era somado no "Upsell 1", o OTO3 aparecia como "Upsell 2" e o
--    "Upsell 3" nunca aparecia. O connector passou a gravar N+1
--    (lib/connectors/vupim/ingest.ts, vupimFunnelStep); aqui os pedidos já
--    gravados.
--
--    Marca de "já acertado": rawMetadata.vupimFunnelStep = o funnelStep que a
--    Vupim mandou (o connector novo grava igual). Soma +1 só onde a marca não
--    existe (pedido antigo) ou onde a etapa ainda é a crua (estorno processado
--    pelo código novo reescreve o rawMetadata, mas preserva a etapa antiga).

-- 1a) Upsell com etapa: +1.
UPDATE "Order" o
SET "funnelStep" = o."funnelStep" + 1,
    "rawMetadata" = (CASE WHEN jsonb_typeof(o."rawMetadata") = 'object' THEN o."rawMetadata" ELSE '{}'::jsonb END)
      || jsonb_build_object('vupimFunnelStep', o."funnelStep")
FROM "Platform" pl
WHERE pl.id = o."platformId" AND pl.slug = 'vupim'
  AND o."productType" = 'UPSELL'
  AND o."funnelStep" IS NOT NULL
  AND (o."rawMetadata" IS NULL
       OR NOT o."rawMetadata" ? 'vupimFunnelStep'
       OR o."rawMetadata"->>'vupimFunnelStep' = o."funnelStep"::text);

-- 1b) Upsell/downsell SEM etapa: o número pelo nome da etapa ou do produto,
--     como o connector faz ("OTO1"/"OTO 1"/"Upsell 1" → Upsell 1 = etapa 2;
--     "Last Chance 1"/"LastChance1" → Downsell 1 = etapa 2). Sem marcador
--     fica null. A marca vai com null (a Vupim não mandou etapa).
UPDATE "Order" o
SET "funnelStep" = c.step + 1,
    "rawMetadata" = (CASE WHEN jsonb_typeof(o."rawMetadata") = 'object' THEN o."rawMetadata" ELSE '{}'::jsonb END)
      || jsonb_build_object('vupimFunnelStep', NULL::int)
FROM (
  SELECT o2.id, COALESCE(
    substring(COALESCE(o2."rawMetadata"->>'funnelStepName', '') FROM r.re),
    substring(pr.name FROM r.re)
  )::int AS step
  FROM "Order" o2
  JOIN "Platform" pl ON pl.id = o2."platformId" AND pl.slug = 'vupim'
  JOIN "Product" pr ON pr.id = o2."productId"
  CROSS JOIN LATERAL (
    SELECT CASE o2."productType"
      WHEN 'UPSELL' THEN '(?i)\m(?:oto|upsell|upgrade|up)\s*0*(\d+)\M'
      ELSE '(?i)\m(?:last\s*chance|down\s*sell)\s*0*(\d+)\M'
    END AS re
  ) r
  WHERE o2."productType" IN ('UPSELL', 'DOWNSELL') AND o2."funnelStep" IS NULL
) c
WHERE o.id = c.id AND c.step IS NOT NULL;

-- 1c) Catálogo: a etapa do produto (não verificado) da Vupim = a etapa mais
--     comum dos pedidos dele com o mesmo papel. O verificado não muda (o
--     catálogo verificado é a autoridade).
UPDATE "Product" p
SET "funnelStep" = m.step
FROM (
  SELECT DISTINCT ON (o."productId") o."productId", o."productType", o."funnelStep" AS step
  FROM "Order" o
  JOIN "Platform" pl ON pl.id = o."platformId" AND pl.slug = 'vupim'
  WHERE o."productType" IN ('UPSELL', 'DOWNSELL') AND o."funnelStep" IS NOT NULL
  GROUP BY o."productId", o."productType", o."funnelStep"
  ORDER BY o."productId", count(*) DESC, o."funnelStep"
) m
WHERE p.id = m."productId" AND p."productType" = m."productType"
  AND NOT p.verified
  AND p."funnelStep" IS DISTINCT FROM m.step;

-- 2) Famílias que faltavam no classificador (CANONICAL_FAMILIES de
--    lib/services/productClassification.ts): sem família o produto não tinha
--    aba no Funil (Vupim "FE - LungFresh (6 Bottles)", JVZoo "LungFresh -
--    6 Bottles / FE"). Preenche só família VAZIA de produto não verificado,
--    em qualquer plataforma, quando o nome (sem espaço/pontuação, como o
--    normalizeKey do classificador) cita UMA só dessas famílias. O Order não
--    guarda família (vem do Product).
UPDATE "Product" p
SET family = f.family
FROM (VALUES ('lungfresh', 'LungFresh'), ('flushpril', 'FlushPril'), ('memovance', 'Memovance PRO')) AS f(key, family)
WHERE p.family IS NULL AND NOT p.verified
  AND position(f.key IN regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g')) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM (VALUES ('lungfresh'), ('flushpril'), ('memovance')) AS g(key)
    WHERE g.key <> f.key AND position(g.key IN regexp_replace(lower(p.name), '[^a-z0-9]', '', 'g')) > 0
  );
