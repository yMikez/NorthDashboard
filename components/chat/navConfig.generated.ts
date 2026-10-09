// ARQUIVO GERADO por scripts/gen-chat-nav.mjs — não edite à mão.
// Fonte: Sidebar em public/src/shell.jsx + Icon/NS_ICON_MARKUP em public/src/utils.jsx.
// Mudou a sidebar da SPA? Rode `node scripts/gen-chat-nav.mjs` (o build confere).

export interface NavItem { id: string; label: string; icon: NsIconName }
export interface NavGroup { label: string; items: NavItem[] }

/** Grupos filtráveis por allowedTabs (membro só vê o que tem liberado). */
export const NAV_GROUPS: NavGroup[] = [
  {
    "label": "Análise",
    "items": [
      {
        "id": "overview",
        "label": "Visão geral",
        "icon": "layout-dashboard"
      },
      {
        "id": "funnel",
        "label": "Funil",
        "icon": "ns-funil"
      },
      {
        "id": "vsl",
        "label": "VSLs",
        "icon": "monitor-play"
      },
      {
        "id": "refund-cohorts",
        "label": "Reembolsos",
        "icon": "percent"
      }
    ]
  },
  {
    "label": "Afiliados",
    "items": [
      {
        "id": "leaderboard",
        "label": "Afiliados",
        "icon": "ns-ranking"
      },
      {
        "id": "affiliate-analysis",
        "label": "Análise",
        "icon": "trending-up"
      },
      {
        "id": "affiliate-crm",
        "label": "CRM",
        "icon": "message-square"
      }
    ]
  },
  {
    "label": "Captação",
    "items": [
      {
        "id": "recovery",
        "label": "Recuperação",
        "icon": "ns-recuperacao"
      },
      {
        "id": "tauk",
        "label": "Call Center",
        "icon": "target"
      }
    ]
  },
  {
    "label": "Clientes",
    "items": [
      {
        "id": "leads",
        "label": "Leads",
        "icon": "user"
      }
    ]
  },
  {
    "label": "Catálogo",
    "items": [
      {
        "id": "products",
        "label": "Produtos",
        "icon": "package"
      },
      {
        "id": "transactions",
        "label": "Transações",
        "icon": "receipt"
      }
    ]
  },
  {
    "label": "Sistema",
    "items": [
      {
        "id": "platforms",
        "label": "Plataformas",
        "icon": "ns-networks"
      },
      {
        "id": "health",
        "label": "Saúde do dado",
        "icon": "alert-triangle"
      }
    ]
  }
];

/** Chat IA: todo usuário logado vê, independente de allowedTabs. */
export const NAV_IA_GROUP: NavGroup = {
  "label": "IA",
  "items": [
    {
      "id": "chat",
      "label": "Análise (IA)",
      "icon": "ns-insights"
    }
  ]
};

/** Só admin. */
export const NAV_ADMIN_GROUP: NavGroup = {
  "label": "Admin",
  "items": [
    {
      "id": "users",
      "label": "Usuários",
      "icon": "user-plus"
    },
    {
      "id": "net-profit",
      "label": "Lucro real",
      "icon": "dollar"
    }
  ]
};

