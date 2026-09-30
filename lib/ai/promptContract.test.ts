// Contrato entre o prompt estável, as skills, o glossário e o catálogo de
// tools. Nome de tool errado num playbook ou no glossário faz a IA chamar
// algo que não existe (ou ler o campo errado) — aqui quebra antes do deploy.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKILLS, SKILL_NAMES, SKILL_INDEX, CANONICAL_FAMILY_NAMES } from '../chat/skills.generated';
import { GLOSSARY, GLOSSARY_KEYS } from './glossary';
import { SKILL_TOOL_MODULE } from './skillTools';
import { stablePromptText } from '../services/ai';

// Catálogo FINAL de tools (CONTRACTS.md §2) — fixo aqui de propósito: o
// teste não depende de aiTools.ts (que importa o banco) e denuncia tanto
// typo nos textos quanto tool renomeada sem atualizar prompt/skills.
const CONTRACT_TOOLS = [
  'get_overview', 'get_affiliates', 'get_affiliate_detail', 'get_affiliate_analysis', 'get_affiliate_explain',
  'get_affiliate_sequence', 'get_funnel', 'get_funnel_sequence', 'get_products', 'get_families', 'get_platforms',
  'get_orders', 'get_profit_split', 'get_costs_overview', 'get_fulfillment', 'get_refund_cohorts', 'get_call_center',
  'get_recovery', 'get_sms', 'get_health', 'respond_with_blocks',
  'calc', 'aggregate_result', 'aggregate_orders', 'compare_periods', 'get_data_coverage', 'resolve_entities',
  'get_profit_model', 'get_net_profit',
  'load_skill', 'get_definitions',
  'search_knowledge',
  'read_attachment', 'query_attachment_table',
] as const;
const TOOL_SET = new Set<string>(CONTRACT_TOOLS);

// Tudo que PARECE nome de tool (prefixos do catálogo + calc).
const TOOL_LIKE = /\b(?:get|load|search|read|query|respond|aggregate|compare|resolve)_[a-z_]+\b|\bcalc\b/g;
const toolMentions = (text: string): string[] => [...new Set(text.match(TOOL_LIKE) ?? [])];

const ROOT = resolve(__dirname, '../..');

describe('skills.generated.ts', () => {
  it('está em dia com lib/chat/skills/*.md e com as famílias do classificador', async () => {
    // Import dinâmico por caminho: o gerador é .mjs (sem tipos) e lê relativo à raiz.
    const genPath = resolve(ROOT, 'scripts/gen-chat-skills.mjs');
    const gen = (await import(/* @vite-ignore */ genPath)) as {
      buildChatSkills(): string;
      OUT: string;
    };
    const cwd = process.cwd();
    process.chdir(ROOT);
    try {
      const current = readFileSync(resolve(ROOT, gen.OUT), 'utf8').replace(/\r\n/g, '\n');
      expect(current, 'rode: node scripts/gen-chat-skills.mjs').toBe(gen.buildChatSkills());
    } finally {
      process.chdir(cwd);
    }
  });

  it('famílias = CANONICAL_FAMILIES de productClassification.ts', () => {
    const src = readFileSync(resolve(ROOT, 'lib/services/productClassification.ts'), 'utf8');
    const at = src.indexOf('const CANONICAL_FAMILIES = [');
    const list = [...src.slice(at, src.indexOf('];', at)).matchAll(/'([^'\n]+)'/g)].map((m) => m[1]);
    expect([...CANONICAL_FAMILY_NAMES]).toEqual(list);
    expect(list).toContain('NeuroPulsePro');
    expect(list).toContain('DigestFlow');
  });
});

