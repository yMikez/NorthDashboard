// Testes do núcleo puro do painel admin da IA (formatação, erros PT-BR,
// normalização das respostas das APIs) e do cliente adminFetch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiErrorMessage,
  canPin,
  docManagedElsewhere,
  evalConfigText,
  evalPassRate,
  evalSummaryView,
  feedbackAnswer,
  fmtRateCi,
  pageRange,
  fmtBytes,
  fmtDateTime,
  fmtDay,
  fmtDayShort,
  fmtFraction,
  fmtInt,
  fmtMs,
  fmtPct,
  fmtUsd,
  isActiveEntry,
  isoToDateInput,
  listChangedEnough,
  matchesText,
  meterState,
  normalizeAnswer,
  normalizeChecks,
  pageWindow,
  parseCaseList,
  passRateFromResults,
  projectedPinnedChars,
  qualityCards,
  rankCells,
  safeBlocks,
  summarizeSeedResult,
  summarizeTrace,
  titleFromFileName,
  type QualitySummary,
} from './adminCore';
import { AdminApiError, adminFetch } from './adminApi';

describe('formatação (padrão americano)', () => {
  it('dinheiro, inteiro e "—" quando falta', () => {
    expect(fmtUsd(1234.5)).toBe('$1,234.50');
    expect(fmtUsd(0)).toBe('$0.00');
    expect(fmtUsd(0.001)).toBe('<$0.01');
    expect(fmtUsd(null)).toBe('—');
    expect(fmtUsd(Number.NaN)).toBe('—');
    expect(fmtInt(12345.6)).toBe('12,346');
    expect(fmtInt(undefined)).toBe('—');
  });

  it('pontos percentuais x fração — sem heurística ≤ 1', () => {
    expect(fmtPct(12.34)).toBe('12.3%');
    expect(fmtPct(0.45)).toBe('0.45%');
    // 0.8 pp é 0.8%, nunca 80%.
    expect(fmtPct(0.8)).toBe('0.80%');
    expect(fmtPct(0)).toBe('0%');
    expect(fmtFraction(0.123)).toBe('12.3%');
    expect(fmtFraction(0.008)).toBe('0.80%');
    expect(fmtFraction(null)).toBe('—');
  });

  it('tempo e tamanho', () => {
    expect(fmtMs(850)).toBe('850 ms');
    expect(fmtMs(12_400)).toBe('12.4 s');
    expect(fmtMs(90_000)).toBe('1.5 min');
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(25 * 1024 * 1024)).toBe('25.0 MB');
  });

  it('dia civil lido em UTC (não volta um dia no fuso BRT)', () => {
    expect(fmtDay('2026-09-29')).toBe('Sep 29, 2026');
    expect(fmtDayShort('2026-09-01')).toBe('Sep 01');
    expect(fmtDay('2026-09-29T02:00:00.000Z')).toBe('Sep 29, 2026');
    expect(fmtDay('lixo')).toBe('—');
    expect(fmtDateTime('2026-09-29T14:05:00.000Z', 'UTC')).toBe('Sep 29, 2026, 14:05');
    expect(isoToDateInput('2026-09-23T00:00:00.000Z')).toBe('2026-09-23');
    expect(isoToDateInput(null)).toBe('');
  });
});

describe('apiErrorMessage', () => {
  it('status vira orientação em PT-BR; detalhe do servidor entre parênteses', () => {
    expect(apiErrorMessage(401, { error: 'unauthorized' })).toBe('Sessão expirada. Entre de novo para continuar.');
    expect(apiErrorMessage(403)).toBe('Acesso restrito a administradores.');
    expect(apiErrorMessage(400, { error: 'title required' })).toBe('Pedido recusado pelo servidor. (title required)');
    expect(apiErrorMessage(0)).toMatch(/Sem conexão/);
    expect(apiErrorMessage(503)).toBe('Erro no servidor (503). Tente de novo em instantes.');
    expect(apiErrorMessage(409, { message: 'run in progress' })).toBe('Conflito com o estado atual. (run in progress)');
    expect(apiErrorMessage(418)).toBe('Falha na requisição (418).');
  });

  it('detalhe longo é cortado', () => {
    const msg = apiErrorMessage(500, { error: 'x'.repeat(500) });
    expect(msg.length).toBeLessThan(260);
    expect(msg.endsWith('…)')).toBe(true);
  });
});

