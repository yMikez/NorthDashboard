// Os esquemas REAIS pelo helper REAL do SDK (sem mock). O 1º briefing em
// prod quebrou aqui: esquema do `zod` clássico no helper que usa o
// toJSONSchema da v4 ("Cannot read properties of undefined (reading 'def')").
import { describe, expect, it } from 'vitest';
import { outputFormat } from './llm';
import { BriefingAiSchema, normalizeTone } from '../briefing/service';
import { DecisionsSchema, normalizeConfidence } from '../decisions/extract';

describe('saída estruturada — esquemas reais no helper do SDK', () => {
  it('briefing: vira JSON Schema estrito e lê a resposta (tom fora da lista não derruba)', () => {
    const f = outputFormat(BriefingAiSchema);
    expect(f.type).toBe('json_schema');
    expect(f.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(Object.keys((f.schema as { properties: object }).properties)).toEqual(['headline', 'summary', 'highlights', 'attention', 'decisions']);
    const parsed = f.parse(JSON.stringify({
      headline: 'Semana forte', summary: 'S.', attention: null, decisions: [],
      highlights: [{ title: 'T', detail: 'D', tone: 'positiva', metric: 'faturamento' }],
    }));
    expect(parsed.highlights[0].tone).toBe('positiva');
    expect(normalizeTone(parsed.highlights[0].tone)).toBe('positivo');
    expect(normalizeTone('Negativo')).toBe('negativo');
    expect(normalizeTone('misto')).toBe('neutro');
  });

  it('decisões: vira JSON Schema estrito e lê a resposta', () => {
    const f = outputFormat(DecisionsSchema);
    expect(f.schema).toMatchObject({ type: 'object', additionalProperties: false });
    const parsed = f.parse(JSON.stringify({
      decisions: [{
        title: 'Subir preço', summary: 'S', decided_at: '2026-11-20', decided_by: null, source_message_ids: ['1'],
        metrics: [{ metric: 'aov', expected: 'subir' }], scope: { platforms: [], families: [], note: null },
        abrangencia: 'setor', impacto: 'alto', confidence: 'Média',
      }],
    }));
    expect(normalizeConfidence(parsed.decisions[0].confidence)).toBe('media');
    expect(normalizeConfidence('ALTA')).toBe('alta');
    expect(normalizeConfidence('baixa')).toBe('baixa');
  });
});
