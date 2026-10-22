# Configuração

O painel lê a configuração de variáveis de ambiente (`.env` local, `/opt/dashboard/.env`
no servidor). Modelo comentado: [`.env.example`](../.env.example). O `.env` real nunca
vai para o git.

Várias chaves de parceiros também podem ser gravadas **pela tela** (Plataformas e
Call Center), na tabela `IntegrationSetting`. Quando a variável de ambiente existe,
ela tem precedência sobre o valor da tela.

## Obrigatórias

| Variável | Para que serve |
| --- | --- |
| `DATABASE_URL` | Conexão com o PostgreSQL. No servidor o `docker-compose.yml` monta a partir de `POSTGRES_*`. |
| `INGEST_SECRET` | Chave de operação: header `X-Ingest-Secret` dos webhooks e `Authorization: Bearer` das rotas `/api/admin/*`. Abre tudo — nunca entregue a parceiro. |

## Produção

| Variável | Para que serve |
| --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Banco do container `dashboard-postgres` |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | Cria o primeiro admin no boot (idempotente). Apague depois. |

## Plataformas

| Variável | Para que serve |
| --- | --- |
| `DIGISTORE24_IPN_PASSPHRASE` | Confere a assinatura SHA-512 do IPN. No painel da Digistore se chama "IPN password". |
| `CLICKBANK_API_KEY_READ`, `CLICKBANK_API_KEY_WRITE` | API da ClickBank (reconciliação) |
| `CLICKBANK_VENDORS` | Contas vendor que a chave enxerga, separadas por vírgula |
| `VUPIM_WEBHOOK_SECRET` | Segredo do webhook da Vupim (`whsec_…`): confere a assinatura HMAC de cada aviso. Aceita mais de um, separados por vírgula, durante a troca. Com ele, a Vupim pode chamar o dash direto. |

BuyGoods, JVZoo e Cartpanda não precisam de chave própria: autenticam pelo
`INGEST_SECRET` que o n8n envia.

## Parceiros

| Variável | Também pela tela? | Para que serve |
| --- | --- | --- |
| `LOGICALL_API_KEY`, `LOGICALL_API_BASE` | sim (chave) | Busca das vendas da Logicall a cada 30 min |
| `LOGICALL_COMMISSION_PCT`, `TAUK_COMMISSION_PCT` | sim | Comissão do call center (fração: 0.30 = 30%) |
| `SALESBOUND_POSTBACK_TOKEN` | sim | Token do postback da SalesBound |
| `SENDTRACE_RETENTION_URL`, `SENDTRACE_RETENTION_KEY` | sim | Busca das ofertas de retenção do SendTrace |
| `SENDTRACE_RETENTION_ALLOW_INSECURE` | — | `1` aceita URL sem HTTPS (só teste) |
| `AFFILIATES_API_URL` | — | Base da API do NorthScale Afiliados |
| `INTEGRATION_API_KEY` | sim | Chave que o dash **envia** ao ler o mapeamento deles |
| `DASHBOARD_API_KEY` | sim | Chave que o dash **aceita** no webhook e nas métricas (sem ela: 503) |
| `AFFILIATES_SYNC_INTERVAL_MIN`, `AFFILIATES_SYNC_ENABLED` | — | Frequência da reconciliação (padrão diário) e liga/desliga |
| `NETWORKS_SYNC_ENABLED` | — | `0` desliga a conferência das redes (usa a mesma URL e chave acima). Ver [integracoes/redes.md](integracoes/redes.md) |

As chaves de **leitura** entregues a parceiros (`X-Api-Key` de `/api/integrations/*`)
ficam em `IntegrationSetting` (`partner.<nome>.apiKey`, gravada pela tela) ou na
variável `PARTNER_<NOME>_API_KEY`, que vence. Ver [api.md](api.md).

## Chat com IA

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Sem ela o chat fica desligado |
| `CHAT_MODEL` | `claude-opus-5` | Modelo das respostas |
| `CLASSIFY_MODEL` | `claude-sonnet-5` | Modelo das classificações auxiliares |
| `CHAT_EFFORT` | — | Esforço de raciocínio: `low` … `max` |
| `CHAT_GROUNDING` | — | Checagem de números sem fonte: `enforce`, `shadow` ou `off` |
| `VOYAGE_API_KEY`, `VOYAGE_EMBED_MODEL` | `voyage-3.5` | Busca semântica da base de conhecimento (sem chave: só por texto) |
| `CHAT_RATE_LIMIT_PER_DAY` | 1000 | Mensagens por usuário por dia (0 = sem limite) |

Ajustes finos (raramente mexidos):

| Variável | Padrão |
| --- | --- |
| `CHAT_MAX_TOOL_LOOPS` | 30 |
| `CHAT_MAX_OUTPUT_TOKENS` | 64000 |
| `CHAT_TOOL_RESULT_MAX_BYTES` | 600000 |
| `CHAT_CONTEXT_MAX_CHARS` | 2400000 |
| `CHAT_HISTORY_MAX_MESSAGES`, `CHAT_HISTORY_MAX_CHARS` | 120 · 400000 |
| `CHAT_TURNLOG_RETENTION_DAYS` | 90 (mínimo 7) |
| `KB_PINNED_MAX_CHARS` | 24000 |
| `CHAT_ATTACH_MAX_FILE_MB` · `CHAT_ATTACH_USER_MAX_MB` | 25 · 2048 |
| `CHAT_ATTACH_ZIP_MAX_MB` · `CHAT_ATTACH_SYNC_MAX_MB` | 256 · 5 |
| `CHAT_ATTACH_TABLE_MAX_ROWS` · `CHAT_ATTACH_TABLE_MAX_CELLS` | 200000 · 5000000 |
| `CHAT_ATTACH_INLINE_MAX_MB` · `CHAT_ATTACH_INLINE_MAX_PAGES` | 12 · 40 |
| `CHAT_ATTACH_INLINE_PDF_MAX_MB` · `CHAT_ATTACH_INLINE_PDF_MAX_TOKENS` | 10 · 100000 |
| `CHAT_ATTACH_INLINE_TEXT_MAX_TOKENS` · `CHAT_ATTACH_INLINE_BUDGET_TOKENS` | 40000 · 150000 |
| `CHAT_ATTACHMENT_RETENTION_DAYS` · `CHAT_ATTACH_DRAFT_HOURS` | 180 · 24 |

## Outros

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `DASHBOARD_URL` | — | URL pública do painel, usada em links gerados pelo servidor |
| `JOB_SECRET` | — | Bearer do job de autotune do Copy Optimizer (cron externo) |
| `COPY_DEFAULT_LAYER` | `black1` | Layer do `/api/copy-decision` quando o lead não cai em Black 2 |
| `LOG_LEVEL` | `info` | Nível de log (pino) |
| `METRICS_SQL_ATTRIBUTION` | ligado | `0` volta para a implementação antiga das métricas (só para emergência) |
