// Script servido em /api/vsl/p/<chave>.js — roda na página de upsell/downsell
// (carregado com defer pelo snippet). ES5 de propósito: página de funil roda
// em todo tipo de celular.
//
// O que ele faz, nesta ordem:
//   1. acha o <vturb-smartplayer data-ns-vsl="<chave>"> do snippet;
//   2. copy white (player dentro de #copyb e _copyBlack=false): não toca em
//      nada — a página segue como estava;
//   3. outro script já carregou um player (reserva do snippet por timeout,
//      script da própria página): não troca nada, só rastreia o que está lá;
//   4. escolhe a VSL: pré-visualização (?ns_vsl_preview=1) > teste A/B (braço
//      sorteado UMA vez por visitante e guardado) > VSL da página > reserva
//      do snippet (página desligada ou sem VSL);
//   5. troca id/proporção do player, data-vdelay e window.VSL_REVEAL_DELAY
//      ANTES do vsl-reveal.js/copy-switch lerem (defer roda antes do
//      DOMContentLoaded e na ordem do documento) e carrega o player.js;
//   6. registra a visita (view → play → pitch → aceite/recusa) via beacon,
//      dizendo QUAL player tocou (o servidor resolve a VSL pelo player).
//      Sem dado pessoal: só ids de sessão da plataforma (sessid2…).
// Qualquer erro no meio: carrega a reserva do snippet (a página nunca fica
// sem vídeo por causa do dash).

export interface LoaderVsl {
  id: string;
  /** playerId */
  p: string;
  /** scriptUrl */
  s: string;
  /** aspectPct */
  a: number | null;
  /** pitch em segundos */
  t: number;
}

export interface LoaderConfig {
  /** chave da página */
  k: string;
  /** página ligada */
  on: boolean;
  /** VSL da página (sem teste) */
  v: LoaderVsl | null;
  /** teste A/B rodando */
  t: { id: string; arms: Array<{ id: string; w: number; v: LoaderVsl }> } | null;
  /** pré-visualização ativa */
  pv: LoaderVsl | null;
  /** endpoint do beacon (null = não rastreia) */
  e: string | null;
}

/** Hosts de checkout: clique num link pra eles = aceitou a oferta. */
export const CHECKOUT_HOSTS = [
  'jvzoo.com', 'jvz1.com', 'jvz2.com', 'jvz3.com', 'jvz4.com', 'jvz5.com', 'jvz6.com',
  'jvz7.com', 'jvz8.com', 'jvz9.com', 'jvz10.com', 'jvz11.com', 'jvz12.com', 'jvzseller.com',
  'buygoods.com', 'clickbank.net', 'digistore24.com', 'checkout-ds24.com',
  'cartpanda.com', 'mycartpanda.com',
];

