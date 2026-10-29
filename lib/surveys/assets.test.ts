import { describe, expect, it } from 'vitest';
import { isSurveyImagePath, sniffImage } from './assets';
import { renderSurveyPage } from './render';
import { sanitizeVariantConfig } from './variantConfig';

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe('fotos da pesquisa', () => {
  it('tipo pelo conteúdo: WebP, PNG e JPEG; o resto não', () => {
    expect(sniffImage(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImage(bytes('GIF89a'))).toBeNull();
  });

  it('caminhos aceitos: as do código e as enviadas pelo dash', () => {
    expect(isSurveyImagePath('/survey-assets/neurorecall.webp')).toBe(true);
    expect(isSurveyImagePath('/api/survey/asset/cmvsx1abc000001')).toBe(true);
    expect(isSurveyImagePath('https://evil.example/x.png')).toBe(false);
    expect(isSurveyImagePath('/api/survey/asset/../../etc')).toBe(false);
  });

  it('a configuração aceita foto enviada e recusa link de fora', () => {
    const ok = sanitizeVariantConfig({ productName: 'X', image: '/api/survey/asset/cmvsx1abc000001' });
    expect(ok.ok && ok.config.image).toBe('/api/survey/asset/cmvsx1abc000001');
    expect(sanitizeVariantConfig({ productName: 'X', image: 'https://evil.example/x.png' })).toMatchObject({ ok: false });
  });

  it('textos da tela final reescritos valem por público (e o de quem tomou todo dia)', () => {
    const res = sanitizeVariantConfig({
      productName: 'NeuroRecall',
      fullPlanFrom: 6,
      offers: { kits: { 6: { url: 'https://vupim.com/c/6', price: 234 } } },
      copy: {
        'end.oferta.title': 'Finish strong, {nome}',
        'end.oferta.title@completo': 'Six more months of focus',
        'end.oferta.body@completo_constante': 'Daily streak text',
        'end.oferta.cta': 'Get my {kit} bottles',
      },
    });
    if (!res.ok) throw new Error(res.error);
    const page = (bottles: number) => renderSurveyPage({
      cfg: res.config, ctx: { firstName: 'Ann', bottles }, slug: 'neurorecall', token: '', preview: true,
      answers: {}, outcome: 'oferta', couponPct: null, followUp: false,
    });
    expect(page(3)).toContain('Finish strong, Ann');
    expect(page(6)).toContain('Six more months of focus');
    expect(page(6)).toContain('Daily streak text');
    expect(page(3)).toContain('Get my 6 bottles');
    // O 6+ tem botão padrão próprio: o campo "6+" do editor é que muda ele.
    expect(page(6)).toContain('Keep going for');
  });

  it('a página mostra a foto enviada', () => {
    const html = renderSurveyPage({
      cfg: { productName: 'NeuroRecall', image: '/api/survey/asset/cmvsx1abc000001' },
      ctx: { firstName: 'Ann', bottles: 2 }, slug: 'neurorecall', token: '', preview: true,
      answers: {}, outcome: null, couponPct: null, followUp: false,
    });
    expect(html).toContain('src="/api/survey/asset/cmvsx1abc000001"');
  });
});
