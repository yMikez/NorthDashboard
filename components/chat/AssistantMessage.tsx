'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui-utils';
import { textForCopy } from '@/lib/chat/citeMarkers';
import { storedToolStatus, toolChipLabel, type ToolChipStatus } from '@/lib/chat/toolLabels';
import { NsIcon } from './NsIcon';
import { BlockRenderer } from './blocks/BlockRenderer';
import { MarkdownBlock } from './blocks/MarkdownBlock';
import { SourcesFooter } from './SourcesFooter';
import { FeedbackForm, type FeedbackFormValues } from './FeedbackForm';
import type {
  Block,
  Citation,
  FeedbackInput,
  FeedbackRating,
  MessageFeedback,
  ToolUseRecord,
} from '@/types/chat';

/** Tool em andamento na resposta que está sendo gerada (SSE tool_use_start/result). */
export interface LiveTool {
  name: string;
  id: string;
  status: ToolChipStatus;
}

interface AssistantMessageProps {
  content: string;
  /** Usos persistidos (histórico) — o input dá o nome do playbook. */
  toolUses?: ToolUseRecord[] | null;
  /** Tools do stream em curso — têm estado próprio (várias rodam em paralelo). */
  liveTools?: LiveTool[];
  blocks?: Block[];
  citations?: Citation[] | null;
  streaming?: boolean;
  truncated?: boolean;
  onRegenerate?: () => void;
  /** Voto atual (GET da conversa). */
  feedback?: MessageFeedback | null;
  /**
   * Persiste o voto (null = remove). Sem ele os botões de voto não aparecem
   * (modo leitura). Rejeita em falha — o botão volta ao estado anterior.
   */
  onFeedback?: (input: FeedbackInput | null) => Promise<void>;
  /** Id ainda temporário: voto indisponível até o `done` trazer o id salvo. */
  feedbackDisabled?: boolean;
}

// Ações da resposta: 32 px como o .icon-btn da SPA, 44 px em toque.
const ACTION_BTN =
  'h-8 w-8 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

/**
 * O ChatShell grava falhas como mensagens locais com prefixo emoji:
 * `⚠️ Erro: …` (erro do stream) e `🚫 …` (limite de uso). Aqui o emoji
 * vira o ícone do DS1 e a mensagem ganha o tom de feedback; o texto
 * ("Erro: …") fica como veio.
 */
type Notice = { tone: 'danger' | 'warning'; text: string };
const ERROR_PREFIX = /^⚠️?\s*(?=Erro:)/u;
const RATE_LIMIT_PREFIX = /^\u{1F6AB}\s*/u;

function parseNotice(content: string): Notice | null {
  if (ERROR_PREFIX.test(content)) return { tone: 'danger', text: content.replace(ERROR_PREFIX, '') };
  if (RATE_LIMIT_PREFIX.test(content)) return { tone: 'warning', text: content.replace(RATE_LIMIT_PREFIX, '') };
  return null;
}

