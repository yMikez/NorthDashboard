# North Editorial — Visual System

Sistema visual da plataforma NorthScale Afiliados. Este documento é autocontido: serve como referência de implementação e como **prompt** para aplicar a mesma direção de arte em outro projeto (a última seção é um prompt condensado pronto para colar).

---

## 1. Filosofia — "anti cara de IA"

A direção nasceu de um briefing explícito contra o visual genérico de produto SaaS feito às pressas:

- **NADA de glassmorphism.** Superfícies são sólidas, com borda nítida de 1px e sombra discreta. Vidro fosco, blur e transparência leitosa são proibidos.
- **NADA de azul-roxo genérico** (o gradiente violeta de todo template). O acento é um **teal petróleo** com personalidade.
- **NADA de Inter/shadcn por padrão.** Tipografia própria (Fontshare), com display de caráter nos títulos.
- **Papel e tinta, não neon.** O tema claro é um papel quente (não branco puro); o escuro é petróleo profundo (não cinza chumbo).
- **Movimento com propósito.** Micro-animações curtas e físicas; espetáculo só onde o usuário para (login), nunca no meio do trabalho.
- **Uma metáfora que costura tudo**: a montanha. O usuário está numa escalada rumo ao norte (ver §8).

## 2. Paleta — tokens CSS

Tudo via CSS custom properties no `body`, tema trocado com `body[data-theme="dark"]`. Componentes NUNCA usam hex direto para cores de tema — só `var(--token)`.

### Tema claro (default) — papel quente + tinta petróleo

```css
--bg: #F5F3EC;          /* fundo: papel quente */
--card: #FFFFFF;        /* superfícies */
--ink: #182226;         /* texto principal: tinta petróleo (não preto) */
--sub: #5E6D71;         /* texto secundário */
--line: rgba(24,34,38,.14);      /* bordas */
--accent: #0E7C97;      /* acento: teal petróleo */
--accent-soft: rgba(14,124,151,.10); /* fundo de chips/ícones do acento */
--accent2: #22D3EE;     /* acento claro (detalhes, brilhos) */
--money: #0B8F60;       /* verde-dinheiro: valores monetários, SEMPRE */
--hot: #E8590C;         /* laranja "escalando"/quente */
--cta: #182226;         /* botão primário = tinta sólida */
--ok: #2E7D5B;          /* sucesso */
--warn: #A97612;        /* atenção */
--shadow: 0 1px 2px rgba(24,34,38,.04), 0 10px 28px rgba(24,34,38,.06);
```

### Tema escuro — petróleo profundo

```css
--bg: #0D1215;   --card: #161D21;  --ink: #ECEFEA;  --sub: #92A1A1;
--line: rgba(236,239,234,.15);
--accent: #3EB7D4;  --accent-soft: rgba(62,183,212,.13);  --accent2: #22D3EE;
--money: #37D695;   --hot: #FF7A33;   --cta: #1E859F;
--ok: #4FB58F;      --warn: #D3A855;
--shadow: 0 1px 2px rgba(0,0,0,.30), 0 12px 32px rgba(0,0,0,.35);
```

### Cores fixas (não mudam com o tema)

- **Sidebar/cenas noturnas**: gradiente petróleo `#0E1A20 → #132630 → #0F2028`, brilhos em ciano-gelo `rgba(91,200,255,…)`, texto `#EDF1F8`, secundário `#93A0B8`.
- **Dourado do topo** (nível máximo, medalha ouro): `#C29B3C`.
- **Vermelho de notificação**: `#E5484D` (bolinha 8px + halo `rgba(229,72,77,.16)`).
- **Categorias/nichos são SEMÂNTICOS** — cada nicho tem cor própria e vibrante (fora da paleta de tema, de propósito): `#38BDF8`, `#FB7185`, `#A78BFA`, `#818CF8`, `#34D399`, `#F59E0B`, `#F472B6`, `#2DD4BF`. Categorias novas ganham cor determinística por hash do nome numa paleta de 12.
- **Misturas**: sempre `color-mix(in oklab, var(--x) N%, transparent)` para fundos de chips de status, hovers e sombras coloridas — nunca opacidade em hex.

## 3. Tipografia

Carregada via CDN (Fontshare + Google Fonts):

```html
<link href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet" />
<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@500;600;700&display=swap" rel="stylesheet" />
```

