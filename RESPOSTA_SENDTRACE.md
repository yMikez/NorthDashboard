# Resposta às pendências do SendTrace — API do dash

Referente a `Dash API — Pendências` (22/09/2026). Os quatro itens estão resolvidos ou respondidos, e as três perguntas têm resposta abaixo. Guia completo da API em [`API.md`](API.md).

**O que mudou na prática:** você ganha uma chave própria, três endpoints novos em `/api/integrations/*` e dois campos que faltavam no dump.

---

## Autenticação: chave de parceiro (nova)

Não vamos entregar a chave de operação (`INGEST_SECRET`). Ela abre todas as rotas `/api/admin/*`, inclusive backfill, mudança de premissas e delete — e é a mesma chave que o n8n usa pra ingestão, então rotacionar depois derrubaria a entrada de vendas.

Em vez disso, criamos a **chave de parceiro**: só leitura, só nos três endpoints abaixo, rotação independente.

```
X-Api-Key: <chave que enviamos por canal separado>
```

Vale em `/api/integrations/orders`, `/api/integrations/targets` e `/api/integrations/catalog`. Qualquer outra rota ignora essa chave. Se precisar de mais escopo, é só pedir — a gente amplia por endpoint.

---

## 1. `GET /api/integrations/targets` — resolve R1 e C1

As metas agora são configuráveis no dash (`PATCH /api/admin/profit-config`, admin) e lidas por você. Fonte única: se o número mudar, muda dos dois lados.

```bash
curl -H "X-Api-Key: $CHAVE" https://dash.thenorthscales.com/api/integrations/targets
```

```json
{
  "reembolso_meta_d30_pct": 10,
  "reembolso_limite_d30_pct": 18,
  "chargeback_atencao_pct": 0.5,
  "chargeback_limite_pct": 0.9,
  "atualizado_em": "2026-09-23T22:00:00.000Z",
  "opex_pct": 10,
  "plataformas": [
    { "slug": "jvzoo", "nome": "JVZoo", "fee_pct": 9, "reserva_pct": 5,
      "refund_cb_pct_modelo": 15, "modelo_estorno": "in-place" }
  ]
}
```

Os quatro primeiros campos são exatamente o formato que você pediu. Começam com os valores do PDF (10/18/0,5/0,9) — se a operação decidir outro número, o endpoint passa a devolver o novo.

Sobre a divergência que o PDF aponta (dash mostrando 6% na coorte e 1,8%/2,8% no chargeback): esses são **valores observados**, não metas. Um é o que aconteceu, o outro é o alvo. Agora dá para comparar os dois sem ambiguidade.

## 2. Valor de estorno separado no dump — resolvido

Cada linha passa a trazer:

| Campo | O que é |
|---|---|
| `refundedUsd` | quanto foi devolvido nesta linha, **sempre positivo**, 0 se não houve |
| `chargebackUsd` | idem para chargeback |
| `originalGross` | o valor da venda no momento do ingest, antes de qualquer evento de estorno |
| `refundModel` | `in-place` ou `extra-row` (explicação abaixo) |
| `updatedAt` | quando a linha mudou pela última vez |
| `bottles`, `mappedAffiliateId`, `currency`, `approvedAt` | vinham faltando |

**A ambiguidade que você levantou é real e tem duas formas no dado bruto:**

- **`in-place`** (JVZoo, BuyGoods, ClickBank, Cartpanda, PagAmerican): a própria linha da venda vira `REFUNDED`/`CHARGEBACK`. O `gross` passa a valer o que a plataforma reportou no evento, e `originalGross` guarda a venda.
- **`extra-row`** (Digistore24): a venda original **continua `APPROVED`** e entra uma linha nova, negativa, apontando para ela em `parentExternalId`.

Se você somar `gross` sem saber disso, a Digistore conta a venda duas vezes (uma positiva, uma negativa) e a JVZoo some com a venda estornada. **Com `refundedUsd` você não precisa saber:** é o valor devolvido, resolvido, positivo. Para reembolso parcial devolvemos o que a plataforma reportou, limitado ao valor da venda.

