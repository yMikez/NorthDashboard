# Deploy na VPS Hostinger

Rodar uma vez como root via SSH (`ssh root@72.62.104.202`).

## 0. DNS

Criar um A record no provedor do domínio `thenorthscales.com`:

```
dash.thenorthscales.com → 72.62.104.202
```

Propagação: 1-30 minutos. Confirma com `nslookup dash.thenorthscales.com` na VPS.

## 1. Rede Docker compartilhada

Cria a network que o reverse proxy (supportchat-caddy) vai usar pra alcançar o dashboard:

```bash
docker network create web
```

Se já existir, `Error response from daemon: network with name web already exists` — tudo ok, segue.

## 2. Conectar o supportchat-caddy na network `web`

```bash
docker network connect web supportchat-caddy
```

Confirma:

```bash
docker network inspect web
```

Deve listar `supportchat-caddy` como container conectado.

## 3. Clonar o repositório

```bash
cd /opt
git clone https://github.com/yMikez/NorthDashboard.git dashboard
cd dashboard
```

## 4. Criar o `.env` em produção

```bash
cp .env.example .env
nano .env
```

Preencher:

```env
DATABASE_URL="postgresql://dashboard:SENHA_FORTE_AQUI@postgres:5432/dashboard"
POSTGRES_USER=dashboard
POSTGRES_PASSWORD=SENHA_FORTE_AQUI
POSTGRES_DB=dashboard

INGEST_SECRET=MESMO_VALOR_DO_N8N
DIGISTORE24_IPN_PASSPHRASE=MESMO_VALOR_DO_PAINEL

CLICKBANK_API_KEY_READ=API-F16DHP10HL26X2YXWJJ8QEA5M92CVF6J2OPQ
CLICKBANK_API_KEY_WRITE=API-F16DHP10HL26X2YXWJJ8QEA5M92CVF6J2OPQ
CLICKBANK_VENDORS=neurompro,burnthermo,maxvitaliz,glycopulse

JOB_SECRET=GERE_COM_OPENSSL
```

Gerar senha forte para o Postgres:

```bash
openssl rand -hex 32
```

Permissions:

```bash
chmod 600 .env
```

## 5. Build + up

```bash
docker compose up -d --build
```

Primeira vez pode demorar 3-5 min (build Next + pull Postgres). Ver progresso:

```bash
docker compose logs -f app
```

Sinal de sucesso:
- Prisma migrations aplicadas
- `▲ Next.js 15.x.x` + `- Local: http://0.0.0.0:3000`
- Sem erros

Teste interno (pelo próprio container do caddy):

```bash
docker exec supportchat-caddy wget -qO- http://dashboard-app:3000/api/health
```

Deve responder JSON com `"ok":true`.

## 6. Adicionar bloco no Caddyfile do supportchat

Localizar o Caddyfile. Normalmente:

```bash
docker exec supportchat-caddy cat /etc/caddy/Caddyfile
```

Se estiver no container, tem que editar via volume do compose do supportchat (onde o Caddyfile está mapeado). Ou no path `/opt/supportchat/Caddyfile` (verificar).

Adicionar bloco:

```caddy
dash.thenorthscales.com {
    reverse_proxy dashboard-app:3000
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

Reload do Caddy sem reiniciar o container:

```bash
docker exec supportchat-caddy caddy reload --config /etc/caddy/Caddyfile
```

Caddy pede SSL automático via Let's Encrypt na primeira requisição.

## 7. Smoke test externo

Da sua máquina local:

```powershell
Invoke-RestMethod -Uri "https://dash.thenorthscales.com/api/health"
```

Esperado: `{ok: True, checks: ...}` com HTTPS. SSL já funcionando via Caddy automático.

## 8. Atualizar os workflows N8N

Nos nodes HTTP Request dos workflows `clickbank-northscale` e `digistore-ipn`, trocar a URL do cloudflared pela nova URL permanente:

- `https://<cloudflared>/api/ingest/clickbank` → `https://dash.thenorthscales.com/api/ingest/clickbank`
- `https://<cloudflared>/api/ingest/digistore24` → `https://dash.thenorthscales.com/api/ingest/digistore24`

Salvar e ativar. Disparar um connection_test no painel Digistore pra confirmar o novo path.

## 9. Backup automático do Postgres

Cron da VPS (`crontab -e`):

```cron
0 3 * * * docker exec dashboard-postgres pg_dump -U dashboard dashboard | gzip > /var/backups/dashboard/$(date +\%Y-\%m-\%d).sql.gz
5 3 * * * find /var/backups/dashboard -name "*.sql.gz" -mtime +14 -delete
```

Criar a pasta antes:

```bash
mkdir -p /var/backups/dashboard
```

## 10. Update workflow (futuro)

Quando quiser fazer deploy de mudanças:

```bash
cd /opt/dashboard
git pull
docker compose up -d --build app
```

A migration roda automática no start do container (pelo CMD do Dockerfile).

## Troubleshooting

### Container app não fica up

```bash
docker compose logs app | tail -50
```

Erros comuns:
- `Can't reach database server` — postgres ainda inicializando. Espera 10s e retenta `docker compose up -d`.
- `Environment variable not found: DATABASE_URL` — `.env` vazio ou path errado
- `Prisma Client could not locate the Query Engine` — bug no Dockerfile Alpine. Verifica se `openssl` foi instalado.

### Caddy retorna 502

- Caddy não consegue resolver `dashboard-app`. Confirma `docker network inspect web` lista os dois containers.
- App container down: `docker compose ps`.

### Ingest retorna 401

- `.env` do dash tem `INGEST_SECRET` diferente do que o N8N manda. Conferir ambos valores.

### SHA signature invalid (Digistore)

- `.env` do dash tem `DIGISTORE24_IPN_PASSPHRASE` diferente do campo "IPN password" no painel Digistore. Conferir.

## Rollback

Se um deploy quebrar:

```bash
cd /opt/dashboard
git log --oneline    # ver commits
git reset --hard <hash-do-commit-anterior>
docker compose up -d --build app
```

Ou usando o git tag anterior.
