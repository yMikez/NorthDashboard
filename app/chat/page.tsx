// Entry point do redesign do chat (TS + Tailwind + shadcn).
//
// Substitui o ChatPage da SPA legacy (que era renderizado pelo
// middleware via rewrite pra /index.html). Agora /chat hit direto
// nessa rota Next.js — middleware foi atualizado pra não rewriter.
//
// Auth: server-side via getSessionUser. Não-logado vai pra /login.
// Desde 2026-08-03 QUALQUER usuário logado usa o chat — as conversas e
// pastas são individuais (escopadas por userId nas rotas da API).
//
// URL: mesmos filtros da SPA (range/from/to/plat/fam/co/st/aff) — quem vem
// da SPA chega com o recorte que estava vendo — e ?c=<id> reabre a conversa.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { ChatShell } from '@/components/chat/ChatShell';
import { csvList, rangeFromQuery } from '@/lib/shared/datePresets';
import type { FilterState } from '@/types/chat';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
// "Nenhum" da SPA vem na URL como '__NONE__' (zero itens). O chat não tem esse
// modo — seria mandado à IA como uma plataforma chamada __NONE__ —, então vira Todos.
const list = (v: string | string[] | undefined) => csvList(one(v)).filter((x) => x !== '__NONE__');

export default async function ChatPageRoute({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getSessionUser();
  const sp = await searchParams;
  if (!user) {
    const qs = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
    ).toString();
    redirect('/login?next=' + encodeURIComponent('/chat' + (qs ? '?' + qs : '')));
  }

  const range = rangeFromQuery({ range: one(sp.range), from: one(sp.from), to: one(sp.to) });
  const initialFilters: FilterState = {
    period: { preset: range.preset, start: range.start, end: range.end },
    platforms: list(sp.plat),
    families: list(sp.fam),
    countries: list(sp.co),
    stages: list(sp.st),
    affiliates: list(sp.aff),
  };
  const c = one(sp.c);
  // id de conversa é cuid — qualquer outra coisa nem tenta abrir.
  const initialConversationId = c && /^[a-z0-9]{8,40}$/i.test(c) ? c : null;
  const initialNavCollapsed = (await cookies()).get('ns-side-collapsed')?.value === '1';

  return (
    <ChatShell
      user={{
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        allowedTabs: user.allowedTabs,
      }}
      initialFilters={initialFilters}
      initialConversationId={initialConversationId}
      initialNavCollapsed={initialNavCollapsed}
    />
  );
}
