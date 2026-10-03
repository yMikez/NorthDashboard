// O script da página (loader) rodando num DOM mínimo, junto do vsl-reveal.js
// REAL do template Upsell01 (fixture) — prova que o pitch do dash chega no
// delay da página sem mexer no código dela.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildLoaderScript, type LoaderConfig } from './loader';
import { buildVslSnippet } from './snippet';

const REVEAL = fs.readFileSync(path.join(__dirname, '__fixtures__/vsl-reveal.template.js'), 'utf8');

// ── DOM mínimo ────────────────────────────────────────────────────────────
type Listener = (e: unknown) => void;

class El {
  attrs = new Map<string, string>();
  children: El[] = [];
  parent: El | null = null;
  style: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  textContent = '';
  src = '';
  async = false;
  calls: unknown[][] = [];
  classList = {
    contains: (c: string) => (this.attrs.get('class') || '').split(/\s+/).includes(c),
    add: (c: string) => { if (!this.classList.contains(c)) this.attrs.set('class', `${this.attrs.get('class') || ''} ${c}`.trim()); },
    remove: (c: string) => this.attrs.set('class', (this.attrs.get('class') || '').split(/\s+/).filter((x) => x && x !== c).join(' ')),
  };
  constructor(public tagName: string, attrs: Record<string, string> = {}, children: El[] = [], public root?: { el: El }) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    for (const c of children) this.appendChild(c);
  }
  get id() { return this.attrs.get('id') || ''; }
  set id(v: string) { this.attrs.set('id', v); }
  getAttribute(n: string) { return this.attrs.has(n) ? this.attrs.get(n)! : null; }
  setAttribute(n: string, v: string) { this.attrs.set(n, String(v)); }
  hasAttribute(n: string) { return this.attrs.has(n); }
  appendChild(c: El) { c.parent = this; this.children.push(c); return c; }
  get firstElementChild() { return this.children[0] || null; }
  get isConnected(): boolean {
    let n: El | null = this;
    while (n.parent) n = n.parent;
    return n.tagName === '#document';
  }
  addEventListener(t: string, fn: Listener) { this.listeners.set(t, [...(this.listeners.get(t) || []), fn]); }
  dispatch(t: string, detail?: unknown) { for (const fn of this.listeners.get(t) || []) fn({ type: t, detail, target: this }); }
  matches(sel: string): boolean { return sel.split(',').some((s) => matchChain(this, s.trim())); }
  closest(sel: string): El | null {
    let n: El | null = this;
    while (n) { if (n.tagName !== '#document' && n.matches(sel)) return n; n = n.parent; }
    return null;
  }
  querySelectorAll(sel: string): El[] {
    const out: El[] = [];
    const walk = (n: El) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] || null; }
  scrollIntoView() {}
  displayHiddenElements(...args: unknown[]) { this.calls.push(args); }
}

function matchCompound(el: El, comp: string): boolean {
  const m = /^([a-z0-9-]+)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/i.exec(comp);
  if (!m) return false;
  if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
  for (const part of m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []) {
    if (part[0] === '#' && el.id !== part.slice(1)) return false;
    if (part[0] === '.' && !el.classList.contains(part.slice(1))) return false;
    if (part[0] === '[') {
      const a = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (!a) return false;
      if (!el.hasAttribute(a[1])) return false;
      if (a[2] != null && el.getAttribute(a[1]) !== a[2]) return false;
    }
  }
  return true;
}
function matchChain(el: El, sel: string): boolean {
  const parts = sel.split(/\s+/);
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  let n = el.parent;
  while (i >= 0 && n) { if (n.tagName !== '#document' && matchCompound(n, parts[i])) i--; n = n.parent; }
  return i < 0;
}

