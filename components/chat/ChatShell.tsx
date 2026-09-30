// Container principal do redesign do chat.
// Layout: DashboardNav (SPA-style) + Sidebar conversas + Main chat + Drawer.
// Estado de conversa, streaming, filtros, tema, anexos do composer e atalhos
// vivem aqui.

'use client';

import * as React from 'react';
import { DashboardNav } from './DashboardNav';
import { Sidebar } from './Sidebar';
import { TopBar, type SyncStatus, type ThemeMode } from './TopBar';
import { MessageList, EmptyState, type StreamingPartial } from './MessageList';
import { ChatInput } from './ChatInput';
import { DetailDrawer } from './DetailDrawer';
import { KnowledgeSheet } from './KnowledgeSheet';
import { NsIcon } from './NsIcon';
import type { LiveTool } from './AssistantMessage';
import type { PendingAttachment } from './AttachmentChips';
import {
  AttachmentUploadError,
  clearFeedback,
  createFolder,
  deleteAttachment,
  deleteConversation,
  deleteFolder,
  getAttachment,
  getConversation,
  listConversations,
  listFolders,
  moveConversation,
  renameConversation,
  renameFolder,
  sendFeedback,
  sendMessage,
  uploadAttachment,
} from '@/lib/chat/client';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_MESSAGE,
  checkSize,
  guessAttachmentKind,
  rejectionNotice,
  selectAttachments,
} from '@/lib/chat/attachmentRules';
import { upsertCitation } from '@/lib/chat/citeMarkers';
import { prepareImageForUpload } from '@/lib/chat/imageResize';
import type {
  AttachmentDTO,
  Block,
  ChatFolder,
  ChatUser,
  Citation,
  Conversation,
  EntityRef,
  FeedbackInput,
  FilterState,
  Message,
  MessageFeedback,
} from '@/types/chat';
import { brtRangeForPreset, spaCustomRange } from '@/lib/shared/datePresets';

// ---------------- Anexos do composer ----------------

const UPLOAD_CONCURRENCY = 2;
const PROCESSING_POLL_MS = 1500;
// O servidor marca FAILED o que passa de 15 min processando; o composer
// desiste junto em vez de girar pra sempre.
const PROCESSING_TIMEOUT_MS = 15 * 60_000;

function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

/**
 * Ciclo de vida dos anexos do composer: fila (2 uploads por vez) →
 * redimensiona imagem no browser → upload XHR com progresso → polling
 * enquanto o servidor processa → pronto | erro (retry). Remover cancela o
 * upload e apaga o rascunho no servidor.
 *
 * @param conversationId vai no upload quando a conversa já existe
 * @param sentInConversation anexos já enviados nesta conversa (limite de 20)
 */
