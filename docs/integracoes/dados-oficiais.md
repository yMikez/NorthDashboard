# Dados oficiais (time de dados)

O time de dados (Douglas) carrega no mesmo Postgres, de hora em hora, o schema
`dados_oficiais`: a JVZoo inteira desde 23/06/2026 (conferida venda a venda com o
extrato), Logicall, Tauk e SalesBound, mais os números prontos do painel dele
(`dq_big_numbers_diario`) e os acertos (`logicall_acerto`, `tauk_acerto`,
`salesbound_acerto`). O dono do schema é outro papel (`dados_oficiais_carga`):
o dashboard só lê.

## Como liga e desliga

| `.env` do servidor | O que as telas leem |
|---|---|
| `METRICS_SOURCE=public` (ou ausente) | o `public`, como sempre |
| `METRICS_SOURCE=oficial` | o schema `painel` (abaixo) |

Trocar a variável e recriar o app (`docker compose up -d app`). Não precisa deploy.
Ligado em produção em 27/10/2026; backup do `.env` anterior em
`/opt/dashboard/.env.bak-20261027-antes-oficial`.

No boot, com a flag ligada, `scripts/painelSchema.ts --boot` confere o schema
`painel` (refaz só se algo mudou: migração nova, coluna nova no oficial, MV
redefinida) e grava `/tmp/painel-pronto`. Sem esse arquivo a flag não liga: se o
painel falhar no boot, as telas seguem no `public` em vez de cair.

Escrita (IPN, conectores, imports, cadastros) continua sempre no `public`.

## O schema `painel`

Montado por `lib/painel/ddl.ts` a partir do retrato vivo do banco:

- **JVZoo (`Order`), Logicall e Tauk (`CallCenterSale`), SalesBound
  (`SalesboundTransaction`)**: as linhas vêm 100% do oficial. O `public` só
  completa o que o oficial não tem (COGS, frete, potes, etapa, `campaignKey`,
  `mappedAffiliateId`, `networkId`, contato), casando pela chave natural, nunca
  por id. A classificação do catálogo (`productType`) e a sessão do funil são as
  nossas (`PAINEL_SESSAO=oficial` troca pela do Douglas).
- **Tempo real**: depois da última venda carregada no oficial entram as que
  chegaram pelo IPN (JVZoo, Logicall, SalesBound); a carga seguinte as
  substitui. A Tauk não entra: a chave é outra e o horário do webhook fica 4h à
  frente (5h no inverno), então o corte duplicaria. `PAINEL_TEMPO_REAL=0` desliga.
- **E-mail da Tauk**: o oficial ainda não traz. Até trazer, vem da venda do
  webhook casada por valor + horário exato com 4h/5h de diferença, só quando há
  um único candidato (4.557 de 4.615 em 27/10).
- **Cadastro** (`Product`, `Affiliate`): o do `public` + o que só o oficial tem.
- **Resto**: view de passagem pro `public`.
- **Enums**: cópias no `painel` (o Prisma qualifica o cast com o schema da
  conexão e o Postgres não compara enum com DOMAIN).
- `daily_metrics` e `lead_summary`: as mesmas MVs, sobre as views. As do
  `public` continuam sendo atualizadas (são o rollback).

Ver o SQL sem aplicar: `npx tsx scripts/painelSchema.ts`. Aplicar à mão:
`--apply` (`--force` refaz mesmo sem mudança).

## Números oficiais nas telas

Lidos do que o Douglas publica (`lib/services/oficial.ts`), não recalculados:
cada plataforma no dia da sua fonte (JVZoo em Nova York, Logicall no Pacífico,
SalesBound em Chicago, Tauk em UTC), filtrada pelo dia-rótulo do período.

- Visão geral: faixa "Resultado oficial por plataforma".
- Call Center: cards e bloco "Acerto oficial por parceiro".
- Lucro real: o back-end usa o líquido do acerto.
- Saúde: cargas do `dados_oficiais._cargas`; Plataformas: "sincronizado" da
  JVZoo = última carga ok.

## Conferência (27/10/2026)

- Nenhum pedido duplicado; nenhuma JVZoo do `public` antes da última carga.
- ClickBank, Digistore, BuyGoods, Cartpanda e Vupim: diferença zero.
- JVZoo set/26 na MV: 27.941 aprovados (antes 27.820) e 1.062 chargebacks que
  antes eram reembolso.
- Tempo: refresh da `daily_metrics` 1,3 s (antes 0,95 s); consulta típica de
  pedidos do mês 344 ms (antes 160 ms); `lead_summary` 27 s (antes 19 s).