export function AssistantMessage({
  content,
  toolUses,
  liveTools,
  blocks,
  citations,
  streaming,
  truncated,
  onRegenerate,
  feedback,
  onFeedback,
  feedbackDisabled,
}: AssistantMessageProps) {
  const [copied, setCopied] = React.useState(false);
  const [vote, setVote] = React.useState<FeedbackRating | null>(feedback?.rating ?? null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [voteError, setVoteError] = React.useState<string | null>(null);
  const [thanks, setThanks] = React.useState(false);
  const downRef = React.useRef<HTMLButtonElement | null>(null);
  const pendingVote = React.useRef<Promise<void> | null>(null);

  // O servidor é a verdade: GET da conversa (ou o retorno do POST) atualiza.
  React.useEffect(() => {
    setVote(feedback?.rating ?? null);
  }, [feedback?.rating]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(textForCopy(content, citations));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  /** Aplica o voto na hora; se o servidor recusar, volta ao anterior. */
  async function persist(input: FeedbackInput | null, next: FeedbackRating | null) {
    if (!onFeedback) return;
    const prev = vote;
    setVote(next);
    setVoteError(null);
    setThanks(false);
    const req = onFeedback(input);
    pendingVote.current = req;
    try {
      await req;
    } catch {
      setVote(prev);
      setVoteError('Não foi possível salvar o voto. Tente de novo.');
    }
  }

  function voteUp() {
    setFormOpen(false);
    // Mesmo voto de novo = desfaz.
    if (vote === 1) void persist(null, null);
    else void persist({ rating: 1, reasons: [] }, 1);
  }

  function voteDown() {
    if (vote === -1) {
      setFormOpen(false);
      void persist(null, null);
      return;
    }
    // O 👎 vale já (mesmo se o formulário for ignorado), mas SEM
    // compartilhar: pergunta e resposta só chegam ao admin quando o usuário
    // envia o formulário com o consentimento marcado.
    void persist({ rating: -1, shared: false }, -1);
    setFormOpen(true);
  }

  async function submitDetails(values: FeedbackFormValues) {
    if (!onFeedback) return;
    // O 👎 "seco" ainda em voo chegaria DEPOIS e apagaria os detalhes no upsert.
    await pendingVote.current?.catch(() => undefined);
    await onFeedback({ rating: -1, ...values });
    setFormOpen(false);
    setThanks(true);
    downRef.current?.focus();
  }

  function closeForm() {
    setFormOpen(false);
    downRef.current?.focus();
  }

  const hasBlocks = !!blocks && blocks.length > 0;
  const chips = React.useMemo(() => toolChips(toolUses, liveTools, streaming), [toolUses, liveTools, streaming]);
  const notice = !streaming && !hasBlocks && chips.length === 0 && content ? parseNotice(content) : null;
  const sources = citations ?? [];
  const showVotes = !!onFeedback && !notice;

  return (
    <div className="group px-4 sm:px-6 py-4 flex gap-3" aria-busy={streaming || undefined}>
      <div className="w-7 h-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0">
        <NsIcon name="ns-insights" size={16} />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        {chips.length > 0 && <ToolChips chips={chips} />}

        {notice ? (
          <div
            role="alert"
            className={cn(
              'nx-bubble-assistant rounded-lg rounded-tl-sm px-4 py-2.5 flex items-start gap-2',
              notice.tone === 'danger' ? 'border-danger/50' : 'border-warning/50',
            )}
          >
            <NsIcon
              name="alert-triangle"
              size={16}
              className={cn('mt-[3px] shrink-0', notice.tone === 'danger' ? 'text-danger' : 'text-warning')}
            />
            <div className="min-w-0 flex-1">
              <MarkdownBlock block={{ content: notice.text }} />
            </div>
          </div>
        ) : (
          content && (
            <div className="nx-bubble-assistant rounded-lg rounded-tl-sm px-4 py-2.5">
              <MarkdownBlock block={{ content }} citations={citations} streaming={streaming && !hasBlocks} />
            </div>
          )
        )}
        {hasBlocks && <BlockRenderer blocks={blocks!} />}
        {!content && !hasBlocks && streaming && (
          <div role="status" className="text-xs text-muted-foreground">
            <span className="sr-only">Gerando resposta</span>
            <span
              aria-hidden
              className="inline-block w-1.5 h-4 bg-ring animate-pulse motion-reduce:animate-none ml-0.5 -mb-0.5"
            />
          </div>
        )}

        {/* Fontes só no fim: durante o stream a lista cresceria embaixo do texto. */}
        {!streaming && sources.length > 0 && <SourcesFooter citations={sources} />}

        {truncated && !streaming && (
          <div className="flex items-start gap-1.5 text-xs leading-[18px] text-warning">
            <NsIcon name="alert-triangle" size={14} className="mt-0.5 shrink-0" />
            <span>Resposta cortada pelo limite de tamanho. Peça para continuar.</span>
          </div>
        )}

        {/* A linha de ações existe (invisível) também durante o stream: quando
            a resposta termina, nada embaixo dela pula. */}
        <div
          aria-hidden={streaming || undefined}
          className={cn(
            'flex flex-wrap items-center gap-1 transition-opacity',
            streaming
              ? 'invisible'
              : formOpen || vote != null || voteError || thanks
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100',
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void copy()}
            aria-label={copied ? 'Copiado' : 'Copiar resposta'}
            title={copied ? 'Copiado' : 'Copiar resposta'}
            className={ACTION_BTN}
          >
            {copied ? <NsIcon name="check" className="text-success" /> : <NsIcon name="copy" />}
          </Button>
          {onRegenerate && (
            // O ChatShell devolve a última pergunta ao campo (não reenvia
            // sozinho) — o rótulo diz isso.
            <Button
              variant="ghost"
              size="icon"
              onClick={onRegenerate}
              aria-label="Repetir a pergunta"
              title="Repetir a pergunta"
              className={ACTION_BTN}
            >
              <NsIcon name="refresh" />
            </Button>
          )}
          {showVotes && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={voteUp}
                disabled={feedbackDisabled}
                aria-label="Resposta útil"
                aria-pressed={vote === 1}
                title={feedbackDisabled ? 'Disponível quando a resposta for salva' : 'Resposta útil'}
                className={cn(ACTION_BTN, vote === 1 && 'text-success hover:text-success')}
              >
                <NsIcon name="thumbs-up" />
              </Button>
              <Button
                ref={downRef}
                variant="ghost"
                size="icon"
                onClick={voteDown}
                disabled={feedbackDisabled}
                aria-label="Resposta ruim"
                aria-pressed={vote === -1}
                aria-expanded={vote === -1 ? formOpen : undefined}
                title={feedbackDisabled ? 'Disponível quando a resposta for salva' : 'Resposta ruim'}
                className={cn(ACTION_BTN, vote === -1 && 'text-danger hover:text-danger')}
              >
                <NsIcon name="thumbs-down" />
              </Button>
              {vote === -1 && !formOpen && !thanks && (
                <button
                  type="button"
                  onClick={() => setFormOpen(true)}
                  className="ml-1 text-xs leading-[18px] text-ring underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Contar o que houve
                </button>
              )}
              <span role="status" className="ml-1 text-xs leading-[18px]">
                {voteError ? (
                  <span className="text-danger">{voteError}</span>
                ) : thanks ? (
                  <span className="text-muted-foreground">Obrigado — feedback registrado.</span>
                ) : null}
              </span>
            </>
          )}
        </div>

        {showVotes && formOpen && vote === -1 && (
          <FeedbackForm
            initialReasons={feedback?.rating === -1 ? feedback.reasons : []}
            initialComment={feedback?.rating === -1 ? feedback.comment ?? '' : ''}
            onSubmit={submitDetails}
            onCancel={closeForm}
          />
        )}
      </div>
    </div>
  );
}

interface ToolChip {
  key: string;
  name: string;
  label: string;
  status: ToolChipStatus;
}

function toolChips(
  toolUses: ToolUseRecord[] | null | undefined,
  liveTools: LiveTool[] | undefined,
  streaming: boolean | undefined,
): ToolChip[] {
  if (liveTools) {
    return liveTools.map((t) => ({
      key: t.id,
      name: t.name,
      label: toolChipLabel(t.name),
      // Stream parado (abort/erro) com tool sem resultado: não gira pra sempre.
      status: t.status === 'running' && !streaming ? 'ok' : t.status,
    }));
  }
  return (toolUses ?? []).map((u, i) => ({
    key: `${i}-${u.name}`,
    name: u.name,
    label: toolChipLabel(u.name, u.input),
    status: storedToolStatus(u.result),
  }));
}

function ToolChips({ chips }: { chips: ToolChip[] }) {
  return (
    <ul aria-label="Consultas feitas" className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li
          key={c.key}
          title={c.status === 'error' ? `${c.name} — falhou` : c.name}
          className={cn(
            'nx-tool-chip',
            c.status === 'ok' && 'is-done',
            c.status === 'error' && 'border-danger/50 bg-danger/10 text-danger',
          )}
        >
          {c.status === 'running' ? (
            <NsIcon name="loader" size={12} className="animate-spin motion-reduce:animate-none" />
          ) : c.status === 'error' ? (
            <NsIcon name="alert-triangle" size={12} />
          ) : (
            <NsIcon name="wrench" size={12} />
          )}
          {c.label}
          {c.status === 'error' && <span className="sr-only"> (falhou)</span>}
        </li>
      ))}
    </ul>
  );
}
