// Hook de boot do Next.js (roda 1x quando o servidor sobe). Usado pra armar
// jobs in-process que precisam existir sem cron externo. Só no runtime
// nodejs — o edge não tem timers longos nem Prisma.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startLogicallScheduler } = await import('./lib/services/logicallScheduler');
  startLogicallScheduler();
}
