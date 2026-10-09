// Pré-compila o JSX da SPA legada (public/src/*.jsx) pra public/dist/*.js.
//
// Substitui o Babel standalone que transpilava ~11k linhas NO BROWSER a cada
// load (~1.5-3s). Modo transform 1:1 (sem bundle): cada .jsx vira um .js
// clássico, preservando a semântica atual de classic scripts com escopo
// global compartilhado — utils.jsx declara helpers que shell.jsx/all-pages.jsx
// consomem, então a ORDEM dos <script> no index.html continua importando.
//
// minifyIdentifiers fica DESLIGADO de propósito: com bundle:false o esbuild
// poderia renomear símbolos top-level que outros arquivos referenciam via
// escopo global. Whitespace+syntax minify já cortam ~40% do tamanho.
//
// Uso:
//   node scripts/build-spa.mjs           # build único (roda no `npm run build`)
//   node scripts/build-spa.mjs --watch   # rebuild on-save pra dev

import { build, context } from 'esbuild';

const options = {
  entryPoints: [
    'public/src/utils.jsx',
    'public/src/skeletons.jsx',
    'public/src/charts.jsx',
    'public/src/ns-charts.jsx',
    'public/src/shell.jsx',
    'public/src/pages/overview.jsx',
    'public/src/pages/all-pages.jsx',
    'public/src/pages/affiliate-identity.jsx',
    'public/src/pages/affiliate-mapping.jsx',
    'public/src/pages/net-profit.jsx',
    'public/src/pages/affiliate-sequence.jsx',
    'public/src/pages/affiliate-analysis.jsx',
    'public/src/pages/affiliate-crm.jsx',
    'public/src/pages/funnel-windows.jsx',
    'public/src/pages/vsl.jsx',
    'public/src/pages/leads.jsx',
    'public/src/app.jsx',
  ],
  outdir: 'public/dist',
  bundle: false,
  loader: { '.jsx': 'jsx' },
  jsx: 'transform', // React.createElement, igual ao preset-react do Babel
  target: 'es2019',
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,
  logLevel: 'info',
};

// Bundle do recharts (npm) → global window.Recharts. React/ReactDOM ficam
// FORA do bundle: os shims apontam pros UMDs globais já servidos de /vendor,
// então o React é um só pra SPA inteira (hooks quebrariam com 2 cópias).
const vendorOptions = {
  entryPoints: ['public/src/vendor-charts.entry.js'],
  outfile: 'public/dist/vendor-recharts.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    'react': './public/src/shims/react-shim.js',
    'react-dom': './public/src/shims/react-dom-shim.js',
    'react/jsx-runtime': './public/src/shims/jsx-runtime-shim.js',
  },
  logLevel: 'info',
};

// ── Guard de consistência de globals ─────────────────────────────────────
//
// Sem bundler, referência quebrada entre módulos NÃO falha no build — vira
// ReferenceError em runtime e derruba a SPA inteira (tela preta em prod,
// 2026-08-18: exports órfãos de networks no window.NSApi). Este guard
// falha o build quando:
//   1. um nome listado no export do window.NSApi (api.js) não está
//      definido no próprio api.js;
//   2. um nome no Object.assign(window, {...}) do all-pages.jsx não está
//      definido lá;
//   3. algum arquivo usa window.NSApi.<fn> que não existe no export.
// É análise por regex, não parser — cobre exatamente o padrão de código
// que esses arquivos usam (declarações top-level function/const).
import {readFileSync, readdirSync } from 'node:fs';

