# Carteira de afiliados (aba Carteira)

Equipe de captação de afiliados e quem enxerga o quê. Código:
`lib/portfolio/core.ts` (regras, puro), `lib/portfolio/scope.ts` (recorte),
`lib/portfolio/service.ts` (aba e ações), `lib/portfolio/admin.ts` (tela de Usuários).

## Equipe

| Função | Responde a | Vê |
| --- | --- | --- |
| Gerente de afiliados | ninguém (tem região: Brasil, USA, Europa…) | a carteira dele + a dos Squad Leaders e Hunters abaixo |
| Squad Leader | um Gerente | a carteira dele + a dos Hunters do squad |
| Hunter | um Squad Leader | só a carteira dele |

Quem configura é o admin, em **Usuários**: função, "responde a" e região.
Admin com função aparece na equipe, mas segue vendo tudo. Quem não tem
função vê como sempre viu.

## O que entra na carteira

O dono é a **pessoa** afiliada (a identidade unificada da Análise): todas as
contas dela, em qualquer plataforma. Conta que for unificada à pessoa depois
entra sozinha. O dono atual vê o afiliado **desde a 1ª venda**; a data da
atribuição fica registrada ("Desde").

Na fusão de duas pessoas, a que sobra herda o dono de uma absorvida quando não
tem o seu.

## Como o afiliado entra na carteira

- **Hunter pede** (aba Carteira → Sem dono → Pedir). Quem aprova é quem está
  acima dele (o Squad Leader ou o Gerente) ou a operação. Um pedido aberto por
  afiliado.
- **Squad Leader e Gerente** pegam pra si ou atribuem direto a alguém da
  equipe abaixo; transferem entre a própria equipe e liberam (volta pra Sem dono).
- **Operação** (admin ou quem tem a aba sem função) atribui, transfere e libera qualquer um.

"Sem dono" lista as pessoas e contas com venda nos últimos 90 dias. O afiliado
só existe no dash depois da 1ª venda. Toda troca vira histórico.

## O que quem tem função enxerga

- **Abas:** Visão geral, Funil, Reembolsos, Afiliados (Ranking), Análise, CRM,
  Produtos e Carteira. Todas recortadas pela carteira. As outras ficam fechadas
  mesmo se marcadas: Transações, Leads, Pesquisas e Recorrências (dado de
  cliente), Call Center, Recuperação, Lucro real, Plataformas, Saúde, VSLs,
  Networks e o chat IA (lêem a operação inteira).
- **Recorte:** o mesmo ponto do filtro global "Afiliado" — o servidor troca
  "sem filtro" pela carteira e intersecta qualquer escolha com ela. Fora da
  carteira = zero, nunca o total.
- Dentro das abas liberadas, ficam de fora: resultado oficial por plataforma,
  monitor de call center, mapeamento do NorthScale Afiliados, sugestões de
  unificação e contagens globais de pedidos no filtro.
- Contato e origem: só das pessoas da carteira. Unificar contas fica com a operação.

## Filtro por captador

O filtro global "Afiliado" lista os captadores (`c:<id>` = a carteira dele e a
da equipe abaixo): o Squad Leader filtra qualquer aba por um Hunter; o
Gerente, por um squad. Na Análise, cada pessoa mostra o captador dono.

## Números da aba Carteira

Vendas aprovadas (mesma régua do Ranking e do Funil), sem venda de rede, em dias
de Brasília: 7 e 30 dias fechando ontem, contra os 30 anteriores. "Com equipe"
soma o captador e todos abaixo dele.
