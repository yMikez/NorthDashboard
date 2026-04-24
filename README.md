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

## Deploy (Fase de produção)

Planejado: Docker + Traefik + Postgres + Redis na VPS Hostinger KVM 4 (São Paulo),
compartilhada com o projeto supportchat existente. Detalhes chegam na Fase 2.
