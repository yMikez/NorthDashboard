# Cálculo de Margem — NorthScale

## Objetivo

Padronizar o cálculo diário da **margem de contribuição da operação**, usando sempre as mesmas taxas e a mesma lógica.

> Este cálculo **não inclui OPEX fixo** da empresa, como folha, salários, softwares, jurídico, escritório etc.  
> Portanto, o resultado abaixo é **margem de contribuição**, não lucro líquido contábil.

---

## 1. Dados-base utilizados

### Front-end / JVZoo

- **Gross JVZoo:** US$ 513.000,00
- **Pedidos / FEs:** 1.241
- **Custo total de afiliados:** US$ 308.948,96
- **CPA médio:** US$ 248,95

### Taxas e provisões

- **Refund projetado:** 20,0% do gross JVZoo
- **Fee JVZoo:** 8,5% do gross JVZoo
- **Reserva tratada como custo:** 5,0% do gross JVZoo
- **Produto + fulfillment:** 12,0% do gross JVZoo

### Backend

Valores informados são gross de cada canal.  
Para o cálculo da margem, considerar somente a parcela pertencente à NorthScale.

- **Logicall gross:** US$ 23.916,00
  - NorthScale: 70%
  - Receita líquida NorthScale: **US$ 16.741,20**

- **TAUK gross:** US$ 16.000,00
  - NorthScale: 70%
  - Receita líquida NorthScale: **US$ 11.200,00**

- **SalesBound gross:** US$ 29.000,00
  - NorthScale: 50%
  - Receita líquida NorthScale: **US$ 14.500,00**

- **Backend líquido total NorthScale:** **US$ 42.441,20**

> **Correção de taxa — 2026-09-18 (regra §10.5):** a parcela real da SalesBound é
> **65%**, ou seja, a NorthScale fica com **35%**, e não com os 50% usados no
> exemplo acima. O dashboard já calcula com 65% (parâmetro da aba Lucro real e
> `salesbound.commissionPct` nas Integrações). Os números deste exemplo foram
> mantidos como estavam para não reescrever a memória do cálculo original.

---

## 2. Fórmulas

### 2.1 CPA médio

```text
CPA médio = custo total de afiliados / quantidade de FEs
```

```text
CPA médio = 308.948,96 / 1.241
CPA médio = US$ 248,95
```

---

### 2.2 Refund projetado

```text
Refund = Gross JVZoo × 20%
```

```text
Refund = 513.000 × 0,20
Refund = US$ 102.600,00
```

---

### 2.3 Fee JVZoo

```text
Fee JVZoo = Gross JVZoo × 8,5%
```

```text
Fee JVZoo = 513.000 × 0,085
Fee JVZoo = US$ 43.605,00
```

---

### 2.4 Reserva

```text
Reserva = Gross JVZoo × 5%
```

```text
Reserva = 513.000 × 0,05
Reserva = US$ 25.650,00
```

> Para este modelo, a reserva está sendo tratada como custo.  
> Caso futuramente seja confirmado que a reserva é devolvida integralmente, ela deve ser separada da margem econômica e tratada como impacto de caixa.

---

### 2.5 Produto + fulfillment

```text
Produto + fulfillment = Gross JVZoo × 12%
```

```text
Produto + fulfillment = 513.000 × 0,12
Produto + fulfillment = US$ 61.560,00
```

---

### 2.6 Backend líquido

```text
Logicall líquido = Logicall gross × 70%
TAUK líquido = TAUK gross × 70%
SalesBound líquido = SalesBound gross × 50%
```

```text
Logicall líquido = 23.916 × 0,70 = US$ 16.741,20
TAUK líquido = 16.000 × 0,70 = US$ 11.200,00
SalesBound líquido = 29.000 × 0,50 = US$ 14.500,00
```

```text
Backend líquido total = 16.741,20 + 11.200 + 14.500
Backend líquido total = US$ 42.441,20
```

---

## 3. Receita econômica usada no cálculo

```text
Receita econômica = Gross JVZoo + Backend líquido total
```

```text
Receita econômica = 513.000 + 42.441,20
Receita econômica = US$ 555.441,20
```

---

## 4. Custos variáveis totais

```text
Custos variáveis =
Afiliados
+ Refund projetado
+ Fee JVZoo
+ Reserva
+ Produto + fulfillment
```

```text
Custos variáveis =
308.948,96
+ 102.600,00
+ 43.605,00
+ 25.650,00
+ 61.560,00
```

```text
Custos variáveis totais = US$ 542.363,96
```

---

## 5. Lucro de contribuição

```text
Lucro de contribuição = Receita econômica - Custos variáveis totais
```

```text
Lucro de contribuição = 555.441,20 - 542.363,96
Lucro de contribuição = US$ 13.077,24
```

---

## 6. Margem de contribuição

### Fórmula oficial

```text
Margem % = Lucro de contribuição / Receita econômica × 100
```

```text
Margem % = 13.077,24 / 555.441,20 × 100
Margem = 2,35%
```

### Margem sobre o gross principal

Opcionalmente, para análise interna também pode ser exibida a margem sobre o gross JVZoo:

```text
Margem sobre gross = Lucro de contribuição / Gross JVZoo × 100
```

```text
Margem sobre gross = 13.077,24 / 513.000 × 100
Margem sobre gross = 2,55%
```

> Para consistência, o dashboard deve usar **2,35% como margem oficial**, pois o denominador inclui também a receita líquida de backend.

---

## 7. Lucro por FE

```text
Lucro por FE = Lucro de contribuição / quantidade de FEs
```

```text
Lucro por FE = 13.077,24 / 1.241
Lucro por FE = US$ 10,54
```

---

## 8. Fórmula resumida para implementação

```text
backend_liquido =
(logicall_gross × 0,70)
+ (tauk_gross × 0,70)
+ (salesbound_gross × 0,50)

receita_economica =
gross_jvzoo
+ backend_liquido

custos =
custo_afiliados
+ (gross_jvzoo × 0,20)
+ (gross_jvzoo × 0,085)
+ (gross_jvzoo × 0,05)
+ (gross_jvzoo × 0,12)

lucro_contribuicao =
receita_economica
- custos

margem_pct =
(lucro_contribuicao / receita_economica) × 100
```

---

## 9. Buffer conservador opcional

Se o dashboard privado utilizar margem de erro conservadora de 1% a 2%, mostrar como uma linha separada.

Exemplo com buffer de 2% sobre a receita econômica:

```text
Risk Buffer = Receita econômica × 2%
```

```text
Risk Buffer = 555.441,20 × 0,02
Risk Buffer = US$ 11.108,82
```

```text
Lucro ajustado = Lucro de contribuição - Risk Buffer
Lucro ajustado = US$ 1.968,42
```

```text
Margem ajustada = 1.968,42 / 555.441,20 × 100
Margem ajustada = 0,35%
```

> O Risk Buffer deve aparecer separado para não alterar silenciosamente as taxas reais da operação.

---

## 10. Regras de consistência

1. Refund, fee, reserva e produto/fulfillment incidem sobre o **gross JVZoo**.
2. Backend entra somente pela **parcela líquida pertencente à NorthScale**.
3. Custo de afiliados entra pelo valor efetivamente atribuído ao período analisado.
4. Não incluir OPEX fixo neste indicador.
5. Não alterar taxas sem registrar a data da mudança.
6. Exibir margem oficial sobre **receita econômica total**.
7. Se houver buffer, mostrar o valor separadamente.
8. O cálculo deve ser reproduzível por dia, período, produto e afiliado usando a mesma fórmula.
