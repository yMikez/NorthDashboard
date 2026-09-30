// Tools de anexo: read_attachment (páginas/seção de um anexo indexado) e
// query_attachment_table (filtro/agrupamento/soma DETERMINÍSTICOS sobre
// planilha/CSV anexado — número de anexo nunca sai de leitura de linha).
// ESQUELETO da fundação — preenchido pela unidade de anexos.

import type { ToolModule } from '../ai/toolTypes';

export const ATTACHMENT_TOOL_MODULE: ToolModule = { tools: [], handlers: {} };
