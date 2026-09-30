// Layout do redesign do /chat.
//
// CSS chain:
//   1. ./globals.css (import) — Tailwind + tokens shadcn (HSL, prefixo --cx-
//      nos nomes que colidiam). Vai no <head>.
//   2. /styles/colors_and_type.css + /styles/dashboard.css (<link> abaixo) —
//      tokens DS1 e as classes da casca da SPA (.side, .top, .filters,
//      .chip…), pra nav/topo/filtros terem o MESMO visual do resto do app.
//
// Ordem importa, e ao contrário do que parece: os <link> sem 'precedence'
// ficam no <body>, DEPOIS do globals.css, e ganham empate de especificidade
// (o @layer do Tailwind 3 compila pra CSS sem camada). Por isso as regras de
// ELEMENTO da SPA (input, p, a, h1…) levam :not(:where([data-app-scope=chat] *))
// e não tocam no chat; e os portais do Radix (menus, tooltips, sheet) levam
// data-app-scope="chat" pra entrar no mesmo escopo.

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Análise (IA) · NorthScale',
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
