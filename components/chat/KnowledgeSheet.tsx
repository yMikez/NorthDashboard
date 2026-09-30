// Painel admin da IA — sheet lateral aberto pelo botão "Base de
// conhecimento" no sidebar do chat. Casca com abas; cada aba é um arquivo
// em components/chat/admin/:
//   Fixas               entradas que vão inteiras no prompt (com medidor do teto)
//   Documentos          base global pesquisável: upload, status, reindexar
//   Memórias sugeridas  fila de aprovação da memória automática
//   Testar busca        trechos e notas de cada ranqueador pra uma pergunta
//   Qualidade           telemetria dos turnos + triagem das respostas avaliadas
//   Avaliação           execuções do conjunto de casos-ouro (A/B de modelo/esforço)
//
// Só ADMIN chega aqui: o gatilho só aparece pra admin (ChatShell/Sidebar) e
// toda rota /api/admin/* confere o papel no servidor. Aba só monta na
// primeira visita (nada de 6 cargas ao abrir) e continua montada depois —
// rascunho e resultado de busca sobrevivem à troca de aba; fechar o sheet
// descarta tudo (o Radix desmonta o conteúdo).

'use client';

import * as React from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/ui-utils';
import { NsIcon, type NsIconName } from './NsIcon';
import { adminFetch } from './admin/adminApi';
import { fmtInt, type MemoryDTO } from './admin/adminCore';
import { DocumentsTab } from './admin/DocumentsTab';
import { EvalTab } from './admin/EvalTab';
import { MemoriesTab } from './admin/MemoriesTab';
import { PinnedTab } from './admin/PinnedTab';
import { QualityTab } from './admin/QualityTab';
import { SearchTestTab } from './admin/SearchTestTab';

type TabId = 'fixas' | 'documentos' | 'memorias' | 'busca' | 'qualidade' | 'avaliacao';

const TABS: ReadonlyArray<{ id: TabId; label: string; icon: NsIconName }> = [
  { id: 'fixas', label: 'Fixas', icon: 'pin' },
  { id: 'documentos', label: 'Documentos', icon: 'file-text' },
  { id: 'memorias', label: 'Memórias sugeridas', icon: 'ns-insights' },
  { id: 'busca', label: 'Testar busca', icon: 'search' },
  { id: 'qualidade', label: 'Qualidade', icon: 'trending-up' },
  { id: 'avaliacao', label: 'Avaliação', icon: 'target' },
];

// Conveniência por pessoa: reabre na última aba usada. Falha de storage
// (janela privada, bloqueio) só volta pra primeira aba.
const TAB_KEY = 'ns-kb-tab';

function readTab(): TabId {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === v) ? (v as TabId) : 'fixas';
  } catch {
    return 'fixas';
  }
}

function saveTab(id: TabId): void {
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    /* sem storage: a aba vale só nesta abertura */
  }
}

export function KnowledgeSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[min(960px,100vw)] sm:max-w-[960px]"
      >
        {/* O Radix desmonta o conteúdo ao fechar (depois da animação): cada
            abertura começa com estado novo. */}
        <AdminPanel />
      </SheetContent>
    </Sheet>
  );
}

function AdminPanel() {
  const [tab, setTab] = React.useState<TabId>(readTab);
  const [visited, setVisited] = React.useState<ReadonlySet<TabId>>(() => new Set([tab]));
  const [pending, setPending] = React.useState<number | null>(null);
  const tabRefs = React.useRef(new Map<TabId, HTMLButtonElement>());
  const baseId = React.useId();

  // Selo de memórias pendentes já na abertura (o admin vê que há fila sem
  // abrir a aba). Falha aqui não é erro de tela: a aba mostra o seu.
  React.useEffect(() => {
    const ctrl = new AbortController();
    adminFetch<{ memories: MemoryDTO[] }>('/api/admin/kb/memories?status=pending', { signal: ctrl.signal })
      .then((d) => setPending((prev) => prev ?? d.memories.length))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const select = React.useCallback((id: TabId, focus = false) => {
    setTab(id);
    setVisited((v) => (v.has(id) ? v : new Set([...v, id])));
    saveTab(id);
    if (focus) tabRefs.current.get(id)?.focus();
  }, []);

  // Teclado do tablist (WAI-ARIA): setas, Home e End movem e ativam.
  function onTabKeyDown(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next == null) return;
    e.preventDefault();
    select(TABS[next].id, true);
  }

  const onPendingCount = React.useCallback((n: number) => setPending(n), []);

  return (
    <>
      <SheetHeader className="px-4 pb-3 pr-12 pt-5 sm:px-6">
        <SheetTitle className="flex items-center gap-2">
          <NsIcon name="book-open" className="shrink-0 text-ring" /> Base de conhecimento e qualidade
        </SheetTitle>
        <SheetDescription className="leading-relaxed">
          O que a IA sabe (entradas fixas no prompt, documentos pesquisáveis, memórias aprovadas) e como ela está
          respondendo. Visível só para administradores.
        </SheetDescription>
      </SheetHeader>

      <div
        role="tablist"
        aria-label="Seções do painel da IA"
        onKeyDown={onTabKeyDown}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 sm:px-4"
      >
        {TABS.map((t) => {
          const selected = tab === t.id;
          const count = t.id === 'memorias' && pending != null && pending > 0 ? pending : null;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el);
                else tabRefs.current.delete(t.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              className={cn(
                'relative inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md px-3 text-sm font-medium',
                'text-muted-foreground transition-colors hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                // Selecionada: texto principal + filete de 2 px no acento.
                "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:content-['']",
                selected ? 'text-foreground after:bg-ring' : 'after:bg-transparent',
              )}
            >
              <NsIcon name={t.icon} className="shrink-0" />
              {t.label}
              {count != null && (
                <span className="rounded-[4px] bg-primary px-1.5 font-mono text-[11px] font-semibold leading-[18px] tabular-nums text-primary-foreground">
                  {fmtInt(count)}
                  <span className="sr-only"> pendentes</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {TABS.map((t) =>
        visited.has(t.id) ? (
          <div
            key={t.id}
            role="tabpanel"
            id={`${baseId}-panel-${t.id}`}
            aria-labelledby={`${baseId}-tab-${t.id}`}
            hidden={tab !== t.id}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
          >
            <TabContent id={t.id} active={tab === t.id} onPendingCount={onPendingCount} />
          </div>
        ) : null,
      )}
    </>
  );
}

function TabContent({
  id,
  active,
  onPendingCount,
}: {
  id: TabId;
  active: boolean;
  onPendingCount: (n: number) => void;
}) {
  switch (id) {
    case 'fixas':
      return <PinnedTab active={active} />;
    case 'documentos':
      return <DocumentsTab active={active} />;
    case 'memorias':
      return <MemoriesTab active={active} onPendingCount={onPendingCount} />;
    case 'busca':
      return <SearchTestTab />;
    case 'qualidade':
      return <QualityTab active={active} />;
    case 'avaliacao':
      return <EvalTab active={active} />;
  }
}