Ressalva honesta: se a plataforma mandar no evento o valor cheio da venda quando o reembolso foi parcial, não temos como saber — nesse caso `refundedUsd` sai igual ao total. Não é limitação nossa de modelagem, é do dado que chega.

## 3. `?updated_since=` — resolvido

```bash
# tudo que mudou desde o último pull, em todas as plataformas
curl -H "X-Api-Key: $CHAVE" \
  "https://dash.thenorthscales.com/api/integrations/orders?platform=all&updated_since=2026-09-23T00:00:00Z"
```

Pega o pedido comprado em agosto e reembolsado ontem, sem janela rolante. A resposta ordena por `updatedAt` crescente e traz `next_updated_since` quando bate o teto de 50.000 linhas: use esse valor no próximo pull. Deduplique por `platform` + `externalId`.

O modo antigo continua: `?platform=jvzoo&start=2026-09-01&end=2026-09-10` (dia BRT, por data da compra).

## 4. Retenção (P10/R4) — proposta de contrato

Concordo com o desenho: vocês expõem, a gente consome. Já temos esse padrão rodando com a Logicall (polling a cada 30 min, idempotente por ID), então sugiro o mesmo:

```
GET {SENDTRACE_API}/api/retencao?updated_since=<ISO>&limit=500
X-Api-Key: <chave que vocês geram pra gente>
```

```json
{
  "itens": [
    {
      "id": "ret_123",                    // id estável de vocês (chave de dedup)
      "transacao_id": "MRZI8U9PDAOB40NWW", // = externalId do nosso dump
      "plataforma": "jvzoo",
      "email": "cliente@exemplo.com",
      "degrau_oferecido": "50_off",
      "degrau_aceito": "50_off",           // null se recusou
      "valor_preservado_usd": 147.00,
      "status": "aceito",                  // oferecido | aceito | recusado
      "ocorrido_em": "2026-09-22T14:03:00Z",
      "atualizado_em": "2026-09-22T14:03:00Z"
    }
  ],
  "next_updated_since": "2026-09-22T14:03:00Z"
}
```

O que preciso de vocês: **`transacao_id` batendo com o nosso `externalId`** (é o que torna auditável por pedido, critério do R4) e `atualizado_em` para o pull incremental. Frequência: 30 min serve? Se preferir empurrar em vez de a gente puxar, também dá — eu abro um endpoint de ingestão com token, no mesmo modelo dos outros parceiros. Me diga qual prefere que eu implemento do nosso lado.

---

## As três perguntas

### 1. Latência do reembolso no dump

Depende da plataforma, e é bom saber caso a caso:

- **JVZoo, BuyGoods, ClickBank, Cartpanda:** postback em tempo real. O evento aparece no dump em **segundos**; some 30 s de cache de resposta.
- **Digistore24:** tempo real para a maioria, **mas ~28% dos estornos nunca disparam IPN** — são os executados por certas contas de suporte. Esses só entram quando reconciliamos com o CSV do painel deles, manualmente. Ou seja: para Digistore, o dado fica incompleto por dias até a reconciliação.
- **SalesBound** (call center de cross-sell): venda em minutos por webhook; **reembolso só vem pelo export CSV**, importado à mão.
- **Tauk** (call center): **não reporta estorno nenhum**.

Recomendação prática: puxe com `updated_since` de hora em hora e refaça uma varredura de 90 dias uma vez por semana, para capturar o que entrou por reconciliação.

### 2. BuyGoods

O buraco é o mesmo dos dois lados, e obrigado por levantar — sua pergunta fez a gente medir. **No período de 24/08 a 22/09 o dash registrou zero estorno de BuyGoods** sobre US$ 234 mil de vendas. Zero não é realidade: é o IPN de refund da BuyGoods que não está chegando (ou não está sendo processado) no nosso lado.

