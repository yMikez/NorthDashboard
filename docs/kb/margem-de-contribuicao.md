---
title: Margem de contribuição (aba Lucro real)
kind: policy
description: Regra oficial de cálculo da margem de contribuição da operação — receita econômica, custos variáveis, parcela NorthScale do backend, margem oficial, lucro por FE e buffer de risco
effectiveDate: 2026-09-18
---

# Margem de contribuição (aba Lucro real)

## Objetivo e escopo

Padroniza o cálculo diário da MARGEM DE CONTRIBUIÇÃO da operação, sempre com as mesmas taxas e a mesma lógica. Não inclui OPEX fixo da empresa (folha, softwares, jurídico, escritório): o resultado é margem de contribuição, não lucro líquido contábil. É a regra da aba Lucro real (admin) e da tool get_net_profit (só admin). Especificação original do dono em calculo_margem_northscale.md, adotada no dashboard em 2026-09-16.

## Fórmula resumida

- Backend líquido NorthScale = Σ por parceiro de (bruto do parceiro − estornos informados pelo parceiro) × parcela da NorthScale.
- Receita econômica = gross das plataformas (front + recuperação) + backend líquido NorthScale.
- Custos variáveis = custo de afiliados (CPA e comissão de recuperação) + reembolso + fee da plataforma + reserva + produto e fulfillment — reembolso, fee, reserva e produto incidem sobre o GROSS das plataformas.
- Lucro de contribuição = receita econômica − custos variáveis.
- Margem OFICIAL = lucro de contribuição ÷ receita econômica × 100.
- Margem sobre o gross das plataformas = lucro ÷ gross × 100 (leitura secundária, só para análise interna).
- Lucro por FE = lucro de contribuição ÷ número de FEs; CPA médio = custo de afiliados ÷ FEs.

## Regras de consistência

1. Reembolso, fee, reserva e produto/fulfillment incidem sobre o gross das plataformas.
2. Backend entra SOMENTE pela parcela líquida que pertence à NorthScale (sem custo de produto ou reembolso projetado, salvo se o admin preencher).
3. Custo de afiliados entra pelo valor efetivamente atribuído ao período.
4. Não incluir OPEX fixo.
5. Não alterar taxas sem registrar a data da mudança — a aba guarda o histórico de premissas (quem mudou qual taxa e quando).
6. A margem oficial é sobre a receita econômica total.
7. Buffer de risco (margem de erro conservadora de 1% a 2% da receita econômica), quando usado, aparece em linha SEPARADA — nunca altera silenciosamente as taxas.
8. O cálculo é reproduzível por dia, período, produto e afiliado com a mesma fórmula.

## Premissas são do admin

Reembolso % das plataformas, custo de produto %, fee (com override por plataforma), reserva e as parcelas dos parceiros são PARÂMETROS da aba Lucro real, editados pelo dono — não constantes. Sempre leia os valores vigentes do resultado da tool e diga que são premissas. Decisões registradas:
- A parcela real da SalesBound é 65% (a NorthScale fica com 35%), confirmada em 2026-09-18; o exemplo original da especificação usava 50%.
- Os estornos informados pelo parceiro são descontados do bruto do backend antes da parcela (a SalesBound estorna cerca de 27% — ignorar inflaria a receita). É um desvio consciente da especificação literal, ligado por padrão.
- A reserva é tratada como custo; se um dia ficar confirmado que ela volta integralmente, passa a ser impacto de caixa, separado da margem econômica.

## Exemplo da especificação (números históricos)

Exemplo que acompanhou a especificação de 2026-09 — ilustrativo, NÃO é o resultado atual:
- Gross JVZoo $513,000.00; 1,241 FEs; custo de afiliados $308,948.96 (CPA médio $248.95).
- Refund projetado 20% ($102,600.00), fee JVZoo 8.5% ($43,605.00), reserva 5% ($25,650.00), produto + fulfillment 12% ($61,560.00).
- Backend: Logicall $23,916 × 70% = $16,741.20; Tauk $16,000 × 70% = $11,200.00; SalesBound $29,000 × 50% = $14,500.00 (parcela corrigida depois para 35%); total $42,441.20.
- Receita econômica $555,441.20; custos variáveis $542,363.96; lucro de contribuição $13,077.24.
- Margem oficial 2.35% (sobre o gross JVZoo seria 2.55%); lucro por FE $10.54.
- Com buffer de 2% da receita econômica ($11,108.82): lucro ajustado $1,968.42, margem ajustada 0.35%.

## Diferença para as outras lentes de lucro

- Net after CPA (modelo) da Visão Geral usa refund&cb% do modelo por plataforma e opex%, sem custo real de produto e sem a parcela do backend.
- Lucro de custo real (lente de custo registrado) usa COGS e frete registrados e não soma backend.
- A margem de contribuição conta reembolso pela premissa do admin ou pelo observado por DATA DO ESTORNO — por isso difere das coortes.
