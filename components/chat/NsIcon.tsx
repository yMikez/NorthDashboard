// Ícone do chat = mesmo desenho e traço do Icon da SPA (public/src/utils.jsx):
// viewBox 24, stroke currentColor 1.6, pontas redondas. O miolo vem de
// navConfig.generated.ts (scripts/gen-chat-nav.mjs), então nome fora da
// lista não compila. Substitui o lucide-react (traço 2, outro desenho) na
// casca do chat.

import * as React from 'react';
import { NS_ICON_SVG, type NsIconName } from './navConfig.generated';

export type { NsIconName };

export function NsIcon({
  name,
  size = 16,
  className,
  label,
}: {
  name: NsIconName;
  size?: number;
  className?: string;
  /** Nome acessível quando o ícone é o único conteúdo com significado; sem ele, decorativo. */
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      dangerouslySetInnerHTML={{ __html: NS_ICON_SVG[name] }}
    />
  );
}
