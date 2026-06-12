# Briefing — Upgrade visual de gráficos e visualizações

Data: 2026-06-12. Contexto: pós-overhaul de performance (backend rápido, SPA
pré-compilada via esbuild — o que destrava usar bibliotecas npm no front legado).

## 1. Inventário do que existe hoje (tudo SVG feito à mão)

| Componente | Onde | Estado |
|---|---|---|
| `LineChart` (charts.jsx:7) | Overview, Custos, Fulfillment, Affiliate drawer | 1 métrica por vez + linha de compare; crosshair + tooltip glassy. Sem multi-séries, sem zoom/brush, sem animação, sem legenda. |
| `Donut` (charts.jsx:166) | Overview (por etapa), Copy Optimizer | Estático — sem hover/segmento ativo, paleta fixa de 5 cores. |
| `CountryBars` (charts.jsx:228) | Overview | Bom: bandeiras, "Outros" expandível, click-to-filter. Manter. |
| `FunnelChart` (charts.jsx:292) | Funil | Bom: barras CSS com % of top + badges de drop. Manter. |
| `HourHeatmap` (charts.jsx:348) | Overview | Funcional, MAS mostra horas em **UTC** (label e dado) — o usuário opera em BRT; padrão de horário de venda aparece deslocado 3h. Detalhe do hover aparece numa faixa abaixo, não no cursor. |
| `Sparkline` (utils.jsx:267) | KPI cards, ranking de afiliados | OK. |
| `SupplierDailyChart` (all-pages.jsx:3312) | Fulfillment | **Duplicação**: line chart de 2 séries reimplementado à mão porque o LineChart só faz 1 série. |
| SVG inline ~120px (all-pages.jsx:6928) | Copy Optimizer | **Terceira** reimplementação de line chart. |

Sintoma central: o `LineChart` mono-métrica forçou 3 implementações paralelas
de gráfico de linha. Cada feature nova de visualização paga esse custo de novo.

## 2. Gaps visuais rankeados (impacto analítico ÷ esforço)

1. **Multi-séries no gráfico principal** — hoje não dá pra ver gross × net ×
   profit JUNTOS, nem comparar plataformas/famílias como séries paralelas. É a
   limitação que mais empobrece a análise.
2. **Custos como área empilhada** — a página de custos é a candidata perfeita
   pra stacked area (COGS + fulfillment + fees + CPA + lucro empilhados sob o
   gross). Hoje é 1 métrica por vez; a composição do custo fica invisível.
3. **Brush/zoom em séries temporais** — em 90d/YTD não dá pra dar zoom num
   evento (ex.: pico de refund). Brush resolve sem mexer no filtro global.
4. **Heatmap em BRT** — corrigir fuso (query + label). Quick win sem lib.
5. **Donut interativo** — hover destacando segmento + tooltip; clique podendo
   filtrar por etapa (mesmo padrão do CountryBars).
6. **Anotações/eventos** — marcar no eixo do tempo eventos operacionais
   (mudança de copy, novo afiliado grande, mudança de preço) via ReferenceLine.
7. **Micro-bars em células de tabela** — ranking de afiliados/produtos com
   barra proporcional inline (revenue/margem) torna a tabela escaneável.
8. **Animações/transições** — entrada suave e morphing entre ranges; hoje os
   gráficos "pulam" a cada filtro.

## 3. Estudo de bibliotecas

Restrições: SPA legada = classic scripts + esbuild (build real existe desde o
overhaul — bundlar npm é viável); React 18 UMD global; dark theme com glow
ciano e glassmorphism; volumes pequenos (≤365 pontos, donuts de 5, heatmap 168
células) — performance de render NÃO é o critério; visual e DX são.

| Lib | Tamanho (gz) | Prós | Contras |
|---|---|---|---|
| **Recharts 3** ✅ | ~110-130KB | **Já é dependência do projeto e já é usada no /chat** (components/chat/blocks/ChartBlock.tsx) — consistência visual e de código; declarativa React (mesmo paradigma da SPA); multi-séries, stacked, Brush, ReferenceLine, tooltip 100% customizável (dá pra portar o tooltip glassy atual); composable. | Bundle médio; animação com milhares de pontos sofre (irrelevante no nosso volume). |
| Apache ECharts | ~90-150KB (modular) | O mais rico visualmente (dataZoom, calendário, gradientes, animações premium); canvas. | Paradigma imperativo (config objects), segunda "linguagem de gráfico" no projeto, tema dark custom dá trabalho pra casar com as CSS vars. |
| ApexCharts | ~120KB | Zoom/brush/annotations prontos, bonito por default. | Dependência nova, imperativo, theming menos flexível. |
| uPlot | ~10KB | Ultra-leve e rápido. | Espartano — tooltip/legenda/stacked são trabalho manual; só compensa com milhares de pontos. |
| Chart.js | ~70KB | Simples. | Visual menos premium, canvas com theming limitado. |
| visx / d3 puro | varia | Liberdade total. | É o que já existe (hand-rolled) com outro nome — máximo custo de manutenção. |

### Recomendação: **Recharts** como motor padrão + manter os customs bons

- Zero dependência nova (já está no package.json, usada no chat).
- Um único paradigma de gráficos no projeto inteiro (SPA + chat IA).
- **Manter** `FunnelChart`, `CountryBars` e `Sparkline` (são únicos e bons).
- **Substituir** `LineChart` + `SupplierDailyChart` + o SVG do Copy Optimizer
  por um wrapper único `NSChart` sobre Recharts.
- `HourHeatmap` continua custom (Recharts não tem heatmap) — só corrigir BRT.

Ponto técnico de integração: criar `public/src/vendor-charts.entry.js` com
`import * as Recharts from 'recharts'; window.Recharts = Recharts;` e bundlar
no `build-spa.mjs` (entry separado com `bundle: true`, `NODE_ENV=production`,
e shim apontando `react`/`react-dom` pros globals `window.React/ReactDOM` já
servidos de public/vendor). Gera `public/dist/vendor-recharts.js` carregado uma
vez com cache longo.

**Crítico pro resultado:** Recharts "cru" tem cara de default. O valor está no
wrapper `NSChart` que aplica o design system em TODOS os gráficos: grid
dasheado `rgba(91,200,255,0.06)`, série principal `var(--glow-cyan)` com
gradiente de área (já existe o `gradCyan`), tooltip glassy reaproveitando o
estilo atual (bg-elev + blur + borda), fontes mono nos eixos, paleta
`['#5BC8FF','#4A90FF','#8B7FFF','#a8b7d8','#6b84b8']`.

## 4. Plano faseado proposto

- **V0 — quick wins sem lib (½ dia):** heatmap em BRT (query `AT TIME ZONE` +
  label); hover/clique no Donut; tooltip do heatmap no cursor.
- **V1 — núcleo Recharts (1-2 dias):** bundle vendor + wrapper `NSChart`
  temático; Overview com ComposedChart multi-séries (gross/net/profit
  toggleáveis + compare tracejado + Brush); Custos com stacked area da
  composição de custos; matar as 3 duplicações de line chart.
- **V2 — visualizações novas (1-2 dias):** barras empilhadas por
  plataforma/família no tempo; ReferenceLine de eventos; micro-bars nas
  tabelas de ranking; transições animadas entre ranges.

Riscos: bundle +~120KB gz no primeiro load (mitigado por cache longo e por já
termos cortado ~600KB do Babel); paridade visual exige QA manual página a
página (mesmo gate da Fase D do overhaul).
