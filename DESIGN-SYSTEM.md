# NorthScale Design System 1.0 — aplicação no dashboard

**Fonte da verdade:** pasta **"North Scale"** no Google Drive (id `1uDFFFgXSNN4MU9JO_B0ZpXAvtCma_TqJ`),
entregue pelo designer em setembro de 2026:

| Arquivo | O que é |
| --- | --- |
| `Documentação Geral.pdf` | Manual de Marca — posicionamento, voz, logo, cores |
| `Documentação do Sistema.pdf` | Design System — fundamentos, componentes, estados, layouts |
| `Variáveis (JSON)/northscale.tokens.json` + `.css` | Tokens exatos |
| `Visual/` | Logotipos, globo, ícone de app, biblioteca de ícones |
| `Fontes - Abertas/` | Inter, Montserrat e Sequel Sans |

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

Tomadas pelo dono do produto em 29/09/2026. Estão marcadas também no CSS.

| Tema | DS1 | Dashboard | Por quê |
| --- | --- | --- | --- |
| Tema escuro | Não existe (só claro) | **Escuro derivado**, opcional | Uso prolongado; derivado dos neutros e do azul claro do DS1, contraste medido |
| Dinheiro | Cor semântica só para estado | **Sempre verde** (`--money`) | Leitura rápida de valor na operação |
| Números | Padrão brasileiro | **Padrão americano** (`US$ 1,250.50`) | Operação em dólar, parceiros internacionais |
| Densidade | Controle 44 px, linha ≥ 48 px | **Controle 36 px, linha 44 px**; 44 px em toque | Painel de operação com muita tabela |
| Título de página | H3 40/48 | **H4 28/36** | Mesma razão — espaço vertical para o dado |

## 3. Cores

Componentes usam **só `var(--token)`**. Os nomes históricos (`--fg1..5`, `--accent`,
`--glow-cyan`, `--navy-*`) foram mantidos por compatibilidade; os valores são do DS1.

### Claro (padrão) — valores do DS1

| Token | Valor | Papel |
| --- | --- | --- |
| `--bg` | `#F4F5F7` | bg.canvas |
| `--bg-raised` | `#FFFFFF` | bg.surface (cartões, tabelas) |
| `--bg-hover` | `#EEF1FD` | bg.hover, seleção |
| `--fg1` | `#0D0D0D` | text.primary |
| `--fg4` | `#515766` | text.secondary |
| `--fg5` | `#5F6890` | subtext.100 — o neutral.50 reprova como texto no canvas |
| `--accent` / `--glow-cyan` | `#4260E6` | azul North: seleção, link, foco |
| `--cta` / `--cta-hover` | `#4260E6` / `#1B22A7` | botão primário |
| `--border` / `--border-strong` | `#D8DBE2` / `#6E7484` | divisor / limite de campo |
| `--success` · `--warning` · `--danger` | `#167447` · `#87520B` · `#B42338` | tons de **texto** de feedback |
| `--success-bg` · `--warning-bg` · `--danger-bg` | `#EAF7EF` · `#FFF5E5` · `#FDECEF` | fundos de feedback |
| `--money` | `#167447` | dinheiro (success.text) |

### Escuro — derivado

| Token | Valor | Observação |
| --- | --- | --- |
| `--bg` / `--bg-raised` / `--bg-elev` | `#101217` / `#16181F` / `#1D2029` | neutros do DS1 |
| `--fg1` … `--fg5` | `#F4F5F7` … `#868C9B` | todos ≥ 4,5:1 no card |
| `--accent` | `#8FA3F2` | azul claro do DS1 ("apoio em fundo escuro"). O azul North dá 3,4:1 em fundo escuro: **não usar como texto** |
| `--cta` | `#4260E6` | botão continua azul North (branco 5,19:1) |
| `--money` / `--success` | `#2FBF71` | |
| `--danger` | `#F26170` | error.base clareado para passar no card elevado |
| `--warning` | `#F5A623` | |

### Contraste é regra

Todo token usado como texto passa **4,5:1** no pior fundo do tema em que aparece; bordas de
controle e elementos essenciais de gráfico, **3:1**. Cor nova só entra depois de medida.
`--chart-1..5` são cores de série (não-texto): se a cor da categoria também vira texto (badge,
eyebrow, rótulo central do Donut), confira — `--chart-4` no escuro é o azul North (3,4:1).

### Chat (Next/Tailwind) — nomes próprios

O `/chat` carrega as duas folhas: `colors_and_type.css` (hex) e `app/chat/globals.css`
(triplets HSL do shadcn). Nome repetido entre elas quebra: a folha hex vence e
`hsl(#D8DBE2)` é inválido. Por isso os tokens HSL que colidiam usam prefixo **`--cx-`**
(`--cx-border`, `--cx-accent`, `--cx-success`, `--cx-warning`, `--cx-danger`). Token HSL novo
no chat: nunca reutilizar um nome de `colors_and_type.css`.

## 4. Tipografia

| Papel | Fonte | Onde |
| --- | --- | --- |
| Texto e títulos | **Sequel Sans** (Body 400/500/600/700), auto-hospedada em `public/fonts/` | `--f-body`, `--f-display` |
| Reserva | **Inter** | fallback |
| Dados | **Montserrat** com algarismos tabulares | `--f-mono` (nome histórico) |
| Código | monoespaçada do sistema | `--f-code` |

Escala: corpo **14/22**, auxiliar **12/18**, título de página **28/36 bold**, métrica
**Montserrat Semibold 32/38** (reduz até 24 px). Sem caixa-alta decorativa em rótulo, sem
itálico decorativo — o complemento de um título vira tom secundário (`--fg4`).

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
  (`className="num"`)** em Montserrat; linha 44 px.
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
