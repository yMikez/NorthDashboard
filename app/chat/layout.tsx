// Layout do redesign do /chat. Importa globals.css (Tailwind + tokens
// shadcn) localmente — Next.js bundla esse CSS na rota /chat sem
// afetar /index.html da SPA legacy (que tem seu próprio CSS).
//
// O wrapper [data-app-scope='chat'] aplica color/background/font do
// tema. Necessário pra evitar que estilos vazem pra outras rotas se
// alguém importar globals.css em outro lugar.

import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Análise IA · Northscale',
};

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div data-app-scope="chat" className="min-h-screen antialiased">
      {children}
    </div>
  );
}
