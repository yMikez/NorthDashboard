import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  EvalWindowError,
  assertSafeWindow,
  normalizeEvalConfig,
  resolveLens,
  resolveUi,
  runEvalCase,
  selectCases,
  servedMatches,
  skipReason,
  type EvalConfig,
} from './chatEval';
import { GOLDEN_CASES } from '../chat/eval/goldens';
import type { GoldenCase } from '../chat/eval/spec';

const NOW = new Date('2026-09-30T17:00:00Z'); // 14:00 BRT

describe('normalizeEvalConfig', () => {
  it('aplica defaults e valida faixas', () => {
    const ok = normalizeEvalConfig({ model: 'claude-opus-5-5', effort: 'medium', cases: ['G01', 'G01'], reps: 3 });
    expect(ok).toMatchObject({ ok: true, value: { model: 'claude-opus-5-5', effort: 'medium', cases: ['G01'], reps: 3, knowledge: 'on', concurrency: 2, role: 'ADMIN' } });
    expect(normalizeEvalConfig({ model: 'gpt-4' })).toMatchObject({ ok: false });
    expect(normalizeEvalConfig({ model: 42 as unknown as string })).toMatchObject({ ok: false });
    expect(normalizeEvalConfig({ effort: 'turbo' as never })).toMatchObject({ ok: false });
    expect(normalizeEvalConfig({ reps: 9 })).toMatchObject({ ok: false });
    expect(normalizeEvalConfig({ cases: 'G01' as unknown as string[] })).toMatchObject({ ok: false });
    expect(normalizeEvalConfig({ knowledge: 'talvez' as never })).toMatchObject({ ok: false });
  });
});

describe('guardas', () => {
  it('modelo servido: mesmo id ou id + data', () => {
    expect(servedMatches('claude-opus-5', 'claude-opus-5')).toBe(true);
    expect(servedMatches('claude-haiku-4-5', 'claude-haiku-4-5-20251001')).toBe(true);
    expect(servedMatches('claude-opus-5', 'claude-opus-5-5')).toBe(false);
  });

  it('não roda perto da meia-noite BRT', () => {
    expect(() => assertSafeWindow(new Date('2026-10-01T02:55:00Z'))).toThrow(EvalWindowError); // 23:55 BRT
    expect(() => assertSafeWindow(new Date('2026-10-01T03:05:00Z'))).toThrow(EvalWindowError); // 00:05 BRT
    expect(() => assertSafeWindow(NOW)).not.toThrow();
  });

  it('pula caso sem a tool no catálogo, admin-only pra membro e anexo', () => {
    const rag = GOLDEN_CASES.find((c) => c.id === 'G33')!;
    expect(skipReason(rag, { role: 'ADMIN' }, new Set(['get_overview']))).toContain('search_knowledge');
    expect(skipReason(rag, { role: 'ADMIN' }, new Set(['search_knowledge']))).toBeNull();
    const admin: GoldenCase = { id: 'X1', category: 'lente', turns: ['?'], requires: { admin: true } };
    expect(skipReason(admin, { role: 'MEMBER' }, new Set())).toBe('exige perfil ADMIN');
    expect(skipReason({ ...admin, requires: undefined, attachments: ['fixture.csv'] }, { role: 'ADMIN' }, new Set())).toContain('anexo');
  });

  it('seleção por id e categoria acusa id desconhecido', () => {
    const { selected, unknown } = selectCases(GOLDEN_CASES, { cases: ['G01', 'G13', 'NAO'], categories: [] });
    expect(selected.map((c) => c.id)).toEqual(['G01', 'G13']);
    expect(unknown).toEqual(['NAO']);
    expect(selectCases(GOLDEN_CASES, { cases: [], categories: ['indisponivel'] }).selected.every((c) => c.category === 'indisponivel')).toBe(true);
  });
});

describe('estado da UI como a SPA manda', () => {
  it('preset BRT vira instantes exatos e o bloco de texto do turno', () => {
    const ui = resolveUi({ route: 'overview', preset: 'yesterday', families: ['GlycoPulse'] }, NOW);
    expect(ui.state).toMatchObject({ preset: 'yesterday', startDate: '2026-09-29', endDate: '2026-09-29', startAt: '2026-09-29T03:00:00.000Z', endAt: '2026-09-30T02:59:59.999Z' });
    expect(ui.defaults.defaultStart?.toISOString()).toBe('2026-09-29T03:00:00.000Z');
    expect(ui.text).toBe('\n# Estado da UI (o que o usuário está vendo agora)\naba: overview · período selecionado: yesterday · intervalo: 2026-09-29 → 2026-09-29 · famílias: GlycoPulse');
  });

  it('período personalizado segue a SPA (dia UTC)', () => {
    const ui = resolveUi({ from: '$d-7', to: '$yesterday' }, NOW);
    expect(ui.state).toMatchObject({ preset: 'custom', startAt: '2026-09-23T00:00:00.000Z', endAt: '2026-09-29T23:59:59.999Z' });
  });

  it('sem UI: sem bloco e sem default', () => {
    expect(resolveUi(undefined, NOW)).toEqual({ state: undefined, text: '', defaults: {} });
  });
});

