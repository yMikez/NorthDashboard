// Tools de RAG: search_knowledge (busca híbrida na base + anexos, devolve
// search_result com citação nativa) e afins.
// ESQUELETO da fundação — preenchido pela unidade de RAG.

import type { ToolModule } from '../ai/toolTypes';

export const RAG_TOOL_MODULE: ToolModule = { tools: [], handlers: {} };
