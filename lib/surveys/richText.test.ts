import { describe, expect, it } from 'vitest';
import { plainText, richText } from './richText';
import { renderSurveyPage } from './render';

describe('formatação dos textos', () => {
  it('negrito, itálico, sublinhado, riscado e quebra de linha', () => {
    expect(richText('**Save** *now* __today__ ~~$294~~')).toBe('<strong>Save</strong> <em>now</em> <u>today</u> <s>$294</s>');
    expect(richText('Line one\nLine two')).toBe('Line one<br>Line two');
    expect(richText('Title\nwith break', { singleLine: true })).toBe('Title with break');
  });

  it('asterisco solto não vira itálico; HTML do usuário continua escapado', () => {
    expect(richText('5 * 3 * 2')).toBe('5 * 3 * 2');
    expect(richText('code KEEP_10 and file_name')).toBe('code KEEP_10 and file_name');
    expect(richText('&lt;b&gt;x&lt;/b&gt;')).toBe('&lt;b&gt;x&lt;/b&gt;');
  });

  it('sem marcações pra contar caracteres e pro título da aba', () => {
    expect(plainText('**Finish** your *plan*\nnow')).toBe('Finish your plan now');
  });

  it('a página aplica a formatação e marca os títulos que encolhem pra caber em 1 linha', () => {
    const html = renderSurveyPage({
      cfg: {
        productName: 'NeuroRecall',
        copy: { 'intro.title': '**{nome}**, a <b>quick</b> check-in', 'intro.body': 'Line one\n*Line two*' },
      },
      ctx: { firstName: 'Ann', bottles: 2 }, slug: 'neurorecall', token: '', preview: true,
      answers: {}, outcome: null, couponPct: null, followUp: false,
    });
    expect(html).toContain('<h1 class="fit" tabindex="-1"><strong>Ann</strong>, a &lt;b&gt;quick&lt;/b&gt; check-in</h1>');
    expect(html).toContain('Line one<br><em>Line two</em>');
  });
});
