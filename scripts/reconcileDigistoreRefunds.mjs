#!/usr/bin/env node
// Envia o export de transações da Digistore pro endpoint de reconciliação
// de estornos, em lotes.
//
//   node scripts/reconcileDigistoreRefunds.mjs "transactions.csv"            # dry-run
//   node scripts/reconcileDigistoreRefunds.mjs "transactions.csv" --apply    # cria o que falta
//
//   --base=https://dash.thenorthscales.com   (default)
//   --batch=200                              linhas por chamada
//   --since=2026-04-24                       ignora estornos anteriores
//                                            (default: início da ingestão)
//
// Secret: env INGEST_SECRET, ou lido do .env local.
//
// O export vem do painel em Relatórios → Transações, ";" como separador e
// campos numéricos no formato ="-144.00" (prefixo de fórmula do Excel).
// Encoding é latin-1. Só linhas com Transaction type = "refund" entram —
// "refund request" é pedido, não estorno.

import { readFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';

const args = argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const base = opt('base', 'https://dash.thenorthscales.com').replace(/\/$/, '');
const batchSize = Number(opt('batch', '200'));
const since = opt('since', '2026-04-24');

if (!file) {
  console.error('uso: node scripts/reconcileDigistoreRefunds.mjs <export.csv> [--apply]');
  exit(1);
}

const secret = env.INGEST_SECRET ?? readSecretFromEnvFile();
if (!secret) {
  console.error('INGEST_SECRET não encontrado (env nem .env)');
  exit(1);
}

function readSecretFromEnvFile() {
  try {
    const line = readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('INGEST_SECRET='));
    return line ? line.slice('INGEST_SECRET='.length).trim().replace(/^"|"$/g, '') : null;
  } catch {
    return null;
  }
}

// ---------- parse do CSV ----------

/** Split de uma linha CSV com ";" respeitando aspas duplas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** ="-144.00" / "1.234,56" → number. */
function num(raw) {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/^=/, '').replace(/"/g, '').trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const text = readFileSync(file, 'latin1');
const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = splitCsvLine(lines[0]).map((h) => h.replace(/"/g, '').trim());

// "Created by" aparece DUAS vezes no export: a primeira é quem criou o
// pedido ("Buyer"), a última é quem executou esta transação ("cron",
// "team24-...", "Tauk3Affilliate"). É a última que interessa.
const idx = (name, { last = false } = {}) => {
  const all = header.reduce((acc, h, i) => (h === name ? [...acc, i] : acc), []);
  return all.length === 0 ? -1 : (last ? all[all.length - 1] : all[0]);
};
const COL = {
  date: idx('Date'), time: idx('Time'), orderId: idx('Order ID'),
  txId: idx('Transaction ID'), type: idx('Transaction type'),
  currency: idx('Currency'), gross: idx('Gross amount'),
  net: idx('Net amount'), earnings: idx('Your earnings'),
  productId: idx('Prd ID'), productName: idx('Product name'),
  affiliate: idx('Affiliate'), lastName: idx('Last name'),
  firstName: idx('First name'), email: idx('Email'),
  buyerId: idx('Buyer ID'), createdBy: idx('Created by', { last: true }),
};
const missingCols = Object.entries(COL).filter(([, i]) => i < 0).map(([k]) => k);
if (missingCols.length) {
  console.error(`colunas ausentes no export: ${missingCols.join(', ')}`);
  exit(1);
}

const sinceDate = new Date(`${since}T00:00:00Z`);
const rows = [];
let skippedType = 0;
let skippedOld = 0;
for (const line of lines.slice(1)) {
  const f = splitCsvLine(line).map((v) => v.replace(/^"|"$/g, ''));
  if (f[COL.type] !== 'refund') { skippedType++; continue; }
  const date = f[COL.date];
  const [MM, DD, YYYY] = date.split('/');
  if (new Date(`${YYYY}-${MM}-${DD}T00:00:00Z`) < sinceDate) { skippedOld++; continue; }
  rows.push({
    transactionId: f[COL.txId],
    orderId: f[COL.orderId],
    date,
    time: f[COL.time],
    gross: num(f[COL.gross]),
    net: num(f[COL.net]),
    earnings: num(f[COL.earnings]),
    currency: f[COL.currency] || 'USD',
    productId: f[COL.productId],
    productName: f[COL.productName],
    affiliate: f[COL.affiliate] || null,
    email: f[COL.email] || null,
    firstName: f[COL.firstName] || null,
    lastName: f[COL.lastName] || null,
    buyerId: f[COL.buyerId] || null,
    createdBy: f[COL.createdBy] || null,
  });
}

console.log(`${file}: ${rows.length} estornos desde ${since} `
  + `(${skippedType} não-refund, ${skippedOld} anteriores ao corte)`);

// Confere o parse antes de falar com a produção: se as colunas do export
// mudarem de nome/posição, o erro aparece aqui e não no meio do envio.
if (args.includes('--parse-only')) {
  console.log('\nprimeira linha:', rows[0]);
  console.log('última linha:', rows[rows.length - 1]);
  const total = rows.reduce((s, r) => s + r.gross, 0);
  console.log(`\ngross somado: ${Math.round(total * 100) / 100}`);
  const bad = rows.filter((r) => !r.transactionId || !r.orderId || r.gross === 0);
  console.log(`linhas suspeitas (sem id ou gross 0): ${bad.length}`);
  exit(0);
}

console.log(apply ? '>>> MODO APPLY — vai criar linhas faltantes' : '>>> dry-run (nada é escrito)');

// ---------- envio em lotes ----------

const totals = {
  received: 0, present: 0, missing: 0, created: 0, failed: 0,
  matchedOriginalSale: 0, missingGrossUsd: 0,
};
const byCreatedBy = {};
const byMonth = {};
const errors = [];

for (let i = 0; i < rows.length; i += batchSize) {
  const batch = rows.slice(i, i + batchSize);
  const res = await fetch(
    `${base}/api/admin/reconcile-digistore-refunds${apply ? '?apply=1' : ''}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ rows: batch }),
    },
  );
  if (!res.ok) {
    console.error(`lote ${i}-${i + batch.length}: HTTP ${res.status} ${await res.text()}`);
    exit(1);
  }
  const s = await res.json();
  for (const k of Object.keys(totals)) totals[k] += s[k] ?? 0;
  for (const [k, v] of Object.entries(s.missingByCreatedBy ?? {})) byCreatedBy[k] = (byCreatedBy[k] ?? 0) + v;
  for (const [k, v] of Object.entries(s.missingByMonth ?? {})) byMonth[k] = (byMonth[k] ?? 0) + v;
  errors.push(...(s.errors ?? []));
  process.stdout.write(
    `\r${Math.min(i + batchSize, rows.length)}/${rows.length}`
    + ` · faltando ${totals.missing} · criadas ${totals.created}   `,
  );
}
console.log('\n');

totals.missingGrossUsd = Math.round(totals.missingGrossUsd * 100) / 100;
console.log(totals);
console.log('\nestornos ausentes por executor:');
for (const [k, v] of Object.entries(byCreatedBy).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
console.log('\nestornos ausentes por mês:');
for (const [k, v] of Object.entries(byMonth).sort()) console.log(`  ${k}  ${v}`);
if (errors.length) {
  console.log(`\n${errors.length} erros (primeiros 10):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e.transactionId}: ${e.message}`);
}