describe('paginação', () => {
  it('janela com reticências igual à da SPA', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(5, 48)).toEqual([1, 'gap-l', 4, 5, 6, 'gap-r', 48]);
    expect(pageWindow(1, 10)).toEqual([1, 2, 'gap-r', 10]);
    expect(pageWindow(10, 10)).toEqual([1, 'gap-l', 9, 10]);
  });

  it('fila que perde um item fica na página; filtro novo volta pro início', () => {
    const before = Array.from({ length: 30 }, (_, i) => `k${i}`);
    expect(listChangedEnough(before, before.slice(1))).toBe(false);
    expect(listChangedEnough(before, ['a', 'b', 'c'])).toBe(true);
  });
});

describe('bloco fixo', () => {
  it('medidor: ok, aviso a partir de 85%, acima do teto', () => {
    expect(meterState(50, 100)).toEqual({ ratio: 0.5, level: 'ok' });
    expect(meterState(85, 100).level).toBe('warn');
    expect(meterState(120, 100).level).toBe('over');
    expect(meterState(10, 0)).toEqual({ ratio: null, level: 'unknown' });
    expect(meterState(null, 100).level).toBe('unknown');
  });

  it('projeção troca a contribuição antiga pela nova', () => {
    // Entrada fixa ativa de 100 → 300 caracteres.
    expect(projectedPinnedChars(1000, { pinned: true, enabled: true, chars: 100 }, { pinned: true, enabled: true, chars: 300 })).toBe(1200);
    // Deixou de ser fixa: sai do bloco.
    expect(projectedPinnedChars(1000, { pinned: true, enabled: true, chars: 100 }, { pinned: false, enabled: true, chars: 100 })).toBe(900);
    // Nova, desligada: não conta.
    expect(projectedPinnedChars(1000, null, { pinned: true, enabled: false, chars: 500 })).toBe(1000);
  });

  it('memória aprovada nunca é fixável; linha sem status conta como ativa', () => {
    expect(canPin({ source: 'auto' })).toBe(false);
    expect(canPin({ source: 'manual' })).toBe(true);
    expect(isActiveEntry({ status: undefined })).toBe(true);
    expect(isActiveEntry({ status: 'pending' })).toBe(false);
  });

  it('espelhos de outras abas não são excluídos pela aba Documentos', () => {
    expect(docManagedElsewhere('knowledge_entry')).toBe('fixas');
    expect(docManagedElsewhere('chat_memory')).toBe('memorias');
    expect(docManagedElsewhere('upload')).toBeNull();
  });
});

describe('rankCells', () => {
  it('seis ranqueadores do contrato sempre presentes, na ordem, com aliases', () => {
    const cells = rankCells({ pt_or: 3, simple: null, trgm: 1, rrf: 0.03125, rerank: 3, extra: 2 });
    expect(cells.map((c) => c.key)).toEqual(['pt', 'simple', 'trigram', 'dense', 'rrf', 'rerank', 'extra']);
    const byKey = Object.fromEntries(cells.map((c) => [c.key, c]));
    expect(byKey.pt.value).toBe('#3');
    expect(byKey.simple).toMatchObject({ value: '—', present: false });
    expect(byKey.trigram.value).toBe('#1');
    expect(byKey.dense.present).toBe(false);
    expect(byKey.rrf.value).toBe('0.0313');
    expect(byKey.rerank.value).toBe('3/3');
    expect(byKey.extra.value).toBe('#2');
  });

  it('allTerms só aparece quando vem; nota não inteira ganha casas', () => {
    expect(rankCells({ allTerms: true }).find((c) => c.key === 'allTerms')?.value).toBe('sim');
    expect(rankCells({}).some((c) => c.key === 'allTerms')).toBe(false);
    expect(rankCells({ pt: 0.4567 }).find((c) => c.key === 'pt')?.value).toBe('0.457');
    expect(rankCells({ rerank: 2.5 }).find((c) => c.key === 'rerank')?.value).toBe('2.50');
    expect(rankCells(null)).toHaveLength(6);
  });
});

