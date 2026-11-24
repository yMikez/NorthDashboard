import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const st = vi.hoisted(() => ({
  messages: [] as Row[], decisions: [] as Row[], queries: 0, ai: vi.fn(),
}));

vi.mock('../db', () => ({
  db: {
    platform: { findMany: async () => [{ slug: 'jvzoo' }, { slug: 'buygoods' }] },
    product: { findMany: async () => [{ family: 'NeuroRecall' }, { family: 'GlycoEden' }, { family: 'UP3 - Combo' }] },
    $queryRaw: async () => (st.queries++ === 0 ? [{ id: 'root1', channelId: 'ch1', channelName: 'liderança' }, { id: 'root2', channelId: 'ch1', channelName: 'liderança' }] : []),
    clickUpMessage: {
      findUnique: async ({ where }: { where: { id: string } }) => st.messages.find((m) => m.id === where.id) ?? null,
      findMany: async ({ where }: { where: { parentId: string } }) => st.messages.filter((m) => m.parentId === where.parentId),
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(st.messages.find((m) => m.id === where.id)!, data),
    },
    decision: {
      findMany: async ({ where }: { where: { threadRootId: string } }) =>
        st.decisions.filter((d) => d.threadRootId === where.threadRootId && (d.edited || d.status !== 'DETECTED')),
      deleteMany: async ({ where }: { where: { threadRootId: string } }) => {
        st.decisions = st.decisions.filter((d) => !(d.threadRootId === where.threadRootId && d.status === 'DETECTED' && !d.edited));
        return { count: 0 };
      },
      create: async ({ data }: { data: Row }) => { const d = { id: `d${st.decisions.length + 1}`, status: 'DETECTED', edited: false, ...data }; st.decisions.push(d); return { id: d.id }; },
    },
  },
}));
vi.mock('../insights/llm', () => ({
  askStructured: (...a: unknown[]) => st.ai(...a),
  InsightsRefusedError: class extends Error {},
}));

import { extractDecisions } from './extract';
import { threadHash } from '../clickup/sync';

const msg = (id: string, parentId: string | null, content: string, at: string, userName = 'Ana Souza') =>
  ({ id, parentId, channelId: 'ch1', content, title: null, userName, userId: '1', postedAt: new Date(at), extractedHash: null as string | null });

beforeEach(() => {
  st.queries = 0;
  st.ai.mockReset();
  st.messages = [
    msg('root1', null, '[PROJETO] ALINHAMENTO', '2026-11-20T13:00:00Z'),
    msg('r1a', 'root1', 'Fechado: a partir de segunda o 6 potes do NeuroRecall passa pra $294 na JVZoo.', '2026-11-20T14:00:00Z'),
    msg('root2', null, 'AUSÊNCIA [24/11]', '2026-11-21T13:00:00Z'),
    msg('r2a', 'root2', 'ok', '2026-11-21T13:05:00Z'),
  ];
  // root2 já lido e sem mudança: não volta pra IA.
  const root2 = st.messages.find((m) => m.id === 'root2')!;
  root2.extractedHash = threadHash({ id: 'root2', content: root2.content as string }, [{ id: 'r2a', content: 'ok' }]);
  // Decisão revisada da mesma thread (origem r1a): a revisão vence.
  st.decisions = [{ id: 'old', threadRootId: 'root1', status: 'CONFIRMED', edited: false, sourceMessageIds: ['r0'] }];
});

describe('extração de decisões', () => {
  it('lê só a thread mexida, filtra id inventado e escopo fora da lista, e guarda a impressão', async () => {
    st.ai.mockResolvedValue({
      data: {
        decisions: [{
          title: 'Subir preço do NeuroRecall 6 potes', summary: 'De $198 pra $294 a partir de segunda.',
          decided_at: '2026-11-20', decided_by: 'Ana Souza', source_message_ids: ['r1a', 'inventado'],
          metrics: [{ metric: 'aov', expected: 'subir' }, { metric: 'pedidos', expected: 'cair' }],
          scope: { platforms: ['jvzoo', 'shopee'], families: ['neurorecall', 'Inexistente'], note: null },
          confidence: 'alta',
        }],
      },
      model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 1,
    });
    const r = await extractDecisions({ maxCalls: 5 });
    expect(st.ai).toHaveBeenCalledTimes(1);
    const prompt = (st.ai.mock.calls[0][0] as { user: string }).user;
    expect(prompt).toContain('[id r1a] 2026-11-20 11:00 — Ana Souza');
    expect(prompt).toContain('Famílias de produto: GlycoEden, NeuroRecall'); // sem o resíduo "UP3 - Combo"
    expect(r).toMatchObject({ read: 1, unchanged: 1, decisions: 1 });
    const created = st.decisions.find((d) => d.id !== 'old')!;
    expect(created).toMatchObject({
      threadRootId: 'root1', sourceMessageIds: ['r1a'],
      scope: { platforms: ['jvzoo'], families: ['NeuroRecall'], note: null },
      metrics: [{ metric: 'aov', expected: 'subir' }, { metric: 'pedidos', expected: 'cair' }],
    });
    expect((created.decidedAt as Date).toISOString()).toBe('2026-11-20T15:00:00.000Z');
    expect(st.decisions.find((d) => d.id === 'old')).toBeTruthy(); // revisada fica
    expect(st.messages.find((m) => m.id === 'root1')!.extractedHash).toBeTruthy();
  });

  it('decisão nova com a mesma origem de uma revisada não duplica', async () => {
    st.decisions = [{ id: 'old', threadRootId: 'root1', status: 'CONFIRMED', edited: true, sourceMessageIds: ['r1a'] }];
    st.ai.mockResolvedValue({
      data: { decisions: [{ title: 'X', summary: 'Y', decided_at: '2026-11-20', decided_by: null, source_message_ids: ['r1a'], metrics: [], scope: { platforms: [], families: [], note: null }, confidence: 'media' }] },
      model: 'm', inputTokens: 1, outputTokens: 1,
    });
    const r = await extractDecisions({ maxCalls: 5 });
    expect(r.decisions).toBe(0);
    expect(st.decisions.map((d) => d.id)).toEqual(['old']);
  });

  it('falha passageira da IA para a rodada sem marcar a thread', async () => {
    st.ai.mockRejectedValue(new Error('overloaded'));
    const r = await extractDecisions({ maxCalls: 5 });
    expect(r.errors).toHaveLength(1);
    expect(st.messages.find((m) => m.id === 'root1')!.extractedHash).toBeNull();
  });
});
