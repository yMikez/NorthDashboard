// Entry point do redesign do chat (TS + Tailwind + shadcn).
//
// Substitui o ChatPage da SPA legacy (que era renderizado pelo
// middleware via rewrite pra /index.html). Agora /chat hit direto
// nessa rota Next.js — middleware foi atualizado pra não rewriter.
//
// Auth: server-side via getSessionUser. Não-logado vai pra /login.
// Desde 2026-08-03 QUALQUER usuário logado usa o chat — as conversas e
// pastas são individuais (escopadas por userId nas rotas da API).

import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { ChatShell } from '@/components/chat/ChatShell';

export default async function ChatPageRoute() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/chat');

  return (
    <ChatShell
      user={{
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      }}
    />
  );
}
