import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPitch, PAGE_KEY_RE, pageKeyFor, parsePitch } from './catalog';
import { aspectLabel, parseVturbEmbed } from './embed';
import { buildVslSnippet } from './snippet';

const TEMPLATE_EMBED = fs.readFileSync(path.join(__dirname, '__fixtures__/upsell01-player-embed.html'), 'utf8');

describe('catálogo', () => {
  it('chave da página: família-etapa-plataforma, minúscula e sem acento', () => {
    expect(pageKeyFor('GlycoEden', 'UP01', 'jvzoo')).toBe('glycoeden-up01-jvzoo');
    expect(pageKeyFor('Neuro Mind Pró', 'DOWN02', 'buygoods')).toBe('neuromindpro-down02-buygoods');
    expect(PAGE_KEY_RE.test('glycoeden-up01-jvzoo')).toBe(true);
    // variante: a mesma etapa com mais de uma página
    expect(pageKeyFor('GlycoEden', 'UP01', 'jvzoo', '2–3 potes')).toBe('glycoeden-up01-jvzoo-23potes');
    expect(pageKeyFor('GlycoEden', 'UP01', 'jvzoo', '  ')).toBe('glycoeden-up01-jvzoo');
    expect(PAGE_KEY_RE.test('glycoeden-up01-jvzoo-23potes')).toBe(true);
    expect(PAGE_KEY_RE.test('glycoeden-up01-jvzoo-23potes-x')).toBe(false);
    expect(PAGE_KEY_RE.test('glycoeden-up04-jvzoo')).toBe(false);
    expect(PAGE_KEY_RE.test('../etc-up01-x')).toBe(false);
  });

  it('pitch: mm:ss, h:mm:ss e segundos', () => {
    expect(parsePitch('5:27')).toBe(327);
    expect(parsePitch('05:27')).toBe(327);
    expect(parsePitch('1:02:05')).toBe(3725);
    expect(parsePitch('327')).toBe(327);
    expect(parsePitch(327)).toBe(327);
    expect(parsePitch('5:61')).toBeNull();
    expect(parsePitch('0:00')).toBeNull();
    expect(parsePitch('abc')).toBeNull();
    expect(formatPitch(327)).toBe('5:27');
    expect(formatPitch(3725)).toBe('1:02:05');
  });
});

describe('embed do VTurb', () => {
  it('lê o embed real do template (Upsell01 Glyco Eden)', () => {
    const r = parseVturbEmbed(TEMPLATE_EMBED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.embed).toEqual({
      accountId: 'b000e64e-8460-43d9-8682-e78d17ef9c97',
      playerId: '6ab51d3cc48cfa9404534d03',
      scriptUrl: 'https://scripts.converteai.net/b000e64e-8460-43d9-8682-e78d17ef9c97/players/6ab51d3cc48cfa9404534d03/v4/player.js',
      aspectPct: 133.333,
    });
    expect(aspectLabel(r.embed.aspectPct)).toBe('vertical');
  });

  it('recusa embed sem script, player trocado e domínio que não é do VTurb', () => {
    expect(parseVturbEmbed('<vturb-smartplayer id="vid-6ab51d3cc48cfa9404534d03"></vturb-smartplayer>')).toMatchObject({ ok: false, error: expect.stringMatching(/player\.js/) });
    const mismatch = TEMPLATE_EMBED.replace('id="vid-6ab51d3cc48cfa9404534d03"', 'id="vid-111111111111111111111111"');
    expect(parseVturbEmbed(mismatch)).toMatchObject({ ok: false, error: expect.stringMatching(/Copie o embed de novo/) });
    expect(parseVturbEmbed('<script src="https://evil.example/players/6ab51d3cc48cfa9404534d03/v4/player.js"></script>').ok).toBe(false);
    expect(parseVturbEmbed('').ok).toBe(false);
  });

  it('nunca guarda o HTML colado: o script sai montado por nós', () => {
    const r = parseVturbEmbed(`${TEMPLATE_EMBED}<script>alert(1)</script>`);
    expect(r.ok && r.embed.scriptUrl.startsWith('https://scripts.converteai.net/')).toBe(true);
    expect(JSON.stringify(r)).not.toContain('alert');
  });
});

describe('snippet', () => {
  const snippet = buildVslSnippet({
    key: 'glycoeden-up01-jvzoo',
    origin: 'https://dash.thenorthscales.com/',
    fallback: {
      name: 'Glyco --> v1 <b>',
      playerId: '6ab51d3cc48cfa9404534d03',
      scriptUrl: 'https://scripts.converteai.net/b000e64e-8460-43d9-8682-e78d17ef9c97/players/6ab51d3cc48cfa9404534d03/v4/player.js',
      aspectPct: 133.333,
      pitchSeconds: 327,
    },
  });

  it('player com a reserva, script do dash com defer e reserva inline', () => {
    expect(snippet).toContain('<vturb-smartplayer id="vid-6ab51d3cc48cfa9404534d03" data-ns-vsl="glycoeden-up01-jvzoo" data-vdelay="327"');
    expect(snippet).toContain('data-ns-fallback="https://scripts.converteai.net/b000e64e-8460-43d9-8682-e78d17ef9c97/players/6ab51d3cc48cfa9404534d03/v4/player.js"');
    expect(snippet).toContain('<script defer src="https://dash.thenorthscales.com/api/vsl/p/glycoeden-up01-jvzoo.js"></script>');
    expect(snippet).toContain('padding:133.333% 0 0');
    expect(snippet).toContain('max-width:400px');
    expect(snippet).toMatch(/<script>\(function\(\)\{var k="glycoeden-up01-jvzoo";/);
  });

  it('nome da VSL não fecha o comentário HTML', () => {
    const comment = snippet.slice(0, snippet.indexOf('-->') + 3);
    expect(comment).not.toContain('<b>');
    expect((snippet.match(/-->/g) || []).length).toBe(1);
  });
});