/** Miolo do <svg viewBox="0 0 24 24"> de cada ícone, igual ao Icon da SPA. */
export const NS_ICON_SVG = {
  "layout-dashboard": "<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"2\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"2\"/><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"2\"/><path d=\"M17 13.5v7M13.5 17h7\"/>",
  "ns-funil": "<path d=\"M4 5h16l-6.2 7v6.2L10.2 20v-8z\"/>",
  "monitor-play": "<path d=\"M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z\"/><path d=\"M12 17v4\"/><path d=\"M8 21h8\"/><path d=\"M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z\"/>",
  "percent": "<path d=\"m19 5-14 14\"/><path d=\"M6.5 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z\"/><path d=\"M17.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z\"/>",
  "ns-ranking": "<path d=\"M9 20.5V10h6v10.5M3.5 20.5v-6H9M15 20.5v-8h5.5v8M3 20.5h18\"/><path d=\"M12 3.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z\" fill=\"currentColor\" stroke=\"none\"/>",
  "trending-up": "<path d=\"M3.5 20.5 9 12l4 4 7.5-10\"/><path d=\"M20.5 6v4.5M20.5 6H16\"/>",
  "message-square": "<path d=\"M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-5 4z\"/><path d=\"M8 9.5h8M8 12.8h5\"/>",
  "ns-recuperacao": "<path d=\"M4 12a8 8 0 1 0 2.3-5.6M4 3.5V7h3.5\"/><path d=\"M12 8.5V12l2.5 1.5\"/>",
  "target": "<path d=\"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z\"/><path d=\"M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z\"/><path d=\"M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z\"/>",
  "user": "<path d=\"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\"/><path d=\"M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8\"/>",
  "package": "<path d=\"M12 3.5 20 8v8l-8 4.5L4 16V8z\"/><path d=\"M4.5 8.2 12 12.5l7.5-4.3M12 12.5v8\"/>",
  "receipt": "<path d=\"M4 8h13M14 4.5 17.5 8 14 11.5\"/><path d=\"M20 16H7M10 12.5 6.5 16l3.5 3.5\"/>",
  "ns-networks": "<circle cx=\"5.5\" cy=\"12\" r=\"2.5\"/><circle cx=\"18.5\" cy=\"5.5\" r=\"2.5\"/><circle cx=\"18.5\" cy=\"18.5\" r=\"2.5\"/><path d=\"M7.8 10.8l8.4-4.2M7.8 13.2l8.4 4.2\"/>",
  "alert-triangle": "<path d=\"M12 4 2.8 19.5h18.4z\"/><path d=\"M12 10v4.2M12 16.8v.2\"/>",
  "ns-insights": "<path d=\"M12 3.5l1.8 4.6 4.7 1.9-4.7 1.9L12 16.5l-1.8-4.6-4.7-1.9 4.7-1.9z\"/><path d=\"M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z\"/>",
  "user-plus": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"/><path d=\"M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8\"/><path d=\"M20 8v6\"/><path d=\"M23 11h-6\"/>",
  "dollar": "<path d=\"M12 1v22\"/><path d=\"M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6\"/>",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\"/>",
  "log-out": "<path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"/><path d=\"m16 17 5-5-5-5\"/><path d=\"M21 12H9\"/>",
  "send": "<path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\"/><path d=\"m21.854 2.147-10.94 10.939\"/>",
  "square": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/>",
  "paperclip": "<path d=\"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551\"/>",
  "at-sign": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8\"/>",
  "slash": "<path d=\"M22 2 2 22\"/>",
  "loader": "<path d=\"M12 2v4\"/><path d=\"m16.2 7.8 2.9-2.9\"/><path d=\"M18 12h4\"/><path d=\"m16.2 16.2 2.9 2.9\"/><path d=\"M12 18v4\"/><path d=\"m4.9 19.1 2.9-2.9\"/><path d=\"M2 12h4\"/><path d=\"m4.9 4.9 2.9 2.9\"/>",
  "wrench": "<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\"/>",
  "copy": "<path d=\"M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z\"/><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"/>",
  "thumbs-up": "<path d=\"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z\"/><path d=\"M7 10v12\"/>",
  "thumbs-down": "<path d=\"M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z\"/><path d=\"M17 14V2\"/>",
  "edit": "<path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z\"/>",
  "trash": "<path d=\"M3 6h18\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/><path d=\"M10 11v6\"/><path d=\"M14 11v6\"/>",
  "save": "<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\"/><path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\"/><path d=\"M7 3v4a1 1 0 0 0 1 1h7\"/>",
  "file-text": "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\"/><path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/><path d=\"M10 9H8\"/><path d=\"M16 13H8\"/><path d=\"M16 17H8\"/>",
  "book-open": "<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>",
  "search": "<circle cx=\"11\" cy=\"11\" r=\"6.5\"/><path d=\"m20 20-4.4-4.4\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "more-horizontal": "<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/><circle cx=\"5\" cy=\"12\" r=\"1\"/>",
  "pin": "<path d=\"M12 17v5\"/><path d=\"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z\"/>",
  "pin-off": "<path d=\"M12 17v5\"/><path d=\"M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89\"/><path d=\"m2 2 20 20\"/><path d=\"M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11\"/>",
  "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>",
  "folder-plus": "<path d=\"M12 10v6\"/><path d=\"M9 13h6\"/><path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>",
  "folder-input": "<path d=\"M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1\"/><path d=\"M2 13h10\"/><path d=\"m9 16 3-3-3-3\"/>",
  "panel-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M9 3v18\"/>",
  "panel-left-close": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M9 3v18\"/><path d=\"m16 15-3-3 3-3\"/>",
  "chevron-down": "<path d=\"m6 9 6 6 6-6\"/>",
  "chevron-left": "<path d=\"m15 18-6-6 6-6\"/>",
  "check": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m8.3 12.3 2.5 2.5 5-5.3\"/>",
  "circle": "<circle cx=\"12\" cy=\"12\" r=\"10\"/>",
  "x": "<path d=\"m6 6 12 12M18 6 6 18\"/>",
  "calendar": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"2.5\"/><path d=\"M3.5 9.5h17M8 3v4M16 3v4\"/>",
  "plug": "<path d=\"M12 22v-5\"/><path d=\"M9 7V2\"/><path d=\"M15 7V2\"/><path d=\"M6 13V8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4Z\"/>",
  "layers": "<path d=\"m12 2 9 5-9 5-9-5 9-5Z\"/><path d=\"m3 12 9 5 9-5\"/><path d=\"m3 17 9 5 9-5\"/>",
  "globe": "<path d=\"M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z\"/><path d=\"M2 12h20\"/><path d=\"M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z\"/>",
  "users": "<circle cx=\"9\" cy=\"8.5\" r=\"3.5\"/><path d=\"M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5\"/><circle cx=\"17\" cy=\"9.5\" r=\"2.6\"/><path d=\"M16.5 14.6c2.4.2 4 1.9 4 4.4\"/>",
  "filter": "<path d=\"M4.5 6.5h15M7.5 12h9M10.5 17.5h3\"/>",
  "refresh": "<path d=\"M23 4v6h-6\"/><path d=\"M1 20v-6h6\"/><path d=\"M3.5 9a9 9 0 0 1 15-3.4L23 10\"/><path d=\"M20.5 15a9 9 0 0 1-15 3.4L1 14\"/>",
  "download": "<path d=\"M12 15V4M8 7.5 12 3.5l4 4\"/><path d=\"M4.5 14v4A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-4\"/>",
  "link": "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"/><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"/>",
  "sun": "<circle cx=\"12\" cy=\"12\" r=\"4.5\"/><path d=\"M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9 6.7 6.7M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8\"/>",
  "moon": "<path d=\"M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z\"/>",
  "external-link": "<path d=\"M15 3h6v6\"/><path d=\"M10 14 21 3\"/><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"/>",
  "trending-down": "<path d=\"M23 18l-9.5-9.5-5 5L1 6\"/><path d=\"M17 18h6v-6\"/>",
  "info": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 11v5M12 8v.2\"/>",
  "arrow-up": "<path d=\"m5 12 7-7 7 7\"/><path d=\"M12 19V5\"/>",
  "arrow-down": "<path d=\"M12 5v14\"/><path d=\"m19 12-7 7-7-7\"/>",
  "arrow-up-right": "<path d=\"M7 17 17 7\"/><path d=\"M7 7h10v10\"/>",
  "arrow-down-right": "<path d=\"M7 7l10 10\"/><path d=\"M17 7v10H7\"/>",
  "minus": "<path d=\"M5 12h14\"/>"
} as const;

/** Nome de ícone válido no chat — fora da lista, não compila. */
export type NsIconName = keyof typeof NS_ICON_SVG;
