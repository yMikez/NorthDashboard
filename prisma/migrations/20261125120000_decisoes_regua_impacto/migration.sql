-- Decisões (aba Decisões): régua nova da IA (2026-11-25, pedido do usuário) —
-- só decisão de impacto e abrangência; ajuste pontual (CPA de um afiliado,
-- liberar uma conta…) fica fora.
--
-- Sai o que a régua antiga detectou e ninguém revisou. Confirmada, descartada,
-- editada ou registrada à mão fica. As threads voltam sozinhas pra fila da IA
-- (a impressão gravada não tem o prefixo da versão nova, lib/decisions/extract.ts)
-- e o que passar na régua nova reaparece.
DELETE FROM "Decision"
WHERE "status" = 'DETECTED' AND "edited" = false AND "threadRootId" IS NOT NULL;
