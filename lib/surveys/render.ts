// HTML da página pública da pesquisa (checkin.<domínio>/<variante>/<token>).
//
// Uma página só, servida pronta pelo servidor: CSS e JS embutidos, sem fonte
// externa, sem framework — abre rápido no celular. Uma pergunta por tela;
// escolha única avança sozinha, múltipla tem "Continue". Cada resposta é
// gravada na hora (POST /api/survey/answer), em fila, e o "finish" leva todas
// as respostas de novo — o servidor decide a tela final (decideOutcome).
// Todas as telas finais já vêm no HTML (uma por faixa de cupom); a página só
// mostra a que o servidor escolheu.

import {
  DEFAULT_COPY, Q1_OPTS, Q3_OPTS, Q3B_OPTS, Q5_OPTS, Q5_MAX,
  availableOffers, copyText, couponVars, fillText, kitSizeFor, q4Options, questionOrder, segmentOf, surveyVars,
  type CheckoutKind, type Outcome, type SurveyAnswers, type SurveyContext, type SurveyVariantConfig,
} from './fimTratamento';

export interface RenderSurveyInput {
  cfg: SurveyVariantConfig;
  ctx: SurveyContext;
  slug: string;
  /** Vazio na pré-visualização. */
  token: string;
  preview: boolean;
  answers: SurveyAnswers;
  /** Já concluída: abre direto na tela final. */
  outcome: Outcome | null;
  couponPct: number | null;
  followUp: boolean;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const DEFAULT_ACCENT = '#2f6fde';
const accentOf = (cfg: SurveyVariantConfig) =>
  cfg.accent && /^#[0-9a-f]{3,8}$/i.test(cfg.accent) ? cfg.accent : DEFAULT_ACCENT;
const imageOf = (cfg: SurveyVariantConfig) =>
  cfg.image && /^\/survey-assets\/[\w.-]+$/.test(cfg.image) ? cfg.image : null;

/** Seção final pelo desfecho (cupom tem uma por faixa). */
export const endSectionId = (outcome: Outcome, couponPct: number | null) =>
  outcome === 'cupom' && couponPct ? `end-cupom-${couponPct}` : `end-${outcome}`;

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.6l-5.9 3.1 1.2-6.6-4.8-4.6 6.6-.9z"/></svg>';

const CSS = `
:root{--ink:#16181d;--muted:#5b6170;--line:#e3e5ea;--bg:#f6f7f9;--card:#fff}
*{box-sizing:border-box}html,body{margin:0}
body{font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
.wrap{max-width:560px;margin:0 auto;padding:12px 16px 28px;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;min-height:44px}
.brand{grid-column:2;font-weight:700;font-size:15px;letter-spacing:.01em;text-align:center}
.stepn{grid-column:3;justify-self:end;font-size:13px;color:var(--muted)}
.back{grid-column:1;justify-self:start;min-height:44px;padding:0 4px;background:none;border:0;font:inherit;font-size:15px;color:var(--muted);cursor:pointer}
.bar{height:4px;background:var(--line);border-radius:2px;overflow:hidden;margin:6px 0 24px}
.bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .3s ease}
section{display:none}section.on{display:block;animation:in .22s ease-out}
@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
h1{font-size:25px;line-height:1.28;margin:0 0 12px;letter-spacing:-.01em;outline:0}
.lead{color:var(--muted);margin:0 0 22px}
.hero{display:block;width:150px;height:auto;aspect-ratio:594/640;margin:0 auto 18px}
.hero.sm{width:118px;margin-bottom:14px}
.hint{font-size:15px;color:var(--muted);margin:-4px 0 16px}.hint.warn{color:#b4540a}
.opt{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:13px 16px;margin:0 0 10px;border:1.5px solid var(--line);border-radius:12px;background:var(--card);font:inherit;color:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background-color .15s;touch-action:manipulation}
.opt:hover{border-color:#c6c9d0}
.opt[aria-pressed=true]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,#fff)}
.box{flex:none;width:22px;height:22px;border:1.5px solid #b6bac3;border-radius:6px;display:grid;place-items:center}
[data-single] .box{border-radius:50%}
.opt[aria-pressed=true] .box{background:var(--accent);border-color:var(--accent)}
.opt[aria-pressed=true] .box::after{content:"";width:6px;height:11px;border:solid #fff;border-width:0 2px 2px 0;transform:translateY(-1px) rotate(45deg)}
[data-single] .opt[aria-pressed=true] .box::after{width:8px;height:8px;border:0;border-radius:50%;background:#fff;transform:none}
.btn{display:block;width:100%;min-height:54px;padding:15px 20px;border:0;border-radius:12px;background:var(--accent);color:#fff;font:inherit;font-weight:600;text-align:center;text-decoration:none;cursor:pointer;touch-action:manipulation}
.btn[disabled]{opacity:.4;cursor:default}
.alt{display:block;width:100%;margin-top:12px;padding:13px 16px;border:1.5px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font-weight:600;text-align:center;text-decoration:none}
.link{display:block;width:100%;min-height:48px;margin-top:8px;background:none;border:0;color:var(--muted);font:inherit;text-decoration:underline;cursor:pointer}
.atalho{display:block;margin-top:18px;padding:12px 0;background:none;border:0;color:var(--accent);font:inherit;font-weight:600;cursor:pointer;text-align:left}
.stars{display:flex;gap:8px;margin:4px 0 10px}
.star{flex:1;max-width:72px;aspect-ratio:1;border:1.5px solid var(--line);border-radius:12px;background:var(--card);cursor:pointer;display:grid;place-items:center;touch-action:manipulation}
.star svg{width:58%;height:58%;fill:#d4d7dd;transition:fill .12s}.star.on svg{fill:#f2a516}
.scale{display:flex;justify-content:space-between;gap:12px;font-size:14px;color:var(--muted)}
label.cap{display:block;font-size:15px;color:var(--muted);margin:10px 0 6px}
textarea{display:block;width:100%;min-height:92px;padding:12px 14px;border:1.5px solid var(--line);border-radius:12px;font:inherit;font-size:16px;resize:vertical;margin:0 0 18px;background:var(--card)}
.code{display:inline-block;padding:1px 9px;border:1.5px dashed var(--accent);border-radius:8px;color:var(--ink);font-weight:700;letter-spacing:.05em}
.foot{margin-top:auto;padding-top:36px;font-size:12px;color:#979dab;text-align:center}
:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}
h1:focus,h1:focus-visible{outline:0}
@media (prefers-reduced-motion:reduce){section.on{animation:none}.bar i,.star svg{transition:none}}
`;

// Navegação e gravação. ES2017 sem dependência; posts em fila pra resposta
// nunca chegar depois do "finish".
const JS = `
(function(){
var D=JSON.parse(document.getElementById('d').textContent),A=D.answers||{},hist=[],cur=null,busy=false,chain=Promise.resolve();
var STEP={};D.order.forEach(function(q,i){STEP[q]=i+1});STEP.q3b=STEP.q3;
function $(s,r){return (r||document).querySelector(s)}
function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
var bar=$('#bar'),back=$('#back'),stepn=$('#stepn');
function show(id){
  $$('section').forEach(function(s){s.classList.toggle('on',s.id===id)});cur=id;var n=STEP[id];
  if(id.indexOf('end-')===0){var c=A.q3==='todo_dia'?'constante':'padrao';var sec=$('#'+id);
    if($('[data-body="constante"]',sec))$$('[data-body]',sec).forEach(function(p){p.hidden=p.getAttribute('data-body')!==c})}
  bar.style.width=(n?(n-.5)/D.total*100:(id==='intro'?0:100))+'%';
  back.hidden=!n||!hist.length;stepn.textContent=n?D.stepLabel.replace('{n}',n):'';
  window.scrollTo(0,0);var h=$('#'+id+' h1');if(h&&h.focus)h.focus({preventScroll:true});
}
function go(id){if(cur)hist.push(cur);show(id)}
back.onclick=function(){var p=hist.pop();if(p)show(p)};
function post(body){
  if(D.preview)return Promise.resolve(null);body.t=D.token;
  chain=chain.then(function(){return fetch(D.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})});
  return chain;
}
function save(q,v){A[q]=v;post({q:q,v:v})}
function after(q){
  if(q==='q1')return A.atalho?finish():go('q2');
  if(q==='q2')return go('q3');
  if(q==='q3')return go(A.q3==='parou'?'q3b':'q4');
  if(q==='q3b')return go('q4');
}
$$('[data-single] .opt,.star').forEach(function(b){b.addEventListener('click',function(){
  var q=b.getAttribute('data-q'),v=b.getAttribute('data-v');if(q==='q2')v=Number(v);
  $$('[data-q="'+q+'"]').forEach(function(o){o.setAttribute('aria-pressed',String(o===b))});
  if(q==='q2')$$('.star').forEach(function(s){s.classList.toggle('on',Number(s.getAttribute('data-v'))<=v)});
  save(q,v);setTimeout(function(){after(q)},180);
})});
$$('[data-multi] .opt').forEach(function(b){b.addEventListener('click',function(){
  var sec=b.closest('section'),max=Number(sec.getAttribute('data-max')||99),on=b.getAttribute('aria-pressed')==='true';
  var hint=$('.hint',sec);
  if(!on&&$$('.opt[aria-pressed="true"]',sec).length>=max){if(hint)hint.classList.add('warn');return}
  if(hint)hint.classList.remove('warn');
  b.setAttribute('aria-pressed',String(!on));$('[data-next]',sec).disabled=!$$('.opt[aria-pressed="true"]',sec).length;
})});
function picked(id){return $$('#'+id+' .opt[aria-pressed="true"]').map(function(o){return o.getAttribute('data-v')})}
$('#start').onclick=function(){go(D.order[0])};
var at=$('#atalho');if(at)at.onclick=function(){save('atalho',true);if(D.order[0]==='q1')go('q1');else finish()};
$('#q4 [data-next]').onclick=function(){save('q4',picked('q4'));go('q5')};
$('#q5 [data-next]').onclick=function(){save('q5',picked('q5'));var c=$('#comentario').value.trim();if(c)save('comentario',c);finish()};
function finish(){
  if(busy)return;busy=true;$$('[data-next]').forEach(function(b){b.disabled=true});
  var p=D.preview
    ?fetch(D.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preview:true,slug:D.slug,bottles:D.bottles,answers:A})}).then(function(r){return r.json()}).catch(function(){return null})
    :post({finish:true,answers:A});
  p.then(function(r){
    busy=false;var o=(r&&r.outcome)||'obrigado';
    if(A.atalho&&!D.preview&&(o==='recorrencia'||o==='oferta')){location.href=o==='recorrencia'?D.goUrl.assinatura:D.goUrl.kit;return}
    var f=$('#followup');if(f&&r&&r.followUp)f.hidden=false;
    var id=o==='cupom'&&r.couponPct?'end-cupom-'+r.couponPct:'end-'+o;if(!$('#'+id))id='end-obrigado';
    hist=[];show(id);
  });
}
$$('[data-dismiss]').forEach(function(b){b.onclick=function(){save('dispensou',true);hist=[];show('end-obrigado')}});
show(D.start);
})();
`;

function page(title: string, accent: string, body: string, script = ''): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + `<title>${esc(title)}</title><style>${CSS}</style></head>`
    + `<body><main class="wrap" style="--accent:${accent}">${body}</main>${script}</body></html>`;
}

