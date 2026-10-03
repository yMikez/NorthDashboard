# NorthScale Design System 1.0 — aplicação no dashboard

**Fonte da verdade:** pasta **"North Scale"** no Google Drive (id `1uDFFFgXSNN4MU9JO_B0ZpXAvtCma_TqJ`),
entregue pelo designer em setembro de 2026:

| Arquivo | O que é |
| --- | --- |
| `Documentação Geral.pdf` | Manual de Marca — posicionamento, voz, logo, cores |
| `Documentação do Sistema.pdf` | Design System — fundamentos, componentes, estados, layouts |
| `Variáveis (JSON)/northscale.tokens.json` + `.css` | Tokens exatos |
| `Visual/` | Logotipos, globo, ícone de app, biblioteca de ícones |
| `Fontes - Abertas/` | Inter, Montserrat e Sequel Sans (o dashboard usa só Inter — §4) |

Este documento diz **como o dashboard aplica** o DS1 e onde ele desvia de propósito. Em caso
de dúvida sobre um componente, vale o PDF do Design System. Substitui a identidade "North
Editorial" (julho de 2026).

---

## 1. Princípios (DS1)

- **Dado com contexto.** A métrica aparece com período, moeda e origem. Leitura parcial ou
  atualização pendente é identificada junto ao resultado — nunca um número que parece certo e
  não está.
- **Ação reconhecível.** Botões com verbo claro; cada tela destaca uma ação principal.
- **Leitura contínua.** Componentes não competem com o dado nem dependem de efeito decorativo.

## 2. Decisões do produto que desviam do pacote

Tomadas pelo dono do produto em 29/09/2026 (as duas últimas linhas, em 03/10/2026). Estão
marcadas também no CSS.

| Tema | DS1 | Dashboard | Por quê |
| --- | --- | --- | --- |
| Tema escuro | Não existe (só claro) | **Escuro derivado**, opcional | Uso prolongado; derivado dos neutros e do azul claro do DS1, contraste medido |
| Dinheiro | Cor semântica só para estado | **Sempre verde** (`--money`) | Leitura rápida de valor na operação |
| Números | Padrão brasileiro | **Padrão americano** (`US$ 1,250.50`) | Operação em dólar, parceiros internacionais |
| Densidade | Controle 44 px, linha ≥ 48 px | **Controle 36 px, linha 44 px**; 44 px em toque | Painel de operação com muita tabela |
| Título de página | H3 40/48 | **H4 28/36** | Mesma razão — espaço vertical para o dado |
| Claro | Superfície `#FFFFFF`, texto `#0D0D0D` | **Claro suave**: superfícies ~15% menos brilhantes, texto `#1A1E26` | O claro puro "doía na vista" (19,4:1, tela quase toda branca); o suave segue AAA (14,4:1) |
| Fonte | Sequel Sans (texto) + Montserrat (dados) | **Inter em tudo** (texto, títulos e números tabulares) | A Sequel Sans era TTF de desktop sem hinting de tela: serrilhava no Windows. Inter é a reserva do DS1, com hinting e eixo óptico |
| Cor | Neutros + azul só em ação/seleção | **"Vida"**: canvas com leve tinta azul, seleção em azul cheio, título de painel em azul, tom por KPI, variação em selo verde/vermelho, séries em 5 matizes | "Estava tudo muito acinzentado" — cor com função, sem efeito decorativo |

## 3. Cores

Componentes usam **só `var(--token)`**. Os nomes históricos (`--fg1..5`, `--accent`,
`--glow-cyan`, `--navy-*`) foram mantidos por compatibilidade; os valores são do DS1.

### Claro (padrão) — "claro suave"

Derivado do DS1 com menos brilho (decisão de 29/09/2026) e, desde 03/10/2026, com leve tinta
do azul da marca no canvas e nas superfícies. Nenhuma superfície é branco puro; todo token de
texto passa 4,5:1 no pior fundo (canvas e hover).

| Token | Valor | Papel |
| --- | --- | --- |
| `--bg` | `#DEE3EE` | canvas (tinta azul leve) |
| `--bg-raised` | `#EDF0F6` | painel, tabela, campo |
| `--bg-elev` | `#F3F5FA` | popover, drawer, modal |
| `--bg-hover` | `#DBE3F7` | hover, seleção |
| `--fg1` | `#1A1E26` | texto principal (14,4:1 no painel) |
| `--fg4` | `#4B5261` | secundário (6,2:1 no canvas) |
| `--fg5` | `#535B7E` | terciário (5,16:1 no canvas) |
| `--accent` / `--glow-cyan` | `#2E47BA` | azul de destaque como TEXTO (o `#4260E6` daria 4,1:1 no canvas suave) |
| `--cta` / `--cta-hover` | `#4260E6` / `#1B22A7` | botão primário (branco em cima 5,19:1) |
| `--border` / `--border-strong` | `#C6CEDD` / `#666C7C` | divisor / limite de campo |
| `--success` · `--warning` · `--danger` | `#12633D` · `#7B4A09` · `#A61F33` | tons de **texto** de feedback |
| `--success-bg` · `--warning-bg` · `--danger-bg` | `#DCEBE2` · `#F1E6D3` · `#F2DEE2` | fundos de feedback |
| `--money` | `#12633D` | dinheiro (sempre verde) |
| `--chart-1..5` | `#2F4FD6` · `#0E6B3C` · `#954C00` · `#07687A` · `#A93224` | séries: azul, verde, laranja, turquesa, coral — todas ≥ 4,5:1 também no próprio tint de 14% (viram texto em selo) |

