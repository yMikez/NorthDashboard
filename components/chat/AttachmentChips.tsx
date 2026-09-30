'use client';

// Chips de anexo — dois usos:
//   - PendingAttachmentChips: no composer, com o ciclo do upload
//     (na fila → enviando % → processando → pronto | erro com retry) e remover;
//   - MessageAttachmentChips: na mensagem enviada, cada chip baixa o original.
// Visual do DS1: superfície + borda 1 px, sem vidro; 36 px (44 em toque).

import * as React from 'react';
import { cn } from '@/lib/ui-utils';
import { attachmentMetaLabel, formatBytes } from '@/lib/chat/attachmentRules';
import { attachmentFileUrl } from '@/lib/chat/client';
import type { AttachmentDTO, AttachmentKind } from '@/types/chat';
import { NsIcon, type NsIconName } from './NsIcon';

export type PendingState = 'queued' | 'uploading' | 'processing' | 'ready' | 'error';

/** Anexo no composer (estado local do ChatShell). */
export interface PendingAttachment {
  localId: string;
  /** Arquivo original — o retry redimensiona/envia de novo a partir dele. */
  file: File;
  name: string;
  kind: AttachmentKind;
  state: PendingState;
  /** Fração 0–1 dos bytes enviados (só em 'uploading'). */
  progress: number;
  /** Resposta do servidor (a partir de 'processing'). */
  attachment?: AttachmentDTO;
  /** Mensagem PT-BR (estado 'error'). */
  error?: string;
  /** Quando entrou em 'processing' — o polling desiste depois de um teto. */
  processingSince?: number;
}

// Sem ícone de imagem/planilha no set NorthScale: clipe e camadas (abas) são
// os mais próximos.
const KIND_ICON: Record<AttachmentKind, NsIconName> = {
  pdf: 'file-text',
  docx: 'file-text',
  text: 'file-text',
  table: 'layers',
  image: 'paperclip',
};

const KIND_LABEL: Record<AttachmentKind, string> = {
  pdf: 'PDF',
  docx: 'Documento',
  text: 'Texto',
  table: 'Planilha',
  image: 'Imagem',
};

const CHIP =
  'relative inline-flex items-center gap-2 max-w-[280px] min-h-9 rounded-md border bg-card pl-2 pr-1 py-1 text-left overflow-hidden [@media(pointer:coarse)]:min-h-11';
const CHIP_BTN =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

function statusText(p: PendingAttachment): string {
  switch (p.state) {
    case 'queued':
      return 'Na fila';
    case 'uploading':
      return p.progress >= 1 ? 'Processando…' : 'Enviando';
    case 'processing':
      return 'Processando…';
    case 'ready':
      return p.attachment ? attachmentMetaLabel(p.attachment) : 'Pronto';
    case 'error':
      return p.error ?? 'Falha no envio';
  }
}

export function PendingAttachmentChips({
  items,
  onRetry,
  onRemove,
}: {
  items: PendingAttachment[];
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul aria-label="Anexos da mensagem" className="flex flex-wrap gap-2 mb-2">
      {items.map((p) => {
        const busy = p.state === 'queued' || p.state === 'uploading' || p.state === 'processing';
        const pct = Math.round(p.progress * 100);
        return (
          <li
            key={p.localId}
            className={cn(CHIP, p.state === 'error' ? 'border-danger/60' : 'border-border')}
            title={p.state === 'error' ? `${p.name} — ${p.error ?? ''}` : p.name}
          >
            {busy ? (
              <NsIcon name="loader" size={16} className="shrink-0 text-ring animate-spin motion-reduce:animate-none" />
            ) : p.state === 'error' ? (
              <NsIcon name="alert-triangle" size={16} className="shrink-0 text-danger" />
            ) : (
              <NsIcon name={KIND_ICON[p.kind]} size={16} className="shrink-0 text-ring" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs leading-[18px] font-medium text-foreground">{p.name}</span>
              <span
                className={cn(
                  'block truncate text-[11px] leading-4 tabular-nums',
                  p.state === 'error' ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                {/* Só a mudança de ESTADO é anunciada; o % fica no progressbar. */}
                <span aria-live="polite">{statusText(p)}</span>
                {p.state === 'uploading' && p.progress < 1 && <span aria-hidden> {pct}%</span>}
              </span>
            </span>
            {p.state === 'error' && (
              <button
                type="button"
                className={CHIP_BTN}
                onClick={() => onRetry(p.localId)}
                aria-label={`Tentar enviar ${p.name} de novo`}
                title="Tentar de novo"
              >
                <NsIcon name="refresh" size={14} />
              </button>
            )}
            <button
              type="button"
              className={CHIP_BTN}
              onClick={() => onRemove(p.localId)}
              aria-label={busy ? `Cancelar envio de ${p.name}` : `Remover ${p.name}`}
              title={busy ? 'Cancelar' : 'Remover'}
            >
              <NsIcon name="x" size={14} />
            </button>
            {p.state === 'uploading' && (
              <span
                role="progressbar"
                aria-label={`Envio de ${p.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="absolute left-0 bottom-0 h-0.5 w-full bg-transparent"
              >
                <span
                  className="block h-full bg-ring transition-[width] duration-150 motion-reduce:transition-none"
                  style={{ width: `${pct}%` }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Chips da mensagem enviada: link de download pro dono; expirado/falho esmaecido. */
export function MessageAttachmentChips({ items, className }: { items: AttachmentDTO[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ul aria-label="Anexos" className={cn('flex flex-wrap gap-2', className)}>
      {items.map((a) => {
        const available = a.status === 'READY' || a.status === 'PROCESSING' || a.status === 'PENDING';
        const meta =
          a.status === 'EXPIRED' ? 'anexo expirado' : a.status === 'FAILED' ? 'falhou ao processar' : attachmentMetaLabel(a);
        const body = (
          <>
            <NsIcon
              name={KIND_ICON[a.kind]}
              size={16}
              className={cn('shrink-0', available ? 'text-ring' : 'text-muted-foreground')}
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-xs leading-[18px] font-medium',
                  available ? 'text-foreground' : 'text-muted-foreground line-through',
                )}
              >
                {a.fileName}
              </span>
              <span className="block truncate text-[11px] leading-4 text-muted-foreground tabular-nums">{meta}</span>
            </span>
          </>
        );
        return (
          <li key={a.id}>
            {available ? (
              <a
                href={attachmentFileUrl(a.id)}
                download={a.fileName}
                className={cn(
                  CHIP,
                  'pr-2 border-border hover:border-ring focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring transition-colors',
                )}
                title={`Baixar ${a.fileName} (${KIND_LABEL[a.kind]}, ${formatBytes(a.byteSize)})`}
                aria-label={`Baixar ${a.fileName} — ${KIND_LABEL[a.kind]}, ${meta}`}
              >
                {body}
              </a>
            ) : (
              <span className={cn(CHIP, 'pr-2 border-border opacity-70')} title={`${a.fileName} — ${meta}`}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
