---
name: recuperacao-backend
title: Backend e recuperação (call center, SMS, afiliados de recuperação)
when: Tauk, Logicall, SalesBound, call center, SMS, recuperação, afiliado de recuperação (ex.: lusk1nha, skill99), lucro do BACK
first_tools: get_call_center, get_sms, get_recovery, get_profit_split
version: 1
---
## Passos
1. Em paralelo: get_call_center(provider=all) — providers traz a linha de cada parceiro (tauk, logicall, salesbound); get_sms; get_recovery; get_profit_split (back.sources).
2. Detalhe de um parceiro: get_call_center(provider=<parceiro>) → agentes (humano × IA), produtos, pendentes.
3. Participação de cada fonte no lucro total e comissão efetiva → calc.

## Checagens obrigatórias
- Backend fica FORA do get_overview (a receita das plataformas não inclui call center).
- commissionPct do call center é fração (0.30 = 30%); commissionAssumed=true → comissão ASSUMIDA, diga.
- SalesBound: estornos, voids e recusas só entram pelo export CSV (o webhook não marca) — período depois do último import tem estorno faltando; webhook em Eastern, export em Central.
- get_call_center usa lente de COORTE (estorno abate a venda pela data da venda); o Lucro real conta estorno pela data do estorno — números diferentes de propósito.
- get_profit_split.back: com filtro de pedido Tauk e Logicall saem; SalesBound vem available:false (não somado).
- Afiliado de recuperação ganha comissão % sobre venda aprovada (histórico de taxas em get_recovery).

## Formato
- table por fonte: bruto | comissão | líquido | estornos | pendentes | participação no lucro total.
- Veredito: quanto o back soma ao lucro e qual fonte pesa mais.
- scope com período e lente (coorte × data do estorno).
