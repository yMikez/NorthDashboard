import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Nome em texto: "NorthScale", junto, com N e S maiúsculos (Manual de Marca).
export const metadata: Metadata = {
  title: 'NorthScale · Operação',
  icons: { icon: '/assets/brand/app-icon-quadrado.svg' },
};

// Inline antes do React hidratar pra evitar flash do tema errado.
// Mesmo script usado em public/index.html (SPA) — chave 'ns-theme'
// no localStorage, default 'light' (o DS 1.0 é uma interface clara; o
// escuro é a variante derivada, por escolha do usuário).
const themeBootstrap = `
(function(){
  try {
    var s = localStorage.getItem('ns-theme');
    var t = (s === 'light' || s === 'dark') ? s : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: o bootstrap acima troca data-theme ANTES da
    // hidratação (é o objetivo dele) — sem isso o React acusa divergência.
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