Já está na fila de correção. Enquanto não resolver: **não trate `refundedUsd = 0` de BuyGoods como "não houve reembolso"** — trate como dado ausente. As outras plataformas estão íntegras.

### 3. Vocabulário de produto

Não monte o seu de-para — use o nosso: `GET /api/integrations/catalog`.

```bash
curl -H "X-Api-Key: $CHAVE" \
  "https://dash.thenorthscales.com/api/integrations/catalog?verified=1"
```

O campo que importa é **`family`** (NeuroMindPro, NeuroRecall, GlycoPulse…): é a dimensão que o dashboard usa em todas as abas para agrupar o mesmo produto entre plataformas. O dump já devolve `family` em cada linha, então na maioria dos casos você nem precisa consultar o catálogo.

Dois cuidados: `productId`/`productName` são crus da plataforma e **o mesmo codinome já apareceu em produtos diferentes na BuyGoods** — agrupar por nome dá erro, agrupe por `family`. E `verificado: false` significa família inferida pelo classificador e ainda não confirmada por humano; trate como provisória (`?verified=1` filtra só as confirmadas).

---

## Resumo do que está coberto

| Item | Situação |
|---|---|
| `GET /metas` | ✅ `GET /api/integrations/targets` |
| Valor de estorno separado | ✅ `refundedUsd` / `chargebackUsd` / `originalGross` / `refundModel` |
| Filtro "atualizado desde" | ✅ `?updated_since=` + `next_updated_since` |
| Endpoint de retenção (P10/R4) | 🔄 proposta de contrato acima — aguardando vocês |
| Latência / BuyGoods / vocabulário | ✅ respondidos |
| E1, E2, E3, C3, C4, T7 | ✅ o dump já cobre |

Qualquer campo que ainda falte, manda que a gente adiciona.

---

# Rodada 2 — respostas ao "O que faltou" (25/09/2026)

## 1. Chave de parceiro

Gerada e ativa. **Vai por canal separado**, não neste arquivo nem no repositório.
Ela vale só em `/api/integrations/orders`, `/targets` e `/catalog`, é rotacionável
sem afetar nada da ingestão, e qualquer outra rota a ignora.

No `.env` de vocês ela é o `DASH_API_KEY`. Se vazar ou quiserem trocar, é uma
chamada — sem janela de indisponibilidade.

## 2. `API.md` atualizado

Feito. O que mudou desde a versão que vocês leram:

- **§3.1 agora traz a resposta completa**, campo a campo, do jeito que sai — o
  exemplo antigo estava desatualizado (faltavam `refundedUsd`, `chargebackUsd`,
  `originalGross`, `refundModel`, `currency`, `approvedAt`, `updatedAt`,
  `bottles`, `mappedAffiliateId` e o próprio `platform` na linha). Tem tabela de
  envelope e tabela de cada campo com tipo e significado.
- **§3.1.1 a §3.1.3**: os três endpoints novos (`/orders` com `updated_since`,
  `/targets`, `/catalog`).
- **§2.4**: a chave de parceiro.
- **§5.3** (nova): o contrato da retenção, abaixo.

`/api/integrations/orders` devolve **exatamente** o mesmo corpo do
`orders-dump` — só muda a autenticação e a existência do modo
`updated_since`. Não tem campo a mais nem a menos.

## 3. Retenção: implementado, puxando a cada 30 min

Anotado e **já construído** do nosso lado — o dash puxa, como vocês preferem.

- Roda **a cada 30 minutos** (primeira tentativa 90s depois de cada deploy).
- `GET {SENDTRACE_API}/api/retencao?updated_since=<ISO>&limit=500`, com a chave
  de vocês em `X-Api-Key`. Marcador incremental guardado aqui; pagina sozinho.
- **Idempotente por `id`**: reprocessar não duplica. Item fora do contrato é
  descartado com o motivo registrado, sem derrubar a página inteira.
- Retenção **não vira venda** no dash. É estorno que não aconteceu; contar como
  `Order` inflaria faturamento. Fica em tabela própria, ligada ao pedido por
  `transacao_id` = `externalId` da mesma plataforma.
