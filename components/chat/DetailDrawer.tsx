'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { EntityKind, EntityRef } from '@/types/chat';
import { NsIcon } from './NsIcon';

interface DetailDrawerProps {
  entity: EntityRef | null;
  open: boolean;
  onClose: () => void;
}

// Rótulo em português do tipo de entidade (o `kind` vem em inglês da IA).
const KIND_LABEL: Record<EntityKind, string> = {
  affiliate: 'Afiliado',
  platform: 'Plataforma',
  product: 'Produto',
  country: 'País',
  currency: 'Valor',
  percent: 'Percentual',
};

// DS1: controle 36px, 44px em toque.
const TOUCH_TEXT = '[@media(pointer:coarse)]:min-h-11';

export function DetailDrawer({ entity, open, onClose }: DetailDrawerProps) {
  return (
    <Sheet open={open && entity != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:w-[400px] flex flex-col gap-0 p-0">
        {entity && (
          <>
            <SheetHeader className="p-5 pr-12 border-b border-border">
              <div className="text-xs font-medium text-muted-foreground">
                {KIND_LABEL[entity.kind] ?? entity.kind}
              </div>
              <SheetTitle className="text-lg break-words">{entity.label}</SheetTitle>
              <SheetDescription>
                ID <span className="font-mono tabular-nums text-foreground break-all">{entity.id}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {entity.meta && Object.keys(entity.meta).length > 0 ? (
                <dl className="grid grid-cols-2 gap-3">
                  {Object.entries(entity.meta).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-border p-3 bg-card min-w-0">
                      <dt className="text-xs font-medium text-muted-foreground first-letter:uppercase">
                        {k}
                      </dt>
                      <dd className="text-sm font-medium text-foreground mt-1 break-words">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem detalhes adicionais. Use “Abrir no dashboard” pra ver a análise completa.
                </p>
              )}

              <ExternalLinkButton entity={entity} />
            </div>

            <div className="border-t border-border p-3 flex justify-end">
              <Button variant="ghost" onClick={onClose} className={TOUCH_TEXT}>
                <NsIcon name="x" /> Fechar
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ExternalLinkButton({ entity }: { entity: EntityRef }) {
  const href = buildLink(entity);
  if (!href) return null;
  return (
    <Button asChild variant="outline" className={`w-full justify-between ${TOUCH_TEXT}`}>
      <a href={href} target="_blank" rel="noreferrer">
        <span>
          Abrir no dashboard<span className="sr-only"> (abre em nova aba)</span>
        </span>
        <NsIcon name="external-link" />
      </a>
    </Button>
  );
}

function buildLink(e: EntityRef): string | null {
  switch (e.kind) {
    // Rotas e params que a SPA lê de verdade (app.jsx / TransactionsPage):
    // afiliado → transações buscadas pelo id; país/plataforma → filtro global.
    case 'affiliate':
      return `/transactions?search=${encodeURIComponent(e.id)}`;
    case 'product':
      return '/products';
    case 'country':
      return `/overview?co=${encodeURIComponent(e.id)}`;
    case 'platform':
      return `/overview?plat=${encodeURIComponent(e.id)}`;
    default:
      return null;
  }
}
