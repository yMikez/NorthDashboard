import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { TurnResult } from './chatEngine';
import {
  buildTurnLogData,
  diffDigests,
  digestResult,
  feedbackByDaySql,
  mergeDays,
  parseFeedbackInput,
  parseFeedbackPatch,
  promptVersionStatsSql,
  qualityTotalsSql,
  resultHash,
  scrubToolInput,
  toolStatsSql,
  turnsByDaySql,
  uiRangeFromTurnContext,
} from './chatTelemetry';
import { usageCostUsd } from './chatPricing';
import { migratedPglite } from '../test/pgliteDb';

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});

const overviewValue = { range: { start: '2026-08-01', end: '2026-08-31' }, kpis: { gross: 154318.42, approvalRate: 0.912 }, daily: [{ date: '2026-08-01', gross: 5000 }, { date: '2026-08-02', gross: 5100 }] };
const ordersValue = { orders: [{ externalId: 'A1', email: 'cliente@x.com', grossAmountUsd: 99 }], total: 350, page: { hasMore: true } };

function fakeTurn(): TurnResult {
  return {
    text: 'Resposta',
    blocks: [{ type: 'summary', kpis: [] }],
    citations: [],
    toolUses: [],
    rounds: [
      {
        round: 0,
        model: 'claude-opus-5',
        stopReason: 'tool_use',
        modelMs: 900,
        ttftMs: 300,
        usage: usage(2_000, 400, 30_000, 5_000),
        tools: [
          { name: 'get_overview', id: 't1', input: { start_date: '2026-08-01', end_date: '2026-08-31' }, ms: 120, bytes: 500, ref: 'r1' },
          { name: 'get_affiliates', id: 't2', input: { platforms: ['xx'] }, ms: 30, bytes: 80, error: 'invalid_input' },
          { name: 'get_orders', id: 't3', input: { search: 'cliente@x.com', email: 'a@b.com', status: 'REFUNDED' }, ms: 200, bytes: 9_000, truncated: true, ref: 'r2' },
          { name: 'respond_with_blocks', id: 't4', input: { guard: 'same_round' }, ms: 0, bytes: 0, error: 'terminal_with_data' },
        ],
      },
      {
        round: 1,
        model: 'claude-opus-5',
        stopReason: 'tool_use',
        modelMs: 1_200,
        ttftMs: null,
        usage: usage(500, 800, 35_000, 0),
        tools: [],
      },
    ],
    status: 'ok',
    forcedFinal: false,
    truncatedResults: 1,
    contextCharsPeak: 88_000,
    latencyMs: 4_321,
    ttftMs: 300,
    ungrounded: ['$ 12.345'],
    raw: [
      { name: 'get_overview', input: {}, value: overviewValue },
      { name: 'get_affiliates', input: {}, value: { error: 'invalid_input', message: 'plataforma xx' } },
      { name: 'get_orders', input: {}, value: ordersValue },
    ],
  };
}

const META = { messageId: 'm1', conversationId: 'c1', userId: 'u1', model: 'claude-opus-5', effort: 'high' };
const VERSIONS = { promptVersion: 'abc123def456', knowledgeHash: 'k1' };

