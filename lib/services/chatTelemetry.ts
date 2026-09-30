// Telemetria por turno do chat (ChatTurnLog) — custo, cache, latência,
// tools, truncamentos. ESQUELETO da fundação — preenchido pela unidade de
// avaliação/qualidade.

import type { TurnResult } from './chatEngine';

export interface TurnLogMeta {
  messageId: string | null;
  conversationId: string | null;
  userId: string | null;
  evalRunId?: string | null;
  model: string;
  effort: string;
  knowledgeHash?: string | null;
}

export async function saveTurnLog(_result: TurnResult, _meta: TurnLogMeta): Promise<void> {
  /* no-op até a unidade de qualidade implementar */
}
