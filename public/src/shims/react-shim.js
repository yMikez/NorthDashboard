// Shim de bundle: o vendor-recharts.js é bundlado com esbuild, mas o React
// real é o UMD global servido de /vendor (compartilhado com toda a SPA).
// Qualquer `import ... from 'react'` dentro do bundle resolve pra cá.
module.exports = window.React;