### Escuro — derivado

| Token | Valor | Observação |
| --- | --- | --- |
| `--bg` / `--bg-raised` / `--bg-elev` | `#0F1219` / `#151923` / `#1C2130` | neutros do DS1 com leve tinta azul |
| `--fg1` … `--fg5` | `#F4F5F7` … `#868C9B` | todos ≥ 4,5:1 no card |
| `--accent` | `#8FA3F2` | azul claro do DS1 ("apoio em fundo escuro"). O azul North dá 3,4:1 em fundo escuro: **não usar como texto** |
| `--cta` | `#4260E6` | botão continua azul North (branco 5,19:1) |
| `--money` / `--success` | `#2FBF71` | |
| `--danger` | `#F26170` | error.base clareado para passar no card elevado |
| `--warning` | `#F5A623` | |
| `--chart-1..5` | `#8FA3F2` · `#2FBF71` · `#F5A623` · `#35C3D6` · `#F27A65` | azul claro, verde, âmbar, turquesa, coral — todas ≥ 4,5:1 no elevado |

### Contraste é regra

Todo token usado como texto passa **4,5:1** no pior fundo do tema em que aparece; bordas de
controle e elementos essenciais de gráfico, **3:1**. Cor nova só entra depois de medida.
`--chart-1..5` são cores de série que às vezes viram texto (selo de família/etapa, rótulo
central do Donut): por isso as cinco passam 4,5:1 nos dois temas, inclusive sobre o próprio tint.
Paleta nova de série só entra medida (`contrast` no canvas, painel e tint de 14%).

### Vida (03/10/2026)

Camada no fim de `dashboard.css` ("VIDA"). Cor com função — seleção, hierarquia, estado:

- **Sidebar:** item ativo em azul cheio (`--cta`, texto branco); rótulo de grupo em `--accent`.
- **Títulos:** complemento do título (`<em>`) e eyebrow da página em `--accent`; título de
  painel (`.panel-eyebrow`) em `--accent` 13 px semibold.
- **KPI:** cada card tem `--kpi-tone` (faixa de 3 px no topo, ícone, ponto, sparkline).
  "Menor é melhor" (reembolso, chargeback) = coral; os demais alternam azul/verde/turquesa/
  laranja pela posição; alerta = `--danger`. Variação em selo: verde melhora, vermelho piora.
- **Tabela:** cabeçalho com tinta de 6% do acento. **Segmentado:** opção ativa com fundo e borda.
- **Barras por país:** nome em cima, barra de 6 px embaixo com trilho (antes o nome ficava
  sobre a barra e parecia riscado).
- Regra antiga `[data-theme="light"] .x` é mais específica que `.x`: na camada VIDA use
  `[data-theme] .x` para empatar e vencer pela ordem nos dois temas.

### Chat (Next/Tailwind) — nomes próprios

O `/chat` carrega as duas folhas: `colors_and_type.css` (hex) e `app/chat/globals.css`
(triplets HSL do shadcn). Nome repetido entre elas quebra: a folha hex vence e
`hsl(#D8DBE2)` é inválido. Por isso os tokens HSL que colidiam usam prefixo **`--cx-`**
(`--cx-border`, `--cx-accent`, `--cx-success`, `--cx-warning`, `--cx-danger`). Token HSL novo
no chat: nunca reutilizar um nome de `colors_and_type.css`.

- **Casca igual à da SPA.** Nav, topo e filtros do chat usam as MESMAS classes da SPA
  (`.side`, `.top`, `.filters`, `.select-btn`…). A nav é **gerada** da Sidebar da SPA
  (`node scripts/gen-chat-nav.mjs` → `components/chat/navConfig.generated.ts`); o build
  quebra se ficar desatualizada. Ícone no chat é `<NsIcon>` (mesmo set e traço 1.6), nunca
  lucide direto.
- **Regra de elemento da SPA não entra no chat.** Seletores de elemento em
  `dashboard.css`/`colors_and_type.css` (`input`, `p`, `a`, `h1`…) levam
  `:not(:where([data-app-scope="chat"] *))`; portal do Radix leva `data-app-scope="chat"`.
  Regra de elemento nova nessas folhas: mesma guarda.
