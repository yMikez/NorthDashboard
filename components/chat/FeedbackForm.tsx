'use client';

// Formulário do 👎: motivo(s), comentário, "qual seria a resposta certa?" e
// o consentimento pro admin ler a pergunta + resposta. É o que alimenta a
// fila de respostas ruins e vira caso de teste do eval — por isso os
// motivos são fixos (agregáveis) e a resposta certa tem campo próprio.

import * as React from 'react';
import { cn } from '@/lib/ui-utils';
import type { FeedbackReason } from '@/types/chat';

export const FEEDBACK_REASONS: ReadonlyArray<{ id: FeedbackReason; label: string }> = [
  { id: 'numero_errado', label: 'Número errado' },
  { id: 'periodo_errado', label: 'Período errado' },
  { id: 'filtro_errado', label: 'Filtro errado' },
  { id: 'nao_respondeu', label: 'Não respondeu' },
  { id: 'inventou', label: 'Inventou informação' },
  { id: 'lento', label: 'Lento' },
  { id: 'formato', label: 'Formato ruim' },
  { id: 'outro', label: 'Outro' },
];

export interface FeedbackFormValues {
  reasons: FeedbackReason[];
  comment?: string;
  expected?: string;
  shared: boolean;
}

const FIELD =
  'nx-input-field block w-full rounded-md px-3 py-2 text-sm leading-[22px] text-foreground placeholder:text-muted-foreground outline-none resize-y';

export function FeedbackForm({
  initialReasons = [],
  initialComment = '',
  onSubmit,
  onCancel,
}: {
  initialReasons?: FeedbackReason[];
  initialComment?: string;
  /** Rejeita = falhou (o form mostra o erro e continua aberto). */
  onSubmit: (values: FeedbackFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [reasons, setReasons] = React.useState<FeedbackReason[]>(initialReasons);
  const [comment, setComment] = React.useState(initialComment);
  const [expected, setExpected] = React.useState('');
  const [shared, setShared] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const firstRef = React.useRef<HTMLButtonElement | null>(null);
  const ids = React.useId();

  // Abriu pelo 👎: foco no primeiro motivo (teclado continua de onde clicou).
  React.useEffect(() => {
    firstRef.current?.focus();
  }, []);

  function toggle(id: FeedbackReason) {
    setReasons((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        reasons,
        comment: comment.trim() || undefined,
        expected: expected.trim() || undefined,
        shared,
      });
    } catch {
      setError('Não foi possível enviar. Tente de novo.');
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      aria-labelledby={`${ids}-title`}
      className="nx-bubble-assistant rounded-lg px-4 py-3 space-y-3"
    >
      <p id={`${ids}-title`} className="text-sm leading-[22px] font-semibold text-foreground">
        O que deu errado nesta resposta?
      </p>

      <fieldset>
        <legend className="mb-1.5 text-xs leading-[18px] text-muted-foreground">Motivos (pode marcar mais de um)</legend>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_REASONS.map((r, i) => {
            const on = reasons.includes(r.id);
            return (
              <button
                key={r.id}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(r.id)}
                className={cn(
                  'inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors [@media(pointer:coarse)]:h-11',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                  on
                    ? 'border-ring bg-accent text-ring'
                    : 'border-border bg-card text-foreground hover:border-ring',
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${ids}-comment`} className="mb-1 block text-xs leading-[18px] text-muted-foreground">
          Comentário (opcional)
        </label>
        <textarea
          id={`${ids}-comment`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={2000}
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor={`${ids}-expected`} className="mb-1 block text-xs leading-[18px] text-muted-foreground">
          Qual seria a resposta certa? (opcional)
        </label>
        <textarea
          id={`${ids}-expected`}
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="ex.: o lucro certo era $12,345.00 (aba Custos)"
          className={FIELD}
        />
      </div>

      <label className="flex items-start gap-2 text-xs leading-[18px] text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => setShared(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span>O admin pode ler esta pergunta e resposta</span>
      </label>

      {error && (
        <p role="alert" className="text-xs leading-[18px] text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving || undefined}>
          {saving ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </form>
  );
}
