'use client';

// Chip [n] de citação dentro do texto da resposta + popover com a fonte
// (rótulo, página, trecho citado; "abrir anexo" quando a fonte é anexo).
//
// Tudo é <span>/<a>/<button>: o chip nasce DENTRO de um <p> do markdown, e
// <div>/<blockquote> ali é HTML inválido. O popover é position:fixed no
// próprio lugar da árvore — escapa do overflow da bolha/tabela e mantém a
// ordem de Tab natural (chip → popover → resto do texto).

import * as React from 'react';
import { cn } from '@/lib/ui-utils';
import { citationLabel } from '@/lib/chat/citeMarkers';
import { attachmentFileUrl } from '@/lib/chat/client';
import type { Citation } from '@/types/chat';
import { NsIcon } from './NsIcon';

const POPOVER_WIDTH = 360;
const GUTTER = 16;
const GAP = 6;
const QUOTE_MAX = 420;

/** "2026-09-12T…" → "12/09/2026" (data de atualização do documento). */
export function formatCitationDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

export function citationKindLabel(c: Pick<Citation, 'kind'>): string {
  return c.kind === 'attachment' ? 'Anexo' : 'Base de conhecimento';
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX - 1)}…` : t;
}

export function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const popRef = React.useRef<HTMLSpanElement | null>(null);
  const baseId = React.useId();
  const popId = `${baseId}-pop`;
  const titleId = `${baseId}-title`;

  const label = citationLabel(citation);
  const page = citation.page ?? null;
  const updated = formatCitationDate(citation.updatedAt);
  const quotes = citation.citedText.filter((t) => t.trim()).slice(0, 3);

  // Abaixo do chip; sem espaço, acima. Sempre dentro da viewport com 16 px
  // de respiro (mesmo gutter do layout no celular).
  const place = React.useCallback(() => {
    const b = btnRef.current;
    const p = popRef.current;
    if (!b || !p) return;
    const r = b.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(POPOVER_WIDTH, vw - GUTTER * 2);
    const h = p.offsetHeight;
    const left = Math.min(Math.max(GUTTER, r.left - 8), vw - width - GUTTER);
    const fitsBelow = r.bottom + GAP + h <= vh - GUTTER;
    const top = fitsBelow || r.top - GAP - h < GUTTER ? r.bottom + GAP : r.top - GAP - h;
    setPos({ top, left, width });
  }, []);

  React.useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  // Foco vai pro popover (leitor de tela lê a fonte) só DEPOIS de
  // posicionado: no 1º frame ele está com visibility:hidden e não aceita foco.
  const placed = pos != null;
  React.useEffect(() => {
    if (open && placed) popRef.current?.focus();
  }, [open, placed]);

  React.useEffect(() => {
    if (!open) return;
    // A rolagem da lista de mensagens reposiciona em vez de deixar o popover solto.
    const reposition = () => place();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, place]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }

  // Foco saiu do chip e do popover (Tab adiante, clique fora): fecha sem roubar o foco.
  function onBlur(e: React.FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && (popRef.current?.contains(next) || btnRef.current?.contains(next))) return;
    if (next) setOpen(false);
  }

  return (
    <span className="inline" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-haspopup="dialog"
        aria-label={`Fonte ${citation.n}: ${label}${page ? `, página ${page}` : ''}`}
        className={cn(
          // Alvo de toque maior sem mexer na linha: a área clicável cresce
          // pelo ::after, o desenho do chip fica em 18 px.
          "relative mx-[2px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border px-1 align-[0.12em] text-[11px] font-medium leading-none tabular-nums transition-colors after:absolute after:-inset-1.5 after:content-[''] [@media(pointer:coarse)]:after:-inset-3",
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
          open
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-ring/35 bg-accent text-ring hover:border-ring',
        )}
      >
        {citation.n}
      </button>
      {open && (
        <span
          ref={popRef}
          id={popId}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="fixed z-50 block rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none text-left whitespace-normal"
          style={
            pos
              ? { top: pos.top, left: pos.left, width: pos.width }
              : // 1º frame: medido invisível (na largura final) antes de posicionar — sem pulo.
                { top: 0, left: 0, width: Math.min(POPOVER_WIDTH, window.innerWidth - GUTTER * 2), visibility: 'hidden' }
          }
        >
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-4 text-muted-foreground">
                Fonte {citation.n} · {citationKindLabel(citation)}
              </span>
              <span id={titleId} className="block text-sm leading-[22px] font-semibold text-foreground break-words">
                {label}
              </span>
              {(page || updated) && (
                <span className="block text-xs leading-[18px] text-muted-foreground">
                  {page ? `p. ${page}` : null}
                  {page && updated ? ' · ' : null}
                  {updated ? `atualizado em ${updated}` : null}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => close(true)}
              aria-label="Fechar fonte"
              title="Fechar"
              className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <NsIcon name="x" size={14} />
            </button>
          </span>

          {quotes.length > 0 ? (
            quotes.map((q, i) => (
              <q
                key={i}
                className="mt-2 block border-l-2 border-ring/50 pl-2 text-xs leading-[18px] text-foreground before:content-none after:content-none break-words"
              >
                {clip(q)}
              </q>
            ))
          ) : (
            <span className="mt-2 block text-xs leading-[18px] text-muted-foreground">
              Fonte consultada na resposta (sem trecho literal).
            </span>
          )}

          {citation.kind === 'attachment' && citation.documentId && (
            <a
              href={attachmentFileUrl(citation.documentId)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ring underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <NsIcon name="external-link" size={12} /> Abrir anexo
            </a>
          )}
        </span>
      )}
    </span>
  );
}