function checkGlobals() {
  const read = (f) => readFileSync(f, 'utf8');
  const definedIn = (src) => new Set([
    ...[...src.matchAll(/(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]),
    ...[...src.matchAll(/const\s+(\w+)\s*=/g)].map((m) => m[1]),
  ]);
  const errors = [];

  const api = read('public/src/api.js');
  const apiDefined = definedIn(api);
  const nsApiMatch = api.match(/window\.NSApi = _wrapMutations\(\{([\s\S]*?)\}\);/);
  const exported = new Set(
    [...(nsApiMatch?.[1] ?? '').matchAll(/^\s*(\w+),?\s*$/gm)].map((m) => m[1]),
  );
  for (const name of exported) {
    if (!apiDefined.has(name)) errors.push(`api.js exporta NSApi.${name} sem defini-lo`);
  }

  const allPages = read('public/src/pages/all-pages.jsx');
  const apDefined = definedIn(allPages);
  const winMatch = allPages.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\);/);
  for (const m of (winMatch?.[1] ?? '').matchAll(/(\w+)/g)) {
    if (!apDefined.has(m[1])) errors.push(`all-pages.jsx exporta window.${m[1]} sem defini-lo`);
  }

  for (const f of [
    'public/src/app.jsx', 'public/src/shell.jsx', 'public/src/pages/all-pages.jsx',
    'public/src/pages/overview.jsx',
    'public/src/pages/affiliate-analysis.jsx', 'public/src/pages/affiliate-identity.jsx', 'public/src/pages/affiliate-sequence.jsx',
    'public/src/pages/affiliate-crm.jsx',
    'public/src/pages/affiliate-mapping.jsx',
    'public/src/pages/funnel-windows.jsx',
    'public/src/pages/vsl.jsx',
    'public/src/pages/leads.jsx',
    'public/src/pages/net-profit.jsx',
  ]) {
    for (const m of read(f).matchAll(/NSApi\.(\w+)/g)) {
      if (!exported.has(m[1])) errors.push(`${f} usa NSApi.${m[1]}, que não existe no export do api.js`);
    }
  }

  // Toda tab do catálogo (lib/auth/tabs.ts) precisa aparecer na sidebar e
  // ter rota no app.jsx — senão dá pra liberar a permissão e o usuário não
  // acha a aba (ou acha e cai em tela branca).
  // Exceção declarada: Ranking e Diretório viraram uma aba só; o id
  // all-affiliates continua válido como rota (redireciona) mas não tem
  // item próprio no menu.
  const SEM_ITEM_NO_MENU = new Set(['all-affiliates']);
  const tabsTs = read('lib/auth/tabs.ts');
  const catalogBlock = tabsTs.slice(tabsTs.indexOf('AVAILABLE_TABS'));
  const shell = read('public/src/shell.jsx');
  const app = read('public/src/app.jsx');
  for (const m of catalogBlock.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'/g)) {
    const id = m[1];
    if (!SEM_ITEM_NO_MENU.has(id) && !shell.includes(`id: '${id}'`)) errors.push(`tab '${id}' está em lib/auth/tabs.ts mas não na sidebar (shell.jsx)`);
    if (!app.includes(`'${id}'`)) errors.push(`tab '${id}' está em lib/auth/tabs.ts mas não tem rota em app.jsx`);
  }

  // Ícone usado precisa existir no mapa do <Icon>: nome desconhecido cai em
  // 'info' (ⓘ) SEM erro — foi assim que o botão de excluir virou um "i".
  const utilsSrc = read('public/src/utils.jsx');
  const iconBlock = utilsSrc.slice(utilsSrc.indexOf('function Icon('), utilsSrc.indexOf('const ps = paths[name]'));
  const iconNames = new Set([...iconBlock.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map((m) => m[1]));
  const iconFiles = ['public/src/app.jsx', 'public/src/shell.jsx', 'public/src/utils.jsx', 'public/src/skeletons.jsx',
    ...readdirSync('public/src/pages').filter((f) => f.endsWith('.jsx')).map((f) => 'public/src/pages/' + f)];
  for (const f of iconFiles) {
    const src = read(f);
    const used = [
      ...[...src.matchAll(/<Icon\s+name="([a-z0-9-]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/<Icon\s+name=\{[^}]*\?\s*'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'/g)].flatMap((m) => [m[1], m[2]]),
      ...[...src.matchAll(/\bicon:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
    ];
    for (const n of new Set(used)) if (!iconNames.has(n)) errors.push(`${f} usa o ícone '${n}', que não existe em utils.jsx (cairia em 'info')`);
  }

  if (errors.length) {
    console.error('[build-spa] GUARD DE GLOBALS FALHOU:');
    for (const e of [...new Set(errors)]) console.error('  ✗ ' + e);
    process.exit(1);
  }
}
checkGlobals();

// A nav do /chat (Next) é GERADA da Sidebar da SPA — se a sidebar mudou e o
// arquivo gerado não, o chat voltaria a mostrar um menu diferente.
{
  const { buildChatNav, OUT } = await import('./gen-chat-nav.mjs');
  const { readFileSync, existsSync } = await import('node:fs');
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== buildChatNav()) {
    console.error(`[build-spa] ${OUT} desatualizado em relação à Sidebar da SPA — rode: node scripts/gen-chat-nav.mjs`);
    process.exit(1);
  }
}

// Skills do chat IA (playbooks + famílias canônicas) também são GERADAS —
// playbook editado sem regerar = a IA carregaria o texto velho.
{
  const { buildChatSkills, OUT } = await import('./gen-chat-skills.mjs');
  const { readFileSync, existsSync } = await import('node:fs');
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== buildChatSkills()) {
    console.error(`[build-spa] ${OUT} desatualizado em relação a lib/chat/skills/*.md — rode: node scripts/gen-chat-skills.mjs`);
    process.exit(1);
  }
}

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  // Vendor não precisa de watch (só muda quando o package muda) — builda 1x.
  await build(vendorOptions);
  console.log('[build-spa] watching public/src/**/*.jsx ...');
} else {
  await Promise.all([build(options), build(vendorOptions)]);
}
