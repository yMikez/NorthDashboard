// Nav esquerda do /chat — espelho da Sidebar da SPA (public/src/shell.jsx).
//
// O /chat é rota Next e não enxerga os globals da SPA; a lista de itens e o
// desenho dos ícones vêm de navConfig.generated.ts, GERADO da própria
// Sidebar (scripts/gen-chat-nav.mjs; o build-spa confere). Antes era uma
// cópia à mão e ficou para trás: sem Reembolsos/CRM/Captação/Lucro real,
// logo antigo, ícones de outro set e sem o trilho recolhido.
//
// Clicar em qualquer item leva pra rota da SPA (full-page nav via <a href>);
// só o 'chat' é desta rota. Mesmas classes .side* de dashboard.css, mesma
// chave 'ns-side-collapsed' do recolhido.

'use client';

import * as React from 'react';
import type { ChatUser } from '@/types/chat';
import { NAV_GROUPS, NAV_IA_GROUP, NAV_ADMIN_GROUP, type NavGroup } from './navConfig.generated';
import { NsIcon } from './NsIcon';

const COLLAPSED_KEY = 'ns-side-collapsed';

/** Mesmo valor do localStorage num cookie, pro servidor renderizar certo. */
function writeCollapsedCookie(v: boolean) {
  document.cookie = `${COLLAPSED_KEY}=${v ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
}

export function DashboardNav({
  user,
  activeId = 'chat',
  open = false,
  onClose,
  linkQuery = '',
  initialCollapsed = false,
}: {
  user: ChatUser;
  activeId?: string;
  /** Drawer do mobile (≤820px) aberto. */
  open?: boolean;
  onClose?: () => void;
  /** Filtros atuais no formato da SPA — os links levam junto (voltar pra SPA não zera o filtro). */
  linkQuery?: string;
  /** Recolhido lido do cookie no servidor (page.tsx) — o HTML já sai certo. */
  initialCollapsed?: boolean;
}) {
  // Mesma regra da SPA: admin vê tudo; membro só as abas liberadas; o chat
  // IA é de todo usuário logado (grupo injetado DEPOIS do filtro).
  const isAdmin = user.role === 'ADMIN';
  const allowed = new Set(user.allowedTabs ?? []);
  const groups: NavGroup[] = isAdmin
    ? [...NAV_GROUPS, NAV_IA_GROUP, NAV_ADMIN_GROUP]
    : [
        ...NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => allowed.has(it.id)) })).filter(
          (g) => g.items.length > 0,
        ),
        NAV_IA_GROUP,
      ];

  // Recolhido persistido (trilho de 64px). O servidor lê o cookie
  // 'ns-side-collapsed' (page.tsx), então o HTML já nasce no estado certo —
  // ler só o localStorage depois da hidratação pintava a nav aberta e a
  // animava fechando. O layout effect só reconcilia quem recolheu antes do
  // cookie existir (localStorage é a fonte que a SPA sempre gravou).
  const [collapsed, setCollapsed] = React.useState(initialCollapsed);
  React.useLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY) === '1';
      if (stored !== initialCollapsed) {
        setCollapsed(stored);
        writeCollapsedCookie(stored);
      }
    } catch {
      /* noop */
    }
  }, [initialCollapsed]);
  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* noop */
    }
    writeCollapsedCookie(next);
  }

  return (
    <>
      {/* Véu do drawer mobile — só existe no DOM enquanto aberto (≤820px). */}
      {open && <div className="side-backdrop" onClick={onClose} />}
      <aside className={'side ' + (collapsed ? 'is-collapsed ' : '') + (open ? 'is-open' : '')}>
        <button
          type="button"
          className="side-collapse"
          onClick={toggleCollapse}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-label="Recolher/expandir menu"
        >
          <NsIcon name="chevron-right" size={12} className="side-collapse-icon" />
        </button>

        {/* Logo completo (nome + símbolo) — arquivo fixo do Manual de Marca,
            mesmo da SPA. Trilho recolhido: ícone de app. */}
        <div className="side-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/brand/logo-azul-preto.svg" alt="NorthScale" className="ns-logotype for-light" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/brand/logo-azulclaro-branco.svg" alt="NorthScale" className="ns-logotype for-dark" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/brand/app-icon-quadrado.svg" alt="NorthScale" className="ns-appicon" />
        </div>

        {groups.map((g) => (
          <div key={g.label}>
            <div className="side-group-label">{g.label}</div>
            <nav className="side-nav">
              {g.items.map((it) => {
                const active = it.id === activeId;
                return (
                  <a
                    key={it.id}
                    href={'/' + it.id + (linkQuery ? '?' + linkQuery : '')}
                    className={`side-item ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? it.label : undefined}
                  >
                    <NsIcon name={it.icon} size={15} />
                    <span className="side-item-label">{it.label}</span>
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
            }}
          >
            <span>v2.4.1 · prod</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--success)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
              Ao vivo
            </span>
          </div>
          <UserChip user={user} />
        </div>
      </aside>
    </>
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
  const tabs = user.allowedTabs?.length ?? 0;

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
        type="button"
        className="user-chip"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          background: open ? 'var(--bg-hover)' : 'transparent',
          border: 0,
          font: 'inherit',
        }}
      >
        <div className="av">{initials}</div>
        <div className="who">
          <span className="nm">{display}</span>
          <span className="rl">
            {user.role === 'ADMIN' ? 'Admin · acesso total' : `Member · ${tabs} ${tabs === 1 ? 'aba' : 'abas'}`}
          </span>
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
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <LogoutButton onClick={() => void logout()} />
        </div>
      )}
    </div>
  );
}

function LogoutButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 4,
        background: hover ? 'var(--danger-bg)' : 'transparent',
        border: 0,
        cursor: 'pointer',
        fontFamily: 'var(--f-mono)',
        fontSize: 11,
        color: hover ? 'var(--danger)' : 'var(--fg1)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <NsIcon name="log-out" size={12} /> Sair
    </button>
  );
}
