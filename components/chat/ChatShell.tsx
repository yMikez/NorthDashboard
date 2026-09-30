// Container principal do redesign do chat.
// Layout: DashboardNav (SPA-style) + Sidebar conversas + Main chat + Drawer.
// Estado de conversa, streaming, filtros, tema e atalhos vivem aqui.

'use client';

import * as React from 'react';
import { DashboardNav } from './DashboardNav';
import { Sidebar } from './Sidebar';
import { TopBar, type SyncStatus, type ThemeMode } from './TopBar';
import { MessageList, EmptyState } from './MessageList';
import { ChatInput } from './ChatInput';
import { DetailDrawer } from './DetailDrawer';
import { KnowledgeSheet } from './KnowledgeSheet';
import {
  createFolder,
  deleteConversation,
  deleteFolder,
  getConversation,
  listConversations,
  listFolders,
  moveConversation,
  renameConversation,
  renameFolder,
  sendMessage,
} from '@/lib/chat/client';
import type {
  Block,
  ChatFolder,
  ChatUser,
  Conversation,
  EntityRef,
  FilterState,
  Message,
} from '@/types/chat';
import { brtRangeForPreset, spaCustomRange } from '@/lib/shared/datePresets';

/** Filtros padrão = os da SPA sem querystring: 30 dias BRT, sem recorte. */
export function defaultFilters(): FilterState {
  const r = brtRangeForPreset('30d');
  return {
    period: { preset: r.preset, start: r.start, end: r.end },
    platforms: [],
    families: [],
    countries: [],
    stages: [],
    affiliates: [],
  };
}

/** Querystring no formato da SPA (public/src/app.jsx) — vai e volta entre as duas. */
export function filtersToQuery(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.period.preset !== '30d') p.set('range', f.period.preset);
  if (f.period.preset === 'custom') {
    p.set('from', f.period.start);
    p.set('to', f.period.end);
  }
  if (f.platforms.length) p.set('plat', f.platforms.join(','));
  if (f.families.length) p.set('fam', f.families.join(','));
  if (f.countries.length) p.set('co', f.countries.join(','));
  if (f.stages.length) p.set('st', f.stages.join(','));
  if (f.affiliates.length) p.set('aff', f.affiliates.join(','));
  return p;
}

