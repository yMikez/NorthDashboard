import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Northscale · Operations Dashboard',
};

// Inline antes do React hidratar pra evitar flash do tema errado.
// Mesmo script usado em public/index.html (SPA) — chave 'ns-theme'
// no localStorage, default 'dark'.
const themeBootstrap = `
(function(){
  try {
    var s = localStorage.getItem('ns-theme');
    var t = (s === 'light' || s === 'dark') ? s : 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
