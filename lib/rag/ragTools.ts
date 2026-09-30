// Tool de RAG: search_knowledge — busca híbrida na base (metodologia,
// regras, ressalvas, glossário, memórias aprovadas) e nos ANEXOS da conversa
// do turno. Devolve blocos search_result com citação nativa (o motor manda
// como conteúdo do tool_result), registrados no SourceRegistry do turno.

import type Anthropic from '@anthropic-ai/sdk';
import type { ContentToolResult, ModuleHandler, ToolContext, ToolModule } from '../ai/toolTypes';
import { toSearchResultBlocks, passageSource } from './present';
import { DEFAULT_MAX_RESULTS, isSearchScope, MAX_RESULTS, sanitizeQueries, searchKnowledge } from './search';

const SEARCH_TOOL: Anthropic.Tool = {
  name: 'search_knowledge',
  description:
    'Busca na base de conhecimento do NorthScale (metodologia de margem/lucro real, modelo CPA/NET AOV, lucro front×back, ' +
    'coortes de reembolso, ressalvas de dados por plataforma, funil e etapas, call center, afiliados de recuperação, fulfillment, ' +
    'CRM de afiliados, integrações, dicionário de campos das tools, regras do admin, memórias aprovadas) e nos ANEXOS desta conversa. ' +
    'Devolve trechos citáveis. Use ANTES de explicar definição, fórmula, regra, "como é calculado", "por que o número é assim", ' +
    'integração ou ressalva, e quando um termo for ambíguo (CB = ClickBank ou chargeback). NÃO use para números do período — ' +
    'esses vêm das tools get_* (ou query_attachment_table para planilhas anexadas). Passe 1–4 formulações em `queries` ' +
    '(sinônimos PT/EN do dash). `low_confidence: true` = a base não cobre: diga isso em vez de completar com suposição. ' +
    'Afirmação tirada daqui deve vir apoiada no trecho citado.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['queries'],
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 4,
        description: '1–4 formulações da mesma dúvida (ex.: ["reembolso Digistore sem IPN", "estornos D24 faltando"]).',
      },
      scope: {
        type: 'string',
        enum: ['all', 'knowledge', 'attachments'],
        description: 'all (default) = base + anexos desta conversa; knowledge = só a base; attachments = só os anexos desta conversa.',
      },
      document_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restringe a documentos específicos (ids de anexo desta conversa ou de documento da base).',
      },
      max_results: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, description: `Trechos a devolver (default ${DEFAULT_MAX_RESULTS}, máx. ${MAX_RESULTS}).` },
    },
  },
};

function invalid(message: string) {
  return { error: 'invalid_input', message };
}

const handleSearch: ModuleHandler = async (input, ctx: ToolContext) => {
  const queries = sanitizeQueries(input.queries);
  if (!queries.length) return invalid('queries: passe de 1 a 4 formulações não vazias (strings)');
  const scope = input.scope == null ? 'all' : input.scope;
  if (!isSearchScope(scope)) return invalid('scope deve ser all | knowledge | attachments');
  if (scope === 'attachments' && !ctx.conversationId) return invalid('scope=attachments só existe dentro de uma conversa com anexos');
  const documentIds = Array.isArray(input.document_ids) ? input.document_ids.filter((x): x is string => typeof x === 'string') : undefined;
  const maxRaw = input.max_results == null ? DEFAULT_MAX_RESULTS : Number(input.max_results);
  if (!Number.isFinite(maxRaw) || maxRaw < 1 || maxRaw > MAX_RESULTS) return invalid(`max_results deve ser um inteiro de 1 a ${MAX_RESULTS}`);

  const res = await searchKnowledge({
    queries,
    scope,
    conversationId: ctx.conversationId ?? null,
    documentIds,
    maxResults: Math.trunc(maxRaw),
    signal: ctx.signal,
  });
  const blocks = toSearchResultBlocks(res.passages, ctx.sources);
  const header = {
    queries,
    results: res.passages.length,
    low_confidence: res.lowConfidence,
    ...(res.passages.length === 0
      ? { note: 'Nenhum trecho encontrado — a base não cobre isso. Diga que não há documentação em vez de supor.' }
      : res.lowConfidence
        ? { note: 'Trechos só tangenciais — a base não cobre bem. Use com cautela e diga a limitação.' }
        : {}),
  };
  const result: ContentToolResult = {
    __content: [{ type: 'text', text: JSON.stringify(header) }, ...blocks],
    summary: { ...header, sources: res.passages.map(passageSource) },
  };
  return result;
};

export const RAG_TOOL_MODULE: ToolModule = {
  tools: [SEARCH_TOOL],
  handlers: { search_knowledge: handleSearch },
};
