// Gera components/chat/navConfig.generated.ts a partir da sidebar da SPA.
//
// O /chat é uma rota Next (TS + Tailwind) e não enxerga os globals da SPA,
// então a nav esquerda dele era uma CÓPIA à mão de public/src/shell.jsx —
// e ficou para trás (sem Reembolsos, CRM, Captação, Lucro real; logo e
// ícones antigos). Agora a fonte única é a SPA:
//   · grupos/itens/ícones  ← Sidebar em public/src/shell.jsx
//   · desenho dos ícones   ← Icon + NS_ICON_MARKUP em public/src/utils.jsx
//
// Uso:
//   node scripts/gen-chat-nav.mjs          # regrava o arquivo
//   node scripts/gen-chat-nav.mjs --check  # falha se estiver desatualizado
// O build-spa.mjs roda o --check: mexeu na sidebar e esqueceu de gerar,
// o build quebra em vez de o chat divergir de novo.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const OUT = 'components/chat/navConfig.generated.ts';

// Recorta o literal que começa logo depois de `marker` (primeiro [ ou {),
// contando colchetes/chaves e ignorando o que está dentro de strings e
// comentários.
function sliceLiteral(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`gen-chat-nav: não achei "${marker}"`);
  let i = at + marker.length;
  while (src[i] !== '[' && src[i] !== '{') i++;
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`gen-chat-nav: literal de "${marker}" não fecha`);
}
const evalLiteral = (text) => new Function(`return (${text});`)();

// Ícones do CHAT além dos da nav (nomes do Icon da SPA; o que não existir lá
// vem do lucide). Quem usa: components/chat/NsIcon.tsx — o nome é tipado,
// então ícone fora desta lista não compila.
const CHAT_ICONS = [
  // IA / conversa
  'ns-insights', 'send', 'square', 'paperclip', 'at-sign', 'slash', 'loader', 'wrench',
  'copy', 'thumbs-up', 'thumbs-down', 'edit', 'trash', 'save', 'file-text', 'book-open',
  // lista de conversas
  'search', 'plus', 'more-horizontal', 'pin', 'pin-off', 'folder', 'folder-plus', 'folder-input',
  'panel-left', 'panel-left-close', 'chevron-right', 'chevron-down', 'chevron-left', 'check', 'circle', 'x',
  // barra do topo e filtros (mesmos ícones da FilterBar da SPA)
  'calendar', 'plug', 'package', 'layers', 'globe', 'users', 'filter', 'refresh', 'download', 'link',
  'sun', 'moon', 'external-link',
  // blocos de resposta
  'trending-up', 'trending-down', 'alert-triangle', 'info', 'arrow-up', 'arrow-down',
  'arrow-up-right', 'arrow-down-right', 'minus',
];

// Desenho do lucide-react instalado (dist/esm/icons/<nome>.mjs → __iconNode).
function lucideMarkup(name) {
  const file = `node_modules/lucide-react/dist/esm/icons/${name}.mjs`;
  if (!existsSync(file)) return null;
  const src = readFileSync(file, 'utf8');
  // Nome antigo que virou apelido (ex.: more-horizontal → ellipsis).
  const reexport = src.match(/export \{ default \} from '\.\/([a-z0-9-]+)\.mjs'/);
  if (reexport && !src.includes('const __iconNode')) return lucideMarkup(reexport[1]);
  const node = evalLiteral(sliceLiteral(src, 'const __iconNode ='));
  return node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('');
}

export function buildChatNav() {
  const shell = readFileSync('public/src/shell.jsx', 'utf8').replace(/\r\n/g, '\n');
  const utils = readFileSync('public/src/utils.jsx', 'utf8').replace(/\r\n/g, '\n');

  const sideAt = shell.indexOf('function Sidebar(');
  if (sideAt < 0) throw new Error('gen-chat-nav: Sidebar não encontrada em shell.jsx');
  const side = shell.slice(sideAt);
  const groups = evalLiteral(sliceLiteral(side, 'const allGroups ='));
  const iaGroup = evalLiteral(sliceLiteral(side, 'const iaGroup ='));
  const adminGroup = evalLiteral(sliceLiteral(side, 'const adminOnly ='));

  const markup = evalLiteral(sliceLiteral(utils, 'const NS_ICON_MARKUP ='));
  const alias = evalLiteral(sliceLiteral(utils, 'const NS_ICON_ALIAS ='));
  const iconAt = utils.indexOf('function Icon(');
  const paths = evalLiteral(sliceLiteral(utils.slice(iconAt), 'const paths ='));

  // Mesma resolução do Icon da SPA: alias NS → 'ns-*' → caminhos de
  // utils.jsx. Só o que a SPA não tem (pin, pasta, polegar…) cai no desenho
  // do lucide instalado — mesma família de traço, e o <svg> do chat força o
  // 1.6 da SPA de qualquer jeito.
  function innerSvg(name) {
    const nsKey = alias[name] || (name.startsWith('ns-') ? name.slice(3) : null);
    if (nsKey && markup[nsKey]) return markup[nsKey];
    const ps = paths[name];
    if (ps) return ps.map((d) => `<path d="${d}"/>`).join('');
    const lucide = lucideMarkup(name);
    if (lucide) return lucide;
    throw new Error(`gen-chat-nav: ícone '${name}' não existe em utils.jsx nem no lucide-react`);
  }

  const clean = (g) => ({ label: g.label, items: g.items.map(({ id, label, icon }) => ({ id, label, icon })) });
  const allGroups = groups.map(clean);
  const ia = clean(iaGroup);
  const admin = clean(adminGroup);
  // Ícones: os dos itens + casca (recolher, "Sair") + os do resto do chat.
  const iconNames = [...new Set([...allGroups, ia, admin].flatMap((g) => g.items.map((it) => it.icon)).concat(['chevron-right', 'log-out'], CHAT_ICONS))];
  const icons = Object.fromEntries(iconNames.map((n) => [n, innerSvg(n)]));

  const j = (v) => JSON.stringify(v, null, 2);
  return `// ARQUIVO GERADO por scripts/gen-chat-nav.mjs — não edite à mão.
// Fonte: Sidebar em public/src/shell.jsx + Icon/NS_ICON_MARKUP em public/src/utils.jsx.
// Mudou a sidebar da SPA? Rode \`node scripts/gen-chat-nav.mjs\` (o build confere).

export interface NavItem { id: string; label: string; icon: NsIconName }
export interface NavGroup { label: string; items: NavItem[] }

/** Grupos filtráveis por allowedTabs (membro só vê o que tem liberado). */
export const NAV_GROUPS: NavGroup[] = ${j(allGroups)};

/** Chat IA: todo usuário logado vê, independente de allowedTabs. */
export const NAV_IA_GROUP: NavGroup = ${j(ia)};

/** Só admin. */
export const NAV_ADMIN_GROUP: NavGroup = ${j(admin)};

/** Miolo do <svg viewBox="0 0 24 24"> de cada ícone, igual ao Icon da SPA. */
export const NS_ICON_SVG = ${j(icons)} as const;

/** Nome de ícone válido no chat — fora da lista, não compila. */
export type NsIconName = keyof typeof NS_ICON_SVG;
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  const next = buildChatNav();
  if (process.argv.includes('--check')) {
    const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== next) {
      console.error(`[gen-chat-nav] ${OUT} está desatualizado — rode: node scripts/gen-chat-nav.mjs`);
      process.exit(1);
    }
    console.log('[gen-chat-nav] nav do chat em dia com a sidebar da SPA');
  } else {
    writeFileSync(OUT, next);
    console.log(`[gen-chat-nav] gravado ${OUT}`);
  }
}
