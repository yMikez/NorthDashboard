# Deploy e operação

## Onde roda

| Peça | Detalhe |
| --- | --- |
| Servidor | VPS Hostinger (KVM 4, São Paulo), compartilhada com o projeto supportchat |
| Código | `/opt/dashboard` (clone do GitHub) |
| Containers | `dashboard-app` (Next.js) e `dashboard-postgres` (PostgreSQL 16), via `docker-compose.yml` |
| Proxy / HTTPS | `supportchat-caddy` (Caddy, certificado automático), na rede Docker `web` |
| Domínio | `dash.thenorthscales.com` → IP da VPS |
| Segredos | `/opt/dashboard/.env` (só no servidor, `chmod 600`) |

O container do app não expõe porta: o Caddy alcança `dashboard-app:3000` pela rede `web`.

## Deploy automático

Todo push em `main` dispara `.github/workflows/deploy.yml`:

1. **Testes:** `npm ci` → `prisma generate` → `npm test`. Se falhar, não publica.
2. **Deploy:** SSH na VPS → `git fetch` + `git reset --hard origin/main` →
   `docker compose up -d --build app` → limpa imagens antigas.
3. **Saúde:** espera `https://dash.thenorthscales.com/api/health` responder (até 90 s).

No boot, o container roda `prisma migrate deploy` antes de subir o app — migração
nova entra sozinha no deploy.

Segredos do GitHub Actions (Settings → Secrets → Actions): `VPS_HOST`, `VPS_USER`,
`VPS_SSH_KEY` (chave privada de deploy) e, opcional, `VPS_SSH_PORT`.

### Disparar na mão

- GitHub → Actions → "CI + Deploy" → **Run workflow** em `main`.
- Ou no servidor: `cd /opt/dashboard && git pull && docker compose up -d --build app`.

### Se o deploy falhar

- **"dial tcp …:22: i/o timeout"** no passo de SSH: instabilidade de rede entre o
  GitHub e a VPS. Rode de novo só o job que falhou (`gh run rerun <id> --failed`).
- **Testes falharam:** nada foi publicado; corrija e faça push de novo.
- **Health check não respondeu:** veja os logs (abaixo). O container anterior já
  foi substituído, então o painel pode estar fora até corrigir.

## Logs e diagnóstico

```bash
ssh root@<IP-da-VPS>
docker logs dashboard-app --since 30m          # logs do app (JSON do pino)
docker compose -f /opt/dashboard/docker-compose.yml ps
docker exec dashboard-app wget -qO- http://localhost:3000/api/health
```

Consultas só de leitura no banco:

```bash
docker exec dashboard-postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT COUNT(*) FROM \"Order\""'
```

Avisos recebidos que falharam:

```sql
SELECT id, "platformSlug", "eventType", "externalId", error, "receivedAt"
FROM "IngestLog" WHERE "processedOk" = false
ORDER BY "receivedAt" DESC LIMIT 20;
```

Operação por linha de comando usa as rotas `/api/admin/*` com
`Authorization: Bearer $INGEST_SECRET` (backfills, imports, reprocessamentos).
Cada rota documenta no topo do arquivo o que faz e se é idempotente.

## Backup do banco

**Hoje não há backup automático configurado no servidor.** Recomendado (cron do root):

```cron
0 3 * * * docker exec dashboard-postgres sh -c 'pg_dump -U $POSTGRES_USER $POSTGRES_DB' | gzip > /var/backups/dashboard/$(date +\%F).sql.gz
5 3 * * * find /var/backups/dashboard -name "*.sql.gz" -mtime +14 -delete
```

Criar a pasta antes (`mkdir -p /var/backups/dashboard`) e, de preferência, copiar
os arquivos para fora da VPS (outro servidor ou storage).

## Instalação do zero (resumo)

1. DNS: registro A `dash.thenorthscales.com` → IP da VPS.
2. Rede Docker compartilhada: `docker network create web` e
   `docker network connect web supportchat-caddy`.
3. `git clone` em `/opt/dashboard`, criar `.env` a partir do `.env.example`
   (ver [configuracao.md](configuracao.md)) com `chmod 600`.
4. `docker compose up -d --build` (primeira vez leva 3–5 min).
5. No Caddyfile do supportchat:

   ```caddy
   dash.thenorthscales.com {
       reverse_proxy dashboard-app:3000
       encode gzip
   }
   ```

   e `docker exec supportchat-caddy caddy reload --config /etc/caddy/Caddyfile`.
6. Primeiro admin: `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` no `.env` (o boot cria)
   ou `npm run create:admin`.
7. Apontar os webhooks/IPNs das plataformas e do n8n para `/api/ingest/<fonte>`.

## Problemas conhecidos

- No boot, os passos `backfillClassification` e `seedAdmin` falham com
  `Cannot find package 'esbuild'` (a imagem copia o `tsx` sem o `esbuild`). O app
  sobe normalmente ("continuing"), mas o admin inicial via env não é criado no boot.
