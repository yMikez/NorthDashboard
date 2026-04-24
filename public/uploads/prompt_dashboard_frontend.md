# Prompt — Front-end de Dashboard para Operação de Direct Response (Nutra / Afiliados Internacional)

## Contexto do negócio (cole isso no topo do prompt)

Você vai construir o **front-end** de um dashboard web para uma empresa de Direct Response no nicho de **nutracêuticos**, que opera em regime de afiliados internacionais.

**Modelo de operação:**
- A empresa **produz os próprios produtos** (nutra) e os disponibiliza em plataformas de afiliação.
- **Afiliados externos** geram tráfego (Facebook Ads, Google, YouTube, TikTok, e-mail, nativa) e fazem as vendas.
- A empresa paga **CPA/comissão por venda aprovada**.
- Operação é **100% Tier 1 internacional**: EUA, Canadá, Austrália, Reino Unido, Alemanha, Nova Zelândia, etc. **Nada de Brasil / LATAM nesta versão.**
- Plataformas atuais: **Digistore24** e **ClickBank**.
- Arquitetura precisa ser **plataforma-agnóstica**: a camada de dados deve permitir adicionar novas plataformas no futuro (ex.: BuyGoods, MaxWeb, Sticky.io) sem refatorar a UI.

**Moedas e localização:**
- Moeda padrão de exibição: **USD**.
- Suportar toggle secundário para **EUR** e **GBP** (conversão via taxa diária salva).
- Datas em formato **internacional (MMM DD, YYYY)**, timezone default **America/New_York** (com opção UTC).
- Idioma da UI: **inglês** (é onde o time e os afiliados operam).

---

## Objetivo do produto

Um dashboard executivo + operacional que permita ao time:
1. Ver em segundos **como está o dia / semana / mês** (visão geral).
2. Identificar **onde o funil está vazando** (Funnel Analytics).
3. Saber **quem são os afiliados que estão puxando o resultado** — e quem está queimando margem.
4. Acompanhar **tendências temporais** (não só snapshots).

---

## Estrutura de navegação (sidebar esquerda)

```
├── Overview               ← visão executiva (default)
├── Funnel Analytics       ← análise de etapas do funil
├── Affiliates
│   ├── Leaderboard        ← top afiliados
│   └── All Affiliates     ← lista completa com busca/filtro
├── Products / Offers      ← performance por SKU e oferta
├── Transactions           ← lista bruta de pedidos (drill-down)
└── Settings
    ├── Integrations       ← status Digistore24, ClickBank, + futuras
    ├── FX / Currency
    └── Users & Permissions
```

---

## Filtros globais (barra superior fixa, sempre visíveis)

Esses filtros devem atualizar **toda a página** ativa e persistir na URL (deep-linkable):

- **Date range picker**: Today, Yesterday, Last 7d, Last 30d, MTD, QTD, YTD, Custom. Com comparação automática vs. período anterior equivalente.
- **Platform**: All, Digistore24, ClickBank (multi-select, arquitetado para novas plataformas).
- **Product / Offer**: multi-select com search.
- **Country / Region**: multi-select (US, CA, UK, AU, DE, NZ, etc.).
- **Traffic source** (quando disponível): FB, Google, YouTube, TikTok, Email, Native, Other.
- **Currency toggle**: USD (default) / EUR / GBP.

---

## Página 1 — Overview (visão executiva)

### Linha 1 — KPI cards (8 cards em grid responsivo)

Cada card mostra: **valor principal**, **delta % vs. período comparável** (verde/vermelho), e **sparkline** do período selecionado.

1. **Gross Revenue** (USD)
2. **Net Revenue** — após refunds e chargebacks
3. **Orders Approved**
4. **AOV** (Average Order Value)
5. **Approval Rate** — approved / initiated checkouts
6. **Refund Rate** (%)
7. **Chargeback Rate** (%) — destacar em vermelho se > 0.9%
8. **Net Profit** — net revenue − CPA − COGS − fees

### Linha 2 — Gráfico temporal principal (full width)

- **Line/area chart** com eixo X temporal (granularidade automática: hora/dia/semana conforme o range).
- Métricas plotáveis (seletor multi-toggle acima do gráfico): Gross Revenue, Net Revenue, Orders, AOV, Approval Rate.
- **Overlay opcional** do período anterior (linha pontilhada cinza) para comparação.
- Tooltip rico: data, valor, delta vs. período anterior, breakdown por plataforma.

