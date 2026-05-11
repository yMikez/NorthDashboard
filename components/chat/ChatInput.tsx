'use client';

import * as React from 'react';
import {
  Paperclip,
  Send,
  Square,
  Sparkles,
  AtSign,
  Slash,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui-utils';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  model: string;
  onChangeModel: (m: string) => void;
  modelOptions?: Array<{ value: string; label: string; hint?: string }>;
  placeholder?: string;
}

const DEFAULT_MODELS = [
  { value: 'claude-opus-4-5', label: 'Opus 4.5', hint: 'Mais inteligente' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'Balanceado' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'Mais rápido' },
];

const SLASH_COMMANDS = [
  { cmd: '/comparar', desc: 'Compara dois ou mais itens' },
  { cmd: '/topo', desc: 'Top N por métrica' },
  { cmd: '/anomalias', desc: 'Detecta outliers no período' },
  { cmd: '/explica', desc: 'Explica um número específico' },
  { cmd: '/exporta', desc: 'Gera CSV/JSON da última resposta' },
];

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  disabled,
  model,
  onChangeModel,
  modelOptions = DEFAULT_MODELS,
  placeholder = 'Pergunte algo sobre seus dados…',
}: ChatInputProps) {
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
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
    const trimmed = value.trim();
    if (!trimmed || streaming || disabled) return;
    onSubmit();
  }

  const activeModel = modelOptions.find((m) => m.value === model) ?? modelOptions[0];

  return (
    <div className="border-t border-border bg-popover/40 backdrop-blur-md p-3 relative">
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
        <div
          className={cn(
            'flex items-end gap-2 rounded-2xl border bg-card px-3 py-2 transition-colors',
            'focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10',
            disabled ? 'border-border opacity-60' : 'border-border',
          )}
        >
          <Button variant="ghost" size="icon-sm" aria-label="Anexar arquivo" disabled>
            <Paperclip className="w-4 h-4" />
          </Button>

          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed py-1.5 max-h-[240px] disabled:cursor-not-allowed"
          />

          {streaming ? (
            <Button
              size="icon-sm"
              variant="outline"
              onClick={onStop}
              aria-label="Parar geração"
              className="text-rose-500 hover:text-rose-500"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={maybeSubmit}
              disabled={!value.trim() || disabled}
              aria-label="Enviar (Enter)"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-1.5 px-1">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
            <span className="inline-flex items-center gap-1"><Slash className="w-3 h-3" /> comandos</span>
            <span className="inline-flex items-center gap-1"><AtSign className="w-3 h-3" /> mencionar</span>
            <span className="opacity-70">Shift+Enter quebra de linha</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
              >
                <Sparkles className="w-3 h-3 text-primary" />
                {activeModel.label}
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Modelo</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {modelOptions.map((m) => (
                <DropdownMenuItem key={m.value} onSelect={() => onChangeModel(m.value)}>
                  <div className="flex flex-col">
                    <span className="font-medium">{m.label}</span>
                    {m.hint && <span className="text-[10px] text-muted-foreground">{m.hint}</span>}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[420px] rounded-md border border-border bg-popover shadow-lg overflow-hidden">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono px-3 pt-2 pb-1">
        Comandos
      </div>
      {items.map((c) => (
        <button
          key={c.cmd}
          type="button"
          onClick={() => onPick(c.cmd)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-accent text-left transition-colors"
        >
          <span className="font-mono text-primary">{c.cmd}</span>
          <span className="text-muted-foreground truncate">{c.desc}</span>
        </button>
      ))}
    </div>
  );
}