export function renderSurveyPage(input: RenderSurveyInput): string {
  const { cfg, ctx } = input;
  const segment = segmentOf(cfg, ctx.bottles);
  const order = questionOrder(segment);
  const kit = kitSizeFor(cfg, segment, ctx.bottles);
  const av = availableOffers(cfg, kit);
  const vars = surveyVars(cfg, ctx);
  const tv = (key: string, v = vars) => esc(fillText(copyText(cfg, key, segment), v));
  const t = (key: string) => tv(key);
  const img = imageOf(cfg);
  const hero = (cls = 'hero') => (img ? `<img class="${cls}" src="${img}" width="594" height="640" alt="${esc(cfg.productName)}">` : '');

  const goUrl = (kind: CheckoutKind, pct?: number): string => {
    if (!input.preview) return `/api/survey/go?t=${encodeURIComponent(input.token)}&o=${kind}`;
    if (kind === 'assinatura') return cfg.offers?.assinatura?.url ?? '#';
    const kitUrl = kit != null ? cfg.offers?.kits?.[String(kit)]?.url : null;
    if (kind === 'cupom') return cfg.coupons?.find((c) => c.pct === pct)?.kits?.[String(kit)] ?? kitUrl ?? '#';
    return kitUrl ?? '#';
  };
  const target = input.preview ? ' target="_blank" rel="noopener"' : '';

  const single = (q: string, opts: readonly string[]) =>
    `<div data-single>${opts.map((v) =>
      `<button type="button" class="opt" data-q="${q}" data-v="${v}" aria-pressed="false"><span class="box"></span>${t(`${q}.${v}`)}</button>`).join('')}</div>`;
  const multi = (q: string, opts: { id: string; label: string }[]) =>
    `<div data-multi>${opts.map((o) =>
      `<button type="button" class="opt" data-q="${q}" data-v="${esc(o.id)}" aria-pressed="false"><span class="box"></span>${esc(fillText(o.label, vars))}</button>`).join('')}</div>`;
  const question = (id: string, title: string, inner: string, attrs = '') =>
    `<section id="${id}"${attrs}><h1 tabindex="-1">${title}</h1>${inner}</section>`;

  /** Corpo da oferta; no público completo, uma versão pra quem tomou todo dia. */
  const body = (key: string, v: Record<string, string>, code?: string) => {
    const mark = (s: string) => (code ? s.replace(esc(code), `<span class="code">${esc(code)}</span>`) : s);
    const padrao = `<p class="lead" data-body="padrao">${mark(tv(key, v))}</p>`;
    if (segment !== 'completo') return padrao;
    const constKey = `${key}@completo_constante`;
    if (cfg.copy?.[constKey] == null && !(constKey in DEFAULT_COPY)) return padrao;
    return padrao + `<p class="lead" data-body="constante" hidden>${mark(esc(fillText(copyText(cfg, key, 'completo_constante'), v)))}</p>`;
  };
  const offer = (id: string, base: string, primary: CheckoutKind, alt: CheckoutKind | null, v = vars, pct?: number, code?: string) =>
    `<section id="${id}">${hero('hero sm')}<h1 tabindex="-1">${tv(`${base}.title`, v)}</h1>${body(`${base}.body`, v, code)}`
    + `<a class="btn" href="${esc(goUrl(primary, pct))}"${target}>${tv(`${base}.cta`, v)}</a>`
    + (alt ? `<a class="alt" href="${esc(goUrl(alt))}"${target}>${tv(`${base}.alt`, v)}</a>` : '')
    + `<button type="button" class="link" data-dismiss>${t('end.dispensar')}</button></section>`;

  const stars = [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="star" data-q="q2" data-v="${n}" aria-pressed="false" aria-label="${n} of 5">${STAR}</button>`).join('');

  const coupons = av.cupons.map((pct) => {
    const v = { ...vars, ...couponVars(cfg, ctx, pct) };
    return offer(`end-cupom-${pct}`, 'end.cupom', 'cupom', av.assinatura ? 'assinatura' : null, v, pct, v.cupom);
  });

  const sections = [
    `<section id="intro">${hero()}<h1 tabindex="-1">${t('intro.title')}</h1><p class="lead">${t('intro.body')}</p>`
      + `<button type="button" class="btn" id="start">${t('intro.cta')}</button>`
      + (av.assinatura || av.kit ? `<button type="button" class="atalho" id="atalho">${t('intro.atalho')}</button>` : '')
      + '</section>',
    order.includes('q1') ? question('q1', t('q1.title'), single('q1', Q1_OPTS)) : '',
    question('q2', t('q2.title'), `<div class="stars">${stars}</div><div class="scale"><span>${t('q2.low')}</span><span>${t('q2.high')}</span></div>`),
    question('q3', t('q3.title'), single('q3', Q3_OPTS)),
    question('q3b', t('q3b.title'), single('q3b', Q3B_OPTS)),
    question('q4', t('q4.title'),
      `<p class="hint">${t('q4.hint')}</p>${multi('q4', q4Options(cfg))}`
      + `<button type="button" class="btn" data-next disabled>${t('nav.continue')}</button>`),
    question('q5', t('q5.title'),
      `<p class="hint">${t('q5.hint')}</p>${multi('q5', Q5_OPTS.map((id) => ({ id, label: copyText(cfg, `q5.${id}`, segment) })))}`
      + `<label class="cap" for="comentario">${t('q5.comentario')}</label><textarea id="comentario" maxlength="2000"></textarea>`
      + `<button type="button" class="btn" data-next disabled>${t('q5.enviar')}</button>`,
      ` data-max="${Q5_MAX}"`),
    `<section id="end-cs"><h1 tabindex="-1">${t('end.cs.title')}</h1><p class="lead">${t('end.cs.body')}</p></section>`,
    av.assinatura ? offer('end-recorrencia', 'end.recorrencia', 'assinatura', av.kit ? 'kit' : null) : '',
    av.kit ? offer('end-oferta', 'end.oferta', 'kit', av.assinatura ? 'assinatura' : null) : '',
    ...coupons,
    `<section id="end-obrigado"><h1 tabindex="-1">${t('end.obrigado.title')}</h1><p class="lead">${t('end.obrigado.body')}</p>`
      + `<p class="lead" id="followup"${input.followUp ? '' : ' hidden'}>${t('end.obrigado.followup')}</p></section>`,
  ].join('');

  const data = {
    token: input.token,
    slug: input.slug,
    bottles: ctx.bottles,
    preview: input.preview,
    api: '/api/survey/answer',
    goUrl: { assinatura: goUrl('assinatura'), kit: goUrl('kit') },
    order,
    total: order.length,
    stepLabel: fillText(copyText(cfg, 'nav.step', segment), { total: String(order.length) }),
    answers: input.answers,
    start: input.outcome ? endSectionId(input.outcome, input.couponPct) : 'intro',
  };
  const top = `<div class="top"><button type="button" class="back" id="back" hidden>← ${t('nav.back')}</button>`
    + `<span class="brand">${esc(cfg.productName)}</span><span class="stepn" id="stepn"></span></div>`
    + '<div class="bar"><i id="bar"></i></div>';
  const script = `<script type="application/json" id="d">${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script>${JS}</script>`;
  return page(fillText(copyText(cfg, 'page.title'), vars), accentOf(cfg), top + sections, script);
}

/** Link inválido, expirado ou de variante desligada. */
export function renderSurveyInvalid(cfg: SurveyVariantConfig | null): string {
  const c = cfg ?? { productName: '' };
  const vars = surveyVars(c, { firstName: null, bottles: 0 });
  const t = (key: string) => esc(fillText(copyText(c, key), vars));
  return page(c.productName || 'Check-in', accentOf(c),
    `<div class="top"><span></span><span class="brand">${esc(c.productName)}</span><span></span></div>`
    + `<div class="bar"><i style="width:100%"></i></div>`
    + `<section class="on"><h1>${t('invalid.title')}</h1><p class="lead">${t('invalid.body')}</p></section>`);
}