describe('buildTurnLogData — agregação do TurnResult', () => {
  it('soma tokens/custo das rodadas e conta tools, erros e tempo de parede', () => {
    const d = buildTurnLogData(fakeTurn(), META, VERSIONS);
    expect(d.rounds).toBe(2);
    expect(d.inputTokens).toBe(2_500);
    expect(d.outputTokens).toBe(1_200);
    expect(d.cacheReadTokens).toBe(65_000);
    expect(d.cacheWriteTokens).toBe(5_000);
    const cost = usageCostUsd('claude-opus-5', usage(2_000, 400, 30_000, 5_000))! + usageCostUsd('claude-opus-5', usage(500, 800, 35_000, 0))!;
    expect(d.costUsd).toBeCloseTo(cost, 6);
    // 4 entradas no trace (3 consultas + terminal barrada) + a terminal entregue
    expect(d.toolCalls).toBe(5);
    expect(d.toolErrors).toBe(2);
    // paralelas na mesma rodada: conta a mais lenta, não a soma
    expect(d.toolMs).toBe(200);
    expect(d.usedBlocks).toBe(true);
    expect(d.ungroundedNumbers).toBe(1);
    expect(d.truncatedResults).toBe(1);
    expect(d).toMatchObject({ status: 'ok', ttftMs: 300, latencyMs: 4_321, contextCharsPeak: 88_000, promptVersion: 'abc123def456', knowledgeHash: 'k1', evalRunId: null });
  });

  it('trace sem resultado bruto e sem PII, com digest+hash quando há o valor', () => {
    const d = buildTurnLogData(fakeTurn(), META, VERSIONS);
    const [ov, aff, orders, guard] = d.trace[0].tools;
    expect(ov.hash).toBe(resultHash(overviewValue));
    expect(ov.digest).toMatchObject({ kpis: { gross: 154318.42 }, daily: { _len: 2 } });
    expect(aff.digest).toBeUndefined(); // erro: nada a resumir
    expect(orders.input).toEqual({ search: '[email]', status: 'REFUNDED' });
    expect(JSON.stringify(orders.digest)).not.toContain('cliente@x.com');
    expect(orders.truncated).toBe(true);
    expect(guard.digest).toBeUndefined();
    expect(JSON.stringify(d.trace)).not.toContain('"value"');
  });

  it('sem raw, usa o ResultStore do turno (ref → valor)', () => {
    const turn = fakeTurn();
    delete turn.raw;
    const results = { all: () => [{ ref: 'r1', value: overviewValue }] };
    const d = buildTurnLogData(turn, { ...META, results }, VERSIONS);
    expect(d.trace[0].tools[0].hash).toBe(resultHash(overviewValue));
    expect(d.trace[0].tools[2].hash).toBeUndefined();
  });

  it('turno com erro de API mascara o texto do erro e zera custo desconhecido', () => {
    const turn = { ...fakeTurn(), status: 'error' as const, error: 'falhou pra joao@x.com' };
    turn.rounds = [{ ...turn.rounds[0], model: 'modelo-sem-preco' }];
    const d = buildTurnLogData(turn, { ...META, model: 'modelo-sem-preco' }, VERSIONS);
    expect(d.error).toBe('falhou pra [email]');
    expect(d.costUsd).toBeNull();
  });
});

describe('scrub / digest / diff', () => {
  it('texto livre vira só o tamanho; PII sai; datas e IDs ficam', () => {
    const out = scrubToolInput({ queries: ['como calcula margem'], external_id: '1234567890', start_date: '2026-08-01', customer: { name: 'X' }, phone: '+55 11 99999-0000' });
    expect(out).toEqual({ queries: { _omitido: 'texto', chars: 23 }, external_id: '1234567890', start_date: '2026-08-01' });
    expect(scrubToolInput({ _truncatedInput: '{"a":' })).toEqual({ _omitido: 'input grande demais', chars: 5 });
  });

  it('digest fica ≤ 8 KB mesmo com objeto enorme', () => {
    const big = Object.fromEntries(Array.from({ length: 3_000 }, (_, i) => [`k${i}`, i]));
    expect(JSON.stringify(digestResult(big)).length).toBeLessThanOrEqual(8_300);
  });

  it('diff mostra só o que mudou, maiores variações primeiro', () => {
    const changes = diffDigests({ kpis: { gross: 100, net: 50, orders: 10 } }, { kpis: { gross: 110, net: 50, orders: 12 } });
    expect(changes.map((c) => c.path)).toEqual(['kpis.orders', 'kpis.gross']);
    expect(changes[0].deltaPct).toBe(20);
  });
});

