FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
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
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/.bin/tsx ./node_modules/.bin/tsx

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Startup chain: migrate → backfill classification → seed admin (idempotente,
# requer ADMIN_SEED_EMAIL/PASSWORD em env) → start app.
# Cada passo é idempotente; falhas em backfill/seed loggam mas não derrubam
# o container — o app sobe mesmo se um deles tropeçar.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && (node_modules/.bin/tsx scripts/backfillClassification.ts || echo '[startup] backfill failed, continuing') && (node_modules/.bin/tsx scripts/seedAdmin.ts || echo '[startup] seedAdmin failed, continuing') && node server.js"]