// Sem crase nem ${ aqui dentro (é String.raw). Sem barra invertida também:
// o que precisaria de escape usa classe de caractere ([.], [/]) ou split.
const LOADER_SOURCE = String.raw`(function () {
  'use strict';
  var C = __NS_VSL_CONFIG__;
  var HOSTS = __NS_VSL_HOSTS__;
  if (window.NS_VSL_LOADED) return;
  var el = null;
  try { el = document.querySelector('vturb-smartplayer[data-ns-vsl="' + C.k + '"]'); } catch (e) {}
  if (!el) return;

  // Copy white: o player está no #copyb e a página não mostra a VSL. Não
  // marca nada — se o copy-switch mudar de ideia, a reserva do snippet cuida.
  if (window._copyBlack === false && el.closest && el.closest('#copyb')) return;

  function fallbackSrc() { return el.getAttribute('data-ns-fallback'); }
  function inject(src) {
    if (!src || window._vturbPlayerLoaded) return;
    window._vturbPlayerLoaded = true;
    var sc = document.createElement('script');
    sc.src = src;
    sc.async = true;
    document.head.appendChild(sc);
  }
  function param(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }
  function sget(store, key) { try { return window[store].getItem(key); } catch (e) { return null; } }
  function sset(store, key, val) { try { window[store].setItem(key, val); } catch (e) {} }
  function rid() {
    var s = '';
    for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 2176782336).toString(36);
    return s.slice(0, 24);
  }
  function djb2(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) + s.charCodeAt(i)) % 4294967296;
    return h;
  }
  function pickArm(arms, seed) {
    var total = 0, i;
    for (i = 0; i < arms.length; i++) total += Math.max(0, arms[i].w);
    if (total <= 0) return null;
    var b = djb2(seed) % total, acc = 0;
    for (i = 0; i < arms.length; i++) {
      acc += Math.max(0, arms[i].w);
      if (b < acc) return arms[i];
    }
    return arms[arms.length - 1];
  }
  function cookie(name) {
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=');
        if (kv[0].trim() === name) return decodeURIComponent(kv.slice(1).join('='));
      }
    } catch (e) {}
    return null;
  }

  var previewMode = !!param('ns_vsl_preview');
  var arm = null, vsl = null, testId = null, pitch = null, player = null;
  try {
    window.NS_VSL_LOADED = true;
    if (window._vturbPlayerLoaded) {
      // Alguém já carregou um player (reserva por timeout, script da página):
      // trocar o elemento agora deixaria a página sem vídeo.
      player = (el.id || '').replace(/^vid-/, '');
    } else {
      if (previewMode && C.pv) {
        vsl = C.pv;
      } else if (C.on) {
        vsl = C.v;
        if (!previewMode && C.t && C.t.arms && C.t.arms.length) {
          var vid = sget('localStorage', 'ns_vsl_vid');
          if (!vid) { vid = rid(); sset('localStorage', 'ns_vsl_vid', vid); }
          var saved = sget('localStorage', 'ns_vsl_t_' + C.t.id);
          for (var a = 0; a < C.t.arms.length; a++) if (C.t.arms[a].id === saved) arm = C.t.arms[a];
          if (!arm) {
            arm = pickArm(C.t.arms, vid + ':' + C.t.id);
            if (arm) sset('localStorage', 'ns_vsl_t_' + C.t.id, arm.id);
          }
          if (arm) { vsl = arm.v; testId = C.t.id; }
        }
      }
      if (vsl) {
        el.id = 'vid-' + vsl.p;
        el.setAttribute('data-vdelay', String(vsl.t));
        window.VSL_REVEAL_DELAY = vsl.t;
        if (vsl.a) {
          el.style.maxWidth = vsl.a < 110 ? '960px' : '400px';
          var ph = el.querySelector('.vturb-player-placeholder') || el.firstElementChild;
          if (ph && ph.style) ph.style.paddingTop = vsl.a + '%';
        }
        player = vsl.p;
        inject(vsl.s);
      } else {
        player = (el.id || '').replace(/^vid-/, '');
        inject(fallbackSrc());
      }
    }
    var d = parseInt(el.getAttribute('data-vdelay'), 10);
    pitch = vsl ? vsl.t : (typeof window.VSL_REVEAL_DELAY === 'number' ? window.VSL_REVEAL_DELAY : (d > 0 ? d : null));
  } catch (err) {
    inject(fallbackSrc());
    return;
  }
  window.NS_VSL = { key: C.k, player: player, pitch: pitch, testId: testId, armId: arm ? arm.id : null, preview: previewMode };

  var lastTu = 0;
  el.addEventListener('player:timeupdate', function (e) {
    var t = e && e.detail && e.detail.currentTime;
    if (typeof t === 'number') lastTu = t;
  });
  function currentTime() {
    try {
      var sp = window.smartplayer;
      var inst = sp && sp.instances && sp.instances[0];
      var t = inst && inst.video && inst.video.currentTime;
      if (typeof t === 'number' && t > 0) return t;
    } catch (e) {}
    return lastTu;
  }
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  if (previewMode) {
    if (!vsl || vsl !== C.pv) return;
    var b = document.createElement('div');
    b.setAttribute('role', 'status');
    b.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#1A1E26;color:#F4F5F7;font:13px/1.45 system-ui,sans-serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:300px');
    var mount = function () { document.body.appendChild(b); };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    setInterval(function () {
      var t = currentTime();
      b.textContent = 'Pré-visualização NorthScale · pitch ' + fmt(pitch) +
        ' · vídeo em ' + fmt(t) + (pitch && t >= pitch ? ' · oferta liberada' : '');
    }, 500);
    return;
  }
  if (!C.e || !player) return;

  var vkey = 'ns_vsl_v_' + C.k + '_' + player + '_' + (arm ? arm.id : '');
  var visit = sget('sessionStorage', vkey);
  if (!visit) { visit = rid(); sset('sessionStorage', vkey, visit); }
  var sk = null;
  var sid2 = param('sessid2') || cookie('sessid2');
  if (sid2) sk = 'sessid2:' + sid2;
  else if (param('cbreceipt')) sk = 'cbreceipt:' + param('cbreceipt');
  else if (param('order_id')) sk = 'order:' + param('order_id');

  var sent = {};
  var maxSec = 0, lastFlush = 0;
  function send(type, once) {
    if (once && sent[type]) return;
    sent[type] = true;
    var body = JSON.stringify({
      k: C.k, v: visit, pl: player, t: testId, a: arm ? arm.id : null, e: type, s: maxSec,
      sk: sk ? sk.slice(0, 160) : null, u: (location.host + location.pathname).slice(0, 200)
    });
    try { if (navigator.sendBeacon && navigator.sendBeacon(C.e, body)) return; } catch (e) {}
    try { fetch(C.e, { method: 'POST', body: body, keepalive: true, mode: 'cors', headers: { 'Content-Type': 'text/plain' } }); } catch (e) {}
  }
  send('view', true);

  el.addEventListener('player:play', function () { send('play', true); });
  setInterval(function () {
    var t = currentTime();
    if (t > 0) send('play', true);
    var s = Math.floor(t);
    if (s > maxSec) maxSec = s;
    if (pitch && maxSec >= pitch) send('pitch', true);
    if (maxSec - lastFlush >= 60) { lastFlush = maxSec; send('progress'); }
  }, 2000);
  function flush() { if (maxSec > lastFlush) { lastFlush = maxSec; send('progress'); } }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);

  // Ordem importa: atributo explícito > cbur > URL de recusa da plataforma >
  // host de checkout (aceite) > texto/caminho de recusa (só fora do checkout —
  // copy de saúde usa "decline" no botão de compra).
  function isCheckout(host) {
    for (var i = 0; i < HOSTS.length; i++) {
      var h = HOSTS[i];
      if (host === h || host.slice(-(h.length + 1)) === '.' + h) return true;
    }
    return false;
  }
  function classify(n) {
    if (n.hasAttribute('data-ns-accept')) return 'accept';
    if (n.hasAttribute('data-ns-decline')) return 'decline';
    if (n.hasAttribute('data-jv-checkout')) return 'accept';
    if (n.hasAttribute('data-jv-next')) return 'decline';
    var href = n.getAttribute('href') || '';
    var text = (n.textContent || '').toLowerCase();
    var declineText = /no,? ?thanks|no thank|n[aã]o,? obrigad|skip this|i don.?t want|i do not want|i.ll pass|recusar|decline this/.test(text);
    if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return declineText ? 'decline' : null;
    var u;
    try { u = new URL(href, location.href); } catch (e) { return null; }
    var q = u.search.toLowerCase();
    var path = u.pathname.toLowerCase();
    if (/[?&]cbur=d(&|$)/.test(q)) return 'decline';
    if (/[?&]cbur=a(&|$)/.test(q)) return 'accept';
    if (/nothanks|no-thanks|no_thanks|[/]answer[/]no|[/]decline/.test(path) || /[?&](decline|nothanks|no_thanks)=/.test(q)) return 'decline';
    var host = u.hostname.toLowerCase().replace(/^www[.]/, '');
    if (isCheckout(host)) return 'accept';
    if (declineText || /down0?[0-9]|downsell|thank|obrigad/.test(path)) return 'decline';
    return null;
  }
  window.addEventListener('click', function (ev) {
    var t = ev.target;
    var n = t && t.closest ? t.closest('a,button,[data-ns-accept],[data-ns-decline]') : null;
    if (!n) return;
    var kind = classify(n);
    if (kind) send(kind, true);
  }, true);
})();
`;

const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');

/** JSON seguro dentro de <script>: sem fechar a tag nem quebrar linha JS. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEP, '\\u2028')
    .replace(PARA_SEP, '\\u2029');
}

export function buildLoaderScript(config: LoaderConfig): string {
  // Hosts primeiro: um valor da config nunca é interpretado como marcador.
  return LOADER_SOURCE
    .replace('__NS_VSL_HOSTS__', () => scriptJson(CHECKOUT_HOSTS))
    .replace('__NS_VSL_CONFIG__', () => scriptJson(config));
}