- **Estado compartilhado:** tema só é gravado no clique (`ns-theme`); recolhido da nav vai
  em localStorage **e** cookie `ns-side-collapsed` (o servidor do chat precisa saber);
  filtros viajam na URL com a codificação da SPA (`range/from/to/plat/fam/co/st/aff`).

## 4. Tipografia

| Papel | Fonte | Onde |
| --- | --- | --- |
| Texto e títulos | **Inter** (Google Fonts, eixo óptico 14–32, pesos 400–700) | `--f-body`, `--f-display` |
| Dados | **Inter** com algarismos tabulares (`tnum` ligado no body) | `--f-mono` (nome histórico) |
| Código | monoespaçada do sistema | `--f-code` |

O `@import` da fonte é a **primeira linha** de `colors_and_type.css` — depois de qualquer regra
o navegador o ignora (era o que acontecia: Inter e Montserrat nunca carregavam). Sequel Sans saiu
em 03/10/2026: TTF de desktop sem hinting, serrilhava no Windows.

Escala: corpo **14/22**, auxiliar **12/18**, título de página **28/36 bold**, métrica
**Inter Semibold 32/38** (reduz até 24 px). Sem caixa-alta decorativa em rótulo, sem
itálico decorativo — o complemento de um título vira o azul de destaque (`--accent`).

## 5. Forma

- Raios: **4** compacto · **6** controle · **8** superfície. Círculo só em avatar e controle circular.
- Borda **1 px** para divisor e campo; **2 px só no foco**.
- Sombra nunca é o único limite de um componente. Cartão = superfície + borda.
- Nada de orbe, brilho, scanline, vidro, cordilheira ou gradiente decorativo.

## 6. Componentes

- **Botões:** primário (azul, texto branco), secundário (superfície + borda), texto. Altura 36 px
  (44 em toque). Processando: mantém a largura e bloqueia reenvio.
- **Campos:** rótulo sempre visível; placeholder só exemplifica. Borda `--border-strong`.
- **Tabelas:** cabeçalho estável em 12 px medium; texto à esquerda, **números à direita
  (`className="num"`)** em Inter tabular; linha 44 px.
- **Paginação:** toda lista ou tabela de dados usa `Paginated` / `usePaged` / `Pager`
  (`public/src/utils.jsx`) — total, página atual, tamanho 10/25/50/100 (lembrado por usuário).
  Totais, CSV e contagens continuam sobre a lista inteira. Listas curtas por natureza não paginam.
  Lista que vem da API com teto (ex.: Transações) pagina **no servidor** (`limit`/`offset` +
  `Pager` controlado), nunca fatiando um lote truncado no cliente. Fila que encolhe a cada ação
  fica na página atual; filtro/busca novos voltam para a página 1.
- **Estados de leitura:** `ReadState` com `vazio`, `carregando`, `parcial` e `falha`. "Parcial"
  é obrigatório quando uma fonte sabidamente não reporta (ex.: estorno da BuyGoods).
- **Drawers e diálogos:** fundo clicável, fecham com Esc, `role="dialog"`.

## 7. Ícones

Biblioteca vetorial NorthScale (32 ícones, grade 24, traço 1,6) em `<Icon>`. Nomes Lucide com
equivalente exato entram por alias (`x` → fechar, `search` → busca…); ícones só-NorthScale usam
prefixo (`ns-funil`, `ns-ranking`, `ns-recuperacao`…). Ícone decorativo é `aria-hidden`; ícone
que carrega significado sozinho recebe `label`. **O build falha se um ícone usado não existir.**

## 8. Marca

- Nome em texto: **NorthScale** (junto, N e S maiúsculos).
- O logotipo é arquivo fixo em `public/assets/brand/` — **nunca recompor com fonte**.
- Globo detalhado só com **≥ 128 px** de largura; abaixo disso, logotipo **sem** símbolo.
- Favicon e trilho recolhido: **ícone de app** (`app-icon-quadrado.svg`), nunca o globo pequeno.

## 9. Acessibilidade (critérios do DS1)

Teclado em tudo, com foco visível e não encoberto · nome acessível e estado (seleção, expansão,
indisponível) · alvo de 44 × 44 em toque (mínimo WCAG 24 × 24) · erros ligados ao campo ·
atualização relevante anunciada sem mover o foco · respeito a movimento reduzido.

## 10. Linguagem (Manual de Marca)

Direta, precisa e sóbria. Começa pela informação que muda a decisão; identifica métrica, período
e fonte; sem superlativo nem urgência artificial. Quando o dado é desfavorável, a linguagem
continua clara e diz o que fazer.

## 11. Guards de build (`scripts/build-spa.mjs`)

- ícone usado precisa existir no mapa do `<Icon>`;
- toda aba do catálogo de permissões precisa ter item na sidebar e rota no `app.jsx`;
- `NSApi.*` usado precisa estar exportado.
