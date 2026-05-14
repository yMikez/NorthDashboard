// Nav esquerdo igual ao da SPA legacy (.side em dashboard.css).
// Renderizado dentro do /chat pra dar sensação de continuidade — clicar
// em qualquer item leva pra rota SPA (full-page nav via <a href>).
//
// Itens em sync com public/src/shell.jsx#Sidebar. Apenas o item 'chat'
// é "interno" ao Next.js native; resto vai pro SPA legacy.

'use client';

import * as React from 'react';
import {
  LayoutDashboard,
  BarChart3,
  Zap,
  TrendingDown,
  Trophy,
  Users,
  Layers,
  Package,
  Receipt,
  Plug,
  Wallet,
  AlertTriangle,
  Sparkles,
  UserPlus,
  LogOut,
} from 'lucide-react';
import type { ChatUser } from '@/types/chat';

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Análise',
    items: [
      { id: 'overview', label: 'Visão geral', href: '/overview', icon: LayoutDashboard },
      { id: 'funnel', label: 'Funil', href: '/funnel', icon: BarChart3 },
      { id: 'insights', label: 'Insights', href: '/insights', icon: Zap },
      { id: 'custos', label: 'Custos', href: '/custos', icon: TrendingDown },
    ],
  },
  {
    label: 'Afiliados',
    items: [
      { id: 'leaderboard', label: 'Ranking', href: '/leaderboard', icon: Trophy },
      { id: 'all-affiliates', label: 'Todos os afiliados', href: '/all-affiliates', icon: Users },
      { id: 'networks', label: 'Networks', href: '/networks', icon: Layers },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { id: 'products', label: 'Produtos', href: '/products', icon: Package },
      { id: 'transactions', label: 'Transações', href: '/transactions', icon: Receipt },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { id: 'platforms', label: 'Plataformas', href: '/platforms', icon: Plug },
      { id: 'costs', label: 'Fulfillment', href: '/costs', icon: Wallet },
      { id: 'health', label: 'Saúde do dado', href: '/health', icon: AlertTriangle },
    ],
  },
  {
    label: 'Admin',
    items: [
      { id: 'chat', label: 'Análise (IA)', href: '/chat', icon: Sparkles },
      { id: 'users', label: 'Usuários', href: '/users', icon: UserPlus },
    ],
  },
];

export function DashboardNav({ user, activeId = 'chat' }: { user: ChatUser; activeId?: string }) {
  const isAdmin = user.role === 'ADMIN';
  const groups = isAdmin ? GROUPS : GROUPS.filter((g) => g.label !== 'Admin');

  return (
    <aside className="side">
      <div className="side-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark-dark.svg" alt="" className="logo-mark logo-dark" style={{ width: 32, height: 32 }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark-light.svg" alt="" className="logo-mark logo-light" style={{ width: 32, height: 32 }} />
        <div className="wm" style={{ width: 71, fontSize: 24 }}>
          north<em>scale</em>
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.label}>
          <div className="side-group-label">{g.label}</div>
          <nav className="side-nav">
            {g.items.map((it) => {
              const Icon = it.icon;
              const active = it.id === activeId;
              return (
                <a key={it.id} href={it.href} className={`side-item ${active ? 'is-active' : ''}`}>
                  <Icon size={15} />
                  <span>{it.label}</span>
                </a>
              );
            })}
          </nav>
        </div>
      ))}

      <div className="side-foot">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 6px',
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            color: 'var(--fg5)',
            letterSpacing: '0.1em',
          }}
        >
          <span>v2.4.1 · prod</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--success)' }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--success)',
                boxShadow: '0 0 6px var(--success)',
              }}
            />
            LIVE
          </span>
        </div>
        <UserChip user={user} />
      </div>
    </aside>
  );
}

function UserChip({ user }: { user: ChatUser }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const display = user.name || user.email;
  const initials =
    (user.name || user.email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';

  async function logout() {
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch {
      /* noop */
    }
    window.location.href = '/login';
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="user-chip"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          background: open ? 'rgba(91,200,255,0.06)' : 'transparent',
          border: 0,
          font: 'inherit',
        }}
      >
        <div className="av">{initials}</div>
        <div className="who">
          <span className="nm">{display}</span>
          <span className="rl">{user.role === 'ADMIN' ? 'ADMIN · acesso total' : 'MEMBER'}</span>
        </div>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            zIndex: 30,
            boxShadow: '0 -10px 40px -10px rgba(91,200,255,0.25)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <button
            onClick={() => void logout()}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              borderRadius: 4,
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              color: 'var(--fg1)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <LogOut size={12} /> Sair
          </button>
        </div>
      )}
    </div>
  );
}
