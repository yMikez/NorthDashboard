// Hook de boot do Next.js (roda 1x quando o servidor sobe). Usado pra armar
// jobs in-process que precisam existir sem cron externo. Só no runtime
// nodejs — o edge não tem timers longos nem Prisma. Toda a lógica mora em
// instrumentation-node.ts (ver o porquê lá).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