function page(opts: { black?: boolean; inCopyb?: boolean; search?: string; storage?: Map<string, string> } = {}) {
  const player = new El('vturb-smartplayer', {
    id: 'vid-aaaaaaaaaaaaaaaaaaaaaaaa', 'data-ns-vsl': 'glycoeden-up01-jvzoo', 'data-vdelay': '327',
    'data-ns-fallback': 'https://scripts.converteai.net/acc/players/aaaaaaaaaaaaaaaaaaaaaaaa/v4/player.js',
  }, [new El('div', { class: 'vturb-player-placeholder' })]);
  const accept = new El('a', { href: 'https://www.jvzoo.com/b/117985/449451/99', class: 'jvz-buy-link' });
  const decline = new El('a', { href: 'https://getglycoeden.com/jv/Down01/', 'data-jv-next': 'https://getglycoeden.com/jv/Down01/' });
  const support = new El('a', { href: 'https://www.jvzoosupport.com/' });
  const noThanks = new El('a', { href: '#' });
  noThanks.textContent = 'No thanks, I understand';
  const reveal = new El('div', { class: 'reveal-later esconder', id: 'reveal-section' }, [accept, decline, noThanks]);
  const copyb = new El('div', { id: 'copyb' }, opts.inCopyb === false ? [reveal] : [new El('section', {}, [player]), reveal]);
  const head = new El('head');
  const body = new El('body', {}, opts.inCopyb === false ? [player, copyb, support] : [copyb, support]);
  const doc = new El('#document', {}, [new El('html', {}, [head, body])]);
  const docListeners = new Map<string, Listener[]>();
  const beacons: Array<Record<string, unknown>> = [];
  const intervals: Array<() => void> = [];
  const timeouts: Array<{ at: number; fn: () => void }> = [];
  let clock = 1_000_000;
  const storage = opts.storage ?? new Map<string, string>();
  const session = new Map<string, string>();
  const mkStore = (m: Map<string, string>) => ({ getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, String(v)); } });
  const document = {
    head, body, readyState: 'interactive', cookie: '', visibilityState: 'visible',
    querySelector: (s: string) => doc.querySelector(s),
    querySelectorAll: (s: string) => doc.querySelectorAll(s),
    createElement: (t: string) => new El(t),
    addEventListener: (t: string, fn: Listener) => docListeners.set(t, [...(docListeners.get(t) || []), fn]),
  };
  const winListeners = new Map<string, Listener[]>();
  const ctx: Record<string, unknown> = {
    document,
    location: { search: opts.search || '', host: 'getglycoeden.com', pathname: '/jv/Up01/', href: `https://getglycoeden.com/jv/Up01/${opts.search || ''}` },
    navigator: { sendBeacon: (_u: string, body: string) => { beacons.push(JSON.parse(body)); return true; } },
    localStorage: mkStore(storage),
    sessionStorage: mkStore(session),
    URLSearchParams, URL, Math, JSON, String, parseInt, Number,
    setInterval: (fn: () => void) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
    setTimeout: (fn: () => void, ms?: number) => { timeouts.push({ at: clock + (ms || 0), fn }); return timeouts.length; },
    Date: { now: () => clock },
    addEventListener: (t: string, fn: Listener) => winListeners.set(t, [...(winListeners.get(t) || []), fn]),
    fetch: () => Promise.resolve(),
    _copyBlack: opts.black !== false,
    VSL_REVEAL_DELAY: 327, // o template define inline antes dos scripts defer
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const run = (code: string) => vm.runInContext(code, ctx);
  const click = (el: El) => { for (const fn of winListeners.get('click') || []) fn({ target: el }); };
  const fireDocument = (t: string) => { for (const fn of docListeners.get(t) || []) fn({ type: t }); };
  const scripts = () => head.children.filter((c) => c.tagName === 'script').map((c) => c.src);
  const tick = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      timeouts.sort((a, b) => a.at - b.at);
      const next = timeouts[0];
      if (!next || next.at > end) break;
      timeouts.shift();
      clock = next.at;
      next.fn();
    }
    clock = end;
  };
  const link = (href: string, text: string) => { const a = new El('a', { href }); a.textContent = text; body.appendChild(a); return a; };
  return { ctx, run, player, accept, decline, noThanks, support, beacons, intervals, click, fireDocument, scripts, storage, document, tick, link };
}

const VSL = (id: string, p: string, t: number, a: number | null = 56.25) => ({ id, p, s: `https://scripts.converteai.net/acc/players/${p}/v4/player.js`, a, t });
const base = (over: Partial<LoaderConfig> = {}): LoaderConfig => ({
  k: 'glycoeden-up01-jvzoo', on: true, v: VSL('vsl_b', 'bbbbbbbbbbbbbbbbbbbbbbbb', 412), t: null, pv: null,
  e: 'https://dash.thenorthscales.com/api/vsl/e', ...over,
});

