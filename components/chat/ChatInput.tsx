'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui-utils';
import { ATTACHMENT_ACCEPT, ATTACHMENTS_PER_MESSAGE, pastedFileName } from '@/lib/chat/attachmentRules';
import { NsIcon } from './NsIcon';
import { PendingAttachmentChips, type PendingAttachment } from './AttachmentChips';

// Sem seletor de modelo: o servidor sempre usa o modelo configurado
// (CHAT_MODEL). O chip antigo ("Opus 4.5") era decorativo e mostrava um
// modelo que não era o que respondia.
interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Anexos do composer (o ChatShell cuida do upload). Sem onAddFiles, sem clipe. */
  attachments?: PendingAttachment[];
  onAddFiles?: (files: File[]) => void;
  onRetryAttachment?: (localId: string) => void;
  onRemoveAttachment?: (localId: string) => void;
  /** Aviso de arquivo recusado (tipo, tamanho, limite) — PT-BR, com o que fazer. */
  notice?: string | null;
  onDismissNotice?: () => void;
}

const SLASH_COMMANDS = [
  { cmd: '/comparar', desc: 'Compara dois ou mais itens' },
  { cmd: '/topo', desc: 'Top N por métrica' },
  { cmd: '/anomalias', desc: 'Detecta outliers no período' },
  { cmd: '/explica', desc: 'Explica um número específico' },
  { cmd: '/exporta', desc: 'Gera CSV/JSON da última resposta' },
];

