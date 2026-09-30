// Skills (playbooks carregados sob demanda) + glossário consultável.
// ESQUELETO da fundação — preenchido pela unidade de prompt/skills:
// load_skill (índice no prompt estável, corpo via tool_result) e
// get_definitions (glossário de fonte única, lib/ai/glossary.ts).

import type { ToolModule } from './toolTypes';

export const SKILL_TOOL_MODULE: ToolModule = { tools: [], handlers: {} };