| Papel | Fonte | Uso |
|---|---|---|
| Títulos (h1–h3) | **Clash Display** 500–700 | `letter-spacing: -.01em` a `-.02em`; headlines de hero em UPPERCASE |
| Texto/UI | **General Sans** 400–700 | corpo, labels, botões |
| Métricas | **Roboto Mono** 500–700 | classe `.mono`: `letter-spacing: -.04em; font-variant-numeric: tabular-nums` |

Regras:
- Números de negócio (EPC, CPA, %, contagens) SEMPRE em `.mono` — alinham em tabela e "parecem dados".
- **Cuidado com o zero**: JetBrains/IBM Plex Mono têm zero cortado/pontuado que em corpo pequeno parece valor riscado — por isso Roboto Mono.
- Valores monetários SEMPRE em `var(--money)` e SEMPRE em `$` (nunca %).
- Hierarquia por peso e cor (`--ink` vs `--sub`), não por tamanho exagerado. Corpo em 12–13.5px, títulos de página 24px.

## 4. Superfícies e profundidade

- **Cartão padrão**: `background: var(--card)`, `border: 1px solid var(--line)`, `border-radius: 14–18px`, `box-shadow: var(--shadow)`.
- Raios: 18px para cartões grandes, 12–14 médios, 9–10 inputs/botões, 99px para pills.
- **Hover de cartão clicável**: `translateY(-2px)` + borda vira `--ink` + sombra `color-mix(ink 12%)`. Transições 150–200ms.
- Bordas tracejadas (`1.5px dashed`) para zonas de upload/vazias.
- Inputs: fundo `var(--bg)`, borda `--line`, foco com `outline: 2px solid var(--accent)`.
- Botão primário (`.cta`): fundo sólido `var(--cta)` (tinta no claro, teal no escuro), texto branco, hover `opacity .90` + `translateY(-1px)`; variante `--lift` sobe 2px com sombra colorida do próprio botão.

## 5. Componentes-assinatura

- **Chips de status**: pill com texto na cor semântica e fundo `color-mix(cor 12%)`. Prefixos: `●` pendente, `⟳` em processo, `✓` ok.
- **Chips de nicho**: cor própria do nicho no texto + fundo `cor+'22'`.
- **Badge de nível** (gamificação): pill pequena com fundo na cor do nível (cinza `#64748B` / accent / dourado `#C29B3C`), texto branco, `★` na frente.
- **Medalhas de ranking**: TOP 1 ouro, TOP 2 prata, TOP 3 bronze — gradientes, canto do cartão.
- **Bolinha de notificação**: 8px `#E5484D` com halo, na aba correspondente; some ao visitar.
- **Sidebar**: escura SEMPRE (nos dois temas), gradiente petróleo + brilhos ciano; item ativo `rgba(91,200,255,.15)` + texto branco; cordilheira sutil no rodapé (traço ciano ~14% de opacidade).
- **Skeletons**: blocos com `border-radius` do componente final pulsando (`opacity .45 ↔ .95`).
- **Toast**: entra de baixo com `translateY(12px) scale(.97) → none`.
- **Confirmação destrutiva**: modal que exige digitar a palavra "deletar".
- **Estados vazios**: cartão de borda tracejada, texto `--sub`, com um link de ação em `--accent`.

## 6. Movimento

- **Entradas**: `fadeUp` (8px, 350ms, ease) em seções; grids de cartões em cascata (delays de 50ms, teto em 300ms).
- **Hovers**: elevação de 1–2px + mudança de borda/sombra; nunca scale em cartões (só 1.1 em setas circulares).
- **Espetáculo controlado (só no login/cadastro)**, com a lib **Motion** (`motion/react`):
  - parallax da cena seguindo o ponteiro via `useMotionValue + useSpring` (stiffness 60, damping 20), camadas com profundidades diferentes (estrelas ×6, fundo ×15);
  - Ken Burns na arte de fundo: `scale 1.015 → 1.055` em 45s alternando;
  - estrelas CSS piscando (`opacity .35 ↔ 1`, durações 2.4–5.2s dessincronizadas), auroras com drift horizontal de 40px em 11–14s;
  - card e logo entram com spring (translateY + fade).
- **Dashboard não usa Motion** — só CSS. Animação onde o usuário trabalha é ruído.
- Padrão de rotação (carrossel): 7s por slide, crossfade 600ms, pausa no hover.

## 7. Iconografia

