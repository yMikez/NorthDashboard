// Gera lib/chat/skills.generated.ts a partir dos playbooks do chat IA.
//
// Skills = procedimentos revisados em código (lib/chat/skills/<nome>.md):
// o ÍNDICE (uma linha por skill) vai no prompt estável e o CORPO chega sob
// demanda pela tool load_skill. Ler os .md em runtime não funciona com
// `output: 'standalone'` (o arquivo não vai pra imagem), por isso o gerador
// embute tudo num módulo TS — mesmo padrão do gen-chat-nav.mjs.
//
// Também embute a lista de FAMÍLIAS canônicas do classificador
// (CANONICAL_FAMILIES em lib/services/productClassification.ts, que não é
// exportada): o glossário do prompt lista as famílias válidas a partir do
// código, não de uma cópia à mão (a cópia antiga tinha 6 de 31).
//
// Formato de cada .md:
//   ---
//   name: <igual ao nome do arquivo>
//   title: <título curto>
//   when: <quando usar — uma linha>
//   first_tools: tool_a, tool_b
//   version: 1
//   ---
//   ## Passos / ## Checagens obrigatórias / ## Formato  (nessa ordem)
//
// Uso:
//   node scripts/gen-chat-skills.mjs          # regrava o arquivo
//   node scripts/gen-chat-skills.mjs --check  # falha se estiver desatualizado
// O build-spa.mjs roda o --check: mexeu num playbook e esqueceu de gerar, o
// build quebra em vez de o chat carregar um playbook velho.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const OUT = 'lib/chat/skills.generated.ts';
const SKILLS_DIR = 'lib/chat/skills';
const CLASSIFIER = 'lib/services/productClassification.ts';

const REQUIRED_KEYS = ['name', 'title', 'when', 'first_tools', 'version'];
const SECTIONS = ['## Passos', '## Checagens obrigatórias', '## Formato'];

const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

function parseSkill(file) {
  const src = read(`${SKILLS_DIR}/${file}`);
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`gen-chat-skills: ${file} sem frontmatter (--- … ---)`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf(':');
    if (at < 1) throw new Error(`gen-chat-skills: ${file}: linha de frontmatter inválida "${line}"`);
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  for (const k of REQUIRED_KEYS) {
    if (!meta[k]) throw new Error(`gen-chat-skills: ${file}: falta "${k}" no frontmatter`);
  }
  const name = meta.name;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`gen-chat-skills: ${file}: name "${name}" fora do padrão kebab-case`);
  if (`${name}.md` !== file) throw new Error(`gen-chat-skills: ${file}: name "${name}" diferente do nome do arquivo`);
  const version = Number(meta.version);
  if (!Number.isInteger(version) || version < 1) throw new Error(`gen-chat-skills: ${file}: version deve ser inteiro ≥ 1`);
  const firstTools = meta.first_tools.split(',').map((t) => t.trim()).filter(Boolean);
  if (!firstTools.length || firstTools.some((t) => !/^[a-z][a-z0-9_]*$/.test(t))) {
    throw new Error(`gen-chat-skills: ${file}: first_tools deve ser uma lista de nomes de tool separados por vírgula`);
  }
  const body = m[2].trim();
  let from = -1;
  for (const s of SECTIONS) {
    const at = body.indexOf(`${s}\n`);
    if (at < 0) throw new Error(`gen-chat-skills: ${file}: falta a seção "${s}"`);
    if (at < from) throw new Error(`gen-chat-skills: ${file}: seções fora de ordem (${SECTIONS.join(' → ')})`);
    from = at;
  }
  return { name, title: meta.title, when: meta.when, firstTools, version, body };
}

function canonicalFamilies() {
  const src = read(CLASSIFIER);
  const at = src.indexOf('const CANONICAL_FAMILIES = [');
  if (at < 0) throw new Error(`gen-chat-skills: CANONICAL_FAMILIES não encontrada em ${CLASSIFIER}`);
  const end = src.indexOf('];', at);
  const list = [...src.slice(at, end).matchAll(/'([^'\n]+)'/g)].map((x) => x[1]);
  if (list.length < 5) throw new Error('gen-chat-skills: lista de famílias canônicas suspeita (menos de 5)');
  return list;
}

export function buildChatSkills() {
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md')).sort();
  const skills = files.map(parseSkill);
  const index = skills.map((s) => `- ${s.name} — ${s.when} · começar: ${s.firstTools.join(', ')}`).join('\n');
  const j = (v) => JSON.stringify(v, null, 2);
  const record = Object.fromEntries(skills.map((s) => [s.name, s]));
  return `// ARQUIVO GERADO por scripts/gen-chat-skills.mjs — não edite à mão.
// Fontes: lib/chat/skills/*.md (playbooks) + CANONICAL_FAMILIES em lib/services/productClassification.ts.
// Mudou um playbook ou uma família canônica? Rode \`node scripts/gen-chat-skills.mjs\` (o build confere).

export interface ChatSkill {
  name: string;
  title: string;
  /** Quando usar — vai no índice do prompt estável. */
  when: string;
  /** Primeiras consultas recomendadas (nomes de tool). */
  firstTools: readonly string[];
  version: number;
  /** Markdown do playbook: ## Passos, ## Checagens obrigatórias, ## Formato. */
  body: string;
}

export const SKILL_NAMES = ${j(skills.map((s) => s.name))} as const;

export type SkillName = (typeof SKILL_NAMES)[number];

export const SKILLS: Record<SkillName, ChatSkill> = ${j(record)};

/** Índice do prompt estável: uma linha por skill (nome — quando · começar: tools). */
export const SKILL_INDEX = ${JSON.stringify(index)};

/** Famílias canônicas do classificador — fonte do glossário do prompt. */
export const CANONICAL_FAMILY_NAMES = ${j(canonicalFamilies())} as const;
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');
if (isMain) {
  const next = buildChatSkills();
  if (process.argv.includes('--check')) {
    const cur = existsSync(OUT) ? read(OUT) : '';
    if (cur !== next) {
      console.error(`[gen-chat-skills] ${OUT} está desatualizado — rode: node scripts/gen-chat-skills.mjs`);
      process.exit(1);
    }
    console.log('[gen-chat-skills] skills do chat em dia com lib/chat/skills/*.md');
  } else {
    writeFileSync(OUT, next);
    console.log(`[gen-chat-skills] gravado ${OUT}`);
  }
}
