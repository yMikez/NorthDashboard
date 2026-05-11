// Helpers de UI pra a nova app (chat redesign).
// cn(): combina classes Tailwind com merge inteligente (tailwind-merge
// resolve conflitos como `bg-red-500 bg-blue-500` mantendo o último).
//
// NÃO confundir com lib/services/* — esses são de domínio (DB, AI, etc).
// ui-utils.ts é só pra os componentes shadcn/Tailwind.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