describe('feedback', () => {
  it('valida rating, motivos e limpa motivo de 👍', () => {
    expect(parseFeedbackInput({ rating: 0 })).toMatchObject({ ok: false });
    expect(parseFeedbackInput({ rating: -1, reasons: ['inventou', 'xpto'] })).toMatchObject({ ok: false });
    const down = parseFeedbackInput({ rating: -1, reasons: ['numero_errado', 'numero_errado'], comment: '  errado ', expected: 'o certo era $ 12.345' });
    expect(down).toEqual({ ok: true, value: { rating: -1, reasons: ['numero_errado'], comment: 'errado', expected: 'o certo era $ 12.345', shared: true } });
    const up = parseFeedbackInput({ rating: 1, reasons: ['lento'], expected: 'x', shared: false });
    expect(up).toEqual({ ok: true, value: { rating: 1, reasons: [], comment: null, expected: null, shared: false } });
    expect(parseFeedbackInput({ rating: 1, comment: 'x'.repeat(2_001) })).toMatchObject({ ok: false });
  });

  it('patch do admin exige algo válido', () => {
    expect(parseFeedbackPatch({})).toMatchObject({ ok: false });
    expect(parseFeedbackPatch({ status: 'resolvido' })).toMatchObject({ ok: false });
    expect(parseFeedbackPatch({ status: 'fixed', adminNote: null })).toEqual({ ok: true, value: { status: 'fixed', adminNote: null } });
  });

  it('extrai o intervalo da tela do contexto do turno (base do replay)', () => {
    const ctx = '<contexto_do_turno>\nAgora em BRT: 2026-09-30 10:00 (data: 2026-09-30).\n# Estado da UI (o que o usuário está vendo agora)\naba: overview · intervalo: 2026-09-01 → 2026-09-07\n</contexto_do_turno>';
    expect(uiRangeFromTurnContext(ctx)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-07' });
    expect(uiRangeFromTurnContext(null)).toBeNull();
  });

  it('mergeDays junta dias só com voto e dias só com turno', () => {
    expect(mergeDays([{ day: '2026-09-02', turns: 3, costUsd: 0.5 }], [{ day: '2026-09-01', up: 1, down: 2 }])).toEqual([
      { day: '2026-09-01', turns: 0, costUsd: 0, thumbsUp: 1, thumbsDown: 2 },
      { day: '2026-09-02', turns: 3, costUsd: 0.5, thumbsUp: 0, thumbsDown: 0 },
    ]);
  });
});

// ── SQL do painel contra Postgres de verdade (PGlite com as migrações) ──

async function query<T>(db: Awaited<ReturnType<typeof migratedPglite>>, sql: Prisma.Sql): Promise<T[]> {
  const r = await db.query<T>(sql.text, sql.values as unknown[]);
  return r.rows;
}

describe('agregados do painel (SQL)', () => {
  it('totais, percentis, cache, tools e dia BRT — turnos do eval fora', async () => {
    const db = await migratedPglite();
    await db.exec(`
      INSERT INTO "User" ("id","email","passwordHash") VALUES ('u1','a@x.com','h');
      INSERT INTO "Conversation" ("id","userId","updatedAt") VALUES ('c1','u1',now());
      INSERT INTO "Message" ("id","conversationId","role","content") VALUES ('m1','c1','assistant','a'),('m2','c1','assistant','b');
    `);
    const trace = (tools: unknown[], round0: { input: number; read: number; write: number }) =>
      JSON.stringify([{ round: 0, usage: { input_tokens: round0.input, cache_read_input_tokens: round0.read, cache_creation_input_tokens: round0.write, output_tokens: 1 }, tools }]);
    const insert = (id: string, createdAt: string, o: { latency: number; ttft: number | null; cost: number; input: number; read: number; write: number; toolCalls: number; toolErrors: number; truncated: number; forced: boolean; ungrounded: number; messageId: string | null; evalRunId: string | null; tools: unknown[] }) =>
      db.query(
        `INSERT INTO "ChatTurnLog" ("id","messageId","evalRunId","createdAt","model","effort","promptVersion","status","rounds","toolCalls","toolErrors","truncatedResults","forcedFinal","ungroundedNumbers","inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens","costUsd","ttftMs","latencyMs","trace")
         VALUES ($1,$2,$3,$4,'claude-opus-5','high','pv1','ok',1,$5,$6,$7,$8,$9,$10,10,$11,$12,$13,$14,$15,$16::jsonb)`,
        [id, o.messageId, o.evalRunId, createdAt, o.toolCalls, o.toolErrors, o.truncated, o.forced, o.ungrounded, o.input, o.read, o.write, o.cost, o.ttft, o.latency, trace(o.tools, o)],
      );
    await insert('t1', '2026-09-10T02:00:00Z', { latency: 1_000, ttft: 200, cost: 0.1, input: 100, read: 800, write: 100, toolCalls: 2, toolErrors: 1, truncated: 1, forced: false, ungrounded: 0, messageId: 'm1', evalRunId: null, tools: [{ name: 'get_overview', ms: 100, bytes: 1_000 }, { name: 'get_orders', ms: 300, bytes: 3_000, error: 'invalid_input' }] });
    await insert('t2', '2026-09-10T15:00:00Z', { latency: 3_000, ttft: 400, cost: 0.3, input: 100, read: 0, write: 900, toolCalls: 2, toolErrors: 0, truncated: 0, forced: true, ungrounded: 2, messageId: 'm2', evalRunId: null, tools: [{ name: 'get_overview', ms: 200, bytes: 2_000 }] });
    await insert('t3', '2026-09-10T15:00:00Z', { latency: 99_000, ttft: 9_000, cost: 9, input: 1, read: 1, write: 1, toolCalls: 9, toolErrors: 9, truncated: 9, forced: true, ungrounded: 9, messageId: null, evalRunId: 'run1', tools: [{ name: 'get_health', ms: 1, bytes: 1 }] });
    await db.query(`INSERT INTO "ChatFeedback" ("id","messageId","userId","rating","reasons","createdAt","updatedAt") VALUES ('f1','m1','u1',-1,'{inventou}','2026-09-10T02:30:00Z',now()),('f2','m2','u1',1,'{}','2026-09-10T16:00:00Z',now())`);

    const since = new Date('2026-09-01T00:00:00Z');
    const [t] = await query<Record<string, number>>(db, qualityTotalsSql(since));
    expect(t.turns).toBe(2);
    expect(t.latencyP50).toBe(2_000);
    expect(t.latencyP95).toBeCloseTo(2_900, 6);
    expect(t.ttftP50).toBe(300);
    expect(t.costUsd).toBeCloseTo(0.4, 9);
    expect(t.cacheHitRatio).toBeCloseTo(800 / 2_000, 9);
    expect(t.cacheHitRatioFirstRound).toBeCloseTo(800 / 2_000, 9);
    expect(t.truncatedPct).toBe(50);
    expect(t.forcedFinalPct).toBe(50);
    expect(t.toolErrorRate).toBeCloseTo(0.25, 9);
    expect(t.ungroundedPct).toBe(50);

    const tools = await query<{ name: string; calls: number; errors: number; avgBytes: number; avgMs: number }>(db, toolStatsSql(since));
    expect(tools).toEqual([
      { name: 'get_overview', calls: 2, errors: 0, avgBytes: 1_500, avgMs: 150 },
      { name: 'get_orders', calls: 1, errors: 1, avgBytes: 3_000, avgMs: 300 },
    ]);

    // 02:00Z = 23:00 BRT do dia anterior
    const days = await query<{ day: string; turns: number; costUsd: number }>(db, turnsByDaySql(since));
    expect(days.map((d) => [d.day, d.turns])).toEqual([['2026-09-09', 1], ['2026-09-10', 1]]);
    const votes = await query<{ day: string; up: number; down: number }>(db, feedbackByDaySql(since));
    expect(votes).toEqual([{ day: '2026-09-09', up: 0, down: 1 }, { day: '2026-09-10', up: 1, down: 0 }]);

    const pv = await query<{ promptVersion: string; turns: number; thumbsDown: number }>(db, promptVersionStatsSql(since));
    expect(pv).toMatchObject([{ promptVersion: 'pv1', turns: 2, thumbsDown: 1 }]);
  }, 60_000);
});