export function ChatShell({
  user,
  initialFilters,
  initialConversationId = null,
  initialNavCollapsed = false,
}: {
  user: ChatUser;
  /** Filtros que vieram da SPA pela URL (page.tsx). */
  initialFilters?: FilterState;
  /** ?c=<id> — reabre a conversa (F5, link copiado, "abrir em página inteira"). */
  initialConversationId?: string | null;
  /** Nav esquerda recolhida (cookie 'ns-side-collapsed' lido no servidor). */
  initialNavCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [folders, setFolders] = React.useState<ChatFolder[]>([]);
  // Pasta "ativa" — conversa NOVA nasce nela (folderId no 1º sendMessage).
  const [activeFolderId, setActiveFolderId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialConversationId);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [streamPartial, setStreamPartial] = React.useState<{
    content: string;
    tools: { name: string; id: string }[];
  } | null>(null);
  const [filters, setFilters] = React.useState<FilterState>(() => initialFilters ?? defaultFilters());
  const [syncStatus, setSyncStatus] = React.useState<SyncStatus>('live');
  // Tema: quem manda é o data-theme que o bootstrap de app/layout.tsx já pôs
  // no <html> (mesma chave 'ns-theme' e mesmo default claro da SPA). O
  // estado só espelha pra desenhar o botão; lido antes da pintura. Grava no
  // localStorage SÓ quando o usuário clica — gravar ao montar (como antes)
  // fixava 'dark' no navegador de quem nunca tinha escolhido e o dash
  // inteiro ficava escuro depois de abrir o chat.
  const [theme, setTheme] = React.useState<ThemeMode>('light');
  React.useLayoutEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  }, []);
  function toggleTheme() {
    const next: ThemeMode = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('ns-theme', next);
    } catch {
      /* noop */
    }
    setTheme(next);
  }
  const [drawerEntity, setDrawerEntity] = React.useState<EntityRef | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = React.useState(false);
  // Drawer da nav no mobile (≤820px) — aberto pelo hambúrguer do TopBar.
  const [navOpen, setNavOpen] = React.useState(false);
  // Lista de conversas como drawer no mobile (≤820px).
  const [convOpen, setConvOpen] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  // ---- Initial load ----
  React.useEffect(() => {
    void refreshConversations();
  }, []);

  async function refreshConversations() {
    // Conversas + pastas carregam juntas — contagens e seções dependem das duas.
    try {
      const [list, folderList] = await Promise.all([listConversations(), listFolders()]);
      setConversations(list);
      setFolders(folderList);
      // "Atualizar" é o retry do "Falha ao sincronizar": sucesso limpa o erro
      // (sem mexer no 'syncing' de uma resposta em andamento).
      setSyncStatus((s) => (s === 'error' ? 'live' : s));
    } catch (err) {
      console.error('refreshConversations', err);
      setSyncStatus('error');
    }
  }

  // ---- URL: filtros (formato da SPA) + conversa aberta (?c=) ----
  // replaceState: trocar filtro/conversa não suja o histórico do Voltar.
  // Filtros da SPA que o chat não usa (funil 'of', comparar 'cmp') passam
  // direto — voltar pra SPA pela nav não pode perdê-los.
  const [passthrough, setPassthrough] = React.useState<[string, string][]>([]);
  React.useLayoutEffect(() => {
    const q = new URLSearchParams(location.search);
    setPassthrough(['of', 'cmp'].flatMap((k) => (q.get(k) ? [[k, q.get(k) as string] as [string, string]] : [])));
  }, []);
  const filterQuery = (() => {
    const p = filtersToQuery(filters);
    for (const [k, v] of passthrough) p.set(k, v);
    return p.toString();
  })();
  React.useEffect(() => {
    const p = new URLSearchParams(filterQuery);
    if (selectedId) p.set('c', selectedId);
    const qs = p.toString();
    const next = '/chat' + (qs ? '?' + qs : '');
    if (location.pathname + location.search !== next) history.replaceState(null, '', next);
  }, [filterQuery, selectedId]);

  // ---- Conversation load ----
  React.useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { messages: msgs } = await getConversation(selectedId);
        if (!cancelled) setMessages(msgs);
      } catch (err) {
        if (cancelled) return;
        console.error('getConversation', err);
        // ?c= de conversa apagada (404) ou de outro usuário (403): abre uma
        // nova em vez de ficar numa tela vazia com o id preso na URL. Falha
        // transitória (rede, 5xx, 401) mantém a seleção e a URL.
        if (/ 40[34]$/.test(err instanceof Error ? err.message : '')) setSelectedId(null);
        else setSyncStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ---- Keyboard shortcuts ----
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        startNew();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const visible = () =>
          Array.from(document.querySelectorAll<HTMLInputElement>('[data-chat-search]')).find(
            (el) => el.offsetParent !== null,
          );
        const search = visible();
        if (search) search.focus();
        else {
          // Coluna recolhida no desktop: expande (abrir o drawer ali só piscava
          // — o Sidebar o fecha ≥821px). ≤820px a lista é drawer: abre.
          // Nos dois casos foca quando montar.
          if (window.matchMedia('(min-width: 821px)').matches) setCollapsed(false);
          else setConvOpen(true);
          window.setTimeout(() => visible()?.focus(), 120);
        }
      } else if (e.key === 'Escape' && drawerEntity) {
        setDrawerEntity(null);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawerEntity]);

  // ---- Actions ----
  function startNew() {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setSelectedId(null);
    setMessages([]);
    setInput('');
    setStreamPartial(null);
    setStreaming(false);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;

    const tempUser: Message = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUser]);
    setInput('');
    setStreaming(true);
    setStreamPartial({ content: '', tools: [] });
    setSyncStatus('syncing');

    const controller = new AbortController();
    abortRef.current = controller;

    let acc = '';
    const tools: { name: string; id: string }[] = [];
    let received: Block[] | null = null;
    let truncated = false;

    // Os filtros da barra valem pra resposta: viram o bloco "Estado da UI" do
    // system e o período default das tools (antes nunca eram enviados — a
    // barra era só enfeite).
    // Personalizado segue a convenção da SPA (dias UTC) pra o chat responder
    // sobre a MESMA janela da tela de onde o usuário veio.
    const range =
      filters.period.preset === 'custom'
        ? spaCustomRange(filters.period.start, filters.period.end)
        : brtRangeForPreset(filters.period.preset);
    const uiState = {
      route: 'chat',
      preset: range.preset,
      startDate: range.start,
      endDate: range.end,
      startAt: range.startAt,
      endAt: range.endAt,
      platforms: filters.platforms,
      families: filters.families,
      countries: filters.countries,
      stages: filters.stages,
      // affiliate_id do NorthScale Afiliados — o route.ts diz ao modelo em
      // quais tools ele vale.
      affiliates: filters.affiliates,
    };

    await sendMessage(
      {
        conversationId: selectedId,
        message: text,
        uiState,
        // Conversa NOVA nasce na pasta ativa; conversas existentes ignoram.
        folderId: selectedId ? undefined : activeFolderId,
      },
      {
        onConversation: ({ id }) => {
          setSelectedId(id);
        },
        onToken: ({ text: tk }) => {
          acc += tk;
          setStreamPartial({ content: acc, tools: [...tools] });
        },
        onToolUseStart: ({ name, id }) => {
          tools.push({ name, id });
          setStreamPartial({ content: acc, tools: [...tools] });
        },
        onToolUseResult: () => {
          /* no-op for now */
        },
        onBlocks: ({ blocks }) => {
          received = blocks;
        },
        onTruncated: () => {
          truncated = true;
        },
        onDone: ({ conversationId: cid }) => {
          const final: Message = {
            id: 'asst-' + Date.now(),
            role: 'assistant',
            content: acc,
            toolUses: tools.map((t) => ({ name: t.name })),
            blocks: received ?? undefined,
            createdAt: new Date().toISOString(),
            truncated: truncated || undefined,
          };
          setMessages((prev) => [...prev, final]);
          setStreamPartial(null);
          setStreaming(false);
          setSyncStatus('live');
          void refreshConversations();
          if (cid && cid !== selectedId) setSelectedId(cid);
        },
        onError: ({ message }) => {
          console.error('chat stream error', message);
          setStreaming(false);
          setStreamPartial(null);
          setSyncStatus('error');
          setMessages((prev) => [
            ...prev,
            {
              id: 'err-' + Date.now(),
              role: 'assistant',
              content: `⚠️ Erro: ${message}`,
              createdAt: new Date().toISOString(),
            },
          ]);
        },
        onRateLimited: ({ message }) => {
          setStreaming(false);
          setStreamPartial(null);
          setSyncStatus('error');
          setMessages((prev) => [
            ...prev,
            {
              id: 'rl-' + Date.now(),
              role: 'assistant',
              content: `🚫 ${message}`,
              createdAt: new Date().toISOString(),
            },
          ]);
        },
      },
      controller.signal,
    );
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    if (streamPartial && streamPartial.content) {
      setMessages((prev) => [
        ...prev,
        {
          id: 'asst-' + Date.now(),
          role: 'assistant',
          content: streamPartial.content + '\n\n_[geração interrompida]_',
          toolUses: streamPartial.tools.map((t) => ({ name: t.name })),
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    setStreamPartial(null);
    setSyncStatus('live');
  }

  async function handleDelete(id: string) {
    const conv = conversations.find((c) => c.id === id);
    const title = conv?.title || '(sem título)';
    if (!window.confirm(`Deletar a conversa "${title}"?\n\nAs mensagens não podem ser recuperadas.`)) {
      return;
    }
    try {
      await deleteConversation(id);
      if (selectedId === id) startNew();
      void refreshConversations();
    } catch (err) {
      console.error('deleteConversation', err);
      window.alert(
        `Não foi possível deletar a conversa.\n${err instanceof Error ? err.message : ''}`,
      );
    }
  }

  function handleRenameTitle(next: string) {
    if (!selectedId) return;
    handleRenameConv(selectedId, next);
  }

  function handleRenameConv(id: string, title: string) {
    // Otimista: aplica local e persiste via PATCH; reverte com refresh em erro.
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    renameConversation(id, title).catch((err) => {
      console.error('renameConversation', err);
      void refreshConversations();
    });
  }

  function handleTogglePin(id: string) {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
    );
  }

  // ---- Pastas ----

  async function handleCreateFolder(name: string) {
    try {
      const folder = await createFolder(name);
      setActiveFolderId(folder.id);
      await refreshConversations();
    } catch (err) {
      console.error('createFolder', err);
      window.alert(`Não foi possível criar a pasta.\n${err instanceof Error ? err.message : ''}`);
    }
  }

  async function handleRenameFolder(id: string, name: string) {
    // Otimista + persistência; refresh corrige em caso de erro.
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    try {
      await renameFolder(id, name);
    } catch (err) {
      console.error('renameFolder', err);
      void refreshConversations();
    }
  }

  async function handleDeleteFolder(id: string) {
    const folder = folders.find((f) => f.id === id);
    const name = folder?.name || '(sem nome)';
    if (
      !window.confirm(
        `Excluir a pasta "${name}"?\n\nAs conversas dela NÃO são apagadas — voltam pra raiz ("Conversas").`,
      )
    ) {
      return;
    }
    try {
      await deleteFolder(id);
      if (activeFolderId === id) setActiveFolderId(null);
      await refreshConversations();
    } catch (err) {
      console.error('deleteFolder', err);
      window.alert(`Não foi possível excluir a pasta.\n${err instanceof Error ? err.message : ''}`);
    }
  }

  async function handleMoveConversation(id: string, folderId: string | null) {
    // Otimista: reflete a seção nova na hora; refresh sincroniza contagens.
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, folderId } : c)));
    try {
      await moveConversation(id, folderId);
    } catch (err) {
      console.error('moveConversation', err);
      window.alert(`Não foi possível mover a conversa.\n${err instanceof Error ? err.message : ''}`);
    } finally {
      void refreshConversations();
    }
  }

  function handleExport(id: string) {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    getConversation(id)
      .then(({ messages: msgs }) => {
        const blob = new Blob(
          [JSON.stringify({ conversation: conv, messages: msgs }, null, 2)],
          { type: 'application/json' },
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversa-${id.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err) => console.error('export', err));
  }

  const currentConv = conversations.find((c) => c.id === selectedId) ?? null;

  // Knowledge é admin-only (/api/admin/knowledge*) — member agora acessa o
  // chat, mas o gatilho do KnowledgeSheet some pra não levar 401 no clique.
  const isAdmin = user.role === 'ADMIN';

  // h-full = preenche o wrapper fixed do layout (100vh ancorado).
  // Linha flex (não grid de colunas fixas): a nav mede a si mesma (232px,
  // 64px recolhida) e, no mobile (≤820px), vira drawer position:fixed — sai
  // do fluxo sem deixar coluna vazia, como na SPA.
  return (
    <div className="flex h-full overflow-hidden nx-chat-bg text-foreground relative">
      <DashboardNav
        user={user}
        activeId="chat"
        open={navOpen}
        onClose={() => setNavOpen(false)}
        linkQuery={filterQuery}
        initialCollapsed={initialNavCollapsed}
      />

      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        conversations={conversations}
        folders={folders}
        activeFolderId={activeFolderId}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setConvOpen(false);
        }}
        onSelectFolder={setActiveFolderId}
        onNew={() => {
          startNew();
          setConvOpen(false);
        }}
        mobileOpen={convOpen}
        onMobileOpenChange={setConvOpen}
        onRename={handleRenameConv}
        onTogglePin={handleTogglePin}
        onExport={handleExport}
        onDelete={(id) => void handleDelete(id)}
        onMove={(id, folderId) => void handleMoveConversation(id, folderId)}
        onCreateFolder={(name) => void handleCreateFolder(name)}
        onRenameFolder={(id, name) => void handleRenameFolder(id, name)}
        onDeleteFolder={(id) => void handleDeleteFolder(id)}
        showKnowledge={isAdmin}
        onOpenKnowledge={() => setKnowledgeOpen(true)}
      />

      {isAdmin && <KnowledgeSheet open={knowledgeOpen} onOpenChange={setKnowledgeOpen} />}

      <main className="relative z-[1] flex flex-col h-full overflow-hidden flex-1 min-w-0">
        <TopBar
          onMenu={() => setNavOpen(true)}
          title={currentConv?.title ?? null}
          onRenameTitle={handleRenameTitle}
          filters={filters}
          onChangeFilters={setFilters}
          syncStatus={syncStatus}
          onRefresh={() => void refreshConversations()}
          canExport={selectedId != null}
          onExport={() => selectedId && handleExport(selectedId)}
          onCopyLink={async () => {
            if (!selectedId) return false;
            // Link = esta conversa + os filtros atuais. Só o dono abre
            // (conversas são individuais).
            const p = new URLSearchParams(filterQuery);
            p.set('c', selectedId);
            try {
              await navigator.clipboard.writeText(window.location.origin + '/chat?' + p.toString());
              return true;
            } catch {
              return false;
            }
          }}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenConversations={() => setConvOpen(true)}
        />

        {messages.length === 0 && !streaming && !selectedId ? (
          <EmptyState onPickPrompt={(q) => setInput(q)} />
        ) : (
          <MessageList
            // Conversa aberta (?c=, clique na lista) ainda carregando: área
            // vazia em vez do hero de "nova conversa" piscando.
            emptyState={<div className="flex-1 min-h-0" aria-busy="true" />}
            messages={messages}
            streaming={streaming}
            streamingPartial={streamPartial}
            onRegenerate={() => {
              const lastUser = [...messages].reverse().find((m) => m.role === 'user');
              if (!lastUser) return;
              setInput(lastUser.content);
            }}
          />
        )}

        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={() => void handleSend()}
          onStop={handleStop}
          streaming={streaming}
        />
      </main>

      <DetailDrawer
        entity={drawerEntity}
        open={drawerEntity != null}
        onClose={() => setDrawerEntity(null)}
      />
    </div>
  );
}
