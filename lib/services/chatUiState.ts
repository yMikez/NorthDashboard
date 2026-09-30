// Estado da UI que a SPA/o /chat mandam junto da pergunta → bloco
// "# Estado da UI" do contexto do turno. Um lugar só: a rota do chat e o
// eval (lib/services/chatEval.ts) montam o MESMO texto, byte a byte — senão
// o eval mediria um prompt diferente do de produção.

export interface UiState {
  route?: string;
  preset?: string;
  // Rótulos (YYYY-MM-DD, dia civil do que a tela mostra) — só pro texto.
  startDate?: string;
  endDate?: string;
  // Instantes exatos (ISO) que as abas usam nas queries — viram o default
  // das tools, pra o chat consultar EXATAMENTE o que está na tela.
  startAt?: string;
  endAt?: string;
  platforms?: string[];
  families?: string[];
  stages?: string[];
  countries?: string[];
  // affiliate_id do NorthScale Afiliados (filtro "Afiliado" da SPA/chat).
  affiliates?: string[];
}

// Sanitiza e serializa: free-form do client — só strings curtas passam,
// listas capadas em 10 itens.
export function uiStateText(ui: UiState | undefined): string {
  if (!ui || typeof ui !== 'object') return '';
  const s = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10).map((x) => (x as string).slice(0, 40)) : [];
  const parts: string[] = [];
  if (s(ui.route)) parts.push(`aba: ${s(ui.route)}`);
  if (s(ui.preset)) parts.push(`período selecionado: ${s(ui.preset)}`);
  if (s(ui.startDate) && s(ui.endDate)) parts.push(`intervalo: ${s(ui.startDate)} → ${s(ui.endDate)}`);
  const lists: Array<[string, unknown]> = [
    ['plataformas', ui.platforms], ['famílias', ui.families],
    ['etapas', ui.stages], ['países', ui.countries],
  ];
  for (const [label, v] of lists) {
    const a = arr(v);
    if (a.length) parts.push(`${label}: ${a.join(', ')}`);
  }
  const aff = arr(ui.affiliates);
  if (aff.length) {
    // Só algumas tools aplicam o filtro — o modelo precisa saber onde ele
    // vale pra não dizer "filtrado" num número que não está.
    parts.push(
      'afiliado (affiliate_id NorthScale): ' + aff.join(', ') +
        ' — como os outros filtros da UI, vale como default só em perguntas dêiticas (em perguntas gerais não herde); nelas passe em affiliate_ids nas tools que aceitam (visão geral, afiliados, detalhe, funil, funil por janelas, ' +
        'produtos, famílias, plataformas, transações, lucro front×back, custos, fulfillment, coortes de reembolso). ' +
        'Call center, recuperação, SMS, saúde e as análises por janela de afiliados NÃO filtram por afiliado — ' +
        'se usar alguma delas, diga que o número é do total.',
    );
  }
  return parts.length ? `\n# Estado da UI (o que o usuário está vendo agora)\n${parts.join(' · ')}` : '';
}
