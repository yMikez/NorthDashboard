// Layout do redesign do /chat.
//
// CSS chain:
//   1. /styles/dashboard.css   — define vars (--fg1, --bg, etc) + .side,
//      .side-item, .user-chip, font-faces da SPA legacy. Permite o
//      DashboardNav renderizar com look idêntico ao resto do app.
//   2. ./globals.css           — Tailwind + tokens shadcn (HSL). Escopado
//      no wrapper [data-app-scope='chat'] pra não vazar.
//
// Ordem importa: Tailwind layers vencem onde houver colisão de classe.

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Análise IA · Northscale',
};

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="/styles/colors_and_type.css" />
      <link rel="stylesheet" href="/styles/dashboard.css" />
      {/* position fixed + inset-0 ancora o app exatamente na viewport,
          ignorando o min-height:100vh do body (de dashboard.css) e o
          height:100vh do .side (sticky). Sem isso a soma desses dois
          fazia o body crescer além de 100vh e o ChatInput ia parar
          abaixo da tela (usuário precisava zoom-out 60% pra ver). */}
      <div data-app-scope="chat" className="fixed inset-0 overflow-hidden antialiased">
        {children}
      </div>
    </>
  );
}