### Linha 3 — Dois gráficos lado a lado (50/50)

**Esquerda — Revenue by Product Type (donut/stacked):**
- Front-end offer
- Upsell 1, Upsell 2, Upsell 3 (quantos existirem)
- Downsell
- Bumps

**Direita — Revenue by Country (horizontal bar + mapa opcional):**
- Top 10 países com bandeira, revenue, orders, AOV.
- Abaixo do gráfico, toggle "View on map" que abre um choropleth.

### Linha 4 — Dois blocos lado a lado

**Esquerda — Top 5 Affiliates (mini-leaderboard):**
- Colunas: Affiliate ID/Nickname, Platform, Revenue, Orders, Approval Rate, Net Margin contribuída.
- CTA "View all" → leva para Affiliates > Leaderboard.

**Direita — Platform Health:**
- Card por plataforma (Digistore24, ClickBank) com: status de sync (✓ / ⚠ / ✗), última atualização, revenue do período, # orders.

---

## Página 2 — Funnel Analytics

Objetivo: descobrir **em qual etapa o funil vaza mais** e comparar funis entre si.

### Seletor de funil
- Dropdown: "Select offer / funnel" (multi-select permitindo sobreposição de até 3 funis para comparação).

### Visualização principal — Funnel chart horizontal

Etapas (configuráveis por oferta, mas padrão nutra DR):

1. **Landing Page Views** (se houver pixel próprio / integração com tracker)
2. **VSL / Sales Page engaged** (scroll ou tempo, opcional)
3. **Checkout Initiated**
4. **Checkout Completed** (payment submitted)
5. **Payment Approved**
6. **Upsell 1 — shown**
7. **Upsell 1 — accepted**
8. **Upsell 2 — shown / accepted** (etc.)

Cada etapa mostra: **volume absoluto**, **% do topo do funil**, **% vs. etapa anterior (drop-off)**. Drop-offs acima de um threshold configurável ficam destacados em vermelho.

### Abaixo do funil — Três blocos

**Bloco A — Upsell/Downsell Take Rates:**
Tabela com colunas: Offer Step, Shown, Accepted, Take Rate %, Revenue, AOV impact.

**Bloco B — AOV Breakdown:**
Comparativo visual: AOV sem upsell vs. AOV com upsell 1 vs. com upsell 1+2 — mostra o **lift** de cada etapa.

**Bloco C — Approval Rate by Payment Method:**
Relevante em Tier 1 também (cartão recusado em internacional é mais comum do que se pensa): Visa, Mastercard, Amex, PayPal, etc. — approval rate por método.

### Gráfico temporal de funnel

Linha mostrando a evolução da **taxa de conversão topo→fundo** ao longo do tempo — permite identificar se uma atualização de VSL, criativo ou checkout degradou a conversão.

---

## Página 3 — Affiliates > Leaderboard

Propósito: identificar rapidamente **quem traz volume saudável vs. tóxico**.

### Filtros locais
- Ordenar por: Revenue, Orders, Net Margin, Approval Rate, Chargeback Rate, Refund Rate.
- Apenas afiliados ativos no período / todos.
- Threshold mínimo de orders (evita ruído de afiliado com 1 venda).

### Tabela principal (com scroll horizontal se necessário)