describe('skills — playbooks', () => {
  it('catálogo com 14+ skills e as obrigatórias', () => {
    expect(SKILL_NAMES.length).toBeGreaterThanOrEqual(14);
    for (const n of ['diagnostico-variacao', 'reembolso-e-chargeback', 'lucro-e-margem', 'arquivo-anexado', 'consultar-base', 'reconciliar-numero', 'saude-dados']) {
      expect(SKILL_NAMES as readonly string[]).toContain(n);
    }
  });

  it('cada skill tem as 3 seções, nessa ordem, e versão ≥ 1', () => {
    for (const name of SKILL_NAMES) {
      const s = SKILLS[name];
      const a = s.body.indexOf('## Passos');
      const b = s.body.indexOf('## Checagens obrigatórias');
      const c = s.body.indexOf('## Formato');
      expect(a, name).toBeGreaterThanOrEqual(0);
      expect(b, name).toBeGreaterThan(a);
      expect(c, name).toBeGreaterThan(b);
      expect(s.version, name).toBeGreaterThanOrEqual(1);
      expect(s.title.length, name).toBeGreaterThan(5);
    }
  });

  it('first_tools e toda tool citada no corpo existem no catálogo', () => {
    for (const name of SKILL_NAMES) {
      const s = SKILLS[name];
      for (const t of s.firstTools) expect(TOOL_SET.has(t), `${name}: first_tools "${t}"`).toBe(true);
      for (const t of toolMentions(s.body)) expect(TOOL_SET.has(t), `${name}: corpo cita "${t}"`).toBe(true);
    }
  });

  it('índice: uma linha por skill e cabe no orçamento do prompt', () => {
    const lines = SKILL_INDEX.split('\n');
    expect(lines).toHaveLength(SKILL_NAMES.length);
    for (const name of SKILL_NAMES) expect(SKILL_INDEX).toContain(`- ${name} — `);
    expect(SKILL_INDEX.length).toBeLessThanOrEqual(4500);
  });

  it('enum do load_skill = skills geradas; enum do get_definitions = chaves do glossário', () => {
    const byName = Object.fromEntries(SKILL_TOOL_MODULE.tools.map((t) => [t.name, t]));
    const skillEnum = ((byName.load_skill.input_schema as { properties: { name: { enum: string[] } } }).properties.name.enum);
    expect(skillEnum).toEqual([...SKILL_NAMES]);
    const termsEnum = ((byName.get_definitions.input_schema as { properties: { terms: { items: { enum: string[] } } } }).properties.terms.items.enum);
    expect(termsEnum).toEqual(GLOSSARY_KEYS);
    for (const t of SKILL_TOOL_MODULE.tools) expect(TOOL_SET.has(t.name)).toBe(true);
    expect(Object.keys(SKILL_TOOL_MODULE.handlers).sort()).toEqual(SKILL_TOOL_MODULE.tools.map((t) => t.name).sort());
  });
});

describe('glossário', () => {
  it('todo whereToRead começa com uma tool do catálogo', () => {
    for (const key of GLOSSARY_KEYS) {
      const where = GLOSSARY[key].whereToRead;
      expect(where.length, key).toBeGreaterThan(0);
      for (const w of where) {
        const tool = w.match(/^[a-z_]+/)?.[0] ?? '';
        expect(TOOL_SET.has(tool), `${key}: "${w}"`).toBe(true);
      }
    }
  });

  it('as 4 lentes de lucro apontam pro campo certo', () => {
    expect(GLOSSARY.profit_model.whereToRead).toContain('get_profit_split.front.profitUsd');
    expect(GLOSSARY.profit_real_cost.whereToRead).toContain('get_costs_overview.kpis.profitUsd');
    expect(GLOSSARY.profit_estimated.whereToRead).toContain('get_overview.kpis.estimatedProfit');
    expect(GLOSSARY.contribution_margin.whereToRead[0]).toMatch(/^get_net_profit/);
  });
});

describe('prompt estável', () => {
  const prompt = stablePromptText();

  it('guia todas as tools do catálogo e não cita tool inexistente', () => {
    for (const t of CONTRACT_TOOLS) expect(prompt, `prompt não menciona ${t}`).toContain(t);
    for (const t of toolMentions(prompt)) expect(TOOL_SET.has(t), `prompt cita "${t}"`).toBe(true);
  });

  it('carrega glossário, limiares, índice de skills e as listas geradas do código', () => {
    expect(prompt).toContain('# Glossário');
    expect(prompt).toContain('# Limiares');
    expect(prompt).toContain(SKILL_INDEX);
    for (const f of CANONICAL_FAMILY_NAMES) expect(prompt).toContain(f);
    for (const p of ['clickbank', 'digistore24', 'buygoods', 'cartpanda', 'jvzoo']) expect(prompt).toContain(p);
    for (const p of ['tauk', 'logicall', 'salesbound']) expect(prompt).toContain(p);
  });

  it('fatos que já saíram errados: CPA = último, NET AOV com reserva, net já sem CPA', () => {
    expect(prompt).toMatch(/ÚLTIMO cpaPaidUsd/);
    expect(prompt).toMatch(/NET AOV = AOV × \(1 − \(refund&cb% \+ fee% \+ opex% \+ reserva%\) \/ 100\)/);
    expect(prompt).toMatch(/Nunca subtraia CPA do net/);
    expect(prompt).not.toMatch(/valor mais frequente/);
  });

  it('cabe no orçamento (~18k tokens)', () => {
    expect(prompt.length).toBeLessThanOrEqual(70_000);
  });
});