describe('qualityCards', () => {
  const base: QualitySummary = {
    turns: 200,
    thumbsUp: 30,
    thumbsDown: 10,
    latencyP50: 8200,
    latencyP95: 31_000,
    ttftP50: 1400,
    costUsd: 48.2,
    cacheHitRatio: 0.62,
    truncatedPct: 1.5,
    forcedFinalPct: 0.5,
    toolErrorRate: 0.034,
    ungroundedPct: 2,
    byTool: [],
    byDay: [],
  };

  it('Pct em pontos percentuais, Rate/Ratio em fração', () => {
    const cards = Object.fromEntries(qualityCards(base).map((c) => [c.key, c]));
    expect(cards.turns.value).toBe('200');
    expect(cards.rating).toMatchObject({ value: '30 / 10', hint: '25.0% negativas' });
    expect(cards.latency).toMatchObject({ value: '8.2 s', hint: 'p95 31.0 s' });
    expect(cards.cost).toMatchObject({ value: '$48.20', hint: '$0.24 por turno', money: true });
    expect(cards.cache.value).toBe('62.0%');
    expect(cards.truncated.value).toBe('1.5%');
    expect(cards.forced.value).toBe('0.50%');
    expect(cards.toolErrors.value).toBe('3.4%');
    expect(cards.ungrounded.value).toBe('2.0%');
  });

  it('campo ausente vira "—", sem avaliação diz isso', () => {
    const cards = Object.fromEntries(
      qualityCards({ ...base, thumbsUp: 0, thumbsDown: 0, costUsd: null, cacheHitRatio: null }).map((c) => [c.key, c]),
    );
    expect(cards.rating.hint).toBe('Nenhuma avaliação no período');
    expect(cards.cost.value).toBe('—');
    expect(cards.cost.hint).toBeUndefined();
    expect(cards.cache.value).toBe('—');
  });
});

describe('normalizeAnswer / safeBlocks', () => {
  it('texto: tira os marcadores de citação', () => {
    expect(normalizeAnswer('Receita de $1,200 [[cite:1]] no mês [[cite:2]].')).toEqual({
      content: 'Receita de $1,200 no mês.',
      blocks: [],
    });
  });

  it('objeto: conteúdo + só blocos com a forma que o renderizador percorre', () => {
    const out = normalizeAnswer({
      content: 'Resumo',
      blocks: [
        { type: 'markdown', content: 'ok' },
        { type: 'table', columns: [], rows: [] },
        { type: 'table', columns: [] },
        { type: 'summary' },
        { type: 'desconhecido' },
        null,
      ],
    });
    expect(out.content).toBe('Resumo');
    expect(out.blocks.map((b) => b.type)).toEqual(['markdown', 'table']);
  });

  it('nada reconhecível → vazio', () => {
    expect(normalizeAnswer(null)).toEqual({ content: '', blocks: [] });
    expect(normalizeAnswer({ text: 'via text' }).content).toBe('via text');
    expect(safeBlocks('x')).toEqual([]);
  });
});