describe('script da página (loader)', () => {
  it('troca player, pitch e proporção ANTES do vsl-reveal.js do template ler', () => {
    const pg = page();
    pg.run(buildLoaderScript(base()));
    pg.run(REVEAL); // defer, logo depois do loader (ordem do documento)
    expect(pg.player.id).toBe('vid-bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(pg.player.getAttribute('data-vdelay')).toBe('412');
    expect(pg.ctx.VSL_REVEAL_DELAY).toBe(412);
    expect(pg.player.style.maxWidth).toBe('960px');
    expect(pg.player.children[0].style.paddingTop).toBe('56.25%');
    expect(pg.scripts()).toEqual(['https://scripts.converteai.net/acc/players/bbbbbbbbbbbbbbbbbbbbbbbb/v4/player.js']);
    expect(pg.ctx._vturbPlayerLoaded).toBe(true);
    // O player fica pronto: o vsl-reveal.js do template pede o reveal com o pitch DO DASH.
    pg.player.dispatch('player:ready');
    expect(pg.player.calls).toEqual([[412, ['.esconder'], { persist: true }]]);
    expect(pg.ctx.NS_VSL).toMatchObject({ key: 'glycoeden-up01-jvzoo', player: 'bbbbbbbbbbbbbbbbbbbbbbbb', pitch: 412, preview: false });
  });

  it('dash fora do ar: a reserva inline do snippet carrega a VSL de sempre com o delay da página', () => {
    const pg = page();
    (pg.document as { readyState: string }).readyState = 'loading';
    const snippet = buildVslSnippet({
      key: 'glycoeden-up01-jvzoo', origin: 'https://dash.thenorthscales.com',
      fallback: { name: 'Glyco v1', playerId: 'aaaaaaaaaaaaaaaaaaaaaaaa', scriptUrl: 'https://scripts.converteai.net/acc/players/aaaaaaaaaaaaaaaaaaaaaaaa/v4/player.js', aspectPct: 133.333, pitchSeconds: 327 },
    });
    pg.run(snippet.match(/<script>([\s\S]*)<\/script>/)![1]); // só o inline; o defer falhou
    pg.run(REVEAL);
    pg.fireDocument('DOMContentLoaded');
    expect(pg.scripts()).toEqual(['https://scripts.converteai.net/acc/players/aaaaaaaaaaaaaaaaaaaaaaaa/v4/player.js']);
    pg.player.dispatch('player:ready');
    expect(pg.player.calls[0][0]).toBe(327);
  });

  it('com o loader carregado, a reserva inline não carrega um segundo player', () => {
    const pg = page();
    (pg.document as { readyState: string }).readyState = 'loading';
    const snippet = buildVslSnippet({
      key: 'glycoeden-up01-jvzoo', origin: 'https://d', fallback: { name: 'v1', playerId: 'aaaaaaaaaaaaaaaaaaaaaaaa', scriptUrl: 'https://scripts.converteai.net/x/players/aaaaaaaaaaaaaaaaaaaaaaaa/v4/player.js', aspectPct: null, pitchSeconds: 327 },
    });
    pg.run(snippet.match(/<script>([\s\S]*)<\/script>/)![1]);
    pg.run(buildLoaderScript(base()));
    pg.fireDocument('DOMContentLoaded');
    expect(pg.scripts()).toHaveLength(1);
  });

  it('copy white: VSL dentro de #copyb não carrega nada nem rastreia', () => {
    const pg = page({ black: false });
    pg.run(buildLoaderScript(base()));
    expect(pg.scripts()).toEqual([]);
    expect(pg.beacons).toEqual([]);
  });

  it('página desligada no dash: toca a reserva e atribui à VSL de reserva', () => {
    const pg = page();
    pg.run(buildLoaderScript(base({ on: false })));
    expect(pg.scripts()).toEqual(['https://scripts.converteai.net/acc/players/aaaaaaaaaaaaaaaaaaaaaaaa/v4/player.js']);
    expect(pg.player.id).toBe('vid-aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(pg.beacons[0]).toMatchObject({ e: 'view', pl: 'aaaaaaaaaaaaaaaaaaaaaaaa', t: null, a: null });
  });

  it('teste A/B: sorteio uma vez por visitante, guardado entre visitas', () => {
    const t = { id: 'test1', arms: [{ id: 'armA', w: 50, v: VSL('vsl_a', 'aaaaaaaaaaaaaaaaaaaaaaaa', 327) }, { id: 'armB', w: 50, v: VSL('vsl_b', 'bbbbbbbbbbbbbbbbbbbbbbbb', 412) }] };
    const storage = new Map<string, string>();
    const first = page({ storage });
    first.run(buildLoaderScript(base({ t })));
    const arm = storage.get('ns_vsl_t_test1');
    expect(['armA', 'armB']).toContain(arm);
    expect(first.beacons[0]).toMatchObject({ t: 'test1', a: arm });
    // Mesmo visitante volta depois que os pesos mudaram: continua no mesmo braço.
    const again = page({ storage });
    again.run(buildLoaderScript(base({ t: { ...t, arms: t.arms.map((x) => ({ ...x, w: x.id === arm ? 0 : 100 })) } })));
    expect(again.ctx.NS_VSL).toMatchObject({ armId: arm });
    // Muitos visitantes novos: os dois braços recebem gente.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const p = page();
      p.run(buildLoaderScript(base({ t })));
      seen.add((p.ctx.NS_VSL as { armId: string }).armId);
    }
    expect(seen).toEqual(new Set(['armA', 'armB']));
  });

  it('pré-visualização só com ?ns_vsl_preview e sem entrar na métrica', () => {
    const pv = VSL('vsl_c', 'cccccccccccccccccccccccc', 200);
    const normal = page();
    normal.run(buildLoaderScript(base({ pv })));
    expect(normal.player.id).toBe('vid-bbbbbbbbbbbbbbbbbbbbbbbb');
    const pre = page({ search: '?ns_vsl_preview=1' });
    pre.run(buildLoaderScript(base({ pv })));
    expect(pre.player.id).toBe('vid-cccccccccccccccccccccccc');
    expect(pre.ctx.VSL_REVEAL_DELAY).toBe(200);
    expect(pre.beacons).toEqual([]);
  });

  it('rastreio: visita, play, pitch e classificação dos cliques', () => {
    const pg = page({ search: '?sessid2=abc123&tid=x' });
    pg.run(buildLoaderScript(base()));
    expect(pg.beacons[0]).toMatchObject({ k: 'glycoeden-up01-jvzoo', e: 'view', pl: 'bbbbbbbbbbbbbbbbbbbbbbbb', sk: 'sessid2:abc123', u: 'getglycoeden.com/jv/Up01/' });
    pg.player.dispatch('player:play');
    pg.player.dispatch('player:timeupdate', { currentTime: 415 });
    pg.intervals.forEach((fn) => fn());
    expect(pg.beacons.map((b) => b.e)).toEqual(['view', 'play', 'pitch', 'progress']);
    pg.click(pg.support);
    pg.click(pg.noThanks);
    pg.click(pg.decline);
    pg.click(pg.accept);
    expect(pg.beacons.map((b) => b.e)).toEqual(['view', 'play', 'pitch', 'progress', 'decline', 'accept']);
    expect(pg.beacons[5]).toMatchObject({ s: 415 });
  });

  it('config com </script> ou o marcador dos hosts não quebra o script', () => {
    const js = buildLoaderScript(base({ k: 'glycoeden-up01-jvzoo', pv: { ...VSL('x', 'dddddddddddddddddddddddd', 10), s: 'https://x/</script><script>alert(1)</script>__NS_VSL_HOSTS__' } }));
    expect(js).not.toContain('</script>');
    const pg = page();
    expect(() => pg.run(js)).not.toThrow();
    expect(pg.scripts()).toHaveLength(1);
  });
});

describe('script da página — o que NÃO pode quebrar a venda', () => {
  const fallbackSnippet = () => buildVslSnippet({
    key: 'glycoeden-up01-jvzoo', origin: 'https://dash.thenorthscales.com',
    fallback: { name: 'Glyco v1', playerId: 'aaaaaaaaaaaaaaaaaaaaaaaa', scriptUrl: 'https://scripts.converteai.net/acc/players/aaaaaaaaaaaaaaaaaaaaaaaa/v4/player.js', aspectPct: 133.333, pitchSeconds: 327 },
  }).match(/<script>([\s\S]*)<\/script>/)![1];

  it('player já carregado por outro script: não troca nada e rastreia o que está tocando', () => {
    const pg = page();
    pg.ctx._vturbPlayerLoaded = true;
    pg.run(buildLoaderScript(base()));
    expect(pg.player.id).toBe('vid-aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(pg.ctx.VSL_REVEAL_DELAY).toBe(327);
    expect(pg.scripts()).toEqual([]);
    expect(pg.beacons[0]).toMatchObject({ e: 'view', pl: 'aaaaaaaaaaaaaaaaaaaaaaaa', t: null });
  });

  it('dash lento: o vigia do snippet carrega a reserva 2 s depois do HTML pronto; o script atrasado não mexe', () => {
    const pg = page();
    (pg.document as { readyState: string }).readyState = 'loading';
    pg.run(fallbackSnippet());
    pg.tick(5000); // ainda lendo o HTML: espera
    expect(pg.scripts()).toEqual([]);
    (pg.document as { readyState: string }).readyState = 'interactive'; // HTML pronto, script do dash pendurado
    pg.tick(1500);
    expect(pg.scripts()).toEqual([]);
    pg.tick(1500);
    expect(pg.scripts()).toEqual(['https://scripts.converteai.net/acc/players/aaaaaaaaaaaaaaaaaaaaaaaa/v4/player.js']);
    pg.run(buildLoaderScript(base())); // chega atrasado
    expect(pg.player.id).toBe('vid-aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(pg.scripts()).toHaveLength(1);
  });

  it('erro no meio do script: carrega a reserva', () => {
    const pg = page();
    (pg.player as unknown as { style: unknown }).style = undefined; // força TypeError na troca
    pg.run(buildLoaderScript(base()));
    expect(pg.scripts()).toEqual(['https://scripts.converteai.net/acc/players/aaaaaaaaaaaaaaaaaaaaaaaa/v4/player.js']);
  });

  it('copy white não trava a reserva: se a copy virar black, o snippet ainda carrega o player', () => {
    const pg = page({ black: false });
    pg.run(buildLoaderScript(base()));
    expect(pg.ctx.NS_VSL_LOADED).toBeUndefined();
    pg.ctx._copyBlack = true;
    (pg.document as { readyState: string }).readyState = 'loading';
    pg.run(fallbackSnippet());
    pg.fireDocument('DOMContentLoaded');
    expect(pg.scripts()).toHaveLength(1);
  });

  it('classificação: "decline" no texto do botão de compra continua sendo aceite; recusa da plataforma é recusa', () => {
    const pg = page();
    pg.run(buildLoaderScript(base()));
    const cases: Array<[string, string, string | null]> = [
      ['https://www.jvzoo.com/b/1/2/3', 'YES! Stop cognitive decline today', 'accept'],
      ['https://www.buygoods.com/secure/upsell?x=1', "Don't skip your bonus — add to order", 'accept'],
      ['https://www.jvzoo.com/nothanks/123456', 'No thanks', 'decline'],
      ['https://www.digistore24.com/answer/no', "I'll pass on this offer", 'decline'],
      ['https://acme.pay.clickbank.net/?cbur=d', 'No', 'decline'],
      ['https://acme.pay.clickbank.net/?cbur=a', 'Yes', 'accept'],
      ['https://www.jvzoosupport.com/', 'Support', null],
    ];
    for (const [href, text, want] of cases) {
      const p = page();
      p.run(buildLoaderScript(base()));
      p.click(p.link(href, text));
      const kinds = p.beacons.map((b) => b.e).filter((e) => e === 'accept' || e === 'decline');
      expect([href, kinds[0] ?? null]).toEqual([href, want]);
    }
    expect(pg.beacons[0].e).toBe('view');
  });
});
