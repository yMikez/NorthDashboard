// Skills (playbooks sob demanda) + glossário consultável.
//
//   load_skill      — devolve o corpo de um playbook listado no índice
//                     "# Skills" do prompt estável. O corpo entra na conversa
//                     como tool_result (append-only): o prompt e a lista de
//                     tools não mudam no meio do turno, então o cache e o
//                     thinking preservado continuam valendo.
//   get_definitions — definição canônica (fórmula, unidade, lente, onde ler,
//                     armadilhas) do mesmo objeto que gera o "# Glossário" do
//                     prompt (lib/ai/glossary.ts) — útil pra reler um termo
//                     no meio de uma análise longa sem depender da memória.
//
// Os enums das duas tools são estáticos (todas as skills / todos os termos):
// a lista de tools faz parte do prefixo cacheado e não pode variar por usuário.

import type Anthropic from '@anthropic-ai/sdk';
import type { ToolModule } from './toolTypes';
import { SKILLS, SKILL_NAMES, type SkillName } from '../chat/skills.generated';
import { GLOSSARY, GLOSSARY_KEYS, definitionView, searchGlossary, type GlossaryKey } from './glossary';

const MAX_TERMS = 12;

const LOAD_SKILL_TOOL: Anthropic.Tool = {
  name: 'load_skill',
  description:
    'Carrega o playbook completo de uma skill do índice "# Skills" (passos, checagens obrigatórias, formato da resposta). Chame na MESMA rodada das primeiras consultas indicadas no índice — não espere o resultado pra consultar. Pode carregar mais de uma quando a pergunta cruza temas. O playbook vence as regras gerais quando for mais específico.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', enum: [...SKILL_NAMES], description: 'Nome da skill, exatamente como no índice.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

const GET_DEFINITIONS_TOOL: Anthropic.Tool = {
  name: 'get_definitions',
  description:
    'Definição canônica de métricas e termos do dashboard (a mesma do Glossário do system): fórmula, unidade, lente/eixo de data, onde ler (tool.campo), card da tela e armadilhas. Use pra confirmar QUAL campo responde a pergunta antes de consultar, ou quando o usuário pergunta "o que é X". `terms` = chaves do glossário; `search` = texto livre (PT/EN, ex.: "reembolso", "take rate"). Sem nenhum dos dois, devolve o catálogo de chaves.',
  input_schema: {
    type: 'object',
    properties: {
      terms: {
        type: 'array',
        items: { type: 'string', enum: [...GLOSSARY_KEYS] },
        maxItems: MAX_TERMS,
        description: 'Chaves do glossário (as que aparecem entre colchetes no Glossário).',
      },
      search: { type: 'string', description: 'Busca por nome/sinônimo quando a chave não é conhecida.' },
    },
    additionalProperties: false,
  },
};

interface ToolError {
  error: 'invalid_input';
  message: string;
  retryable: false;
  validValues?: readonly string[];
}

function invalid(message: string, validValues?: readonly string[]): ToolError {
  return { error: 'invalid_input', message, retryable: false, ...(validValues ? { validValues } : {}) };
}

function isSkillName(v: string): v is SkillName {
  return (SKILL_NAMES as readonly string[]).includes(v);
}

function isGlossaryKey(v: string): v is GlossaryKey {
  return Object.prototype.hasOwnProperty.call(GLOSSARY, v);
}

export async function loadSkill(input: Record<string, unknown>) {
  const raw = typeof input.name === 'string' ? input.name.trim().toLowerCase() : '';
  if (!raw) return invalid('name obrigatório', SKILL_NAMES);
  if (!isSkillName(raw)) return invalid(`skill desconhecida: "${raw}"`, SKILL_NAMES);
  const s = SKILLS[raw];
  return { name: s.name, version: s.version, title: s.title, body: s.body };
}

export async function getDefinitions(input: Record<string, unknown>) {
  const rawTerms = Array.isArray(input.terms) ? input.terms.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
  const search = typeof input.search === 'string' ? input.search.trim() : '';

  if (!rawTerms.length && !search) {
    return {
      catalog: GLOSSARY_KEYS.map((key) => ({ key, label: GLOSSARY[key].label })),
      hint: 'Passe terms (chaves acima) ou search (texto livre).',
    };
  }
  if (rawTerms.length > MAX_TERMS) return invalid(`no máximo ${MAX_TERMS} termos por chamada`);

  // Chave exata primeiro; o que não for chave vira busca textual (o modelo às
  // vezes manda o rótulo em vez da chave) — resolve em vez de devolver erro.
  const keys: GlossaryKey[] = [];
  const unknown: string[] = [];
  const add = (k: GlossaryKey) => { if (!keys.includes(k)) keys.push(k); };
  for (const t of rawTerms) {
    const trimmed = t.trim();
    if (isGlossaryKey(trimmed)) { add(trimmed); continue; }
    const hits = searchGlossary(trimmed, 1);
    if (hits.length) add(hits[0]);
    else unknown.push(trimmed);
  }
  if (search) for (const k of searchGlossary(search)) add(k);

  if (!keys.length) {
    return {
      definitions: [],
      notFound: search ? [...unknown, search] : unknown,
      message: 'Nenhum termo do glossário corresponde. Tente search_knowledge para regras/metodologia ou outro sinônimo.',
      validTerms: GLOSSARY_KEYS,
    };
  }
  return {
    definitions: keys.map(definitionView),
    ...(unknown.length ? { notFound: unknown } : {}),
  };
}

export const SKILL_TOOL_MODULE: ToolModule = {
  tools: [LOAD_SKILL_TOOL, GET_DEFINITIONS_TOOL],
  handlers: {
    load_skill: (input) => loadSkill(input),
    get_definitions: (input) => getDefinitions(input),
  },
};