describe('summarizeTrace', () => {
  const rounds = [
    {
      round: 0,
      model: 'claude-opus-5',
      stopReason: 'tool_use',
      modelMs: 2000,
      ttftMs: 900,
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
      tools: [
        { name: 'get_overview', id: 't1', input: {}, ms: 320, bytes: 4096 },
        { name: 'get_orders', id: 't2', input: {}, ms: 900, bytes: 90_000, truncated: true },
      ],
    },
    {
      round: 1,
      model: 'claude-opus-5',
      stopReason: 'end_turn',
      modelMs: 3000,
      ttftMs: 700,
      usage: { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 },
      tools: [{ name: 'calc', id: 't3', input: {}, ms: 2, bytes: 80, error: 'invalid_input: expr' }],
    },
  ];

  it('lista de rodadas do motor', () => {
    const t = summarizeTrace(rounds)!;
    expect(t.model).toBe('claude-opus-5');
    expect(t.rounds).toBe(2);
    expect(t.ttftMs).toBe(900);
    expect(t.latencyMs).toBe(5000);
    expect(t.inputTokens).toBe(3000);
    expect(t.outputTokens).toBe(500);
    expect(t.cacheReadTokens).toBe(11_000);
    expect(t.tools.map((x) => [x.name, x.round, x.truncated, x.error])).toEqual([
      ['get_overview', 0, false, null],
      ['get_orders', 0, true, null],
      ['calc', 1, false, 'invalid_input: expr'],
    ]);
  });

  it('forma da rota de feedback: resumo do log com roundsTrace', () => {
    const t = summarizeTrace({
      turnLogId: 'l1',
      model: 'claude-opus-5',
      effort: 'high',
      promptVersion: 'abc123def456',
      status: 'ok',
      rounds: 2,
      toolCalls: 3,
      toolErrors: 1,
      truncatedResults: 1,
      ungroundedNumbers: 2,
      costUsd: 0.12,
      latencyMs: 9100,
      ttftMs: 1200,
      roundsTrace: rounds,
    })!;
    expect(t).toMatchObject({ promptVersion: 'abc123def456', toolCalls: 3, toolErrors: 1, ungrounded: 2, ttftMs: 1200 });
    expect(t.tools.map((x) => x.name)).toEqual(['get_overview', 'get_orders', 'calc']);
  });

  it('log do turno com a lista dentro: os escalares do log valem', () => {
    const t = summarizeTrace({
      model: 'claude-opus-5-5',
      effort: 'high',
      status: 'ok',
      rounds: 2,
      latencyMs: 7400,
      costUsd: 0.21,
      forcedFinal: true,
      truncatedResults: 1,
      ungroundedNumbers: 0,
      inputTokens: 3100,
      trace: rounds,
    })!;
    expect(t).toMatchObject({
      model: 'claude-opus-5-5',
      effort: 'high',
      status: 'ok',
      rounds: 2,
      latencyMs: 7400,
      costUsd: 0.21,
      forcedFinal: true,
      truncatedResults: 1,
      ungrounded: 0,
      inputTokens: 3100,
      outputTokens: 500,
    });
    expect(t.tools).toHaveLength(3);
  });

  it('sem nada reconhecível → null', () => {
    expect(summarizeTrace(null)).toBeNull();
    expect(summarizeTrace({})).toBeNull();
    expect(summarizeTrace('x')).toBeNull();
    expect(summarizeTrace([])).toBeNull();
  });
});

