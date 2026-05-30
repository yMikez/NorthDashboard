// POST /api/admin/copy-autotune/run — dispara um ciclo do auto-tune.
// Auth: bearer JOB_SECRET (cron externo — systemd timer / GH Actions schedule).
// ?dry=1 → dry-run: calcula as decisões mas NÃO aplica nem grava log.

import { runAutotune } from '@/lib/copy-optimizer/autotuneRunner';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const expected = process.env.JOB_SECRET;
  const auth = req.headers.get('authorization');
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('forbidden', { status: 403 });
  }

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';
  try {
    const result = await runAutotune({ dryRun });
    logger.info({ processed: result.processed, changed: result.changed, dryRun }, 'copy-autotune run');
    return Response.json(result);
  } catch (err) {
    logger.error({ err }, 'copy-autotune run failed');
    return Response.json({ error: 'run failed' }, { status: 500 });
  }
}
