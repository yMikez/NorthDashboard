# Painel de cohort de reembolso

## O problema que isso resolve

Hoje a taxa de reembolso é calculada como reembolso do período dividido por venda do período. Isso quebra toda vez que o volume de venda muda rápido: um reembolso de uma venda de duas semanas atrás cai no mês errado e distorce a taxa pra cima ou pra baixo sem nenhum motivo real de qualidade. O painel abaixo resolve isso prendendo cada reembolso no dia em que a venda original aconteceu, não no dia em que o reembolso caiu.

## Dado de entrada

Duas entidades, ligadas pelo id da transação:

**Venda**

- `transaction_id` (único)  
- `product` (ou SKU)  
- `sale_date`  
- `amount`  
- `client_id` (se o painel for multi-cliente)

**Reembolso**

- `transaction_id` (mesmo id da venda que ele reembolsa)  
- `refund_date`  
- `refund_amount`

Isso vem direto do export do gateway (JVZoo, ClickBank, CartPanda, o que for). Cada gateway rotula diferente, mas a estrutura é sempre a mesma: uma linha de crédito na venda e uma linha de débito no reembolso, com um id em comum entre as duas. No JVZoo especificamente, a venda é a linha `Credit` e o reembolso é a linha `Refund`, e o `Transaction Number` é o campo que liga as duas. Ignorar linhas de taxa de processamento, estorno de comissão de afiliado e saque/distribuição: essas não são reembolso de cliente.

## Regra central

`dias_para_reembolso = refund_date - sale_date` (nulo se nunca foi reembolsado)

O reembolso é sempre atribuído ao `sale_date` da venda original, independente de quantos dias depois ele aconteceu.

## O que o painel precisa mostrar

**1\. Matriz de cohort**

Linha \= dia da venda. Coluna \= dias desde a venda (0, 1, 2... N). Célula \= % acumulado de reembolso das vendas daquele dia, considerando só reembolsos com `dias_para_reembolso <= coluna`.

Regra de censura: se `hoje - sale_date < coluna`, a célula fica em branco, não em zero. Esse cohort ainda não teve tempo de chegar naquele dia, é diferente de "chegou e não reembolsou nada".

Toggle pra alternar a métrica entre contagem de transação e valor em $ (os dois divergem quando ticket médio varia entre reembolsados e não reembolsados).

Visual: heatmap, verde no valor baixo, vermelho no valor alto, número dentro da célula.

**2\. Curva agregada de maturação**

Pra cada dia N, olhar só os cohorts que já têm N dias de idade e calcular a % agregada (soma de reembolsados até o dia N dividido pela soma da base elegível daquele grupo). É essa curva que mostra se a operação tá saudável mês a mês, sem o viés dos cohorts recentes ainda imaturos puxando a média pra baixo.

**3\. Filtro por produto**

Precisa de um mapeamento configurável de "nome bruto do produto" pra "família" (ex: "Neuro Mind Pro 6 Bottles", "Neuro Mind Pro 6 Bottles (Upgrade)" e "Neuro Mind Pro 3 Bottles (Last Chance)" caem todos em "Neuro Mind Pro"). Não codar esse mapeamento fixo no código, cada client tem nomenclatura própria de produto e isso muda.

**4\. Aviso de amostra baixa**

Se o N do cohort for menor que um limite (sugiro 30, mas deixa configurável), marcar a célula com um indicador visual (cinza, ícone, o que for mais fácil de implementar). Um cohort de 2 vendas com 1 reembolso mostra 50% e isso não é uma taxa, é ruído.

## Fase 2 (não precisa entrar no MVP)

Projeção de onde a taxa de cada cohort recente deve estabilizar quando atingir maturidade completa, ajustando uma curva de saturação em cima do histórico observado. Isso é estatística, não é trivial de fazer client side. Se quiser encaixar depois, eu specifico a fórmula.

## Sugestão de schema (Postgres / Supabase)

```sql
create table refund_events (
  transaction_id text primary key,
  client_id text,
  product text not null,
  sale_date date not null,
  sale_amount numeric not null,
  refund_date date,
  refund_amount numeric
);
```

Query base pra montar uma célula da matriz (dia da venda `:data`, dias decorridos `:dia`, produto `:produto`):

```sql
select
  count(*) as n_vendas,
  count(*) filter (
    where refund_date is not null
    and (refund_date - sale_date) <= :dia
  ) as n_reembolsos_ate_dia
from refund_events
where sale_date = :data
  and product = :produto
  and (current_date - sale_date) >= :dia
```

Se `(current_date - sale_date) < :dia`, não roda a query, a célula fica em branco.  
