# Decisões do ClickUp e briefing da IA

Duas leituras da operação feitas por IA, com os números sempre calculados pelo dash.

- **Briefing** (topo da Visão geral): saudação + leitura da semana.
- **Decisões** (aba Decisões): o que a liderança decidiu nas threads do ClickUp × as métricas
  que cada decisão podia mexer.

Código: `lib/briefing/`, `lib/clickup/`, `lib/decisions/`, `lib/insights/` (chamada à IA e
números de janela).

## Regra de ouro

A IA **escreve**; o dash **calcula**. Ela recebe os números já formatados e não soma, não
arredonda, não estima. A correlação decisão × métrica é feita pelo dash, nunca pela IA, e todo
texto diz que é **correlação no tempo, não prova de causa**.

## Briefing da Visão geral

- Janela: os **últimos 7 dias fechados** (até ontem, Brasília) contra os **7 anteriores**. Dia em
  andamento fica fora (mesma regra da Análise de afiliados).
- Números: as mesmas funções da Visão geral (`getOverview` com comparação e `getOverviewPanels`):
  faturamento, pedidos aprovados, AOV, Net after CPA, aprovação, reembolso (US$ pela data do
  estorno) e chargeback; altas e quedas por família, plataforma e afiliado (pessoa), com piso de
  ruído de max(US$ 300; 1,5% do faturamento).
- Recorte: a operação inteira — ou, pra quem tem função na carteira, só a carteira dele. Os
  filtros da barra não entram (é a leitura da semana inteira).
- Decisões no briefing: só pra quem abre a aba Decisões (admin ou com a aba), as 3 mais recentes
  dos últimos 45 dias.
- Custo: o texto é gerado **1x por dia por recorte** (tabela `AiBriefing`) na primeira abertura;
  o resto do dia é leitura. Admin pode pedir de novo ("Gerar de novo").

## Decisões (ClickUp)

**Leitura do chat** (a cada 30 min, `lib/clickup/sync.ts`):

- Token pessoal do ClickUp (Configurações → Apps → API Token), gravado pela aba Decisões →
  Configurar ClickUp (ou `CLICKUP_API_TOKEN` no `.env`). O dash enxerga o que o **dono do token**
  enxerga: use o de alguém que está nos canais de liderança.
- Só canais (`CHANNEL`) ligam por padrão. **DM e grupo de DM ficam desligados**: são conversas
  pessoais de quem gerou o token. Canal com nome de liderança/gestão/diretoria/decisão entra
  marcado como liderança (lido primeiro).
- A raiz do canal costuma ser só o título; a conversa e a decisão moram na **thread**, então toda
  raiz com resposta nova tem a thread relida.
- Histórico: até 365 dias, lido em partes; depois, os últimos 30 dias dos canais com atividade nova.
  Ritmo ~85 chamadas/min (limite do ClickUp) e teto de 450 chamadas por rodada.

**Extração pela IA** (`lib/decisions/extract.ts`): uma chamada por thread nova ou mexida dos
últimos 180 dias (espera 45 min de silêncio), até 20 por rodada, liderança e recentes primeiro.
Decisão = escolha concluída de fazer/mudar algo (preço, oferta, funil, produto, plataforma,
afiliados, tráfego, call center, fulfillment, processo). Aviso de ausência, alerta, pergunta e
discussão sem conclusão ficam de fora.

**Régua de impacto** (desde 2026-11-25, pedido do usuário): só entra decisão de impacto e
abrangência. A IA classifica cada uma em abrangência (ampla = operação toda / várias áreas; setor =
um produto, plataforma, funil ou canal; pontual = um afiliado, cliente, conta, pagamento) e impacto
(alto/médio/baixo); o código descarta pontual e baixo impacto (`isMaterial`). Ex.: "Definir CPA de
$125 para o afiliado X" fica fora; "Subir o CPA padrão de todos os afiliados JVZoo" entra. Mudar a
régua = subir `EXTRACT_VERSION` (a thread já lida volta pra fila e é relida). A IA devolve as métricas que a decisão pode mexer (com a
direção esperada) e o escopo, escolhido de uma lista fechada de plataformas e famílias.

**Revisão manda**: decisão confirmada, descartada ou editada não é sobrescrita quando a thread é
relida. "Não é decisão" tira do briefing e das análises. Decisão tomada fora do ClickUp entra por
"Registrar decisão".

**Correlação** (`lib/decisions/core.ts` + `correlate.ts`):

- Depois = do dia da decisão até ontem (no máximo 30 dias); antes = os mesmos tantos dias
  imediatamente antes. Menos de 3 dias depois = "cedo demais".
- Fluxos (faturamento, pedidos, Net after CPA, reembolso) em média por dia; taxas e AOV como estão.
- No escopo da decisão (plataformas/famílias); vazio = operação toda.
- Veredito por métrica: na direção esperada, contra o esperado, estável (|Δ| < 0,5% ou < 0,1 pp) ou
  sem base.
- Texto: "Desde 12/11 foi decidido "X", com potencial de mexer em 3 métricas. Nos 12 dias seguintes,
  contra os 12 anteriores: … 2 de 3 andaram na direção esperada." + o aviso de correlação.
- Recalculada 1x por dia enquanto a decisão tem menos de 45 dias.

## Quem vê

- Briefing: quem abre a Visão geral (no recorte dele).
- Aba Decisões: só quem o admin liberar (conteúdo de canais privados). Configurar o ClickUp: admin.
- Quem tem função na carteira não abre a aba Decisões.

## Modelo de IA

`ANTHROPIC_INSIGHTS_MODEL` (padrão `claude-opus-5-5`, troca por `INSIGHTS_MODEL` no `.env`),
saída estruturada com esquema e fallback automático do servidor se o modelo recusar.
