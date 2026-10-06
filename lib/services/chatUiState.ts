// Estado da UI que a SPA/o /chat mandam junto da pergunta → bloco
// "# Estado da UI" do contexto do turno. Um lugar só: a rota do chat e o
// eval (lib/services/chatEval.ts) montam o MESMO texto, byte a byte — senão
// o eval mediria um prompt diferente do de produção.

import { db } from '../db';

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
  // Filtro "Afiliado" da SPA/chat: a:<Affiliate.id> (conta) ou p:<partnerId>
  // (pessoa). A rota resolve pra nome + contas (resolveUiAffiliates).
  affiliates?: string[];
}

/** Afiliado do filtro da tela já resolvido: nome e as contas (Affiliate.id). */
export interface UiAffiliate {
  name: string;
  accounts: Array<{ id: string; platform: string; externalId: string }>;
}

/** Resolve as chaves do filtro "Afiliado" (a:/p:) pra nome + contas — vai no texto do Estado da UI. */
export async function resolveUiAffiliates(keys: unknown): Promise<UiAffiliate[]> {
  const list = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string' && /^[ap]:[A-Za-z0-9_-]{1,64}$/.test(k)).slice(0, 10) : [];
  if (!list.length) return [];
  const accIds = list.filter((k) => k.startsWith('a:')).map((k) => k.slice(2));
  const partnerIds = list.filter((k) => k.startsWith('p:')).map((k) => k.slice(2));
  const rows = await db.affiliate.findMany({
    where: { OR: [...(accIds.length ? [{ id: { in: accIds } }] : []), ...(partnerIds.length ? [{ partnerId: { in: partnerIds } }] : [])] },
    select: { id: true, externalId: true, nickname: true, partnerId: true, platform: { select: { slug: true } }, partner: { select: { displayName: true } } },
  });
  const out: UiAffiliate[] = [];
  for (const pid of partnerIds) {
    const acc = rows.filter((r) => r.partnerId === pid);
    if (acc.length) out.push({ name: acc[0].partner?.displayName ?? 'pessoa', accounts: acc.map((r) => ({ id: r.id, platform: r.platform.slug, externalId: r.externalId })) });
  }
  for (const aid of accIds) {
    const r = rows.find((x) => x.id === aid);
    if (r) out.push({ name: r.nickname?.trim() || r.externalId, accounts: [{ id: r.id, platform: r.platform.slug, externalId: r.externalId }] });
  }
  return out;
}

// Sanitiza e serializa: free-form do client — só strings curtas passam,
// listas capadas em 10 itens.
export function uiStateText(ui: UiState | undefined, affiliates?: UiAffiliate[]): string {
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
  if (affiliates?.length) {
    // Só algumas tools aplicam o filtro — o modelo precisa saber onde ele
    // vale pra não dizer "filtrado" num número que não está.
    const who = affiliates
      .map((a) => `${a.name.slice(0, 40)} (contas: ${a.accounts.slice(0, 12).map((c) => `${c.id} = ${c.platform} ${c.externalId}`).join('; ')})`)
      .join(' | ');
    parts.push(
      'afiliado (filtro da tela): ' + who +
        ' — como os outros filtros da UI, vale como default só em perguntas dêiticas (em perguntas gerais não herde); nelas passe TODAS as contas em affiliate_accounts nas tools que aceitam (visão geral, afiliados, detalhe, funil, funil por janelas, ' +
        'produtos, famílias, plataformas, transações, lucro front×back, custos, fulfillment, coortes de reembolso). ' +
        'Call center, recuperação, SMS, saúde e as análises por janela de afiliados NÃO filtram por afiliado nas tools — ' +
        'se usar alguma delas, diga que o número é do total.',
    );
  }
  return parts.length ? `\n# Estado da UI (o que o usuário está vendo agora)\n${parts.join(' · ')}` : '';
}
