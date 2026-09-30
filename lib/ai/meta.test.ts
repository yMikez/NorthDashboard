import { describe, expect, it } from 'vitest';
import {
  ToolInputError,
  ToolTimeoutError,
  attachMeta,
  errorFromException,
  formatBrt,
  normalizeErrorResult,
  parseBrtEnd,
  parseBrtStart,
  rangeMeta,
  rangeMetaFromDays,
} from './meta';

// 2026-09-30 14:05 BRT (quarta).
const NOW = new Date('2026-09-30T17:05:00.000Z');

describe('rangeMeta', () => {
  it('mês até hoje parcial: fim efetivo = agora, 29 dias fechados, horas decorridas', () => {
    const r = rangeMeta(parseBrtStart('2026-09-01'), parseBrtEnd('2026-09-30'), NOW, 'ui');
    expect(r).toEqual({
      startBrt: '2026-09-01 00:00',
      endBrt: '2026-09-30 14:05',
      days: 30,
      closedDays: 29,
      includesToday: true,
      partialToday: true,
      hoursElapsedToday: 14.1,
      source: 'ui',
    });
  });

  it('janela fechada (ontem): nada de hoje', () => {
    const r = rangeMeta(parseBrtStart('2026-09-29'), parseBrtEnd('2026-09-29'), NOW, 'explicit');
    expect(r).toMatchObject({ startBrt: '2026-09-29 00:00', endBrt: '2026-09-29 23:59', days: 1, closedDays: 1, includesToday: false, partialToday: false });
    expect(r.hoursElapsedToday).toBeUndefined();
  });

  it('"desde X" (fim = agora) também é hoje parcial', () => {
    const r = rangeMeta(parseBrtStart('2026-09-28'), NOW, NOW, 'explicit');
    expect(r).toMatchObject({ days: 3, closedDays: 2, includesToday: true, partialToday: true });
  });

  it('fim no meio de hoje, já passado: hoje incluído mas não cresce mais', () => {
    const r = rangeMeta(parseBrtStart('2026-09-30'), new Date('2026-09-30T13:00:00.000Z'), NOW, 'explicit');
    expect(r).toMatchObject({ endBrt: '2026-09-30 10:00', includesToday: true, partialToday: false, closedDays: 0 });
  });

  it('borda UTC: 30/09 02:59Z ainda é 29/09 em BRT', () => {
    expect(formatBrt(new Date('2026-09-30T02:59:00.000Z'))).toBe('2026-09-29 23:59');
  });

  it('janela em dias (tools de janela)', () => {
    expect(rangeMetaFromDays('2026-09-23', '2026-09-29', NOW, 'default')).toMatchObject({ days: 7, closedDays: 7, includesToday: false });
    expect(rangeMetaFromDays('lixo', '2026-09-29', NOW, 'default')).toBeUndefined();
  });
});

describe('attachMeta', () => {
  it('_meta no topo, vazios omitidos, notas somadas, chaves do handler vencem', () => {
    const tag = Symbol.for('northscale.ai.fitTool');
    const value: Record<string | symbol, unknown> = { kpis: { gross: 1 }, _meta: { aligned: true, notes: ['do handler'] } };
    value[tag] = 'get_overview';
    const out = attachMeta(value as Record<string, unknown>, { notes: ['fixa'], units: {}, filtersApplied: { platforms: ['clickbank'] }, aligned: false });
    expect(Object.keys(out)[0]).toBe('_meta');
    expect(out._meta).toEqual({ aligned: true, filtersApplied: { platforms: ['clickbank'] }, notes: ['fixa', 'do handler'] });
    expect((out as Record<symbol, unknown>)[tag]).toBe('get_overview');
  });

  it('nada a anexar → sem _meta', () => {
    expect(attachMeta({ a: 1 }, { notes: [], units: undefined })).toEqual({ a: 1 });
  });
});

describe('forma única de erro', () => {
  it('input inválido carrega hint/validValues', () => {
    const { result, log } = errorFromException(new ToolInputError('stages inválido', { validValues: ['FRONTEND', 'UPSELL'], hint: 'use o enum' }));
    expect(result).toEqual({ error: 'invalid_input', message: 'stages inválido', retryable: false, hint: 'use o enum', validValues: ['FRONTEND', 'UPSELL'] });
    expect(log).toBe(false);
  });

  it('erro "invalid_input:" do normalizeScope vira invalid_input com os valores válidos', () => {
    const err = Object.assign(new Error('invalid_input: plataforma "digistore" desconhecida'), { validValues: ['clickbank', 'digistore24'] });
    const { result } = errorFromException(err);
    expect(result).toMatchObject({ error: 'invalid_input', message: 'plataforma "digistore" desconhecida', retryable: false, validValues: ['clickbank', 'digistore24'] });
    expect(result.hint).toMatch(/resolve_entities/);
  });

  it('formato do normalizeScope ("— valid: … · dica") vira validValues + hint sem repetir a lista', () => {
    const { result } = errorFromException(new Error('invalid_input: families: "neuromind" não existe — valid: NeuroMindPro, NeuroPulsePro, … (+3) · NeuroPulsePro e NeuroMindPro são famílias diferentes'));
    expect(result).toEqual({
      error: 'invalid_input',
      message: 'families: "neuromind" não existe',
      retryable: false,
      hint: 'NeuroPulsePro e NeuroMindPro são famílias diferentes',
      validValues: ['NeuroMindPro', 'NeuroPulsePro'],
    });
  });

  it('timeout é retryable com dica de estreitar', () => {
    const { result, log } = errorFromException(new ToolTimeoutError('get_orders', 180_000));
    expect(result).toMatchObject({ error: 'timeout', message: 'get_orders excedeu 180s', retryable: true });
    expect(result.hint).toMatch(/Estreite o período/);
    expect(log).toBe(true);
  });

  it('erro do Prisma: mensagem genérica (a crua vai só pro log); transitório = retryable', () => {
    const raw = Object.assign(new Error('Raw query failed. Code: `42P01`. Message: relation "Ordr" does not exist'), { name: 'PrismaClientKnownRequestError', code: 'P2010', clientVersion: '5.22.0' });
    const { result, log } = errorFromException(raw);
    expect(result).toMatchObject({ error: 'query_failed', message: 'A consulta ao banco falhou.', retryable: false });
    expect(JSON.stringify(result)).not.toMatch(/Ordr/);
    expect(log).toBe(true);
    const conn = Object.assign(new Error("Can't reach database server"), { name: 'PrismaClientInitializationError', code: 'P1001' });
    expect(errorFromException(conn).result.retryable).toBe(true);
  });

  it('abort e erro genérico', () => {
    expect(errorFromException(Object.assign(new Error('aborted'), { name: 'AbortError' })).result.error).toBe('aborted');
    expect(errorFromException(new Error('janela inválida')).result).toEqual({ error: 'tool_execution_failed', message: 'janela inválida', retryable: false });
  });

  it('objetos de erro antigos devolvidos por handler/módulo ganham a forma única', () => {
    expect(normalizeErrorResult({ error: 'external_id obrigatório' })).toEqual({ error: 'invalid_input', message: 'external_id obrigatório', retryable: false });
    expect(normalizeErrorResult({ error: 'not_found', message: 'entidade x não encontrada', alternatives: [{ id: 1 }] }))
      .toEqual({ error: 'not_found', message: 'entidade x não encontrada', retryable: false, alternatives: [{ id: 1 }] });
    expect(normalizeErrorResult({ error: 'forbidden', message: 'só admin', retryable: false }).error).toBe('forbidden');
  });
});
