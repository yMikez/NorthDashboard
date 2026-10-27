FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# public/ owned by nextjs pra escrita em runtime (uploads/contracts/* — PDF
# de contrato gerado por pdfkit). Sem chown, o volume mount herdava root
# e o write falhava com EACCES (container roda como uid 1001).
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Pré-criar o diretório de contracts ANTES do USER nextjs garante que o
# Docker volume init copie a estrutura com permissão correta. Sem isso,
# o volume nasce vazio e owned by root no primeiro mount.
RUN mkdir -p /app/public/uploads/contracts \
  && chown -R nextjs:nodejs /app/public/uploads
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
# Backfill assets — classifier + script + tsx need to be present in the
# runner image so the startup backfill can classify existing Products.
# CSVs are NOT required (classifier derives family from SKU pattern alone);
# they only carry optional metadata for the manual seed:catalog command.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/Planilhas ./Planilhas
# Base de conhecimento da IA (RAG): documentos curados que o seed indexa
# em segundo plano depois do boot (lib/rag/seed.ts via instrumentation).
COPY --from=builder /app/docs/kb ./docs/kb
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# tsx roda pelo próprio dist/cli.mjs: copiar node_modules/.bin/tsx trazia o
# CLI como arquivo solto em .bin/, onde ele não acha o esbuild (que fica em
# tsx/node_modules) — o backfill e o seedAdmin falhavam em todo boot.
# get-tsconfig/resolve-pkg-maps são deps do tsx; bcryptjs é do seedAdmin
# (o standalone do Next embute o bcryptjs no servidor e não traz o pacote).
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=builder /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Startup chain: migrate → backfill classification → seed admin (idempotente,
# requer ADMIN_SEED_EMAIL/PASSWORD em env) → schema painel (só com
# METRICS_SOURCE=oficial; sem ele as métricas seguem no public) → start app.
# Cada passo é idempotente; falhas em backfill/seed loggam mas não derrubam
# o container — o app sobe mesmo se um deles tropeçar.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && (node node_modules/tsx/dist/cli.mjs scripts/backfillClassification.ts || echo '[startup] backfill failed, continuing') && (node node_modules/tsx/dist/cli.mjs scripts/seedAdmin.ts || echo '[startup] seedAdmin failed, continuing') && (node node_modules/tsx/dist/cli.mjs scripts/painelSchema.ts --boot || echo '[startup] painel failed, metrics stay on public') && node server.js"]
