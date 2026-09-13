# Northscale Operations Dashboard

Consolida vendas de afiliados internacional das plataformas ClickBank e Digistore24
em um painel único, com ingestão em tempo real via N8N + reconciliação por API.

## Fase atual: 1 (backend-first)

- Schema Prisma + Postgres
- Ingestão ClickBank (`/api/ingest/clickbank`)
- Ingestão Digistore24 (`/api/ingest/digistore24`) com validação SHA-512
- Health check (`/api/health`)
- Front estático legado servido de `public/` — será reescrito na Fase 2

## Stack

- Next.js 15 (App Router) — API + front
- Prisma + Postgres 16
- Zod (validação), Pino (logs)
- Vitest (testes)
- Node 20+

## Rodar local

Pré-requisitos: Node 20+, Docker (pra Postgres), npm.

```bash
# 1. Dependências
npm install

# 2. Postgres local via Docker (ajuste senha/porta se quiser)
docker run -d --name dashboard-pg \
  -e POSTGRES_USER=dashboard \
  -e POSTGRES_PASSWORD=dashboard \
  -e POSTGRES_DB=dashboard \
  -p 5432:5432 postgres:16-alpine

# 3. Configurar .env
cp .env.example .env
# Editar: DATABASE_URL, INGEST_SECRET, DIGISTORE24_IPN_PASSPHRASE

# 4. Migrations
npm run prisma:migrate -- --name init

# 5. Dev server
npm run dev
```

Acesso:
- `http://localhost:3000/` → front legado (redirecionado pra `/index.html`)
- `http://localhost:3000/api/health` → JSON com status do DB
- `http://localhost:3000/api/ingest/clickbank` → POST só (401 sem `X-Ingest-Secret`)

## Testes

```bash
npm run test           # run once
npm run test:watch     # watch mode
```

Cobre parsers dos dois connectors + validação de assinatura Digistore24
com fixtures extraídas de payloads reais de produção.

## Testar ingestão manualmente

### ClickBank

```bash
curl -X POST http://localhost:3000/api/ingest/clickbank \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Secret: $INGEST_SECRET" \
  -d @lib/connectors/clickbank/__fixtures__/neuromind-frontend.json
```

### Digistore24

```bash
# Converte fixture JSON → form-urlencoded
node -e "const d=require('./lib/connectors/digistore24/__fixtures__/glyco-on-payment.json'); \
  console.log(new URLSearchParams(d).toString())" \
  | curl -X POST http://localhost:3000/api/ingest/digistore24 \
      -H "Content-Type: application/x-www-form-urlencoded" \
      -H "X-Ingest-Secret: $INGEST_SECRET" \
      --data-binary @-
```

Sem `DIGISTORE24_IPN_PASSPHRASE` correta, responde `401 invalid signature`.
A fixture tem `sha_sign` válido só com a passphrase real de produção — em dev,
esvazie o campo `sha_sign` da fixture pra que o endpoint aceite como `signatureOk=null`.

## Configuração do N8N

Cada plataforma tem um workflow que recebe o payload e encaminha pra cá via HTTP Request:

```
N8N webhook → HTTP Request
  URL:     https://dash.thenorthscales.com/api/ingest/{platform}
  Header:  X-Ingest-Secret: {{ $env.INGEST_SECRET }}
  Body:    {{ $json }} (ClickBank: JSON; Digistore24: form-urlencoded)
  Retry:   3x, exponential backoff
```

### ClickBank

Upstream: endpoint decifrador (externo) recebe AES-256-CBC do ClickBank INS v8,
decifra com Secret Key e encaminha JSON em claro pro N8N. O dash recebe JSON puro.

### Digistore24

Connection type = **"Generic IPN"** (NÃO "Webhook" — este último manda schema
mínimo). Campo "IPN password" no painel Digistore = SHA passphrase (nomenclatura
enganosa). A mesma passphrase tem que estar em `DIGISTORE24_IPN_PASSPHRASE` aqui.

## Estrutura

```
app/
├── api/
│   ├── health/route.ts
│   └── ingest/
│       ├── clickbank/route.ts
│       └── digistore24/route.ts
├── layout.tsx
└── page.tsx                    (redirect → /index.html)
lib/
├── db.ts                       (Prisma client singleton)
├── logger.ts                   (Pino + email masking)
├── connectors/
│   ├── clickbank/
│   │   ├── ingest.ts
│   │   ├── types.ts
│   │   ├── ingest.test.ts
│   │   └── __fixtures__/
│   └── digistore24/
│       ├── ingest.ts
│       ├── signature.ts
│       ├── types.ts
│       ├── ingest.test.ts
│       ├── signature.test.ts
│       └── __fixtures__/
├── ingest/auth.ts              (X-Ingest-Secret timing-safe compare)
├── services/upsertOrder.ts     (normalized → DB)
└── shared/types.ts             (NormalizedOrder)
prisma/
└── schema.prisma
public/                          (front legado — Fase 2 reescreve)
├── index.html
├── src/
├── styles/
└── assets/
```

## Adicionar nova plataforma

1. Criar `lib/connectors/{slug}/` com `types.ts`, `ingest.ts`, `ingest.test.ts`, fixtures
2. Implementar função que retorna `NormalizedOrder`
3. Criar `app/api/ingest/{slug}/route.ts` seguindo o padrão existente
4. Se a plataforma assina payloads, criar também `signature.ts`
5. Adicionar fixture de payload real (com PII anonimizada) e testes

