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
    'public/src/charts.jsx',
    'public/src/shell.jsx',
    'public/src/pages/overview.jsx',
    'public/src/pages/custos.jsx',
    'public/src/pages/all-pages.jsx',
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

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build-spa] watching public/src/**/*.jsx ...');
} else {
  await build(options);
}
