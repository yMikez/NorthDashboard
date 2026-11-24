// Aba Decisões (lib/decisions/service.ts).
//
//   GET  /api/metrics/decisions?status=DETECTED|CONFIRMED|DISCARDED|ALL&channel=
//   POST /api/metrics/decisions { action, id?, ... }
//        confirm | discard | restore            { id }
//        edit      { id, title?, summary?, decidedAt? (AAAA-MM-DD), metrics?, platforms?, families?, note? }
//        create    { title, decidedAt, summary?, metrics?, platforms?, families?, note? }  ← decisão fora do ClickUp
//        recompute { id }

import { NextResponse } from 'next/server';
import type { DecisionStatus } from '@prisma/client';
import { requireTab } from '@/lib/auth/guard';
import { decisionAction, DecisionInputError, listDecisions } from '@/lib/decisions/service';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STATUSES = new Set(['DETECTED', 'CONFIRMED', 'DISCARDED', 'ALL']);

export async function GET(req: Request) {
  const auth = await requireTab('decisions');
  if (!auth.ok) return auth.response;
  const sp = new URL(req.url).searchParams;
  const status = sp.get('status') ?? '';
  try {
    return NextResponse.json(await listDecisions({
      status: STATUSES.has(status) ? (status as DecisionStatus | 'ALL') : undefined,
      channelId: sp.get('channel') || undefined,
    }));
  } catch (err) {
    logger.error({ err }, 'metrics/decisions failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireTab('decisions');
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  try {
    return NextResponse.json(await decisionAction(auth.user.name || auth.user.email, body));
  } catch (err) {
    if (err instanceof DecisionInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    logger.error({ err, action: body.action }, 'metrics/decisions action failed');
    return NextResponse.json({ error: 'falhou' }, { status: 500 });
  }
}