## Debug de ingestão

Toda request que chega em `/api/ingest/*` cria um registro em `IngestLog` com o
payload completo, antes mesmo de tentar processar. Útil pra replay:

```sql
SELECT id, event_type, external_id, processed_ok, error, received_at
FROM "IngestLog"
WHERE platform_slug = 'digistore24' AND processed_ok = false
ORDER BY received_at DESC LIMIT 20;
```

Campo `signatureOk`:
- `true` — assinatura válida
- `false` — assinatura inválida (payload rejeitado)
- `null` — assinatura ausente (Digistore sem passphrase configurada; ClickBank não usa aqui)

## Integração NorthScale Afiliados (sistema de afiliados)

Contrato completo em [`integration-dashboard.md`](integration-dashboard.md). O sistema de
afiliados (`https://api.thenorthscales.com`) é a **fonte de verdade da identidade** do
afiliado (`affiliate_id` + IDs em cada plataforma); o dashboard espelha o mapeamento e
resolve o `affiliate_id` de cada venda de BuyGoods, Digistore24 e JVZoo.

| Sentido | Endpoint | Auth |
| --- | --- | --- |
| Eles → nós | `POST /api/integrations/affiliates/webhook` (evento `affiliate.updated`) | `X-Api-Key` = `DASHBOARD_API_KEY` |
| Eles → nós | `GET /api/integrations/affiliates/metrics?period=7d\|30d\|mtd\|custom&from=&to=` | `X-Api-Key` = `DASHBOARD_API_KEY` |
| Nós → eles | `GET {AFFILIATES_API_URL}/api/integrations/affiliates/mapping` (reconciliação diária + carga inicial) | enviamos `X-Api-Key` = `INTEGRATION_API_KEY` |

Configuração: env vars `DASHBOARD_API_KEY`, `INTEGRATION_API_KEY`, `AFFILIATES_API_URL`
(ver `.env.example`) **ou** pelo painel (Plataformas → *Sistema de afiliados* → Chaves),
que grava em `IntegrationSetting`; a env var tem precedência. Sem chave de entrada, os
dois endpoints respondem 503 (como o contrato prevê).

Como funciona:

- `affiliate_mappings` / `affiliate_mapping_state`: espelho do mapping (UNIQUE em
  `platform + external_id`, normalizado `trim + lower`). Webhook e mapping aplicam o
  **estado completo** do afiliado; evento com `occurred_at` menor que o gravado é
  ignorado com 2xx (idempotência por `occurred_at`).
- Ingest (`upsertOrder`): resolve por plataforma — BuyGoods `aff_id` → `aff_name`;
  Digistore24 `affiliate_name` (Digistore ID) → `affiliate_id`; JVZoo `affiliate_id` →
  `affiliate_name` — e grava `Order.mappedAffiliateId` (+ cache em
  `Affiliate.mappedAffiliateId`). Sem mapeamento → `unmapped_affiliate_events`
  (contador, primeiro/último visto, último pedido). Quando o mapeamento chega, as
  contas afetadas são reprocessadas automaticamente.
- Reconciliação: scheduler in-process (45 s após o boot; depois a cada
  `AFFILIATES_SYNC_INTERVAL_MIN`, padrão diário). Manual:
  `POST /api/admin/affiliate-mapping {"action":"sync","full":true}` e
  `{"action":"backfill"}` (histórico), com sessão admin ou `Authorization: Bearer $INGEST_SECRET`.
- Métricas pro ranking deles: faturado por data da venda, estornos (refund + chargeback)
  por data do estorno, `net_sales = gross − refunds`, `orders_count` = pedidos reais
  (linha sintética da Digistore fora), `refund_rate` em % 0–100. Cache de 5 min por
  período; dia = `America/Sao_Paulo`.
- UI: filtro global **Afiliado** (aplica em Visão geral, Funil, Afiliados, Produtos,
  Transações, Plataformas), agrupamento **sistema** na aba Afiliados, coluna *Afiliado
  (sistema)* em Transações, painel *Sistema de afiliados* em Plataformas (fila de não
  mapeados, mapeados, ações).

Teste rápido (curls da seção 6/7 do contrato):

```bash
curl -i -X POST "https://dash.thenorthscales.com/api/integrations/affiliates/webhook"   -H "Content-Type: application/json" -H "X-Api-Key: $DASHBOARD_API_KEY"   -H "X-Event-Id: teste1" -H "X-Event-Type: affiliate.updated" -H "X-Webhook-Attempt: 1"   -d '{"event":"affiliate.updated","affiliate_id":"cmfgq1x2a0000v8l4h3k9d2pw","name":"Maria Silva","status":"active","platforms":[{"platform":"jvzoo","external_id":"1234567"}],"occurred_at":"2026-09-12T13:37:00.123Z"}'

curl -s "https://dash.thenorthscales.com/api/integrations/affiliates/metrics?period=7d" -H "X-Api-Key: $DASHBOARD_API_KEY"
```

## Deploy (Fase de produção)

Planejado: Docker + Traefik + Postgres + Redis na VPS Hostinger KVM 4 (São Paulo),
compartilhada com o projeto supportchat existente. Detalhes chegam na Fase 2.
