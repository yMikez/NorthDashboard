# CRM de afiliados — o que o dashboard faz

Implementação do playbook `NorthScale_CRM_Playbook_Automacao` do lado do dash.
O **disparo continua manual**: aqui mora a classificação, a fila de trabalho,
o registro do que foi enviado e o export pro WhatsApp.

Aba: **Afiliados › CRM** (`/affiliate-crm`). Permissão própria — dá pra liberar
só ela pra quem opera o WhatsApp, sem expor receita, margem ou CPA da operação.

---

## 1. A ideia central: o ciclo é o dia da última venda

O problema de uma régua tocada por CSV é mandar *"sumiu, o que aconteceu?"*
pra quem vendeu ontem. Aqui isso não acontece por construção.

Cada toque registrado fica ancorado num **ciclo**:

| Segmento | Âncora do ciclo |
| --- | --- |
| Dormente / Frio | `sale:<dia da última venda>` |
| Onboarding | `onb:<dia do cadastro>` |
| Em risco / Upgrade / Ativo | `w:<semana ISO>` |

Vendeu de novo → muda o dia da última venda → **muda o ciclo** → os toques
antigos deixam de contar e ele sai da fila na hora. Não existe job de
expiração nem sincronia com a ferramenta de disparo: é o dado da venda que
manda, e ele chega por postback em segundos.

## 2. Segmentos

| Segmento | Regra |
| --- | --- |
| **Onboarding** | cadastrado há ≤ `onboardingDays` (padrão 10) — vale pra quem ainda não vendeu e pra quem acabou de fazer a primeira |
| **Dormente** | dias sem vender ≥ limiar **do tier** (Base 7 · Ascendente 5 · North 3) |
| **Frio** | dias sem vender ≥ `coldDays` (30), ou cadastrado e nunca ativou |
| **Em risco** | caiu ≥ 40% frente à média semanal dele mesmo nas últimas 4 semanas, **mas ainda vendeu** nos últimos 7 dias |
| **Upgrade** | sustenta o volume semanal do tier de cima por 3 semanas seguidas |
| **Ativo** | vendendo no ritmo |
| **Fora** | opt-out no dash ou `status: inactive` no sistema de afiliados |

O limiar de dormência é por tier de propósito: perder um North custa mais,
então ele entra na régua antes.

## 3. A escada de toques

Corre a partir do limiar do tier, com os offsets `0, 4, 7, 14`:

- **Base** (limiar 7): D7 · D11 · D14 · D21 → `reativacao_d7`, `…d11`, `…d14`, `…d21`
- **North** (limiar 3): D3 · D7 · D10 · D17
- Passou de `coldDays`: um último toque `reativacao_frio`
- **Onboarding**: D0 · D1 · D3 · D5 · D7 · D10 (`onboarding_d0`…)
- **Em risco**: `risco_checkin` (1×/semana) · **Upgrade**: `upgrade_<tier>` · **Ativo no top 10**: `top10_semana`

Um toque só aparece depois de vencer, nunca se repete no mesmo ciclo, e se
um degrau foi pulado o próximo devido assume. "Pular este ciclo" tira da fila
sem contar como enviado.

## 4. Ordem da fila: valor, não dias parados

Metade da base não paga o próprio CPA. Reativar todo mundo que parou é caro e
às vezes aumenta a perda — então a fila ordena por **valor** (maior entre a
receita dos últimos 30 dias e o melhor mês dele no histórico), com alertas:

| Alerta | Significa |
| --- | --- |
| `sem_whatsapp` | não dá pra contatar — falta o número |
| `prejuizo` | Net após CPA negativo no mês com ≥ 5 vendas: é conversa de CPA, não régua |
| `cpa_acima_do_volume` | recebe CPA de North sem entregar volume de North (o "tier desalinhado" do playbook) |
| `tier_indefinido` | sem tier da plataforma e sem CPA conhecido — está caindo em Base |

## 5. Telefone e tier

Resolução, nesta ordem: **manual no dash** → **o que a plataforma de afiliados
mandar** → (só pro tier) **inferido pelo CPA pago** → Base.

O que precisamos do sistema de afiliados no payload do webhook/mapping
(opcional e não destrutivo — ver `API.md` §5.2):

```json
{ "affiliate_id": "...", "phone": "+55 11 98888-7777", "tier": "North" }
```

Aceitamos `phone` | `whatsapp` | `telefone` | `phone_number` | `celular` e
`tier` | `nivel` | `level` | `plan`. Campo ausente **não apaga** o que já
existe, e edição manual no dash sempre vence o sync.

Enquanto isso não vem: dá pra cadastrar o número e o tier à mão no drawer de
cada afiliado, e a aba mostra quantos da fila estão sem WhatsApp.

## 6. Export pro disparo

`GET /api/admin/affiliate-crm/export` — por padrão só quem está **devendo
toque neste ciclo** (a regra "7+ dias sem venda, ainda sem tag ativa" do §2.10
do playbook, agora com estado de verdade).

Colunas: `nome, whatsapp, tier, dias_sem_venda, produto_principal, cpa_atual,
tag_sugerida` (as do playbook) + `segmento, toque, valor_usd, ultima_venda,
prioridade, plataformas, crm_key, ciclo`.

Leva WhatsApp de parceiro: é dado pessoal. A rota exige a aba, o download fica
no log e o arquivo não entra no repositório.

## 7. Medição

O playbook não dizia como saber se funcionou. A aba mostra: dos toques dos
últimos 30 dias, quantos foram seguidos de venda em até 7 dias. Não prova
causa — mostra o sinal, por segmento.

## 8. Parâmetros

Tudo que o playbook deixou "a confirmar" é editável (drawer **parâmetros**,
admin): limiares por tier, dias de frio, offsets da escada, janela de
onboarding, gatilho de risco (% e semanas), regra de upgrade (semanas e
vendas/semana), CPA de corte pra inferir tier e piso de relevância.

Dois defaults são **chute inicial declarado** e precisam da régua real do
programa: `upgradeSalesAscendente` (10 vendas/semana) e `upgradeSalesNorth`
(25). Os CPAs de corte (230 / 240) vieram da página show-app; o dash sabe o
CPA real pago, então dá pra fechar a divergência com a VSL olhando os dados.

## 9. O que está fora

- **Disparo**: manual, por decisão (2026-09-24). A estrutura registra o envio,
  não envia.
- **Canal**: WA Web Plus vs. API oficial segue em aberto. Quando definir, o
  campo de canal entra no registro de toque.
- **Push em tempo real**: hoje é puxar a aba e baixar CSV. Quando a ferramenta
  tiver API, o padrão já existe no repo (`/api/integrations/*` com chave de
  parceiro) e vira um endpoint de leitura por segmento.

## 10. Onde mexer

| Peça | Arquivo |
| --- | --- |
| Regras (puro, testável) | `lib/services/affiliateCrmCore.ts` |
| Banco + orquestração | `lib/services/affiliateCrm.ts` |
| Rotas | `app/api/admin/affiliate-crm/{route.ts,export/route.ts}` |
| Aba | `public/src/pages/affiliate-crm.jsx` |
| Tabelas | `AffiliateCrmProfile`, `AffiliateCrmTouch`, `CrmConfig` |

A carga de vendas é a **mesma** da Análise de afiliados (`loadRaw`): se as duas
abas divergirem sobre "ele vendeu", é bug de uma só fonte.
