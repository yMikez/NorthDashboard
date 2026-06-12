// Entry do bundle de gráficos: empacota o recharts (já dependência do
// projeto, usado no /chat) e expõe como global pra SPA legada consumir.
// Bundlado por scripts/build-spa.mjs → public/dist/vendor-recharts.js.
import * as Recharts from 'recharts';

window.Recharts = Recharts;