describe('avaliação', () => {
  it('checks em lista ou em mapa', () => {
    expect(
      normalizeChecks([
        { name: 'fact:gross', pass: true },
        { id: 'unit', status: 'fail', detail: 'fração mostrada como %' },
        { check: 'tools:args', ok: false, expected: '2026-08-01', got: '2026-08-02' },
        { id: 'fact:net', status: 'lens_mismatch', critical: true },
        { id: 'direction', status: 'skip', critical: false },
        'lixo',
      ]),
    ).toEqual([
      { name: 'fact:gross', pass: true, detail: null, critical: false, note: null },
      { name: 'unit', pass: false, detail: 'fração mostrada como %', critical: false, note: null },
      { name: 'tools:args', pass: false, detail: 'esperado 2026-08-01 · obtido 2026-08-02', critical: false, note: null },
      { name: 'fact:net', pass: false, detail: null, critical: true, note: 'número certo, lente não nomeada' },
      { name: 'direction', pass: null, detail: null, critical: false, note: 'não se aplica' },
    ]);
    expect(normalizeChecks({ hedge: true, lang: 0, budget: { passed: true }, faithfulness: 0.8 })).toEqual([
      { name: 'hedge', pass: true, detail: null, critical: false, note: null },
      { name: 'lang', pass: false, detail: null, critical: false, note: null },
      { name: 'budget', pass: true, detail: null, critical: false, note: null },
      { name: 'faithfulness', pass: null, detail: null, critical: false, note: null },
    ]);
    expect(normalizeChecks(null)).toEqual([]);
  });

  it('taxa pelos resultados: só avaliadas (pass/partial/fail), como o runner', () => {
    const r = passRateFromResults([
      { status: 'pass' },
      { status: 'pass' },
      { status: 'fail' },
      { status: 'partial' },
      { status: 'error' },
      { status: 'inconclusive' },
      { status: 'truncated' },
      { status: 'refusal' },
    ]);
    expect(r).toEqual({ rate: 0.5, pass: 2, graded: 4 });
    expect(passRateFromResults([{ status: 'error' }]).rate).toBeNull();
  });

  it('taxa do resumo: objeto do runner, contagens, e sem adivinhar unidade', () => {
    expect(evalPassRate({ passRate: { n: 31, pass: 25, rate: 0.806, ci: [0.63, 0.91] } })).toBe(0.806);
    expect(evalPassRate({ passRate: { n: 4, pass: 3, rate: null, ci: null } })).toBe(0.75);
    expect(evalPassRate({ pass: 25, total: 31 })).toBeCloseTo(25 / 31);
    expect(evalPassRate({ passRate: 0.87 })).toBe(0.87);
    expect(evalPassRate({ passRate: 87 })).toBeNull();
    expect(evalPassRate({ passPct: 87 })).toBeCloseTo(0.87);
    expect(evalPassRate(null)).toBeNull();
  });

  it('resumo completo da execução e taxa com intervalo', () => {
    const v = evalSummaryView({
      passRate: { n: 90, pass: 72, rate: 0.8, ci: [0.705, 0.871] },
      acceptableRate: { n: 90, pass: 80, rate: 0.889, ci: [0.8, 0.94] },
      meanScore: 0.912,
      lensMismatchRate: 0.05,
      unitFailRate: 0,
      falseDenialRate: null,
      faithfulness: 0.97,
      directness: 1.2,
      costPerPass: 0.18,
      latencyP50: 9000,
      latencyP95: 30000,
      flaky: ['G07', 3],
      byCategory: { numero: { n: 9, pass: 8, partial: 1, fail: 0, rate: 0.889, ci: [0.56, 0.98] }, lixo: 'x' },
    });
    expect(v.passRate?.rate).toBe(0.8);
    expect(v.acceptableRate?.ci).toEqual([0.8, 0.94]);
    expect(v.directness).toBeNull();
    expect(v.flaky).toEqual(['G07']);
    expect(v.byCategory).toEqual([{ category: 'numero', n: 9, pass: 8, partial: 1, fail: 0, rate: 0.889, ci: [0.56, 0.98] }]);
    expect(fmtRateCi(0.8, [0.705, 0.871])).toBe('80.0% (IC 95% 70.5%–87.1%)');
    expect(fmtRateCi(null, null)).toBe('—');
    expect(evalSummaryView(null).byCategory).toEqual([]);
  });

  it('configuração legível e lista de casos', () => {
    expect(
      evalConfigText({ model: 'claude-opus-5', effort: 'xhigh', reps: 3, cases: ['G01', 'G02'], knowledge: 'on' }),
    ).toBe('claude-opus-5 · esforço xhigh · 3× · 2 casos · base on');
    expect(evalConfigText(null)).toBe('—');
    expect(parseCaseList(' G01, g13 ,G01;G20\nG21 ')).toEqual(['G01', 'g13', 'G20', 'G21']);
    expect(parseCaseList('  ')).toEqual([]);
  });
});