Colunas:
- Rank (#)
- Affiliate (ID + nickname + avatar/iniciais)
- Platform (tag Digistore24 / ClickBank)
- Orders
- Gross Revenue
- **Approval Rate** (com color-coding: verde > 70%, amarelo 50-70%, vermelho < 50%)
- **Refund Rate** (color-coding inverso)
- **Chargeback Rate** (vermelho forte se > 1%)
- CPA pago
- **Net Margin contribuída** (a métrica que importa)
- Top country
- Top traffic source
- Tendência (sparkline 30d de revenue)
- Ações (→ ver detalhe do afiliado)

### Acima da tabela — 4 KPI cards

- **Active Affiliates** no período (vs. período anterior)
- **Revenue Concentration** — % do revenue vindo do Top 5 e Top 10 (alerta se Top 5 > 60%)
- **New Affiliates** no período
- **Churned Affiliates** — venderam no período anterior e não venderam neste

### Drill-down do afiliado (modal ou página dedicada)

Ao clicar em um afiliado:
- Header com métricas do afiliado
- Gráfico temporal de revenue + orders dele
- Breakdown por oferta
- Histórico de transações
- Flags automáticas ("High chargeback rate", "Low approval rate", "Revenue concentration risk") com explicação

---

## Página 4 — Affiliates > All Affiliates

Lista completa estilo CRM: search, filtros, paginação, export CSV. Mesmas colunas da leaderboard + colunas extras (data de primeiro venda, último venda, lifetime revenue, lifetime orders).

---

## Página 5 — Products / Offers

Grid de cards por produto/oferta mostrando: thumbnail, nome, plataforma, revenue, orders, AOV, take rate de upsells associados, margem. Clique abre detalhe com gráfico temporal e lista de afiliados que vendem aquela oferta.

---

## Página 6 — Transactions (lista bruta)

Tabela tipo "ledger" para auditoria e drill-down:
Data/hora, Order ID, Platform, Product, Affiliate, Country, Payment method, Gross, Fees, Net, Status (approved/pending/refunded/chargeback), CPA pago.

Com: search por Order ID, filtros pesados, export CSV/XLSX.

---

## Requisitos de design (visual)

- **Dark mode + Light mode** (toggle no header). Dark como default — operação de DR roda muito em horário noturno.
- **Paleta sugerida**: base neutra (slate/zinc), accent em verde-esmeralda para positivo, vermelho-coral para negativo, roxo/azul para neutro-destaque. Nada de gradientes chamativos — dashboard é ferramenta, não landing page.
- **Densidade de informação alta** — o usuário é analítico, prefere ver mais dados por tela do que ter que clicar. Nada de cards gigantes com muito whitespace.
- **Tipografia**: sans-serif moderna (Inter, Geist, ou similar). Tabular numbers obrigatório para colunas numéricas.
- **Cards**: bordas sutis, radius ~8px, shadow mínima.
- **Estados claros**: loading (skeleton), empty state ("No data for this period"), error (com retry).
- **Responsivo**: desktop-first (é onde o dash é usado), mas funcional em tablet. Mobile = visão reduzida de KPIs principais, sem tabelas complexas.

---

## Stack técnico sugerido (ajuste se tiver preferência)

- **Framework**: Next.js 14+ (App Router) + TypeScript
- **UI**: Tailwind CSS + shadcn/ui
- **Charts**: Recharts (ou Tremor, que já vem pronto para dashboards)
- **Tabelas**: TanStack Table (sorting, filtering, virtualization para listas grandes de transações)
- **Ícones**: Lucide
- **Estado**: Zustand ou React Query para server state
- **Date handling**: date-fns
- **Mock data**: gerar um seed realista (ao menos 90 dias de dados fake com sazonalidade de fim de semana, ~20 afiliados fictícios, 3 ofertas, mix de países Tier 1) para desenvolver a UI sem depender da API.

---

## Arquitetura de dados (camada que a UI consome)

Projete a UI consumindo um **adapter unificado** — não amarre componentes ao schema do Digistore24 ou ClickBank. Cada plataforma tem seu connector no backend; a UI só conhece o modelo normalizado:

```ts
type Order = {
  id: string;
  platform: 'digistore24' | 'clickbank' | string; // extensível
  productId: string;
  productType: 'frontend' | 'upsell' | 'downsell' | 'bump';
  affiliateId: string;
  country: string;      // ISO-2
  currency: string;
  grossAmount: number;
  netAmount: number;
  fees: number;
  cpaPaid: number;
  status: 'approved' | 'pending' | 'refunded' | 'chargeback';
  paymentMethod: string;
  createdAt: string;    // ISO
  trafficSource?: string;
};
```

Isso garante que, quando entrar a terceira plataforma, é só escrever o connector — a UI não muda.

---

## Entregáveis esperados

1. Projeto Next.js rodando localmente com todas as páginas acima.
2. Mock data realista cobrindo os últimos 90 dias.
3. Todos os filtros globais funcionais (alterando dados em todas as páginas).
4. Componentes de chart, KPI card, tabela e filtro **reutilizáveis** e tipados.
5. README explicando como trocar o mock por API real quando os connectors de Digistore24 e ClickBank estiverem prontos.

---

## Prioridade de implementação (se for entregar em fases)

**Fase 1 (MVP)**: Overview + Affiliates Leaderboard + Transactions + filtros globais.
**Fase 2**: Funnel Analytics + Products/Offers.
**Fase 3**: Drill-down de afiliado, alertas automáticos, export avançado, multi-currency.

---

**Ao gerar o código, comece pela estrutura de pastas, o layout base (sidebar + topbar com filtros globais) e a página Overview completa com mock data. Depois avance para as outras páginas.**