function useComposerAttachments(conversationId: string | null, sentInConversation: number) {
  const [items, setItems] = React.useState<PendingAttachment[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  // Espelho síncrono: add/take/remove leem o estado sem esperar o re-render
  // (soltar e colar em sequência não pode furar o limite de 5).
  const itemsRef = React.useRef<PendingAttachment[]>(items);
  itemsRef.current = items;
  const convRef = React.useRef(conversationId);
  convRef.current = conversationId;
  const sentRef = React.useRef(sentInConversation);
  sentRef.current = sentInConversation;
  const controllers = React.useRef(new Map<string, AbortController>());
  const seq = React.useRef(0);

  const patch = React.useCallback((localId: string, p: Partial<PendingAttachment>) => {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...p } : it)));
  }, []);

  const applyServer = React.useCallback(
    (localId: string, att: AttachmentDTO) => {
      switch (att.status) {
        case 'READY':
          patch(localId, { state: 'ready', attachment: att, error: undefined });
          break;
        case 'FAILED':
          patch(localId, { state: 'error', attachment: att, error: att.error || 'Não foi possível processar o arquivo.' });
          break;
        case 'EXPIRED':
          patch(localId, { state: 'error', attachment: att, error: 'O anexo expirou — envie de novo.' });
          break;
        default:
          setItems((prev) =>
            prev.map((it) =>
              it.localId === localId
                ? { ...it, state: 'processing', attachment: att, processingSince: it.processingSince ?? Date.now() }
                : it,
            ),
          );
      }
    },
    [patch],
  );

  const start = React.useCallback(
    async (item: PendingAttachment) => {
      const ctrl = new AbortController();
      controllers.current.set(item.localId, ctrl);
      patch(item.localId, { state: 'uploading', progress: 0, error: undefined, attachment: undefined, processingSince: undefined });
      try {
        // Decisão do dono: o servidor não decodifica imagem — quem reduz é o browser.
        const file = item.kind === 'image' ? await prepareImageForUpload(item.file) : item.file;
        if (ctrl.signal.aborted) return;
        const tooBig = checkSize(file.size);
        if (tooBig) {
          patch(item.localId, { state: 'error', error: tooBig });
          return;
        }
        const att = await uploadAttachment(file, {
          conversationId: convRef.current,
          signal: ctrl.signal,
          onProgress: (f) => patch(item.localId, { progress: f }),
        });
        // Removido no instante em que o upload terminou: o rascunho não fica órfão.
        if (ctrl.signal.aborted) {
          void deleteAttachment(att.id).catch(() => undefined);
          return;
        }
        applyServer(item.localId, att);
      } catch (err) {
        if (isAbortError(err)) return;
        patch(item.localId, {
          state: 'error',
          error: err instanceof AttachmentUploadError ? err.message : 'Falha no envio — tente de novo.',
        });
      } finally {
        controllers.current.delete(item.localId);
      }
    },
    [patch, applyServer],
  );

  // Fila: no máximo UPLOAD_CONCURRENCY enviando ao mesmo tempo.
  React.useEffect(() => {
    const free = UPLOAD_CONCURRENCY - items.filter((it) => it.state === 'uploading').length;
    if (free <= 0) return;
    for (const it of items.filter((x) => x.state === 'queued').slice(0, free)) void start(it);
  }, [items, start]);

  // Polling de quem o servidor ainda está processando (arquivo grande).
  const processingKey = items
    .filter((it) => it.state === 'processing' && it.attachment)
    .map((it) => it.attachment!.id)
    .join(',');
  React.useEffect(() => {
    if (!processingKey) return;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        for (const it of itemsRef.current) {
          if (it.state !== 'processing' || !it.attachment) continue;
          if (it.processingSince && Date.now() - it.processingSince > PROCESSING_TIMEOUT_MS) {
            patch(it.localId, { state: 'error', error: 'O processamento demorou demais — tente de novo.' });
            continue;
          }
          try {
            applyServer(it.localId, await getAttachment(it.attachment.id));
          } catch (err) {
            if (err instanceof AttachmentUploadError && err.status === 404) {
              patch(it.localId, { state: 'error', attachment: undefined, error: 'O anexo não existe mais — envie de novo.' });
            }
            // Rede/5xx: transitório — tenta no próximo ciclo.
          }
        }
      } finally {
        inFlight = false;
      }
    }, PROCESSING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [processingKey, patch, applyServer]);

  // Saiu da página: cancela o que está subindo (rascunho já salvo o servidor limpa em 24h).
  React.useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const c of map.values()) c.abort();
    };
  }, []);

  const add = React.useCallback((files: File[]) => {
    const { accepted, rejected } = selectAttachments(files, itemsRef.current.length, sentRef.current);
    setNotice(rejectionNotice(rejected));
    if (!accepted.length) return;
    const fresh: PendingAttachment[] = accepted.map((file) => ({
      localId: `att-${Date.now()}-${++seq.current}`,
      file,
      name: file.name,
      kind: guessAttachmentKind(file.name, file.type) ?? 'text',
      state: 'queued',
      progress: 0,
    }));
    itemsRef.current = [...itemsRef.current, ...fresh];
    setItems((prev) => [...prev, ...fresh]);
  }, []);

  const retry = React.useCallback(
    (localId: string) => {
      const it = itemsRef.current.find((x) => x.localId === localId);
      if (!it) return;
      // Rascunho que falhou no servidor sai antes do reenvio (não ocupa a cota).
      if (it.attachment) void deleteAttachment(it.attachment.id).catch(() => undefined);
      patch(localId, { state: 'queued', progress: 0, error: undefined, attachment: undefined, processingSince: undefined });
    },
    [patch],
  );

  const remove = React.useCallback((localId: string) => {
    const it = itemsRef.current.find((x) => x.localId === localId);
    controllers.current.get(localId)?.abort();
    if (it?.attachment) void deleteAttachment(it.attachment.id).catch(() => undefined);
    itemsRef.current = itemsRef.current.filter((x) => x.localId !== localId);
    setItems((prev) => prev.filter((x) => x.localId !== localId));
  }, []);

  /** Tira os prontos do composer (vão na mensagem); os com erro ficam pra retry. */
  const takeReady = React.useCallback((): PendingAttachment[] => {
    const ready = itemsRef.current.filter((it) => it.state === 'ready' && it.attachment);
    if (ready.length) {
      const ids = new Set(ready.map((r) => r.localId));
      itemsRef.current = itemsRef.current.filter((it) => !ids.has(it.localId));
      setItems((prev) => prev.filter((it) => !ids.has(it.localId)));
    }
    setNotice(null);
    return ready;
  }, []);

  /** Envio recusado antes de começar: os rascunhos seguem válidos — voltam pro composer. */
  const restore = React.useCallback((list: PendingAttachment[]) => {
    if (!list.length) return;
    itemsRef.current = [...list, ...itemsRef.current];
    setItems((prev) => [...list, ...prev]);
  }, []);

  /** Nova conversa / outra conversa: rascunho não migra (o servidor recusaria). */
  const discardAll = React.useCallback(() => {
    for (const c of controllers.current.values()) c.abort();
    controllers.current.clear();
    for (const it of itemsRef.current) {
      if (it.attachment) void deleteAttachment(it.attachment.id).catch(() => undefined);
    }
    itemsRef.current = [];
    setItems([]);
    setNotice(null);
  }, []);

  const dismissNotice = React.useCallback(() => setNotice(null), []);

  return { items, notice, dismissNotice, add, retry, remove, takeReady, restore, discardAll };
}