describe('diversos', () => {
  it('resposta do feedback: texto + blocos à parte viram um objeto', () => {
    const blocks = [{ type: 'markdown', content: 'x' }];
    expect(feedbackAnswer({ answer: 'oi', answerBlocks: blocks })).toEqual({ content: 'oi', blocks });
    expect(feedbackAnswer({ answer: 'oi' })).toBe('oi');
    expect(normalizeAnswer(feedbackAnswer({ answer: 'oi [[cite:1]]', answerBlocks: blocks })).blocks).toHaveLength(1);
  });

  it('faixa de páginas', () => {
    expect(pageRange(3, null)).toBe('p. 3');
    expect(pageRange(3, 5)).toBe('p. 3–5');
    expect(pageRange(3, 3)).toBe('p. 3');
    expect(pageRange(null)).toBeNull();
  });

  it('resumo do seed', () => {
    expect(summarizeSeedResult({ created: 2, updated: 1, unchanged: 10, failed: 0 })).toBe(
      'Recarga do repositório concluída: 2 novos, 1 atualizado, 10 sem mudança.',
    );
    expect(summarizeSeedResult({ result: { updated: ['a', 'b'] } })).toBe('Recarga do repositório concluída: 2 atualizados.');
    expect(summarizeSeedResult({ ok: true })).toBe('Recarga do repositório concluída.');
    expect(summarizeSeedResult({ created: 0, updated: 0 })).toBe('Recarga do repositório concluída: nada mudou.');
  });

  it('título do arquivo e filtro sem acento', () => {
    expect(titleFromFileName('Cohort_v2.md')).toBe('Cohort v2');
    expect(titleFromFileName('.env')).toBe('.env');
    expect(matchesText('coorte reembolso', 'Coorte de REEMBOLSO', null)).toBe(true);
    expect(matchesText('politica', 'Política de fretes')).toBe(true);
    expect(matchesText('frete', 'Cohort')).toBe(false);
    expect(matchesText('  ', 'x')).toBe(true);
  });
});

describe('adminFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    const fn = vi.fn(impl);
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('JSON de ida e volta', async () => {
    const fn = stubFetch(async () => Response.json({ entry: { id: 'e1' } }));
    const out = await adminFetch<{ entry: { id: string } }>('/api/admin/knowledge', { method: 'POST', json: { title: 't' } });
    expect(out.entry.id).toBe('e1');
    const [, init] = fn.mock.calls[0];
    expect(init.body).toBe('{"title":"t"}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
  });

  it('204 → undefined', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    await expect(adminFetch('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('erro HTTP vira AdminApiError com mensagem PT-BR', async () => {
    stubFetch(async () => Response.json({ error: 'run in progress' }, { status: 409 }));
    const err = await adminFetch('/api/admin/chat-eval', { method: 'POST', json: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect((err as AdminApiError).status).toBe(409);
    expect((err as AdminApiError).message).toBe('Conflito com o estado atual. (run in progress)');
  });

  it('falha de rede → status 0; aborto propaga como AbortError', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await adminFetch('/x').catch((e: unknown) => e);
    expect((err as AdminApiError).status).toBe(0);

    stubFetch(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    const aborted = await adminFetch('/x').catch((e: unknown) => e);
    expect((aborted as DOMException).name).toBe('AbortError');
  });

  it('resposta de erro sem JSON ainda dá mensagem', async () => {
    stubFetch(async () => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const err = await adminFetch('/x').catch((e: unknown) => e);
    expect((err as AdminApiError).message).toBe('Erro no servidor (502). Tente de novo em instantes.');
  });
});
