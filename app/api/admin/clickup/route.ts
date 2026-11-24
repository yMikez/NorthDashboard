// Configuração do ClickUp (admin) — aba Decisões › Configurar.
//
//   GET  /api/admin/clickup → token (mascarado), workspace, canais e a última leitura
//   POST /api/admin/clickup { action, ... }
//        save     { token?, workspaceId?, clearToken? }  ← token é conferido no ClickUp antes de gravar
//        channels { updates: [{ id, enabled?, leadership? }] }
//        run      { aiCalls? }   ← lê agora em segundo plano (leva alguns minutos)

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { clickupAdminView, DecisionInputError, saveClickUpSettings, updateChannels } from '@/lib/decisions/service';
import { ClickUpApiError, ClickUpNotConfiguredError } from '@/lib/clickup/client';
import { runClickUpPipeline } from '@/lib/clickup/pipeline';
import { ClickUpSyncBusyError } from '@/lib/clickup/sync';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let lastRun: { startedAt: string; finishedAt: string | null; error: string | null } | null = null;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ...(await clickupAdminView()), run: lastRun });
  } catch (err) {
    logger.error({ err }, 'admin/clickup failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  try {
    switch (body.action) {
      case 'save':
        await saveClickUpSettings(body);
        return NextResponse.json({ ok: true });
      case 'channels':
        return NextResponse.json({ ok: true, updated: await updateChannels(body.updates) });
      case 'run': {
        if (lastRun && !lastRun.finishedAt) return NextResponse.json({ error: 'já está lendo' }, { status: 409 });
        const aiCalls = typeof body.aiCalls === 'number' ? Math.min(Math.max(Math.trunc(body.aiCalls), 0), 60) : 40;
        lastRun = { startedAt: new Date().toISOString(), finishedAt: null, error: null };
        const run = lastRun;
        void runClickUpPipeline({ source: `admin:${auth.user.email}`, aiCalls })
          .then(() => { run.finishedAt = new Date().toISOString(); })
          .catch((err) => {
            run.finishedAt = new Date().toISOString();
            run.error = err instanceof Error ? err.message : 'falhou';
            if (!(err instanceof ClickUpSyncBusyError)) logger.warn({ err }, 'admin/clickup run failed');
          });
        return NextResponse.json({ ok: true, started: true });
      }
      default:
        return NextResponse.json({ error: 'action inválida' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof DecisionInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ClickUpApiError) {
      return NextResponse.json({ error: err.status === 401 ? 'o ClickUp recusou o token' : err.message }, { status: 400 });
    }
    if (err instanceof ClickUpNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 400 });
    logger.error({ err, action: body.action }, 'admin/clickup action failed');
    return NextResponse.json({ error: 'falhou' }, { status: 500 });
  }
}
