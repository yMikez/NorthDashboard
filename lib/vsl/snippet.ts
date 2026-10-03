// Snippet que a equipe cola na página no lugar do player do VTurb. Gerado
// pelo dash (aba VSLs → Páginas → Snippet), já com a chave da página e a VSL
// de reserva (a que está na página hoje).
//
// Como funciona na página:
//   1. o <vturb-smartplayer> já nasce com a VSL de reserva (id, data-vdelay);
//   2. o <script defer> do dash roda DEPOIS do HTML lido e ANTES do
//      DOMContentLoaded — troca o player e o pitch (window.VSL_REVEAL_DELAY e
//      data-vdelay) antes do vsl-reveal.js/copy-switch lerem;
//   3. se o script do dash não carregar, o <script> inline carrega a reserva
//      no DOMContentLoaded — a página fica exatamente como era.

import { formatPitch } from './catalog';

export interface SnippetVsl {
  name: string;
  playerId: string;
  scriptUrl: string;
  aspectPct: number | null;
  pitchSeconds: number;
}

/** Tira o que fecharia o comentário HTML ou quebraria a linha. */
function commentSafe(s: string): string {
  return s.replace(/--+/g, '-').replace(/[<>]/g, '').replace(/[\r\n]+/g, ' ').slice(0, 80);
}

/**
 * "Memória do afiliado" (BuyGoods) — cola na PÁGINA DE VENDAS. O upsell da
 * BuyGoods não recebe o afiliado na URL; a página de vendas tem, no link de
 * checkout (aff_id + account_id). Guarda `aff_id@account_id` no localStorage
 * do domínio (o mesmo do upsell) — o script do dash no upsell lê dali. Não
 * chama o dash: a página de vendas não ganha dependência nenhuma.
 */
export function buildAffiliateMemorySnippet(): string {
  const js =
    `(function(){function s(h){try{var u=new URL(h,location.href);if(u.hostname.toLowerCase().indexOf("buygoods.com")<0)return;` +
    `var a=u.searchParams.get("aff_id"),c=(u.searchParams.get("account_id")||"").split(",")[0];if(!a||!c)return;` +
    `localStorage.setItem("ns_aff",JSON.stringify({p:"buygoods",k:a+"@"+c,t:Date.now()}));}catch(e){}}` +
    `function scan(){var l=document.querySelectorAll('a[href*="buygoods.com"]');for(var i=0;i<l.length;i++){var h=l[i].href||"";if(h.indexOf("aff_id=")>=0){s(h);return;}}}` +
    `document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(a)s(a.href);},true);` +
    `if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",scan);else scan();setTimeout(scan,2500);setTimeout(scan,6000);})();`;
  return [
    `<!-- NorthScale · memória do afiliado (BuyGoods). Cole na PÁGINA DE VENDAS,`,
    `     em qualquer lugar do <body>. Guarda o afiliado do link de checkout pra o upsell`,
    `     (mesmo domínio) saber de quem é a venda. Não chama o dash. -->`,
    `<script>${js}</script>`,
  ].join('\n');
}

export function playerMaxWidth(aspectPct: number | null | undefined): string {
  return aspectPct != null && aspectPct < 110 ? '960px' : '400px';
}

export function buildVslSnippet(o: { key: string; origin: string; fallback: SnippetVsl }): string {
  const { key, fallback: f } = o;
  const origin = o.origin.replace(/\/+$/, '');
  const aspect = f.aspectPct ?? 56.25;
  // Reserva: no DOMContentLoaded (o script do dash falhou) e por vigia — se o
  // HTML já terminou de carregar e o script do dash não rodou em 2 s (dash
  // lento), carrega a reserva sem esperar. Script do dash atrasado que chega
  // depois vê o player carregado e não troca nada.
  const inline =
    `(function(){var k="${key}";function f(){if(window.NS_VSL_LOADED||window._vturbPlayerLoaded)return;` +
    `var p=document.querySelector('vturb-smartplayer[data-ns-vsl="'+k+'"]');if(!p||!p.isConnected)return;` +
    `if(window._copyBlack===false&&p.closest&&p.closest("#copyb"))return;window._vturbPlayerLoaded=true;` +
    `var s=document.createElement("script");s.src=p.getAttribute("data-ns-fallback");s.async=true;document.head.appendChild(s);}` +
    `var t0=0;function w(){if(window.NS_VSL_LOADED||window._vturbPlayerLoaded)return;` +
    `if(document.readyState==="loading"){setTimeout(w,500);return;}if(!t0)t0=Date.now();` +
    `if(Date.now()-t0<2000){setTimeout(w,500);return;}f();}setTimeout(w,500);` +
    `if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",f);else f();})();`;
  return [
    `<!-- NorthScale · VSL da página ${key} (aba VSLs do dash).`,
    `     A VSL e o tempo do pitch vêm do dash. Se o dash não responder, toca a reserva:`,
    `     ${commentSafe(f.name)} · pitch ${formatPitch(f.pitchSeconds)}. -->`,
    `<vturb-smartplayer id="vid-${f.playerId}" data-ns-vsl="${key}" data-vdelay="${f.pitchSeconds}" ` +
      `data-ns-fallback="${f.scriptUrl}" style="display:block;margin:0 auto;width:100%;max-width:${playerMaxWidth(f.aspectPct)}">` +
      `<div class="vturb-player-placeholder" style="position:relative;width:100%;padding:${aspect}% 0 0;z-index:0;background-color:black"></div>` +
      `</vturb-smartplayer>`,
    `<script defer src="${origin}/api/vsl/p/${key}.js"></script>`,
    `<script>${inline}</script>`,
  ].join('\n');
}