// Controles do composer: 36 px (DS1), 44 px em toque.
const CTL = 'h-9 w-9 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled,
  placeholder = 'Pergunte algo sobre seus dados…',
  attachments = [],
  onAddFiles,
  onRetryAttachment,
  onRemoveAttachment,
  notice,
  onDismissNotice,
}: ChatInputProps) {
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [slashOpen, setSlashOpen] = React.useState(false);

  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(240, ta.scrollHeight) + 'px';
  }, [value]);

  React.useEffect(() => {
    setSlashOpen(value.startsWith('/') && value.length <= 16);
  }, [value]);

  const uploading = attachments.some((a) => a.state === 'queued' || a.state === 'uploading' || a.state === 'processing');
  const readyCount = attachments.filter((a) => a.state === 'ready').length;
  // Anexo pronto basta pra enviar (o servidor põe "Analise o(s) anexo(s).");
  // upload/processamento pendente bloqueia — mandar sem ele perderia o arquivo.
  const canSend = !disabled && !streaming && !uploading && (value.trim().length > 0 || readyCount > 0);
  const atLimit = attachments.length >= ATTACHMENTS_PER_MESSAGE;

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      maybeSubmit();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      maybeSubmit();
    }
  }

  function maybeSubmit() {
    if (!canSend) return;
    onSubmit();
  }

  // Colar imagem (print) anexa; colar TEXTO continua sendo texto — células
  // copiadas do Excel trazem texto E uma imagem, e o usuário quer o texto.
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!onAddFiles) return;
    const dt = e.clipboardData;
    const files = Array.from(dt.files ?? []);
    if (!files.length) return;
    if (dt.getData('text/plain').trim()) return;
    e.preventDefault();
    const now = new Date();
    onAddFiles(
      files.map((f, i) => {
        const name = pastedFileName(f.name, f.type, now, i);
        return name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified });
      }),
    );
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Zera o input: escolher o MESMO arquivo de novo (após remover) dispara change.
    e.target.value = '';
    if (files.length) onAddFiles?.(files);
    taRef.current?.focus();
  }

  const sendTitle = uploading ? 'Aguarde os anexos terminarem de carregar' : 'Enviar (Enter)';

  return (
    <div className="nx-strip-input px-4 py-3 relative">
      {slashOpen && (
        <SlashMenu
          query={value}
          onPick={(cmd) => {
            onChange(cmd + ' ');
            taRef.current?.focus();
          }}
        />
      )}

      <div className="max-w-3xl mx-auto">
        {notice && (
          <div role="alert" className="mb-2 flex items-start gap-2 rounded-md border border-danger/50 bg-card px-3 py-2">
            <NsIcon name="alert-triangle" size={14} className="mt-0.5 shrink-0 text-danger" />
            <p className="min-w-0 flex-1 text-xs leading-[18px] text-foreground break-words">{notice}</p>
            {onDismissNotice && (
              <button
                type="button"
                onClick={onDismissNotice}
                aria-label="Fechar aviso"
                title="Fechar aviso"
                className="-my-1 -mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <NsIcon name="x" size={14} />
              </button>
            )}
          </div>
        )}

        {onRetryAttachment && onRemoveAttachment && (
          <PendingAttachmentChips items={attachments} onRetry={onRetryAttachment} onRemove={onRemoveAttachment} />
        )}

        {/* A borda e o foco (focus-within: borda + anel no acento) são do
            wrapper .nx-input-field; o textarea não desenha caixa própria. */}
        <div
          className={cn(
            'nx-input-field flex items-end gap-1 rounded-md py-1 pl-1 pr-1 transition-colors',
            disabled && 'opacity-60',
          )}
        >
          {onAddFiles && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                onChange={handlePick}
                hidden
                tabIndex={-1}
                aria-hidden
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileRef.current?.click()}
                disabled={disabled || atLimit}
                aria-label="Anexar arquivos"
                title={
                  atLimit
                    ? `No máximo ${ATTACHMENTS_PER_MESSAGE} anexos por mensagem`
                    : 'Anexar arquivos — PDF, imagem, CSV/XLSX, DOCX, TXT/MD ou JSON (até 25 MB)'
                }
                className={cn(CTL, 'text-muted-foreground hover:text-foreground')}
              >
                <NsIcon name="paperclip" />
              </Button>
            </>
          )}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            placeholder={placeholder}
            aria-label="Pergunta para a IA"
            disabled={disabled}
            rows={1}
            className={cn(
              'flex-1 min-w-0 self-center resize-none border-0 rounded-none bg-transparent shadow-none p-0 py-[7px] text-sm leading-[22px] text-foreground placeholder:text-muted-foreground max-h-[240px] outline-none focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed',
              !onAddFiles && 'pl-2',
            )}
          />

          {streaming ? (
            <Button
              variant="outline"
              size="icon"
              onClick={onStop}
              aria-label="Parar resposta"
              title="Parar resposta"
              className={cn(CTL, 'text-danger hover:text-danger')}
            >
              <NsIcon name="square" className="fill-current" />
            </Button>
          ) : (
            <button
              type="button"
              onClick={maybeSubmit}
              disabled={!canSend}
              aria-label={sendTitle}
              title={sendTitle}
              className={cn(CTL, 'nx-send-btn rounded-md inline-flex items-center justify-center transition-colors')}
            >
              <NsIcon name="send" size={16} />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-1.5 px-1 text-xs leading-[18px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <NsIcon name="slash" size={12} /> comandos
          </span>
          <span className="max-sm:hidden [@media(pointer:coarse)]:hidden">
            Enter envia · Shift+Enter nova linha{onAddFiles ? ' · arraste ou cole arquivos' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function SlashMenu({ query, onPick }: { query: string; onPick: (cmd: string) => void }) {
  const q = query.trim().toLowerCase();
  const items = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
  if (items.length === 0) return null;
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[min(420px,calc(100vw-32px))] rounded-md border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden">
      <div className="text-xs font-medium text-muted-foreground px-3 pt-2 pb-1">
        Comandos
      </div>
      {items.map((c) => (
        <button
          key={c.cmd}
          type="button"
          onClick={() => onPick(c.cmd)}
          className="w-full min-h-9 flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-accent text-left transition-colors [@media(pointer:coarse)]:min-h-11"
        >
          <span className="font-medium text-ring">{c.cmd}</span>
          <span className="text-xs text-muted-foreground truncate">{c.desc}</span>
        </button>
      ))}
    </div>
  );
}