describe('resolveLens (cálculos sobre resultados)', () => {
  const exec = async (tool: string, args: Record<string, unknown>) =>
    tool === 'get_overview'
      ? { kpis: { gross: args.start_date === '2026-09-29' ? 110 : 100 } }
      : { scopes: { all: { transitions: [{ volumeEffect: -50, aovEffect: 20 }] } } };
  const ov = (d: string) => ({ tool: 'get_overview', args: { start_date: d, end_date: d }, path: 'kpis.gross' });

  it('pct_change em pontos percentuais', async () => {
    const r = await resolveLens({ name: 'x', calc: { op: 'pct_change', inputs: [ov('$yesterday'), ov('$d-2')] } }, exec, NOW);
    expect(r.items[0][0]).toBeCloseTo(10, 9);
  });

  it('dominant devolve as palavras do rótulo vencedor (e as dos perdedores)', async () => {
    const seq = (p: string) => ({ tool: 'get_funnel_sequence', args: {}, path: p });
    const r = await resolveLens(
      { name: 'x', calc: { op: 'dominant', inputs: [seq('scopes.all.transitions[-1].volumeEffect'), seq('scopes.all.transitions[-1].aovEffect')], labels: ['volume|sessões', 'AOV|ticket'] } },
      exec,
      NOW,
    );
    expect(r).toEqual({ items: [['volume', 'sessões']], list: false, rivals: ['AOV', 'ticket'] });
  });

  it('erro da tool vira erro da lente (não valor zero)', async () => {
    await expect(resolveLens({ name: 'x', source: { tool: 'get_overview', path: 'kpis.gross' } }, async () => ({ error: 'invalid_input', message: 'família' }), NOW)).rejects.toThrow('invalid_input');
  });
});

// ── Caminho completo do turno com um cliente falso (sem API, sem banco) ──

function fakeClient(answers: string[]) {
  const calls: Anthropic.MessageParam[][] = [];
  const client = {
    messages: {
      stream(params: { messages: Anthropic.MessageParam[] }) {
        calls.push(JSON.parse(JSON.stringify(params.messages)));
        const text = answers[calls.length - 1] ?? 'ok';
        const events = [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
          { type: 'content_block_stop', index: 0 },
        ];
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of events) yield e;
          },
          finalMessage: async () => ({
            model: 'claude-opus-5',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text }],
            usage: { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 5_000, cache_creation_input_tokens: 0 },
          }),
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const CONFIG: EvalConfig = { model: 'claude-opus-5', effort: 'high', cases: [], categories: [], reps: 1, knowledge: 'off', concurrency: 1, maxUsd: 1, role: 'ADMIN' };
const USER = { id: 'eval', role: 'ADMIN', allowedTabs: [] };

describe('runEvalCase — mesmo caminho da rota', () => {
  it('multiturno: 2º turno leva a 1ª resposta + contexto do turno; só a última é avaliada', async () => {
    const spec: GoldenCase = {
      id: 'T1',
      category: 'multiturno',
      ui: { preset: 'yesterday', families: ['GlycoPulse'] },
      turns: ['Primeira pergunta?', 'E a segunda?'],
      mention: ['segunda resposta'],
    };
    const { client, calls } = fakeClient(['primeira resposta', 'segunda resposta']);
    const out = await runEvalCase(spec, 0, { client, config: CONFIG, knowledgeBlock: '', user: USER, runTag: 'test' });
    expect(calls).toHaveLength(2);
    const second = JSON.stringify(calls[1]);
    expect(second).toContain('Primeira pergunta?');
    expect(second).toContain('primeira resposta');
    expect(second).toContain('<contexto_do_turno>');
    expect(second).toContain('famílias: GlycoPulse');
    expect(out.record.status).toBe('pass');
    expect(out.answer).toBe('segunda resposta');
    // 2 turnos × (1.000×$5 + 100×$25 + 5.000×$0,50) / 1M
    expect(out.usage.costUsd).toBeCloseTo((2 * (1_000 * 5 + 100 * 25 + 5_000 * 0.5)) / 1_000_000, 9);
    expect(out.usage.rounds).toBe(2);
  });

  it('modelo servido diferente do pedido = erro de infra, não nota', async () => {
    const { client } = fakeClient(['x']);
    const out = await runEvalCase({ id: 'T2', category: 'definicao', turns: ['?'] }, 0, { client, config: { ...CONFIG, model: 'claude-opus-5-5' }, knowledgeBlock: '', user: USER, runTag: 'test' });
    expect(out.record.status).toBe('error');
    expect(out.record.error).toContain('claude-opus-5');
  });
});
