// Análises salvas do Simulador de Funil (aba Análise › Simulador de Funil).
//   GET    /api/funnel-sim/simulations           → { simulations }
//   POST   /api/funnel-sim/simulations           { name, product?, params, summary } → { id }
//   PUT    /api/funnel-sim/simulations?id=<id>   { name, product?, params, summary } → { ok }
//   DELETE /api/funnel-sim/simulations?id=<id>   → { ok }
// Quem tem a aba vê e salva todas; atualizar e apagar só quem criou ou admin.

import { NextResponse } from 'next/server';
import { requireTab } from '@/lib/auth/guard';
import { logger } from '@/lib/logger';
import {
  createFunnelSimulation, deleteFunnelSimulation, listFunnelSimulations, updateFunnelSimulation,
} from '@/lib/services/funnelSimulator';
import { validarSimulacao } from '@/lib/services/funnelSimulatorCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MSG = { nao_achou: 'Essa análise não existe mais.', proibido: 'Só quem salvou (ou um admin) pode alterar ou apagar esta análise.' } as const;

async function lerCorpo(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { return null; }
}

export async function GET() {
  const auth = await requireTab('funnel-sim');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ simulations: await listFunnelSimulations() });
  } catch (err) {
    logger.error({ err }, 'funnel-sim/simulations list failed');
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireTab('funnel-sim');
  if (!auth.ok) return auth.response;
  const v = validarSimulacao(await lerCorpo(req));
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  try {
    const id = await createFunnelSimulation(v.valor, auth.user.id);
    logger.info({ id, userId: auth.user.id }, '[funnelSim] análise salva');
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    logger.error({ err }, 'funnel-sim/simulations save failed');
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const auth = await requireTab('funnel-sim');
  if (!auth.ok) return auth.response;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
  const v = validarSimulacao(await lerCorpo(req));
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  try {
    const r = await updateFunnelSimulation(id, v.valor, auth.user);
    if (r !== 'ok') return NextResponse.json({ error: MSG[r] }, { status: r === 'nao_achou' ? 404 : 403 });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    logger.error({ err }, 'funnel-sim/simulations update failed');
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireTab('funnel-sim');
  if (!auth.ok) return auth.response;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
  try {
    const r = await deleteFunnelSimulation(id, auth.user);
    if (r !== 'ok') return NextResponse.json({ error: MSG[r] }, { status: r === 'nao_achou' ? 404 : 403 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'funnel-sim/simulations delete failed');
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
}