- Se a retenção chegar **antes** de a venda existir aqui, ela é guardada e
  religada ao pedido depois. Não se perde nada por ordem de chegada.

Enquanto `retencao_ofertas` estiver vazia, o pull devolve zero e não faz nada —
pode subir o endpoint quando quiser que a gente já está do outro lado. Formato
completo e campos obrigatórios em `API.md` §5.3.

**Uma condição, e ela é firme:** a URL precisa ser **HTTPS**. A resposta carrega
e-mail de cliente e a nossa chave vai no header — na 4400 em HTTP puro isso
trafega em claro na rede. O sincronizador recusa `http://` com erro explícito.
Se for intencional por ser rede interna, dá para liberar com um setting, mas
tem que ser decisão consciente e escrita, não default. O mesmo vale para o
token de serviço que já existe aí.

## 4. R1, R2 e R3 — preciso da definição, e proponho parar de trocar número por e-mail

Não respondi antes porque **não tenho o catálogo de indicadores do PDF do
Rodrigo** ("CS NorthScale · Visão Geral do SendTrace v2"). Sei que R1 é a taxa
de reembolso contra a meta e que R3 depende do valor exato devolvido (vocês
descreveram nos itens 1 e 2 das pendências), mas não sei a fórmula exata de
nenhum dos três — nem o denominador (pedidos reais? faturamento? coorte D30?),
nem o recorte de tempo.

Me manda a definição dos três (ou o PDF) e eu faço melhor do que responder três
números: **exponho um `GET /api/integrations/resumo`** que devolve os valores
oficiais calculados aqui, com o período como parâmetro. Aí "diferença zero"
deixa de ser um e-mail que envelhece e vira uma chamada que vocês repetem
quando quiserem.

Enquanto isso, dois cuidados para não comparar coisas diferentes:

- **Estorno tem duas lentes** e elas dão números diferentes de propósito: por
  **data do evento** (o estorno cai no dia em que aconteceu) e por **coorte**
  (o estorno volta para o dia da venda). A matriz de coorte do dash usa a
  segunda. Se vocês somarem por data do evento e compararmos com a coorte, a
  diferença não é bug.
- **Coorte recente subestima.** Reembolso chega até 60–90 dias depois da venda.
  Nós fechamos taxa em coorte madura (60–150 dias atrás).

## 5. BuyGoods — medido, e o buraco é o mesmo dos dois lados

Vocês perguntaram se o dash tinha esse dado por outro caminho. Não tem, e agora
está quantificado:

- **90 dias de BuyGoods no dash: zero linhas `REFUNDED` e zero `CHARGEBACK`**,
  sobre 29.007 pedidos aprovados.
- **Nos últimos 200 IPNs recebidos (22 a 25/09): 100% `neworder`.** Nenhum
  evento de refund ou chargeback chegou ao nosso endpoint.

Ou seja: não é o dash deixando de processar o evento — ele não chega. Está na
nossa fila resolver (configuração do postback do lado da BuyGoods). Até lá,
tratem `refundedUsd = 0` da BuyGoods como **dado ausente**, nunca como ausência
de reembolso. As outras plataformas estão íntegras.

## 6. Digistore — os ~28% continuam valendo

Sem novidade: os estornos executados por certas contas de suporte não disparam
IPN e só entram quando reconciliamos com o CSV do painel deles, manualmente.
Para vocês isso significa que a Digistore fica **temporariamente incompleta**,
não errada. A recomendação continua: pull incremental de hora em hora mais uma
varredura de 90 dias uma vez por semana.

## 7. Sobre validar a primeira sincronização

O `refundModel` (`in-place` × `extra-row`) está documentado em §3.1.1 e agora
sai **em cada linha** — vocês não precisam deduzir do texto. Se a primeira
sincronização divergir do que está escrito, me manda o `externalId` da linha e
eu olho aqui: é mais rápido do que vocês investigarem no escuro.
