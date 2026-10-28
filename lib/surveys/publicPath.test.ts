import { describe, expect, it } from 'vitest';
import { surveyPageParams } from './publicPath';

describe('caminho público da pesquisa', () => {
  it('no domínio checkin o handler recebe a URL original: lê slug e token do caminho', () => {
    expect(surveyPageParams(new URL('https://checkin.healthnwellnes.com/neurorecall/0m2CdgJziXqIMn8bQ2h5HEJ0'))).toEqual({
      slug: 'neurorecall', token: '0m2CdgJziXqIMn8bQ2h5HEJ0',
    });
  });

  it('no dash vale a query', () => {
    expect(surveyPageParams(new URL('https://dash.thenorthscales.com/api/survey/page?slug=neurorecall&t=0m2CdgJziXqIMn8bQ2h5HEJ0'))).toEqual({
      slug: 'neurorecall', token: '0m2CdgJziXqIMn8bQ2h5HEJ0',
    });
    expect(surveyPageParams(new URL('https://dash.thenorthscales.com/api/survey/page?slug=neurorecall&preview=1'))).toEqual({
      slug: 'neurorecall', token: '',
    });
  });

  it('qualquer outro caminho não acha pesquisa', () => {
    expect(surveyPageParams(new URL('https://checkin.healthnwellnes.com/login'))).toEqual({ slug: '', token: '' });
    expect(surveyPageParams(new URL('https://checkin.healthnwellnes.com/neurorecall/curto'))).toEqual({ slug: '', token: '' });
  });
});
