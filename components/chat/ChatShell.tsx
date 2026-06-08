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
  deleteConversation,
  getConversation,
  listConversations,
  sendMessage,
} from '@/lib/chat/client';
import type {
  Block,
  ChatUser,
  Conversation,
  EntityRef,
  FilterState,
  Message,
} from '@/types/chat';

const INITIAL_FILTERS: FilterState = (() => {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  return {
    period: {
      preset: '30d',
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    },
    platforms: [],
    products: [],
    countries: [],
    families: [],
  };
})();

export function ChatShell({ user }: { user: ChatUser }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [streamPartial, setStreamPartial] = React.useState<{
    content: string;
    tools: { name: string; id: string }[];
  } | null>(null);
  const [filters, setFilters] = React.useState<FilterState>(INITIAL_FILTERS);
  const [syncStatus, setSyncStatus] = React.useState<SyncStatus>('live');
  const [theme, setTheme] = React.useState<ThemeMode>(() => {
    if (typeof document === 'undefined') return 'dark';
    const stored = (() => {
      try {
        return localStorage.getItem('ns-theme');
      } catch {
        return null;
      }
    })();
    const fromHtml = document.documentElement.getAttribute('data-theme');
    return (stored ?? fromHtml) === 'light' ? 'light' : 'dark';
  });
  const [model, setModel] = React.useState('claude-opus-4-5');
  const [drawerEntity, setDrawerEntity] = React.useState<EntityRef | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  // ---- Initial load ----
  React.useEffect(() => {
    void refreshConversations();
  }, []);

  async function refreshConversations() {
    try {
      const list = await listConversations();
      setConversations(list);
    } catch (err) {
      console.error('listConversations', err);
      setSyncStatus('error');
    }
  }

  // ---- Theme ----
  // Sync com a SPA legada: data-theme no <html> alimenta tanto o chat
  // (via globals.css) quanto a dashboard.css. localStorage 'ns-theme'
  // mantém a escolha entre rotas/sessões.
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('ns-theme', theme);
    } catch {
      /* noop */
    }
  }, [theme]);

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
        if (!cancelled) console.error('getConversation', err);
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
        const search = document.querySelector<HTMLInputElement>('[data-chat-search]');
        search?.focus();
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

    await sendMessage(
      { conversationId: selectedId, message: text },
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
        onDone: ({ conversationId: cid }) => {
          const final: Message = {
            id: 'asst-' + Date.now(),
            role: 'assistant',
            content: acc,
            toolUses: tools.map((t) => ({ name: t.name })),
            blocks: received ?? undefined,
            createdAt: new Date().toISOString(),
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
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, title: next } : c)),
    );
    // Server-side rename ainda não tem endpoint dedicado; Phase 1 mantém local-only.
  }

  function handleRenameConv(id: string, title: string) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }

  function handleTogglePin(id: string) {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
    );
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

  return (
    {/* h-full = preenche o wrapper fixed do layout (100vh ancorado).
        grid-rows-[100%] força a única row implícita a respeitar 100% da
        altura do grid container — evita que filhos com height: 100vh
        (como .side sticky) inflem a row. */}
    <div className="grid grid-cols-[232px_auto_1fr] grid-rows-[100%] h-full overflow-hidden nx-chat-bg text-foreground relative">
      <div className="nx-fx-blobs" aria-hidden />
      <DashboardNav user={user} activeId="chat" />

      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        conversations={conversations}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={startNew}
        onRename={handleRenameConv}
        onTogglePin={handleTogglePin}
        onExport={handleExport}
        onDelete={(id) => void handleDelete(id)}
        onOpenKnowledge={() => setKnowledgeOpen(true)}
      />

      <KnowledgeSheet open={knowledgeOpen} onOpenChange={setKnowledgeOpen} />

      <main className="relative z-[1] flex flex-col h-full overflow-hidden">
        <TopBar
          title={currentConv?.title ?? null}
          onRenameTitle={handleRenameTitle}
          filters={filters}
          onChangeFilters={setFilters}
          syncStatus={syncStatus}
          onRefresh={() => void refreshConversations()}
          onExport={() => selectedId && handleExport(selectedId)}
          onShare={() => {
            if (!selectedId) return;
            void navigator.clipboard.writeText(window.location.origin + '/chat?c=' + selectedId);
          }}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        />

        {messages.length === 0 && !streaming ? (
          <EmptyState onPickPrompt={(q) => setInput(q)} />
        ) : (
          <MessageList
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
          model={model}
          onChangeModel={setModel}
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
