// Parte SÓ-NODE do hook de boot (instrumentation.ts importa isto dentro de
// um if (NEXT_RUNTIME === 'nodejs')). Separado de propósito: o Next compila
// instrumentation.ts também pro runtime edge, e o webpack só descarta o import
// quando ele está atrás dessa condição constante — um return antecipado não
// basta, e aí módulos com node:crypto/node:fs quebravam o build do edge.

export async function registerNode(): Promise<void> {
  const { startLogicallScheduler } = await import('./lib/services/logicallScheduler');
  startLogicallScheduler();
  // Reconciliação do mapeamento de afiliados (NorthScale Afiliados): 45s
  // após o boot (carga inicial se nunca rodou) e depois diária.
  const { startAffiliateMappingScheduler } = await import('./lib/services/affiliateMappingSync');
  startAffiliateMappingScheduler();
  // Retenção do SendTrace (P10/R4): pull a cada 30 min, cadência pedida por
  // eles. No-op enquanto URL/chave não estiverem configuradas.
  const { startRetentionScheduler } = await import('./lib/services/retentionScheduler');
  startRetentionScheduler();
  // Base de conhecimento da IA: seed de docs/kb 20s após o boot, em segundo
  // plano (idempotente por sha256 — boot sem mudança não reindexa nada).
  const { scheduleKnowledgeSeed } = await import('./lib/rag/seed');
  scheduleKnowledgeSeed();
  startAttachmentCleanup();
}

const ATTACHMENT_CLEANUP_FIRST_MS = 10 * 60_000;
const ATTACHMENT_CLEANUP_EVERY_MS = 6 * 60 * 60_000;

/**
 * Limpeza dos anexos do chat: vencidos (CHAT_ATTACHMENT_RETENTION_DAYS) e
 * rascunhos nunca enviados (> 24h). Primeira rodada 10 min após o boot,
 * depois a cada 6h. Timers unref'd; erro só vai pro log.
 */
function startAttachmentCleanup(): void {
  const run = async () => {
    const [{ cleanupExpiredAttachments }, { logger }] = await Promise.all([
      import('./lib/rag/attachments'),
      import('./lib/logger'),
    ]);
    try {
      const removed = await cleanupExpiredAttachments();
      if (removed) logger.info({ removed }, '[attachments] limpeza de anexos vencidos');
    } catch (err) {
      logger.warn({ err }, '[attachments] limpeza falhou (tenta de novo no próximo ciclo)');
    }
  };
  const first = setTimeout(() => {
    void run();
    const every = setInterval(() => void run(), ATTACHMENT_CLEANUP_EVERY_MS);
    every.unref?.();
  }, ATTACHMENT_CLEANUP_FIRST_MS);
  first.unref?.();
}
