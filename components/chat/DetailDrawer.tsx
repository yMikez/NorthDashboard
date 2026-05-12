'use client';

import * as React from 'react';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { EntityRef } from '@/types/chat';

interface DetailDrawerProps {
  entity: EntityRef | null;
  open: boolean;
  onClose: () => void;
}

export function DetailDrawer({ entity, open, onClose }: DetailDrawerProps) {
  return (
    <Sheet open={open && entity != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="lg-deep flex flex-col gap-0 p-0">
        {entity && (
          <>
            <SheetHeader className="p-5 border-b border-border">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                {entity.kind}
              </div>
              <SheetTitle className="text-lg">{entity.label}</SheetTitle>
              <SheetDescription>
                ID <span className="font-mono">{entity.id}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {entity.meta && Object.keys(entity.meta).length > 0 ? (
                <dl className="grid grid-cols-2 gap-3">
                  {Object.entries(entity.meta).map(([k, v]) => (
                    <div key={k} className="rounded-md border border-border p-3 bg-card">
                      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                        {k}
                      </dt>
                      <dd className="text-sm font-medium mt-1">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sem detalhes adicionais — clique em "Abrir no dashboard" pra ver
                  análise completa.
                </p>
              )}

              <ExternalLinkButton entity={entity} />
            </div>

            <div className="border-t border-border p-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="w-3.5 h-3.5" /> Fechar
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
    <Button asChild variant="outline" className="w-full justify-between">
      <a href={href} target="_blank" rel="noreferrer">
        Abrir no dashboard
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </Button>
  );
}

function buildLink(e: EntityRef): string | null {
  switch (e.kind) {
    case 'affiliate':
      return `/affiliates/${encodeURIComponent(e.id)}`;
    case 'product':
      return `/products?focus=${encodeURIComponent(e.id)}`;
    case 'country':
      return `/geography?country=${encodeURIComponent(e.id)}`;
    case 'platform':
      return `/overview?platform=${encodeURIComponent(e.id)}`;
    default:
      return null;
  }
}