- Ícones próprios em SVG stroke (`strokeWidth 1.8–2.2`, `strokeLinecap/join: round`), 13–19px, na cor do contexto.
- Ícone em "azulejo": quadrado 32–38px, raio ~11px, fundo `--accent-soft`, ícone `--accent`.
- **Troca semântica pela metáfora**: tudo que "escala/cresce" usa o ícone de **cordilheira** (não setinha de gráfico). Tenda = base, escalador = meio, estrela de 4 pontas = topo.

## 8. Narrativa visual — a montanha e o norte

A metáfora que diferencia o produto: **o afiliado escala uma montanha rumo ao norte.**

- Níveis de progressão: **Base** (acampamento, cinza) → **Ascendente** (a subida, accent) → **North** (o topo/estrela, dourado). Rótulos centralizados num único módulo — renomear é trocar uma linha.
- **Login** = a cena completa: céu espacial petróleo, estrela do norte, aurora teal, cordilheira em gravura fina estilo engraving (linhas ciano-gelo sobre petróleo), com parallax.
- **No app, o tema aparece SUTIL** (regra do "sem fru-fru"): cordilheira quase imperceptível no rodapé (traço `--ink` a 5% de opacidade), eco ciano no pé da sidebar, ícone de montanha nas features de crescimento. Se dá pra notar de relance, está forte demais.
- **Artes geradas** (banners/fundos): gravura vintage de montanhas em `#5BC8FF` sobre `#0D1215`, aurora `#0E7C97`, dourado `#C29B3C` para conquista; composição com peso à direita e terço esquerdo calmo para texto.

## 9. Regras de tema claro/escuro

- Troca via `body[data-theme="dark"]` redefinindo os tokens — componentes não sabem qual tema está ativo.
- Superfícies fixas escuras (sidebar, cenas noturnas, artes) usam hex fixo e ficam iguais nos dois temas.
- Telas de autenticação são sempre escuras; o card de login é sempre papel (`#F7F5EF` com tinta `#182226`) — para forms aninhados, injete os tokens claros via style no wrapper.
- `--blur: 0px` global neutraliza qualquer `backdrop-filter` legado.

## 10. Tom de escrita

- PT-BR direto, caloroso e específico: "a primeira é por sua conta", "a equipe vai te retornar em breve".
- Microcopy explica a consequência, não a mecânica: "o afid entra automático na aprovação".
- Toasts começam com `✓`/`⟳`/emoji de contexto. Erros dizem o que fazer, não só o que falhou.

---

## 11. PROMPT CONDENSADO (colar em outra IA/projeto)

> Crie a interface seguindo o design system "North Editorial": tema claro = papel quente #F5F3EC com tinta petróleo #182226 (nunca preto puro nem branco gelo); tema escuro = petróleo profundo #0D1215 com superfícies #161D21. Acento teal #0E7C97 (claro) / #3EB7D4 (escuro) — proibido azul-roxo genérico. Verde #0B8F60 exclusivo para dinheiro. PROIBIDO glassmorphism: superfícies sólidas com borda 1px rgba(24,34,38,.14), raio 14–18px e sombra dupla discreta. Tipografia: Clash Display (títulos, tracking -0.02em) + General Sans (texto) via Fontshare, Roboto Mono com tabular-nums para todo número/métrica. Botão primário sólido cor de tinta, hover sobe 1–2px. Chips em pill com texto na cor semântica e fundo color-mix 12%. Sidebar sempre escura em gradiente petróleo com brilhos ciano rgba(91,200,255). Animações: fadeUp 350ms em cascata (50ms de delay entre cartões), hovers de 150–200ms com elevação sutil; nada de animação decorativa em telas de trabalho; na tela de login, cena noturna com parallax de ponteiro (springs), estrelas piscando, aurora e zoom lento de 45s. Metáfora da marca: montanha/escalada rumo ao norte — gravuras finas de cordilheira em ciano-gelo #5BC8FF sobre petróleo, estrela de 4 pontas no topo, dourado #C29B3C para conquista; no miolo do app o tema aparece só em detalhes quase imperceptíveis (traços a 5% de opacidade). Estética geral: editorial premium, papel e tinta, bordas nítidas, dados em mono — nunca "template de SaaS".

---

*Fonte da verdade no código: `frontend/src/index.css` (tokens e classes), `frontend/src/data/seed.ts` (cores de nicho), `frontend/src/lib/levels.ts` (níveis), `frontend/src/components/AuthScene.tsx` (cena do login), `frontend/index.html` (fontes).*
