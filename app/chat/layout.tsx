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
      <link rel="stylesheet" href="/styles/dashboard.css" />
      <div data-app-scope="chat" className="min-h-screen antialiased">
        {children}
      </div>
    </>
  );
}