/** Texto da pergunta enviada só com anexo — o mesmo default do POST /api/chat. */
function attachmentOnlyText(n: number): string {
  return n === 1 ? 'Analise o anexo.' : 'Analise os anexos.';
}

/** Drag de arquivo do sistema (não de texto/link selecionado na página). */
function isFileDrag(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
}

/** Estado de um turno em curso — compartilhado entre o stream e Parar/Nova conversa. */
interface TurnState {
  /** Mensagem final já registrada (done, parada manual ou descarte). */
  finalized: boolean;
  /** O servidor aceitou o turno (evento `conversation`). */
  started: boolean;
  error: string | null;
  rateLimited: string | null;
}

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
  const [streamPartial, setStreamPartial] = React.useState<StreamingPartial | null>(null);
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
  const turnRef = React.useRef<TurnState | null>(null);

  // Anexos já enviados nesta conversa contam no limite de 20 por conversa.
  const sentAttachments = messages.reduce((n, m) => n + (m.attachments?.length ?? 0), 0);
  const uploads = useComposerAttachments(selectedId, sentAttachments);

  // Arrastar arquivo sobre a área do chat: overlay + drop anexa. O contador
  // de enter/leave existe porque cada filho do <main> dispara o par.
  const dragDepth = React.useRef(0);
  const [dragging, setDragging] = React.useState(false);
  React.useEffect(() => {
    // Arquivo solto FORA da área (nav, lista de conversas) faria o browser
    // abrir o arquivo e sair do chat — bloqueia o default na janela toda.
    function block(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.type === 'drop') {
        dragDepth.current = 0;
        setDragging(false);
      }
    }
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);
  const dropZone = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) uploads.add(files);
    },
  };

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
    if (turnRef.current) turnRef.current.finalized = true;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    uploads.discardAll();
    setSelectedId(null);
    setMessages([]);
    setInput('');
    setStreamPartial(null);
    setStreaming(false);
  }

  async function handleSend() {
    const text = input.trim();
    if (streaming) return;
    const pendingUpload = uploads.items.some(
      (a) => a.state === 'queued' || a.state === 'uploading' || a.state === 'processing',
    );
    const readyCount = uploads.items.filter((a) => a.state === 'ready').length;
    // Upload em andamento bloqueia: mandar sem ele perderia o arquivo em silêncio.
    if (pendingUpload || (!text && readyCount === 0)) return;

    const sent = uploads.takeReady();
    const sentDocs = sent.map((a) => a.attachment!);

    const tempUser: Message = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: text || attachmentOnlyText(sentDocs.length),
      createdAt: new Date().toISOString(),
      attachments: sentDocs.length ? sentDocs : undefined,
    };
    setMessages((prev) => [...prev, tempUser]);
    setInput('');
    setStreaming(true);
    setStreamPartial({ content: '', tools: [], citations: [] });
    setSyncStatus('syncing');

    const controller = new AbortController();
    abortRef.current = controller;
    const turn: TurnState = { finalized: false, started: false, error: null, rateLimited: null };
    turnRef.current = turn;

    let acc = '';
    const tools: LiveTool[] = [];
    // Mesma referência entre tokens (só muda quando chega fonte nova): o
    // MarkdownBlock não recria os chips de citação a cada token.
    let citations: Citation[] = [];
    let received: Block[] | null = null;
    let truncated = false;
    const publish = () => setStreamPartial({ content: acc, tools: [...tools], citations });

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
        attachmentIds: sentDocs.map((a) => a.id),
      },
      {
        onConversation: ({ id }) => {
          turn.started = true;
          setSelectedId(id);
        },
        onToken: ({ text: tk }) => {
          acc += tk;
          publish();
        },
        onToolUseStart: ({ name, id }) => {
          tools.push({ name, id, status: 'running' });
          publish();
        },
        onToolUseResult: ({ id, ok }) => {
          const t = tools.find((x) => x.id === id);
          if (!t) return;
          t.status = ok === false ? 'error' : 'ok';
          publish();
        },
        onCitation: (c) => {
          citations = upsertCitation(citations, c);
          publish();
        },
        onBlocks: ({ blocks }) => {
          received = blocks;
        },
        onTruncated: () => {
          truncated = true;
        },
        onDone: ({ conversationId: cid, messageId }) => {
          if (turn.finalized) return;
          turn.finalized = true;
          // Erro no meio do turno: o servidor salvou o parcial com esta mesma
          // nota — a tela fica igual ao que volta no F5.
          const content = turn.error
            ? `${acc}${acc ? '\n\n' : ''}⚠️ _A resposta foi interrompida por um erro: ${turn.error}_`
            : acc;
          const final: Message = {
            // Id real = voto 👍/👎 liga nesta resposta; sem ele (servidor
            // antigo), id local e voto desabilitado.
            id: messageId ?? 'asst-' + Date.now(),
            role: 'assistant',
            content,
            toolUses: toolRecords(tools),
            blocks: received ?? undefined,
            citations: citations.length ? citations : null,
            createdAt: new Date().toISOString(),
            truncated: truncated || undefined,
          };
          setMessages((prev) => [...prev, final]);
          setStreamPartial(null);
          setStreaming(false);
          setSyncStatus(turn.error ? 'error' : 'live');
          void refreshConversations();
          if (cid && cid !== selectedId) setSelectedId(cid);
        },
        onError: ({ message }) => {
          console.error('chat stream error', message);
          turn.error = message;
        },
        onRateLimited: ({ message }) => {
          turn.rateLimited = message;
        },
      },
      controller.signal,
    );

    // Stream acabou sem `done` (recusa antes de começar, limite de uso, queda
    // de conexão). Parar/Nova conversa já fecharam o turno por conta própria.
    if (turn.finalized) return;
    turn.finalized = true;
    setStreaming(false);
    setStreamPartial(null);
    setSyncStatus('error');
    // Recusado antes de começar (400/429): o servidor não ligou os anexos —
    // voltam pro composer pra reenviar ou remover.
    if (!turn.started) uploads.restore(sent);
    setMessages((prev) => [
      ...prev,
      turn.rateLimited != null
        ? { id: 'rl-' + Date.now(), role: 'assistant', content: `🚫 ${turn.rateLimited}`, createdAt: new Date().toISOString() }
        : {
            id: 'err-' + Date.now(),
            role: 'assistant',
            content: `⚠️ Erro: ${turn.error ?? 'a conexão caiu antes do fim da resposta'}`,
            createdAt: new Date().toISOString(),
          },
    ]);
  }

  function handleStop() {
    if (turnRef.current) turnRef.current.finalized = true;
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
          toolUses: toolRecords(streamPartial.tools),
          citations: streamPartial.citations.length ? streamPartial.citations : null,
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

  // Persiste o voto e espelha no estado (export e o voto sobrevivem a
  // re-render). Rejeição sobe pro AssistantMessage, que desfaz o botão.
  async function handleFeedback(messageId: string, input: FeedbackInput | null) {
    let saved: MessageFeedback | null = null;
    if (input) saved = await sendFeedback(messageId, input);
    else await clearFeedback(messageId);
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: saved } : m)));
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
          if (id !== selectedId) uploads.discardAll();
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

      <main className="relative z-[1] flex flex-col h-full overflow-hidden flex-1 min-w-0" {...dropZone}>
        {dragging && (
          // Só visual (o drop é no <main>); quem usa teclado anexa pelo clipe.
          <div
            aria-hidden
            className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ring bg-background/90 text-center"
          >
            <NsIcon name="paperclip" size={28} className="text-ring" />
            <p className="text-sm leading-[22px] font-semibold text-foreground">Solte para anexar</p>
            <p className="px-4 text-xs leading-[18px] text-muted-foreground">
              PDF, imagem, CSV/XLSX, DOCX, TXT/MD ou JSON · até {ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB por arquivo ·{' '}
              {ATTACHMENTS_PER_MESSAGE} por mensagem
            </p>
          </div>
        )}
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
            onFeedback={handleFeedback}
          />
        )}

        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={() => void handleSend()}
          onStop={handleStop}
          streaming={streaming}
          attachments={uploads.items}
          onAddFiles={uploads.add}
          onRetryAttachment={uploads.retry}
          onRemoveAttachment={uploads.remove}
          notice={uploads.notice}
          onDismissNotice={uploads.dismissNotice}
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

/** Tools do stream → registro da mensagem (o estado de erro sobrevive no chip). */
function toolRecords(tools: LiveTool[]): Message['toolUses'] {
  return tools.map((t) => ({ name: t.name, result: { ok: t.status !== 'error' } }));
}
