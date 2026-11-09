/* GERADO — não editar à mão.
   Fonte: northscale-analytics/dados/afiliados/_pagina.html (painel de afiliados do time de dados) + dash_mike/pedidos_dash.js,
   adaptados por dash_mike/gerar_dash.py. Mude a fonte e rode o gerador.
   Regras do modelo: docs/kb/ranking-afiliados.md. Dados: GET /api/metrics/affiliate-ranking (+ /orders);
   premissas: /api/admin/affiliate-ranking/config.

   window.NSAfRanking.montar(root, opts) → { destroy }
     opts.dados            payload da API (campos, afs, rows, parceiros, gerado, d0, d1)
     opts.premissas        { pesos, ajustes, metas } do banco
     opts.podeEditar       true = admin (as mudanças nas Premissas são salvas para todos)
     opts.salvarPremissas  (premissas) => Promise
     opts.buscarPedidos    ({ contas, de, ate }) => Promise<pedido[]>
     opts.buscarTodosPedidos () => Promise<pacote>   todas as vendas (GET /api/metrics/affiliate-ranking/all-orders)
     opts.pagina           'ranking' | 'lista' (Visão Geral) | 'visao' (Visão Geral › Pontuação por curva)
                           | 'reemb' (Reembolso Prev.): a tela de entrada */
(function(){
function montar(root,opts){
const _offs=[];
const _on=(t,ev,fn,o)=>{const w=e=>{if(root.isConnected)fn(e)};t.addEventListener(ev,w,o);_offs.push(()=>t.removeEventListener(ev,w,o))};
// premissas: as chaves ns-af-* (pesos, ajustes, metas) vão para o banco; o resto (ex.: agrupar) fica no navegador
const CFG=JSON.parse(JSON.stringify(opts.premissas||{}));let _salvaT=null;
const _CH={'ns-af-pesos':'pesos','ns-af-ajustes':'ajustes','ns-af-metas':'metas'};
const _agenda=()=>{if(!opts.podeEditar||!opts.salvarPremissas)return;clearTimeout(_salvaT);
  _salvaT=setTimeout(()=>opts.salvarPremissas(CFG).then(()=>toast('Premissas salvas para todos.')).catch(e=>toast('Não consegui salvar as premissas: '+(e.message||e))),900)};
const LS={getItem(k){const c=_CH[k];if(c)return CFG[c]?JSON.stringify(CFG[c]):null;try{return localStorage.getItem(k)}catch(e){return null}},
  setItem(k,v){const c=_CH[k];if(!c){try{localStorage.setItem(k,v)}catch(e){}return}CFG[c]=JSON.parse(v);_agenda()},
  removeItem(k){const c=_CH[k];if(!c){try{localStorage.removeItem(k)}catch(e){}return}delete CFG[c];_agenda()}};
root.innerHTML=`<div class="filters af-filtros" aria-label="Filtros do ranking">
  <div class="af-fg"><span class="f-label">Período</span>
    <div class="fgrp" id="fPer">
      <button type="button" data-v="30d" aria-pressed="true">Últimos 30 dias</button><button type="button" data-v="passado">Mês passado</button><button type="button" data-v="atual">Este mês</button><button type="button" data-v="3m">Últimos 3 meses</button><button type="button" data-v="tudo">Tudo</button>
    </div>
    <select class="fsel" id="fMes" aria-label="Escolher a safra (mês)"></select></div>
  <div class="af-fg"><span class="f-label">Agrupar</span>
    <div class="fgrp" id="fAgr" aria-label="Agrupar afiliados">
      <button type="button" data-v="parceiro" title="Soma as contas do mesmo parceiro (cadastro de parceiros)">Por parceiro</button><button type="button" data-v="conta" title="Cada conta de plataforma separada">Por conta</button>
    </div></div>
  <div class="af-fg"><span class="f-label">Plataforma</span>
    <div class="fgrp" id="fPlat" aria-label="Plataforma">
      <button type="button" data-v="" aria-pressed="true">Todas</button><button type="button" data-v="JVZoo" aria-pressed="false">JVZoo</button><button type="button" data-v="Vupim" aria-pressed="false">Vupim</button>
    </div></div>
  <div class="af-fg"><select class="fsel" id="fMin" aria-label="Mínimo de FEs para entrar no ranking">
    <option value="10">Ranking: 10+ FEs</option><option value="30" selected>Ranking: 30+ FEs</option><option value="50">Ranking: 50+ FEs</option><option value="100">Ranking: 100+ FEs</option>
  </select></div>
</div>
<div class="content af">
  <div class="head">
    <div class="tt"><div class="af-crumb">Ranking › <b id="crumb">Ranking</b></div><h2 class="af-titulo" id="titulo">Ranking dos afiliados</h2><div class="sline" id="safraLn"></div></div>
    <div class="stamp" title="JVZoo pelo dia de Nova York · Vupim pelo dia de Brasília (desde 21/10)"><span class="dot"></span>Dados de <b id="stamp">—</b> · vendas até <b id="fimTx">—</b> · JVZoo + Vupim</div>
  </div>
  <nav class="subtabs" aria-label="Telas do ranking">
    <button type="button" data-pg="ranking">Ranking</button><button type="button" data-pg="premissas">Premissas</button>
  </nav>
  <nav class="subtabs vg" aria-label="Telas da Visão Geral" hidden>
        <button type="button" data-pg="lista">Afiliados</button><button type="button" data-pg="visao">Pontuação por curva</button>
      </nav>
  <section class="bigs" id="bigs" aria-label="Big numbers"></section>
  <div id="pg-visao" hidden>
        <div class="def">
          <span>Curva pela <b>receita do funil</b>:</span>
          <span><span class="tag A">A</span> até 80%</span><span><span class="tag B">B</span> 80% a 95%</span><span><span class="tag C">C</span> o resto</span>
          <span><span class="sb" title="Curva S: premium"><i>S</i></span> curva A com 100+ pontos</span>
          <span>Notas: <span class="fb">bom 9–10</span> · <span class="fm">médio 7–8</span> · <span class="fr">ruim 0–6</span></span>
        </div>
        <section class="cbox"><div class="curvas" id="curvas"></div></section>
      </div>
  <div id="pg-ranking" hidden><section class="rks" id="rankings"></section></div>
  <div id="pg-lista" hidden><div id="lista"></div></div>
  <div id="pg-reemb" hidden><div id="reemb"></div></div>
  <div id="pg-af" hidden><div class="pm" id="afiliado"></div></div>
  <div id="pg-premissas" hidden><section class="pm" id="premissas"></section></div>
  <div class="foot" id="rodape"></div>
  <div id="tip" role="tooltip" aria-hidden="true"></div>
</div>`;

/* dados: af_dia.sql (BigQuery northscale-dados), um afiliado JVZoo × dia do FE (Nova York). Atribuição da view
   report_data_quality.afiliados_coorte: upsell/downsell/bump herdam o FE; call center fica com o FE mais recente do cliente. */
const DADOS_CONTA=opts.dados, PARC=opts.dados.parceiros||{};
let AGRUPA='parceiro';try{const v=LS.getItem('ns-af-agrupar');if(v==='conta'||v==='parceiro')AGRUPA=v}catch(e){}
const RPL=DADOS_CONTA.campos.length+2;   // posição da plataforma da conta em cada linha
function agrupar(modo){const d=DADOS_CONTA,plOf=a=>a[2]||'JVZoo';
  if(modo==='conta')return {afs:d.afs.map(a=>[a[0],a[1],a[2],1]),rows:d.rows.map(r=>[...r,plOf(d.afs[r[0]])]),mapa:d.afs.map((_,i)=>i)};
  const gi=new Map(),gs=[];
  const mapa=d.afs.map(a=>{const p=PARC[a[0]],k=p?'p:'+p[0]:'c:'+a[0];
    if(!gi.has(k)){gi.set(k,gs.length);gs.push({id:p?'Parceiro '+p[0]:a[0],nome:p?p[1]:a[1],pls:[],n:0})}
    const g=gs[gi.get(k)];if(!g.pls.includes(plOf(a)))g.pls.push(plOf(a));g.n++;return gi.get(k)});
  const M=new Map();
  d.rows.forEach(r=>{const pl=plOf(d.afs[r[0]]),g=mapa[r[0]],k=g+'|'+r[1]+'|'+pl;let o=M.get(k);
    if(!o)M.set(k,[g,r[1],...r.slice(2),pl]);else for(let i=2;i<r.length;i++)o[i]+=r[i]});
  return {afs:gs.map(g=>[g.id,g.nome,g.pls.sort().join(' + '),g.n]),rows:[...M.values()],mapa}}
let MAPA_CONTA;   // conta (índice em DADOS_CONTA.afs) → linha do ranking (índice em AFS)
const DADOS=(()=>{const g=agrupar(AGRUPA);MAPA_CONTA=g.mapa;return {...DADOS_CONTA,afs:g.afs,rows:g.rows}})();

const C=Object.fromEntries(DADOS.campos.map((k,i)=>[k,i+2]));
const AFS=DADOS.afs, D0=new Date(DADOS.d0+'T12:00:00Z');
const dIso=i=>new Date(D0.getTime()+i*864e5).toISOString().slice(0,10), dIdx=s=>Math.round((new Date(s+'T12:00:00Z')-D0)/864e5);
const dTx=i=>{const s=dIso(i);return s.slice(8,10)+'/'+s.slice(5,7)};
// hoje (dia de Brasília) entra como dia aberto: as somas usam o que já chegou; as contas por dia (FEs em 30 dias, bônus de
// volume, comparação com o período anterior) contam só a parte do dia que já passou (FRAC_HOJE)
const _HB=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  .formatToParts(new Date(DADOS.gerado)).reduce((o,p)=>(o[p.type]=p.value,o),{});
const HOJE=`${_HB.year}-${_HB.month}-${_HB.day}`, FIM=Math.min(dIdx(DADOS.d1),dIdx(HOJE)), ABERTO=FIM===dIdx(HOJE);
const FRAC_HOJE=ABERTO?Math.max(1/24,(+_HB.hour*60+ +_HB.minute)/1440):1, HORA_HOJE=_HB.hour+':'+_HB.minute;
const diasEf=(p0,p1)=>p1-p0+1-(ABERTO&&p1>=FIM?1-FRAC_HOJE:0);
const MESES=[...new Set(DADOS.rows.map(r=>dIso(r[1]).slice(0,7)))].filter(m=>dIdx(m+'-01')<=FIM).sort();
const mesTx=k=>['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+k.slice(5)-1]+'/'+k.slice(2,4);
const fimMes=k=>{const [y,m]=k.split('-').map(Number);return dIdx(new Date(Date.UTC(y,m,0)).toISOString().slice(0,10))};
// custo real médio da Full Stack (produto + separação + frete da fatura) ÷ receita do funil coberta: vale onde ainda não há pedido no armazém
const FS=DADOS.rows.reduce((o,r)=>{o.c+=r[C.custo_fs];o.f+=r[C.funil_coberto];return o},{c:0,f:0}), PCT_FS=FS.f?FS.c/FS.f:0.10;
// reembolso = valor devolvido + taxas de alerta e disputa. Curva pelas vendas que já têm 60 dias: fator 10d → 60d geral e de cada afiliado
const D10=r=>r[C.dev10]+r[C.tx10],D60=r=>r[C.dev60]+r[C.tx60];
const M60=FIM-60,GR=DADOS.rows.reduce((o,r)=>{if(r[1]<=M60){o.d10+=D10(r);o.d60+=D60(r);o.b+=r[C.funil]}return o},{d10:0,d60:0,b:0});
const FATOR=GR.d10?GR.d60/GR.d10:2.36, R10G=GR.b?GR.d10/GR.b:0.097;
const OWN=new Map();DADOS.rows.forEach(r=>{if(r[1]>M60)return;let o=OWN.get(r[0]);if(!o)OWN.set(r[0],o={d10:0,d60:0,b:0});o.d10+=D10(r);o.d60+=D60(r);o.b+=r[C.funil]});
// credibilidade: o fator próprio pesa metade com US$ 50 mil de venda madura; o 10d puxa para a média só com pouca venda (US$ 10 mil)
const K_FATOR=50000,K_R10=10000;
function fatorAf(i){const o=OWN.get(i);if(!o||o.d10<=0)return {f:FATOR,w:0,fo:null};const fo=Math.min(5,Math.max(1.2,o.d60/o.d10)),w=o.b/(o.b+K_FATOR);return {f:w*fo+(1-w)*FATOR,w,fo}}
// forma média da curva: % do reembolso de 60 dias já ocorrido em cada dia desde a venda (vendas de 06/07 a 03/09/2026)
const CURVA=[[0,0],[1,17.3],[2,22.5],[3,27.5],[5,33.2],[7,37.1],[10,42.3],[14,48.6],[21,60.2],[30,72.8],[45,89.7],[60,100]];
// curva própria de cada afiliado: o mesmo % por dia, medido só nas vendas dele que já têm 60 dias.
// Pesa pelo volume (metade com US$ 50 mil de venda madura); o resto vem da mediana geral. Sem histórico (ex.: Vupim) = mediana geral.
const DCH=[1,3,5,7,10,14,21,30,45,60],RTH=(r,d)=>d===10?D10(r):d===60?D60(r):r[C['rt'+d]];
const HIST=new Map();DADOS.rows.forEach(r=>{if(r[1]>M60)return;let o=HIST.get(r[0]);if(!o)HIST.set(r[0],o={s:DCH.map(()=>0),b:0});DCH.forEach((d,k)=>o.s[k]+=RTH(r,d));o.b+=r[C.funil]});
const CURVA_AF=new Map();
const formaAf=o=>{const t=o.s[DCH.length-1];let m=0;return DCH.map((d,k)=>m=Math.max(m,Math.min(100,o.s[k]/t*100)))};
// mediana geral: em cada dia, a mediana do % já ocorrido entre os afiliados com histórico (US$ 10 mil+ de venda madura)
const CURVA_MED=(()=>{const F=[...HIST.values()].filter(o=>o.b>=10000&&o.s[DCH.length-1]>0).map(formaAf);if(F.length<5)return CURVA;
  const md=v=>{const s=[...v].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};let m=0;
  return [[0,0]].concat(DCH.map((d,k)=>[d,m=Math.max(m,md(F.map(f=>f[k])))]))})();
function curvaAf(i){if(CURVA_AF.has(i))return CURVA_AF.get(i);const o=HIST.get(i);let c={pts:CURVA_MED,w:0};
  if(o&&o.s[DCH.length-1]>0){const w=o.b/(o.b+K_FATOR),f=formaAf(o);
    c={w,pts:[[0,0]].concat(DCH.map((d,k)=>[d,w*f[k]+(1-w)*reta(d,CURVA_MED)]))}}
  CURVA_AF.set(i,c);return c}

/* ---------- regras: modelo de 28/10 + ajustes de 03/11 ---------- */
const reta=(v,pts)=>{if(v<=pts[0][0])return pts[0][1];for(let i=1;i<pts.length;i++)if(v<=pts[i][0]){const [x0,y0]=pts[i-1],[x1,y1]=pts[i];return y0+(v-x0)*(y1-y0)/(x1-x0)}return pts[pts.length-1][1]};
// metas (editáveis em Premissas, salvas neste navegador). 9 = bom a partir de; 7 = médio a partir de
const MT_PADRAO={re9:16,re7:23,lpf9:5,lpf7:-15,fesA:400,fesB:120,fesC:40,aov9:410,aov7:380,
  volIni:12,volMax:50,reBIni:16,reBMax:8,cbIni:2,cbMax:4,prejIni:30,prejMax:90},MT={...MT_PADRAO};
try{const s=JSON.parse(LS.getItem('ns-af-metas')||'null');if(s)for(const k in MT){const v=+s[k];if(isFinite(v))MT[k]=v}}catch(e){}
// mantém a ordem das metas (o "bom" sempre melhor que o "médio"; o máximo depois do início)
function fixMT(k){const gap=(a,b,d,menor)=>{if(menor?MT[a]>=MT[b]:MT[a]<=MT[b]){if(k===a)MT[b]=menor?MT[a]+d:MT[a]-d;else MT[a]=menor?MT[b]-d:MT[b]+d}};
  gap('re9','re7',1,true);gap('lpf9','lpf7',5,false);gap('aov9','aov7',5,false);gap('volMax','volIni',1,false);gap('reBMax','reBIni',1,true);gap('cbMax','cbIni',0.5,false);gap('prejMax','prejIni',5,false);
  ['fesA','fesB','fesC','re9','re7','volIni','reBMax','cbIni','prejIni'].forEach(x=>{if(MT[x]<0.5)MT[x]=0.5})}
const META_FES={};const aplicaMT=()=>{META_FES.A=MT.fesA;META_FES.B=MT.fesB;META_FES.C=MT.fesC};aplicaMT();   // FEs em 30 dias para nota 9 em cada curva
const REGUA={
  re60:()=>[[0,10],[MT.re9*0.75,10],[MT.re9,9],[MT.re7,7],[Math.max(45,MT.re7+10),0]],
  lpf:()=>[[Math.min(-60,MT.lpf7-20),0],[MT.lpf7,7],[MT.lpf9,9],[Math.max(30,MT.lpf9+10),10]],
  fes:c=>{const m=META_FES[c];return [[0,0],[m*.5,7],[m,9],[m*2,10]]},
  aov:()=>[[Math.min(310,MT.aov7-40),0],[MT.aov7,7],[MT.aov9,9],[MT.aov9+10,10]]};
const U$=v=>(v<0?'−':'')+'US$ '+num(Math.abs(v),Number.isInteger(v)?0:1),P$=v=>num(v,Number.isInteger(v)?0:1)+'%';
const NEUTRA=7;
const EIXOS=[
  {k:'re60',l:'Reembolso 60d',r:'Reembolso',peso:45,f:v=>pct(v),meta:()=>'≤ '+P$(MT.re9)},
  {k:'lpf',l:'Lucro/cliente',r:'Lucro',peso:25,f:v=>usd(v),meta:()=>'≥ '+U$(MT.lpf9)},
  {k:'fes',l:'FEs (30 dias)',r:'FEs',peso:20,f:v=>n(v),meta:c=>'≥ '+n(META_FES[c])},
  {k:'aov',l:'AOV',r:'AOV',peso:10,f:v=>usd(v),meta:()=>'≥ '+U$(MT.aov9)}];
const PESO_PADRAO=Object.fromEntries(EIXOS.map(e=>[e.k,e.peso]));
try{const s=JSON.parse(LS.getItem('ns-af-pesos')||'null');if(s)EIXOS.forEach(e=>{const v=+s[e.k];if(isFinite(v)&&v>=0&&v<=100)e.peso=v})}catch(e){}
// pontos máximos de cada bônus e penalidade (editáveis em Premissas, salvos neste navegador)
const AJ_PADRAO={vol:5,re:5,cb:10,prej:50},AJ={...AJ_PADRAO};
try{const s=JSON.parse(LS.getItem('ns-af-ajustes')||'null');if(s)for(const k in AJ){const v=+s[k];if(isFinite(v)&&v>=0&&v<=100)AJ[k]=v}}catch(e){}
const volMid=()=>Math.round(MT.volIni+(MT.volMax-MT.volIni)*8/38),reMid=()=>(MT.reBIni+MT.reBMax)/2;
const bonusVol=fd=>fd<=MT.volIni?0:reta(fd,[[MT.volIni,0],[volMid(),0.6],[MT.volMax,1]])*AJ.vol, bonusRe=p=>p==null||p*100>MT.reBIni?0:reta(p*100,[[MT.reBMax,1],[reMid(),0.6],[MT.reBIni,0]])*AJ.re;
const penCb=t=>t==null||t*100<=MT.cbIni?0:-reta(t*100,[[MT.cbIni,0],[MT.cbMax,1]])*AJ.cb;   // disputas por quantidade, em % das vendas
// prejuízo por cliente em 60 dias (líquido com call center ÷ FEs): 0 até −US$ 30, proporcional até −50 em −US$ 90 ou pior
const penPrej=lpc=>lpc==null||lpc>=-MT.prejIni?0:-reta(-lpc,[[MT.prejIni,0],[MT.prejMax,1]])*AJ.prej;

const n=v=>v==null||!isFinite(v)?'—':Math.round(v).toLocaleString('pt-BR');
const num=(v,c=0)=>v==null||!isFinite(v)?'—':v.toLocaleString('pt-BR',{minimumFractionDigits:c,maximumFractionDigits:c});
const pct=(v,c=1)=>v==null||!isFinite(v)?'—':(v*100).toLocaleString('pt-BR',{minimumFractionDigits:c,maximumFractionDigits:c})+'%';
const usd=v=>v==null||!isFinite(v)?'—':(v<-0.5?'-':'')+'US$ '+Math.round(Math.abs(v)).toLocaleString('pt-BR');
const usdC=v=>{if(v==null||!isFinite(v))return '—';const a=Math.abs(v),s=v<0?'-':'';return a>=1e6?s+'US$ '+(a/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})+' mi':a>=1e3?s+'US$ '+(a/1e3).toLocaleString('pt-BR',{maximumFractionDigits:0})+' mil':s+'US$ '+n(a)};
const fx=x=>x==null?'':x>=9?'fb':x>=7?'fm':'fr';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const st={per:'30d',mes:null,min:30,plat:'',pg:'ranking',sort:{A:['pts',-1],B:['pts',-1],C:['pts',-1]}};
function periodo(){
  const atual=dIso(FIM).slice(0,7),fech=MESES.filter(m=>m<atual);
  if(st.per==='30d')return [FIM-29,FIM];
  if(st.per==='atual')return [dIdx(atual+'-01'),FIM];
  if(st.per==='passado'){const k=fech[fech.length-1];return [dIdx(k+'-01'),fimMes(k)]}
  if(st.per==='3m'){const ks=fech.slice(-3);return [dIdx(ks[0]+'-01'),fimMes(ks[ks.length-1])]}
  if(st.per==='mes')return [Math.max(0,dIdx(st.mes+'-01')),Math.min(FIM,fimMes(st.mes))];
  return [0,FIM]}
// comparação: o mesmo tamanho logo antes (30 dias antes; mês anterior; 3 meses anteriores)
function anterior(){
  const [p0,p1]=periodo(),mes=k=>{const [y,m]=k.split('-').map(Number);return new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7)};
  let r=null;
  if(st.per==='30d')r=[p0-30,p1-30];
  else if(st.per==='3m'){const k=mes(mes(mes(dIso(p0).slice(0,7))));r=[dIdx(k+'-01'),p0-1]}
  else if(st.per!=='tudo'){const k=mes(dIso(p0).slice(0,7)),f=fimMes(k);r=[dIdx(k+'-01'),Math.min(f,dIdx(k+'-01')+(p1-p0))]}
  return r&&r[0]>=0?r:null}

/* safra = as vendas do período, com tudo o que renderam até hoje. Reembolso 60d = o que já caiu em até 60 dias + o que
   ainda vai cair (10d × fator do afiliado, só nas vendas que não têm 60 dias). Safra fechada (60+ dias): tudo real. */
function calcular(pp=periodo(),off=0){
  const [p0,p1]=pp,dias=p1-p0+1,de=diasEf(p0,p1),b1=p1+off,fechada=p1<=FIM-60;
  const jan=k=>{let j1=Math.min(b1,FIM-k)-off,j0=p0;if(j1<j0)j0=Math.max(0,j1-Math.max(p1-p0,29));return [j0,j1,j1>=j0]};
  const [r0,r1,temRe]=jan(10),[q0,q1,temQ]=jan(30);
  const Z=()=>({fes:0,funil:0,liq:0,custo:0,fcob:0,call:0,dev:0,base:0,vendas:0,disp:0,imFu:0,imD:0,imR:0,d60:0,idS:0,fut:0});
  const M=new Map();
  for(const r of DADOS.rows){
    if(st.plat&&r[RPL]!==st.plat)continue;
    const d=r[1],noP=d>=p0&&d<=p1,noR=temRe&&d>=r0&&d<=r1,noQ=temQ&&d>=q0&&d<=q1;if(!noP&&!noR&&!noQ)continue;
    let a=M.get(r[0]);if(!a)M.set(r[0],a={i:r[0],af:AFS[r[0]][0],nome:AFS[r[0]][1],pl:st.plat||AFS[r[0]][2]||'JVZoo',contas:AFS[r[0]][3]||1,...Z()});
    if(noP){const fu=r[C.funil];a.fes+=r[C.fes];a.funil+=fu;a.liq+=r[C.liq_funil];a.fcob+=r[C.funil_coberto];
      a.custo+=r[C.custo_fs]+PCT_FS*Math.max(0,fu-r[C.funil_coberto]);a.call+=r[C.liq_call];
      a.d60+=D60(r);a.idS+=fu*Math.min(60,FIM-d);if(d>M60){a.imFu+=fu;a.imD+=D60(r);a.imR+=fu*(1-FRAC(FIM-d))}}
    if(noR){a.dev+=D10(r);a.base+=r[C.funil]}
    if(noQ){a.vendas+=r[C.vendas];a.disp+=r[C.disputas]}}
  const L=[...M.values()].filter(a=>a.fes>0||a.funil>0);
  const T=L.reduce((s,a)=>s+Math.max(0,a.funil),0);let acc=0;
  const CVJ=curvaJanela(p1);L.forEach(a=>{a.curva=CVJ.cv.get(a.i)||'C'});
  for(const a of L){
    const fa=fatorAf(a.i);a.fator=fa.f;a.fw=fa.w;a.fo=fa.fo;
    a.r10=a.base>0?a.dev/a.base:null;a.p60=(a.base>0?(a.dev+K_R10*R10G)/(a.base+K_R10):R10G)*a.fator;
    a.fut=a.p60*a.imR;
    a.agora=a.funil?a.d60/a.funil:null;a.idade=a.funil?a.idS/a.funil:null;
    a.re60=a.funil?(a.d60+a.fut)/a.funil:null;
    a.lpf=a.fes?(a.liq-a.custo-a.fut)/a.fes:null;a.lpfHoje=a.fes?(a.liq-a.custo)/a.fes:null;
    a.liqTot=a.liq-a.custo-a.fut+a.call;a.lpc=a.fes?a.liqTot/a.fes:null;
    a.fes30=a.fes/de*30;a.aov=a.fes?a.funil/a.fes:null;a.tdisp=a.vendas>=20?a.disp/a.vendas:null;
    a.n={re60:a.re60==null?NEUTRA:reta(a.re60*100,REGUA.re60()),lpf:a.lpf==null?null:reta(a.lpf,REGUA.lpf()),
         fes:reta(a.fes30,REGUA.fes(a.curva)),aov:a.aov==null?null:reta(a.aov,REGUA.aov())};
    let s=0,w=0;for(const e of EIXOS){const x=a.n[e.k];if(x==null)continue;s+=x*e.peso;w+=e.peso}
    a.base100=w?10*s/w:null;a.bonus=bonusVol(a.fes/de)+bonusRe(a.re60);
    a.pCb=penCb(a.tdisp);a.pPrej=penPrej(a.lpc);a.pen=a.pCb+a.pPrej;
    a.pts=a.base100==null?null:a.base100+a.bonus+a.pen;a.rank=a.fes>=st.min&&a.pts!=null;a.S=a.curva==='A'&&a.rank&&a.pts>100}
  const rk=L.filter(a=>a.rank),med={};
  for(const e of EIXOS){const k=e.k==='fes'?'fes30':e.k,vs=rk.map(a=>a[k]).filter(v=>v!=null).sort((x,y)=>x-y);med[e.k]=vs.length?vs[Math.floor(vs.length/2)]:null}
  const t=Z();L.forEach(a=>{for(const k in t)t[k]+=a[k]});
  t.re60=t.funil?(t.d60+t.fut)/t.funil:null;t.agora=t.funil?t.d60/t.funil:null;t.idade=t.funil?t.idS/t.funil:null;
  t.lpf=t.fes?(t.liq-t.custo-t.fut)/t.fes:null;t.lpfHoje=t.fes?(t.liq-t.custo)/t.fes:null;
  t.fes30=t.fes/de*30;t.aov=t.fes?t.funil/t.fes:null;t.liqTot=t.liq-t.custo-t.fut+t.call;t.cob=t.funil?t.fcob/t.funil:0;
  t.pts=rk.length?rk.reduce((s,a)=>s+a.pts,0)/rk.length:null;
  return {L,T,rk,med,t,p0,p1,dias,diasEf:de,r0,r1,temRe,q0,q1,temQ,fechada}}
// período anterior de mesmo tamanho; com hoje aberto, as somas dele (receita, FEs, líquido) ficam proporcionais à parte do
// período atual que já passou, para a variação não acusar queda só porque o dia ainda não terminou
function calcAnt(R){const pa=anterior();if(!pa)return null;const A=calcular(pa,R.p0-pa[0]),k=R.diasEf/A.dias;
  if(k<0.9999){['funil','fes','liqTot','liq','custo','fut','call','d60'].forEach(x=>{A.t[x]*=k});A.L.forEach(a=>{a.funil*=k})}
  return A}

/* ---------- dica de ferramenta ---------- */
const TIPS=new Map();let tipN=0;
const regTip=html=>{const k='t'+(++tipN);TIPS.set(k,html);return k};
// curva: cheia até a idade média das vendas (o que já caiu) e pontilhada até o dia 60 (o que ainda vai cair)
const RE_MAX=0.35;
function tipCurva(agora,idade,total,be,W=290,H=96,cv=CURVA){
  if(agora==null||total==null)return '';
  // escala fixa até 35% (só cresce se o afiliado passar disso): dá para comparar um afiliado com o outro
  const L=W>400?40:28,R=8,Tp=8,B=18,ym=Math.max(RE_MAX,total*1.05,agora*1.05)*1.15,X=d=>L+d/60*(W-L-R),Y=v=>Tp+(1-v/ym)*(H-Tp-B);
  const sh=d=>reta(d,cv)/100,ia=Math.max(0,Math.min(60,idade??60)),sa=sh(ia)||1e-9;
  const yReal=d=>agora*sh(d)/sa,yPrev=d=>agora+(total-agora)*(sh(d)-sh(ia))/Math.max(1e-9,1-sh(ia));
  const ds=[];for(let d=0;d<=60;d++)ds.push(d);
  const yAt=d=>d<=ia?yReal(d):yPrev(d);let dz=null;
  if(be!=null&&isFinite(be)){if(be<=0)dz=0;else for(let d=0;d<=60;d+=0.25)if(yAt(d)>=be){dz=d;break}}
  const zx=dz==null?null:X(dz),zl=dz==null?'':`<line class="be" x1="${zx.toFixed(1)}" x2="${zx.toFixed(1)}" y1="${Tp}" y2="${H-B}"/>`+
    `<text class="bel" x="${(dz>45?zx-4:zx+4).toFixed(1)}" y="${Tp+8}" text-anchor="${dz>45?'end':'start'}">${dz===0?'prejuízo desde a venda':'lucro 0 · dia '+num(dz,0)}</text>`;
  const pReal=ds.filter(d=>d<ia).concat(ia).map(d=>`${X(d).toFixed(1)},${Y(yReal(d)).toFixed(1)}`).join(' ');
  const pPrev=[ia].concat(ds.filter(d=>d>ia)).map(d=>`${X(d).toFixed(1)},${Y(yPrev(d)).toFixed(1)}`).join(' ');
  const grid=[0,0.5,1].map(f=>{const v=ym/1.15*f;return `<line class="gr" x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L-4}" y="${(Y(v)+3).toFixed(1)}" text-anchor="end">${num(v*100,0)}%</text>`}).join('');
  const xs=(W>400?[0,10,20,30,45,60]:[0,10,30,60]).map(d=>`<text x="${X(d).toFixed(1)}" y="${H-4}" text-anchor="${d===0?'start':d===60?'end':'middle'}">${d===0?'dia 0':'dia '+d}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${grid}${xs}
    <polygon class="ar" points="${X(0)},${Y(0)} ${pReal} ${X(ia).toFixed(1)},${Y(0)}"/>
    <polyline class="cv" points="${pReal}"/>${ia<60?`<polyline class="cv prev" points="${pPrev}"/>`:''}
    ${zl}<circle class="pa" cx="${X(ia).toFixed(1)}" cy="${Y(agora).toFixed(1)}" r="3.5"/>${ia<60?`<circle class="pf" cx="${X(60).toFixed(1)}" cy="${Y(total).toFixed(1)}" r="3.5"/>`:''}</svg>`+
    (be==null||!isFinite(be)?'':`<div class="bez ${dz==null?'ok':'neg'}">${dz==null?`Lucro positivo até o dia 60: o prejuízo começaria com ${pct(be)} de reembolso.`:dz===0?'Prejuízo desde a venda: a margem não cobre o CPA e os custos, mesmo sem reembolso.':`Passa a dar prejuízo no dia ${num(dz,0)}, quando o reembolso chega a ${pct(be)} da receita.`}</div>`)}
/* conta da nota: nota de cada critério × peso (proporção dos pesos com nota) + bônus − penalidades */
function contaNota(a){const W0=EIXOS.reduce((s,e)=>s+(a.n[e.k]==null?0:e.peso),0);
  return EIXOS.map(e=>{const x=a.n[e.k];return {e,v:e.k==='fes'?a.fes30:a[e.k],x,pts:x==null||!W0?0:10*x*e.peso/W0}})}
function ajustesAf(a){const fd=(a.fes30||0)/30;
  return [{t:'bo',nome:'Volume alto',motivo:`${num(fd,1)} FEs por dia · vale acima de 12 (+${fP(AJ.vol)} em 50)`,pts:bonusVol(fd)},
    {t:'bo',nome:'Reembolso baixo',motivo:`reembolso 60d ${pct(a.re60)} · vale abaixo de ${P$(MT.reBIni)} (+${fP(AJ.re)} em ${P$(MT.reBMax)})`,pts:bonusRe(a.re60)},
    {t:'pe',nome:'Risco de chargeback',motivo:a.tdisp==null?'poucas vendas com 30 dias para medir':`${pct(a.tdisp)} das vendas em disputa · pesa acima de ${P$(MT.cbIni)} (−${fP(AJ.cb)} em ${P$(MT.cbMax)})`,pts:a.pCb},
    {t:'pe',nome:'Prejuízo por cliente',motivo:`${usd(a.lpc)} por cliente, com call center · pesa abaixo de −US$ ${n(MT.prejIni)} (−${fP(AJ.prej)} em −US$ ${n(MT.prejMax)})`,pts:a.pPrej}]}
const ptsTx=v=>v==null||Math.abs(v)<0.05?'0':(v>0?'+':'−')+num(Math.abs(v),1);
const corAf=a=>a.S?'#E58A00':'var(--c'+a.curva+')';
function tipAf(a,fechada){
  const real=fechada||a.idade>=59.5,sx=real?'real':'prev.';
  const cr=contaNota(a).map(c=>`<tr><td>${c.e.r||c.e.l}</td><td>${c.e.f(c.v)}</td><td class="${fx(c.x)}">${num(c.x,1)}</td><td>${num(c.pts,1)}</td></tr>`).join('');
  const aj=ajustesAf(a).map(j=>`<tr><td>${j.nome}</td><td colspan="2" class="mo">${j.motivo}</td><td class="${j.pts>=0.05?'mais':j.pts<=-0.05?'menos':'zero'}">${ptsTx(j.pts)}</td></tr>`).join('');
  return `<div class="tipaf${a.S?' ouro':''}">
    <div class="t1"><b>${a.S?SB+' ':''}${esc(nomeAf(a))} ${PLB(a)}</b><span>Curva Afiliado ${a.S?'S':a.curva} · ${String(a.af).startsWith('Parceiro ')?'parceiro · '+a.contas+(a.contas>1?' contas':' conta'):esc(a.af)}</span></div>${a.pl==='Vupim'?`<div class="t2 vu-nt">${NOTA_VU}</div>`:''}
    <div class="tx">
      <div class="trd" style="--c:${corAf(a)}">${radar(EIXOS.map(e=>a.n[e.k]),REF_N)}<div class="tx-pt">${sc(a.pts)}<small>pontos · tracejado = média do ranking</small></div></div>
      <div class="tx-t"><table class="tpt"><thead><tr><th>Critério</th><th>Resultado ${sx}</th><th>Nota</th><th>Pontos</th></tr></thead><tbody>${cr}
        <tr class="sub"><td colspan="3">Base (notas × pesos)</td><td>${num(a.base100,1)}</td></tr>
        <tr class="grp"><td colspan="4">Bônus e penalidades</td></tr>${aj}
        <tr class="tot"><td colspan="3">Pontuação</td><td>${num(a.pts,1)}</td></tr></tbody></table></div></div>
    <div class="tx-cv"><div class="t2">${real?'Reembolso real de 60 dias.':'Reembolso por dia: cheio = já caiu · pontilhado = previsto · vermelho = onde o lucro zera.'}</div>
      ${tipCurva(a.agora,real?60:a.idade,a.re60,a.funil?(a.liq-a.custo+a.d60)/a.funil:null,600,104,curvaAf(a.i).pts)}</div>
    <div class="nt">Clique para abrir a página do afiliado.</div></div>`}
const tip=document.getElementById('tip');let tipAlvo=null;
function mostra(el,x,y){const h=TIPS.get(el.dataset.tip);if(!h)return;tip.innerHTML=h;tipAlvo=el;
  tip.classList.toggle('largo',h.startsWith('<div class="tipaf'));tip.classList.toggle('ouro',h.startsWith('<div class="tipaf ouro'));tip.classList.add('on');tip.setAttribute('aria-hidden','false');posiciona(x,y)}
function posiciona(x,y){const w=tip.offsetWidth,h=tip.offsetHeight,m=12;let l=x+16,t=y+16;
  if(l+w>innerWidth-m)l=Math.max(m,x-w-16);if(t+h>innerHeight-m)t=y-h-16;t=Math.max(m,Math.min(t,innerHeight-h-m));tip.style.left=l+'px';tip.style.top=t+'px'}
function esconde(){tip.classList.remove('on');tip.setAttribute('aria-hidden','true');tipAlvo=null}
const ESPERA=1500;let espEl=null,espT=null,ux=0,uy=0;
const espBar=document.body.appendChild(Object.assign(document.createElement('div'),{id:'espBar'}));
const iniciaBarra=el=>{const r=el.getBoundingClientRect();Object.assign(espBar.style,{left:r.left+'px',top:(r.bottom-2)+'px',width:r.width+'px'});
  espBar.classList.remove('on');void espBar.offsetWidth;espBar.classList.add('on')};
const cancelaEspera=()=>{if(espT)clearTimeout(espT);espT=null;espBar.classList.remove('on');if(espEl)espEl.classList.remove('aguarda');espEl=null};
_on(document,'pointermove',e=>{if(e.pointerType==='touch')return;ux=e.clientX;uy=e.clientY;const el=e.target.closest('[data-tip]');
  if(!el){cancelaEspera();if(tipAlvo)esconde();return}
  if(el===tipAlvo){posiciona(ux,uy);return}
  if(el.dataset.delay){if(el!==espEl){cancelaEspera();if(tipAlvo)esconde();espEl=el;el.classList.add('aguarda');iniciaBarra(el);
      espT=setTimeout(()=>{const a=espEl;cancelaEspera();if(a&&a.isConnected)mostra(a,ux,uy)},ESPERA)}return}
  cancelaEspera();mostra(el,ux,uy)});
_on(document,'pointerleave',()=>{cancelaEspera();esconde()});
let ultimoPT='mouse';
_on(document,'pointerdown',e=>{ultimoPT=e.pointerType;if(e.pointerType!=='touch')return;const el=e.target.closest('[data-tip]');
  if(!el){esconde();return}if(el===tipAlvo)return;mostra(el,e.clientX,e.clientY)});
// clique na linha do afiliado abre a página dele (no toque: o 1º toque mostra a dica, o 2º abre)
_on(document,'click',e=>{const el=e.target.closest('[data-af]');if(!el)return;
  if(ultimoPT==='touch'&&!el.dataset.ok){document.querySelectorAll('[data-ok]').forEach(x=>delete x.dataset.ok);el.dataset.ok='1';return}
  cancelaEspera();esconde();abreAf(el.dataset.af)});
_on(document,'keydown',e=>{if(e.key!=='Enter')return;const el=e.target.closest&&e.target.closest('[data-af]');if(el)abreAf(el.dataset.af)});
_on(window,'scroll',()=>{cancelaEspera();if(tipAlvo)esconde()},{passive:true});
_on(document,'focusin',e=>{const el=e.target.closest('[data-tip]');if(el){const r=el.getBoundingClientRect();mostra(el,r.left,r.bottom)}});
_on(document,'focusout',esconde);

/* ---------- desenho ---------- */
function radar(vals,ref){
  const W=320,H=268,cx=W/2,cy=H/2,r=100,N=EIXOS.length,ang=i=>-Math.PI/2+i*2*Math.PI/N,P=(i,v)=>[cx+Math.cos(ang(i))*r*v,cy+Math.sin(ang(i))*r*v];
  const poly=f=>EIXOS.map((_,i)=>P(i,f(i)).map(x=>x.toFixed(1)).join(',')).join(' ');
  let s=`<svg class="radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Nota média da curva em cada critério">`;
  [.25,.5,.75,1].forEach(v=>s+=`<polygon class="ring" points="${poly(()=>v)}"/>`);
  EIXOS.forEach((e,i)=>{const [x,y]=P(i,1);s+=`<line class="ax" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    const [lx,ly]=P(i,1.17),a=Math.abs(lx-cx)<4?'middle':lx>cx?'start':'end';s+=`<text x="${lx.toFixed(1)}" y="${(ly+(Math.abs(ly-cy)<4?4:ly>cy?11:-3)).toFixed(1)}" text-anchor="${a}">${e.r||e.l}</text>`});
  if(ref.some(v=>v!=null))s+=`<polygon class="ref" points="${poly(i=>(ref[i]??0)/10)}"/>`;
  if(vals.some(v=>v!=null)){s+=`<polygon class="area" points="${poly(i=>(vals[i]??0)/10)}"/>`;
    vals.forEach((v,i)=>{if(v==null)return;const [x,y]=P(i,v/10),dx=Math.abs(x-cx)<4?8:x>cx?7:-7;
      s+=`<circle class="ptr" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2"/><text class="val" x="${(x+dx).toFixed(1)}" y="${(y-6).toFixed(1)}" text-anchor="${dx>0?'start':'end'}">${num(v,1)}</text>`})}
  return s+'</svg>'}
const MINUSC=new Set(['de','da','do','das','dos','e','di','du','del','van','von']);
const fmtNome=s=>String(s).replace(/([a-zà-ÿ])([A-Z])/g,'$1 $2').toLowerCase().split(/\s+/).filter(Boolean)
  .map((w,i)=>i>0&&MINUSC.has(w)?w:w.replace(/(^|[-'])([a-zà-ÿ])/g,(m,a,b)=>a+b.toUpperCase())).join(' ');
const nomeAf=a=>a.nome?fmtNome(a.nome):String(a.af).startsWith('Vupim ')?'Vupim · '+String(a.af).slice(6,14):a.af;
const PLB=a=>String(a.pl||'JVZoo').split(' + ').map(p=>p==='Vupim'?'<span class="plb vu" title="Vupim (dia de Brasília)">Vupim</span>':'<span class="plb jv" title="JVZoo (dia de Nova York)">JVZoo</span>').join(' ');
const VUPIM_INI='2026-10-21';
const NOTA_VU='A Vupim ainda não tem venda com 60 dias (dados desde 21/10): o fator 10d → 60d dela vem do geral (JVZoo).';
const SB='<span class="sb" title="Curva Afiliado S: premium"><i>S</i></span>';
const afId=a=>String(a.af).split(' ').pop().replace(/[^A-Za-z0-9-]/g,'');
let REF_N=[];   // nota média do ranking em cada critério (tracejado dos radares)
// selo da pontuação: a cor diz a faixa (80+ forte, 60–79 bom, 40–59 atenção, abaixo de 40 ruim)
const scCls=v=>v==null?'':v>=80?'b':v>=60?'a':v>=40?'m':'r';
const sc=v=>`<span class="sc ${scCls(v)}">${num(v,0)}</span>`;
const ajTx=a=>{const v=a.bonus+a.pen;return Math.abs(v)<0.5?['','']:[(v>0?'+':'−')+num(Math.abs(v),0),v>0?'mais':'menos']};
function linhaAf(a,cls,pos,fechada){
  const [tx,c]=ajTx(a);
  return `<div class="afl ${cls}" style="--w:${Math.max(0,Math.min(100,a.pts)).toFixed(1)}%" data-tip="${regTip(tipAf(a,fechada))}" data-delay="1" data-af="${afId(a)}" tabindex="0"><span class="ps">${pos}</span><span class="nm">${a.S?SB:''}<span class="nmt">${esc(nomeAf(a))}</span>${PLB(a)}</span><span class="aj ${c}">${tx}</span><span class="pt">${sc(a.pts)}</span></div>`}
const dist=parts=>{const v=parts.filter(x=>x[0]>0),tot=v.reduce((s,x)=>s+x[0],0);if(!tot)return '<div class="dist"><i class="z" style="flex:1">—</i></div>';
  return `<div class="dist" aria-label="${v.map(x=>x[0]+' '+x[2]).join(', ')}">${v.map(x=>`<i class="${x[1]}" style="flex:${x[0]}">${x[0]}</i>`).join('')}</div>`};

function render(){
  TIPS.clear();tipN=0;esconde();
  const R=calcular(),{L,T,rk,med,t,p0,p1,dias,diasEf:de,fechada}=R;
  renderPremissas();st.R=R;
  const pa=anterior(),A=calcAnt(R);
  const info=regTip(`<div class="t1"><b>Safra ${dTx(p0)} a ${dTx(p1)}</b><span>${dias} dias</span></div>
    <div class="t2">As vendas desse período, com tudo o que renderam até hoje.</div>
    <div class="kv"><span>Situação</span><b>${fechada?'fechada (60+ dias): real':'aberta: previsto'}</b>
    <span>Reembolso 10d (base da previsão)</span><b>${R.temRe?dTx(R.r0)+' a '+dTx(R.r1):'—'}</b>
    <span>Disputas (risco de chargeback)</span><b>${R.temQ?dTx(R.q0)+' a '+dTx(R.q1):'—'}</b>
    <span>Custo real da Full Stack</span><b>${pct(t.cob,0)} da receita</b>
    <span>Variação contra</span><b>${pa?dTx(pa[0])+' a '+dTx(pa[1]):'—'}</b></div>
    <div class="nt">Onde ainda não há pedido no armazém, o custo usa a média real de ${pct(PCT_FS)} da receita.</div>`);
  document.getElementById('safraLn').innerHTML=`<span class="st ${fechada?'real':'prev'}">${fechada?'real':'previsto'}</span>`+
    `<span class="tx">Safra <b>${dTx(p0)}–${dTx(p1)}</b> · ${dias} dias${ABERTO&&p1>=FIM?` (hoje até ${HORA_HOJE})`:''}${pa?` · vs ${dTx(pa[0])}–${dTx(pa[1])}`:''}${st.plat?` · ${st.plat}`:''}</span>`+
    (st.plat!=='JVZoo'&&dIso(p1)<VUPIM_INI?`<span class="st vu-av">sem Vupim nesta safra (dados desde 21/10)</span>`:'')+
    `<button class="info" type="button" data-tip="${info}" aria-label="Detalhes da safra">i</button>`;
  const varia=(v,va,modo,melhor)=>{
    if(v==null||va==null||!isFinite(v)||!isFinite(va)||(modo==='%'&&!va))return '<span class="var">—</span>';
    const d=modo==='%'?(v-va)/Math.abs(va):v-va,txt=modo==='%'?num(Math.abs(d)*100,1)+'%':modo==='pp'?num(Math.abs(d)*100,1)+' pp':modo==='usd'?usd(Math.abs(d)):modo==='usdC'?usdC(Math.abs(d)):num(Math.abs(d),0)+' pts';
    if(Math.abs(d)<(modo==='%'||modo==='pp'?0.0005:modo==='usdC'?500:0.5))return `<span class="var">= ${txt}</span>`;
    return `<span class="var ${(d>0)===(melhor>0)?'up':'down'}">${d>0?'▲':'▼'} ${txt}</span>`};
  const sx=fechada?'real':'prev.';
  const kpi=(l,v,vr,m,cls='',tp='')=>`<article class="kpi${cls}"${tp?` data-tip="${tp}" tabindex="0"`:''}><span class="k">${l}</span><b class="v">${v}</b>${vr}<span class="m">${m}</span></article>`;
  const tipTotRe=regTip(`<div class="t1"><b>Reembolso 60d de todos os afiliados</b><span>${sx}</span></div>
    <div class="t2">${fechada?'Safra fechada: valor real de 60 dias.':'Cheio = já caiu · pontilhado = previsto até o dia 60.'}</div>
    <div class="hl"><div><small>Até agora${fechada?'':` (dia ${num(t.idade,0)})`}</small><strong>${pct(t.agora)}</strong></div><div><small>Até o dia 60</small><strong>${pct(t.re60)}</strong></div></div>
    ${tipCurva(t.agora,fechada?60:t.idade,t.re60,t.funil?(t.liq-t.custo+t.d60)/t.funil:null)}
    <div class="kv"><span>Ainda vai cair</span><b>${usdC(t.fut)}</b><span>Fator geral 10d → 60d</span><b>× ${num(FATOR,2)}</b><span>Mediana dos afiliados</span><b>${pct(med.re60)}</b></div>
    ${st.plat!=='JVZoo'?`<div class="nt">${NOTA_VU}</div>`:''}
    <div class="nt">Reembolso = pedido pelo cliente + alerta + disputa + taxas de alerta e disputa.</div>`);
  const tipTotLu=regTip(`<div class="t1"><b>Lucro por cliente</b><span>${sx}</span></div>
    <div class="t2">Líquido do funil (sem call center) ÷ FEs, com custo real da Full Stack${fechada?'':' e o reembolso que ainda vai cair'}.</div>
    <div class="kv"><span>${fechada?'Real (60 dias)':'Previsto (60 dias)'}</span><b>${usd(t.lpf)}</b>${fechada?'':`<span>Hoje, sem o que vai cair</span><b>${usd(t.lpfHoje)}</b>`}
    <span>Custo produto + frete</span><b>${usdC(t.custo)}</b><span>Mediana dos afiliados</span><b>${usd(med.lpf)}</b></div>`);
  const nPrej=rk.filter(a=>a.pPrej<=-0.5).length,nCb=rk.filter(a=>a.pCb).length;
  document.getElementById('bigs').innerHTML=
    kpi('Pontuação média',num(t.pts,0)+'<small>/100</small>',varia(t.pts,A&&A.t.pts,'pts',1),`${n(rk.length)} no ranking · ${nPrej} c/ prejuízo · ${nCb} c/ risco CB`,' total')+
    kpi('Receita do funil',usdC(t.funil),varia(t.funil,A&&A.t.funil,'%',1),`${n(t.fes)} FEs · ${n(L.length)} afiliados`)+
    kpi(`Reembolso 60d <i>${sx}</i>`,pct(t.re60),varia(t.re60,A&&A.t.re60,'pp',-1),`peso ${EIXOS[0].peso} · meta ${EIXOS[0].meta()}`,'',tipTotRe)+
    kpi(`Lucro/cliente <i>${sx}</i>`,usd(t.lpf),varia(t.lpf,A&&A.t.lpf,'usd',1),`peso ${EIXOS[1].peso} · meta ${EIXOS[1].meta()}`,'',tipTotLu)+
    kpi('FEs',n(t.fes),varia(t.fes,A&&A.t.fes,'%',1),`peso ${EIXOS[2].peso} · meta A ${n(META_FES.A)} · B ${n(META_FES.B)} · C ${n(META_FES.C)}`)+
    kpi('AOV',usd(t.aov),varia(t.aov,A&&A.t.aov,'%',1),`peso ${EIXOS[3].peso} · meta ${EIXOS[3].meta()}`)+
    kpi(`Líquido 60d c/ call center <i>${sx}</i>`,usdC(t.liqTot),varia(t.liqTot,A&&A.t.liqTot,'usdC',1),`por cliente ${usd(t.fes?t.liqTot/t.fes:null)}`);

  const refN=EIXOS.map(e=>{const v=rk.map(a=>a.n[e.k]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null});REF_N=refN;
  const grupos=['A','B','C'].map(c=>{const g=L.filter(a=>a.curva===c);return {c,g,rkc:g.filter(a=>a.rank).sort((x,y)=>y.pts-x.pts||y.funil-x.funil),rec:g.reduce((s,a)=>s+Math.max(0,a.funil),0)}});
  document.getElementById('curvas').innerHTML=grupos.map(({c,g,rkc,rec})=>{
    const media=rkc.length?rkc.reduce((s,a)=>s+a.pts,0)/rkc.length:null,cS=rkc.filter(a=>a.S).length;
    const vals=EIXOS.map(e=>{const v=rkc.map(a=>a.n[e.k]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null});
    const P={fes:0,funil:0,liq:0,custo:0,fut:0,d60:0};rkc.forEach(a=>{for(const k in P)P[k]+=a[k]});
    const pv={re60:P.funil?(P.d60+P.fut)/P.funil:null,lpf:P.fes?(P.liq-P.custo-P.fut)/P.fes:null,fes:rkc.length?P.fes/de*30/rkc.length:null,aov:P.fes?P.funil/P.fes:null};
    let linhas=EIXOS.map((e,i)=>{const q={fb:0,fm:0,fr:0};rkc.forEach(a=>{const f=fx(a.n[e.k]);if(f)q[f]++});
      return `<tr><td>${e.r||e.l}</td><td>${e.meta(c)}</td><td>${e.f(pv[e.k])}</td><td class="${fx(vals[i])}">${num(vals[i],1)}</td><td>${dist([[q.fb,'b','bons'],[q.fm,'m','médios'],[q.fr,'r','ruins']])}</td></tr>`}).join('');
    const nb=rkc.filter(a=>a.bonus>=0.5).length,np=rkc.filter(a=>a.lpc!=null&&a.lpc<=-MT.prejMax).length,npp=rkc.filter(a=>a.pPrej<=-0.05&&!(a.lpc<=-MT.prejMax)).length,nc=rkc.filter(a=>a.pCb&&a.pPrej>-0.5).length;
    const mb=rkc.length?rkc.reduce((s,a)=>s+a.bonus,0)/rkc.length:null,mp=rkc.length?rkc.reduce((s,a)=>s+a.pen,0)/rkc.length:null;
    linhas+=`<tr class="aj"><td>Bônus</td><td>até +${fP(AJ.vol+AJ.re)}</td><td>${mb==null?'—':'+'+num(mb,1)}</td><td>—</td><td>${dist([[nb,'b','com bônus'],[rkc.length-nb,'z','sem bônus']])}</td></tr>`+
      `<tr><td>Penalidades</td><td>0</td><td class="${mp<-0.05?'fr':''}">${mp==null?'—':mp<-0.05?'−'+num(-mp,1):'0'}</td><td>—</td><td>${dist([[np,'r',`prejuízo de US$ ${n(MT.prejMax)}+ por cliente`],[npp,'m',`prejuízo de US$ ${n(MT.prejIni)} a ${n(MT.prejMax)} por cliente`],[nc,'c','só risco de chargeback'],[rkc.length-np-npp-nc,'z','sem penalidade']])}</td></tr>`;
    const top=rkc.slice(0,3),pior=rkc.slice(Math.max(3,rkc.length-3)).reverse();
    const cab='<span>Bônus/pen. · Pontos</span>';
    return `<article class="panel ${c}">
      <div class="ch"><div><h2><span class="tag ${c}">${c}</span>Curva Afiliado ${c}</h2><p><b>${n(g.length)}</b> afiliados · <b>${T?pct(rec/T,0):'—'}</b> da receita</p><p>${n(rkc.length)} no ranking${cS?` · <b>${cS} na Curva Afiliado S</b>`:''}</p></div>
        <div class="nota"><div class="v">${num(media,0)}<small>/100</small></div><span>pontuação média</span></div></div>
      ${radar(vals,refN)}
      <div class="tw"><table class="tc"><colgroup><col><col style="width:64px"><col style="width:60px"><col style="width:40px"><col style="width:31%"></colgroup>
        <thead><tr><th>Critério</th><th>Meta</th><th>Curva</th><th>Nota</th><th>Distribuição</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div class="lista"><h4><span>Top 3</span>${cab}</h4>${top.length?top.map((a,i)=>linhaAf(a,'melhor',i+1,fechada)).join(''):'<div class="vazio">Nenhum afiliado no ranking.</div>'}</div>
      <div class="lista"><h4><span>Piores 3</span>${cab}</h4>${pior.length?pior.map((a,i)=>linhaAf(a,'pior',rkc.length-i,fechada)).join(''):'<div class="vazio">Menos de 4 afiliados no ranking.</div>'}</div>
    </article>`}).join('');

  // ranking por curva: todos os afiliados ranqueados, ordenável por coluna
  const COLS=[['pos','#'],['nome','Afiliado'],['pts','Pontos'],['re60',`Reemb. 60d ${sx}`],['lpf',`Lucro/cliente ${sx}`],['fes30','FEs (30d)'],['aov','AOV'],['bonus','Bônus'],['pen','Penalidades'],['funil','Receita do funil']];
  const cel=(a,k,pos)=>{
    if(k==='pos')return `<td>${pos}</td>`;
    if(k==='nome')return `<td class="nm" title="${esc(nomeAf(a))}"><span>${a.S?SB:''}<span class="nmt">${esc(nomeAf(a))}</span>${PLB(a)}</span></td>`;
    if(k==='pts')return `<td class="pts">${sc(a.pts)}</td>`;
    const nk={re60:'re60',lpf:'lpf',fes30:'fes',aov:'aov'}[k];
    if(nk){const e=EIXOS.find(x=>x.k===nk),v=k==='fes30'?n(a.fes30):e.f(a[k]);return `<td>${v}<span class="np ${fx(a.n[nk])}">${num(a.n[nk],1)}</span></td>`}
    if(k==='bonus')return `<td class="${a.bonus>=0.5?'mais':''}">${a.bonus>=0.5?'+'+num(a.bonus,1):'—'}</td>`;
    if(k==='pen')return `<td class="${a.pen<=-0.5?'menos':''}">${a.pen<=-0.5?'−'+num(-a.pen,1):'—'}</td>`;
    return `<td>${usdC(a.funil)}</td>`};
  document.getElementById('rankings').innerHTML=grupos.map(({c,g,rkc,rec})=>{
    const [sk,sd]=st.sort[c],pos=new Map(rkc.map((a,i)=>[a,i+1]));
    const val=a=>sk==='pos'?pos.get(a):sk==='nome'?nomeAf(a).toLowerCase():(a[sk]??-Infinity);
    const ord=[...rkc].sort((x,y)=>{const vx=val(x),vy=val(y);return (vx<vy?-1:vx>vy?1:0)*sd});
    return `<section class="rk ${c}"><div class="rk-h"><h2><span class="tag ${c}">${c}</span>Ranking Curva Afiliado ${c}</h2>
      <p><b>${n(rkc.length)}</b> no ranking de ${n(g.length)} afiliados · <b>${T?pct(rec/T,0):'—'}</b> da receita · média <b>${num(rkc.length?rkc.reduce((s,a)=>s+a.pts,0)/rkc.length:null,0)}</b> pts</p></div>
      ${rkc.length?`<div class="rw"><table class="tr" data-c="${c}"><thead><tr>${COLS.map(([k,l])=>`<th data-k="${k}"${k===sk?` aria-sort="${sd>0?'ascending':'descending'}"`:''}>${l}</th>`).join('')}</tr></thead>
      <tbody>${ord.map(a=>`<tr data-tip="${regTip(tipAf(a,fechada))}" data-delay="1" data-af="${afId(a)}" tabindex="0">${COLS.map(([k])=>cel(a,k,pos.get(a))).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="vazio">Nenhum afiliado com o mínimo de FEs nesta curva.</div>'}</section>`}).join('');
  // o ranking não ordena por nome (ficava confuso: a posição # embaralhava); as outras colunas ordenam
  document.querySelectorAll('.tr th').forEach(th=>{if(th.dataset.k==='nome')return;th.onclick=()=>{const c=th.closest('table').dataset.c,k=th.dataset.k,[sk,sd]=st.sort[c];
    st.sort[c]=[k,sk===k?-sd:(k==='pos'||k==='re60'?1:-1)];render()}});

  renderAfiliado(R);
  document.getElementById('rodape').innerHTML=
    `Pontuação = notas de 0 a 10 (${EIXOS.map(e=>e.l+' '+e.peso).join(' · ')}) + bônus (volume acima de ${n(MT.volIni)} FEs/dia; reembolso 60d até ${P$(MT.reBIni)}) − penalidades (disputas acima de ${P$(MT.cbIni)} das vendas, até −${fP(AJ.cb)}; prejuízo de 60 dias com call center abaixo de −US$ ${n(MT.prejIni)} por cliente, até −${fP(AJ.prej)}). `+
    `Curva Afiliado (A/B/C): receita do funil de ${mesTx(curvaJanela(periodo()[1]).ini)} a ${mesTx(curvaJanela(periodo()[1]).fim)} (2 meses fechados + o mês da safra). Safra aberta: o que já caiu + a parte que ainda falta (curva (dia/60)^${num(kEq(),2)}) × a previsão de 10 dias. Safra fechada (60+ dias): real. Custo do produto: Full Stack real, ou a média real de ${pct(PCT_FS)} da receita onde ainda não há pedido no armazém (a Vupim usa sempre a média). JVZoo pelo dia de Nova York; Vupim pelo dia de Brasília, desde 21/10.`;
}


/* ---------- aba Premissas: pesos, regras, réguas e exemplos reais ---------- */
const REGRAS={
  re60:{o:'Quanto do dinheiro das vendas volta ao cliente em até 60 dias da venda: pedido pelo cliente, alerta e disputa, mais as taxas de alerta (US$ 23) e disputa (US$ 49).',
        c:'Safra aberta: o que já caiu + a parte que ainda falta pela curva × a previsão de 10 dias (10d × fator do afiliado). Safra fechada: real.',u:'%',melhor:'menor'},
  lpf:{o:'Quanto cada cliente (FE) deixa no funil da JVZoo depois de CPA, taxas, reembolso e custo real do produto e frete (Full Stack).',
       c:'(Líquido do funil − custo − reembolso que ainda vai cair) ÷ FEs. Sem call center.',u:'US$',melhor:'maior'},
  fes:{o:'Volume: quantos clientes novos (FEs) o afiliado trouxe, em 30 dias.',c:'FEs da safra ÷ dias × 30. A meta muda com a curva do afiliado.',u:'FEs',melhor:'maior'},
  aov:{o:'Quanto cada cliente gasta no funil de entrada (FE, upsell, downsell, bump).',c:'Receita do funil ÷ FEs.',u:'US$',melhor:'maior'}};
const fmtR=(k,v)=>k==='re60'?num(v,0)+'%':k==='fes'?n(v):(v<0?'−':'')+'US$ '+n(Math.abs(v));
function reguaTab(k,pts){
  return `<table class="pm-r"><thead><tr><th>Resultado</th>${pts.map(x=>`<th>${fmtR(k,x[0])}</th>`).join('')}</tr></thead>
    <tbody><tr><td>Nota</td>${pts.map(x=>`<td class="${fx(x[1])}">${num(x[1],0)}</td>`).join('')}</tr></tbody></table>`}
function exemplo(a,fechada){
  const W=EIXOS.reduce((s,e)=>s+(a.n[e.k]==null?0:e.peso),0);
  const lin=EIXOS.map(e=>{const v=e.k==='fes'?a.fes30:a[e.k],x=a.n[e.k],pt=x==null||!W?0:10*x*e.peso/W;
    return `<tr><td>${e.l}</td><td>${e.f(v)}</td><td class="${fx(x)}">${num(x,1)}</td><td>${e.peso}</td><td>${num(pt,1)}</td></tr>`}).join('');
  return `<article class="pm-ex"><div class="pm-exh"><div><b>${a.S?SB+' ':''}${esc(nomeAf(a))}</b><span>Curva Afiliado ${a.curva} · ${n(a.fes)} FEs · ${fechada?'real':'previsto'}</span></div>${sc(a.pts)}</div>
    <div class="tab"><table class="pm-t"><thead><tr><th>Critério</th><th>Resultado</th><th>Nota</th><th>Peso</th><th>Pontos</th></tr></thead><tbody>${lin}
    <tr class="sub"><td>Base (notas × pesos)</td><td></td><td></td><td></td><td>${num(a.base100,1)}</td></tr>
    <tr><td>Bônus</td><td colspan="3">volume ${num(a.fes/(st.dias||30),1)} FEs/dia · reembolso ${pct(a.re60)}</td><td class="fb">${a.bonus>=0.05?'+'+num(a.bonus,1):'0'}</td></tr>
    <tr><td>Penalidades</td><td colspan="3">disputas ${a.tdisp==null?'—':pct(a.tdisp)} · ${usd(a.lpc)} por cliente (60d, com call center)</td><td class="${a.pen<=-0.05?'fr':''}">${a.pen<=-0.05?'−'+num(-a.pen,1):'0'}</td></tr>
    <tr class="tot"><td>Pontuação</td><td></td><td></td><td></td><td>${num(a.pts,1)}</td></tr></tbody></table></div></article>`}
const POR_QUE={re60:'Dinheiro que volta para o cliente (pedido, alerta e disputa). Quanto menor, melhor.',
  lpf:'O que sobra de cada cliente depois de CPA, taxas, reembolso e produto. Quanto maior, melhor.',
  fes:'Quantos clientes novos ele traz. A meta é maior para quem é Curva Afiliado A.',
  aov:'Quanto cada cliente gasta no funil. Quanto maior, melhor.'};
const COR_K={re60:'#4260E6',lpf:'#1F7F63',fes:'#6a80e8',aov:'#B86A16'};
const LAPIS='<svg class="lp" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
const FAIXA_TX=v=>v>=80?'forte':v>=60?'bom':v>=40?'atenção':'ruim';
// safra fixa desta aba: últimos 30 dias, ranking com 30+ FEs
function base30(){const sv=st.min;st.min=30;const R=calcular([FIM-29,FIM]);st.min=sv;return R}
const simDe=(a,nome)=>({nome,id:afId(a),ptsReal:a.pts,re:a.re60==null?null:a.re60*100,lpf:a.lpf,fes:a.fes30,aov:a.aov,curva:a.curva,disp:a.tdisp==null?0:a.tdisp*100,lpc:a.lpc});
const medi=vs=>{vs=vs.filter(v=>v!=null&&isFinite(v)).sort((x,y)=>x-y);return vs.length?vs[Math.floor(vs.length/2)]:null};
function simCalc(s){
  const nt={re60:s.re==null?NEUTRA:reta(s.re,REGUA.re60()),lpf:s.lpf==null?NEUTRA:reta(s.lpf,REGUA.lpf()),fes:reta(s.fes||0,REGUA.fes(s.curva)),aov:s.aov==null?NEUTRA:reta(s.aov,REGUA.aov())};
  const W=EIXOS.reduce((t,e)=>t+e.peso,0),pts=Object.fromEntries(EIXOS.map(e=>[e.k,W?10*nt[e.k]*e.peso/W:0]));
  const base=Object.values(pts).reduce((x,y)=>x+y,0),bV=bonusVol((s.fes||0)/30),bR=bonusRe(s.re==null?null:s.re/100),pC=penCb((s.disp||0)/100),pP=penPrej(s.lpc);
  const tot=base+bV+bR+pC+pP;return {nt,pts,base,bV,bR,pC,pP,tot,S:s.curva==='A'&&tot>100}}
function pqRadarHTML(s,c){return `<div class="pq-rdw" style="--c:${c.S?'#E58A00':'var(--brand)'}">${radar(EIXOS.map(e=>c.nt[e.k]),st.pqRef||[])}</div>
  <p class="pq-rl">Cheio = o afiliado simulado · tracejado = média do ranking</p>`}
function pqPlacarHTML(s,c){
  const lin=EIXOS.map(e=>`<div class="pq-l"><span>${e.l}</span><span class="pq-m"><b class="${fx(c.nt[e.k])}">${num(c.nt[e.k],1)}</b> × ${e.peso}</span><b>${num(c.pts[e.k],1)}</b></div>`).join('');
  const aj=(nome,motivo,v,lim,tipo)=>{const on=Math.abs(v)>=0.05;return `<div class="pq-a ${tipo} ${on?'on':''}"><span class="pq-ai">${on?'●':'○'}</span><span><b>${nome}</b><small>${motivo}</small></span><b class="pq-av">${on?(v>0?'+':'−')+num(Math.abs(v),1):'0'}<small>de ${lim}</small></b></div>`};
  return `<div class="pq-sc"><div class="pq-big ${scCls(c.tot)}">${num(c.tot,0)}<small>/100</small></div>
      <div class="pq-st"><span class="pq-tl">${c.S?SB:`<span class="tag ${s.curva}">${s.curva}</span>`}<b>${c.S?'Curva Afiliado S · premium':'Curva Afiliado '+s.curva}</b></span><small>Pontuação ${FAIXA_TX(c.tot)}${c.S?' · 100+ na Curva Afiliado A':''}</small><small class="pq-quem">${s.edit?`E se… · nota real ${num(s.ptsReal,0)}`:'Valores reais · '+(st.pqSafra||'')}</small></div></div>
    <div class="pq-g"><h3>Pontos das notas <small>nota × peso</small></h3>${lin}<div class="pq-l pq-sub"><span>Soma das notas</span><span></span><b>${num(c.base,1)}</b></div></div>
    <div class="pq-g"><h3>Bônus <small>somam pontos</small></h3>
      ${aj('Volume alto',`${num((s.fes||0)/30,1)} clientes/dia · vale acima de 12`,c.bV,'+'+fP(AJ.vol),'bo')}
      ${aj('Reembolso baixo',`${s.re==null?'sem dado':num(s.re,1)+'%'} · vale abaixo de ${P$(MT.reBIni)}`,c.bR,'+'+fP(AJ.re),'bo')}</div>
    <div class="pq-g"><h3>Penalidades <small>tiram pontos</small></h3>
      ${aj('Risco de chargeback',`${num(s.disp||0,1)}% em disputa · pesa acima de 2%`,c.pC,'−'+fP(AJ.cb),'pe')}
      ${aj('Prejuízo por cliente (c/ call)',`${usd(s.lpc)} · pesa abaixo de −US$ ${n(MT.prejIni)}`,c.pP,'−'+fP(AJ.prej),'pe')}</div>
    <div class="pq-l pq-tot"><span>Pontuação</span><span class="pq-m">notas ${num(c.base,1)} ${c.bV+c.bR>=0.05?'+ bônus '+num(c.bV+c.bR,1):''} ${c.pC+c.pP<=-0.05?'− penalidades '+num(-(c.pC+c.pP),1):''}</span><b>${num(c.tot,1)}</b></div>`}
function pqAtualiza(){
  const s=st.sim,el=document.getElementById('pqSim');if(!el||!s)return;const c=simCalc(s);
  EIXOS.forEach(e=>{const b=el.querySelector(`[data-nt="${e.k}"]`);if(b){b.className='pq-nt '+fx(c.nt[e.k]);b.textContent=num(c.nt[e.k],1)}});
  const fd=el.querySelector('#pqFd');if(fd)fd.textContent=num((s.fes||0)/30,1);
  const mf=el.querySelector('#pqMetaFes');if(mf)mf.textContent='meta '+s.curva+': '+n(META_FES[s.curva]);
  el.querySelectorAll('#pqCurva button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.c===s.curva)));
  el.querySelectorAll('.pz-it').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===s.id)));
  const rb=el.querySelector('#pzReal');if(rb)rb.disabled=!s.edit;
  const q=el.querySelector('#pzQuem');if(q)q.innerHTML=`${s.curva==='A'&&c.S?SB:`<span class="tag ${s.curva}">${s.curva}</span>`}<b>${esc(s.nome||'')}</b>${s.edit?'<em>com mudanças</em>':''}`;
  el.querySelector('#pqRadar').innerHTML=pqRadarHTML(s,c);el.querySelector('#pqPlacar').innerHTML=pqPlacarHTML(s,c)}
function pqRegras(){
  const fesT=['A','B','C'].map(c=>`<div class="pm-fc"><span class="tag ${c}">${c}</span>${reguaTab('fes',REGUA.fes(c))}</div>`).join('');
  return `<div class="pq-mh"><h2>Réguas completas</h2><button type="button" class="pm-btn" id="pqFecha">Fechar ✕</button></div>
    <p class="pq-mp">Cada resultado vira uma nota de 0 a 10. Entre os pontos da régua a nota é proporcional.</p>
    ${EIXOS.map(e=>`<div class="pq-mr"><h3>${e.l} <span class="tag-p">peso ${e.peso}</span></h3><p>${REGRAS[e.k].o}</p><div class="tab">${e.k==='fes'?fesT:reguaTab(e.k,REGUA[e.k]())}</div></div>`).join('')}
    <div class="pq-mr"><h3>Bônus e penalidades</h3><div class="tab"><table class="pm-t"><tbody>
      <tr><td>Volume alto</td><td>acima de ${n(MT.volIni)} clientes por dia: ${n(volMid())} = +${fP(AJ.vol*0.6)}, ${n(MT.volMax)} ou mais = +${fP(AJ.vol)}</td><td class="fb">+${fP(AJ.vol)}</td></tr>
      <tr><td>Reembolso baixo</td><td>reembolso 60d: ${P$(MT.reBIni)} = 0, ${P$(reMid())} = +${fP(AJ.re*0.6)}, ${P$(MT.reBMax)} ou menos = +${fP(AJ.re)}</td><td class="fb">+${fP(AJ.re)}</td></tr>
      <tr><td>Risco de chargeback</td><td>disputas: ${P$(MT.cbIni)} das vendas = 0, ${P$(MT.cbMax)} ou mais = −${fP(AJ.cb)}</td><td class="fr">−${fP(AJ.cb)}</td></tr>
      <tr><td>Prejuízo por cliente</td><td>com call center, 60 dias: −US$ ${n(MT.prejIni)} = 0, −US$ ${n(MT.prejMax)} ou pior = −${fP(AJ.prej)}</td><td class="fr">−${fP(AJ.prej)}</td></tr></tbody></table></div></div>
    <div class="pq-mr"><h3>Como prevemos o reembolso</h3><p>O que já caiu + a parte que ainda falta × a previsão de 10 dias (reembolso dos primeiros 10 dias × fator do afiliado; o geral é × ${num(FATOR,2)}). A parte que falta vem da curva (dia/60)^${num(kEq(),2)}, ajustada à mediana: quanto mais velha a venda, mais pesa o que já aconteceu. Safra com 60+ dias usa o real. Custo do produto: real da Full Stack, ou a média real de ${pct(PCT_FS)} da receita onde ainda não há pedido no armazém.</p></div>`}
const fP=v=>num(v,Number.isInteger(v)?0:1);
// campo pequeno para editar uma meta no meio do texto
const mi=(k,rot,st=1)=>`<input type="number" class="mt-in" data-m="${k}" value="${MT[k]}" step="${st}" inputmode="decimal" aria-label="${rot}" title="${rot}">`;
const META_ED={
  re60:()=>`Bom até ${mi('re9','Reembolso: bom até (%)',0.5)}% · médio até ${mi('re7','Reembolso: médio até (%)',0.5)}%`,
  lpf:()=>`Bom a partir de US$ ${mi('lpf9','Lucro por cliente: bom a partir de (US$)')} · médio a partir de US$ ${mi('lpf7','Lucro por cliente: médio a partir de (US$)')}`,
  fes:()=>`A ${mi('fesA','Meta de FEs da Curva Afiliado A',10)} · B ${mi('fesB','Meta de FEs da Curva Afiliado B',5)} · C ${mi('fesC','Meta de FEs da Curva Afiliado C',5)} em 30 dias (médio = metade)`,
  aov:()=>`Bom a partir de US$ ${mi('aov9','AOV: bom a partir de (US$)',5)} · médio a partir de US$ ${mi('aov7','AOV: médio a partir de (US$)',5)}`};
const AJUSTES=()=>[
  {k:'vol',t:'bo',nome:'Volume alto',o:'Afiliado que traz muitos clientes novos todo dia.',quando:`mais de ${mi('volIni','Volume alto: começa acima de (clientes por dia)')} clientes por dia`,vale:`${n(volMid())} por dia = +${fP(AJ.vol*0.6)} · ${mi('volMax','Volume alto: máximo a partir de (clientes por dia)',5)} ou mais = +${fP(AJ.vol)}`},
  {k:'re',t:'bo',nome:'Reembolso baixo',o:'Quase nenhum dinheiro volta para o cliente.',quando:`reembolso em 60 dias abaixo de ${mi('reBIni','Reembolso baixo: começa abaixo de (%)',0.5)}%`,vale:`${P$(reMid())} = +${fP(AJ.re*0.6)} · ${mi('reBMax','Reembolso baixo: máximo em (%)',0.5)}% ou menos = +${fP(AJ.re)}`},
  {k:'cb',t:'pe',nome:'Risco de chargeback',o:'Muitos clientes abrindo disputa no banco. Coloca a conta em risco.',quando:`disputas acima de ${mi('cbIni','Chargeback: começa acima de (% das vendas)',0.5)}% das vendas`,vale:`${P$((MT.cbIni+MT.cbMax)/2)} = −${fP(AJ.cb/2)} · ${mi('cbMax','Chargeback: máximo em (% das vendas)',0.5)}% ou mais = −${fP(AJ.cb)}`},
  {k:'prej',t:'pe',nome:'Prejuízo por cliente',o:'Cada cliente dá prejuízo, mesmo contando o call center.',quando:`prejuízo maior que US$ ${mi('prejIni','Prejuízo: começa acima de (US$ por cliente)',5)} por cliente`,vale:`US$ ${n((MT.prejIni+MT.prejMax)/2)} = −${fP(AJ.prej/2)} · US$ ${mi('prejMax','Prejuízo: máximo em (US$ por cliente)',5)} ou mais = −${fP(AJ.prej)}`}];
function simCampos(s){
  const campo=(k,l,meta,u,step,val)=>`<label class="pq-f"><span class="pq-fl">${l}<small${k==='fes'?' id="pqMetaFes"':''}>${meta}</small></span>
      <span class="pq-fi"><span class="ed">${u==='US$'?'<em>US$</em>':''}<input type="number" inputmode="decimal" step="${step}" id="sim-${k}" data-s="${k}" value="${val==null?'':Math.round(val*10)/10}" aria-label="${l}">${u==='%'?'<em>%</em>':''}${LAPIS}</span>
      ${k==='disp'||k==='lpc'?'<span class="pq-nt ghost"></span>':`<span class="pq-nt" data-nt="${k==='fes'?'fes':k==='re'?'re60':k}">—</span>`}</span></label>`;
  return `<div class="pq-fs">
    <h3>Resultado do afiliado <small>vira nota de 0 a 10</small></h3>
    ${campo('re','Reembolso 60 dias','meta '+EIXOS[0].meta(),'%',0.5,s.re)}
    ${campo('lpf','Lucro por cliente','meta '+EIXOS[1].meta(),'US$',1,s.lpf)}
    ${campo('fes','Clientes em 30 dias','meta '+s.curva+': '+n(META_FES[s.curva]),'',10,s.fes)}
    ${campo('aov','Ticket médio','meta '+EIXOS[3].meta(),'US$',5,s.aov)}
    <div class="pq-f"><span class="pq-fl">Curva Afiliado<small>pela receita</small></span><span class="pq-fi"><span class="seg pq-cv" id="pqCurva">${['A','B','C'].map(c=>`<button type="button" data-c="${c}" aria-pressed="${s.curva===c}">${c}</button>`).join('')}</span><span class="pq-nt ghost"></span></span></div>
    <div class="pq-f ro"><span class="pq-fl" title="Calculado: clientes em 30 dias ÷ 30">Clientes por dia<small>bônus &gt; 12</small></span><span class="pq-fi"><span class="rov" id="pqFd">—</span><span class="pq-nt ghost"></span></span></div>
    <h3>Para bônus e penalidades</h3>
    ${campo('disp','Disputas','% das vendas · pena &gt; 2%','%',0.1,s.disp)}
    ${campo('lpc','Resultado por cliente','c/ call center','US$',5,s.lpc)}</div>`}
function simPinta(){
  const box=document.getElementById('pzCampos');if(!box||!st.sim)return;box.innerHTML=simCampos(st.sim);
  box.querySelectorAll('input[data-s]').forEach(i=>i.oninput=()=>{const v=i.value===''?null:+i.value;st.sim[i.dataset.s]=v==null||!isFinite(v)?null:v;st.sim.edit=true;pqAtualiza()});
  box.querySelectorAll('#pqCurva button').forEach(b=>b.onclick=()=>{st.sim.curva=b.dataset.c;st.sim.edit=true;pqAtualiza()});
  pqAtualiza()}
function simLista(){
  const q=(st.simQ||'').trim().toLowerCase(),l=(st.pqOrd||[]).filter(a=>!q||nomeAf(a).toLowerCase().includes(q)||String(a.af).toLowerCase().includes(q));
  return l.length?l.map(a=>`<button type="button" class="pz-it" data-id="${afId(a)}" aria-pressed="${st.sim&&st.sim.id===afId(a)}"><span class="pz-ps">${st.pqOrd.indexOf(a)+1}</span><span class="pz-nm">${a.S?SB:`<span class="tag ${a.curva}">${a.curva}</span>`}<span>${esc(nomeAf(a))}</span></span>${sc(a.pts)}</button>`).join('')
    :'<p class="vazio">Nenhum afiliado com esse nome.</p>'}
function simEscolhe(id){const a=(st.pqOrd||[]).find(x=>afId(x)===id);if(!a)return;st.sim={...simDe(a,nomeAf(a)),edit:false};simPinta()}
/* ---------- Premissas: bons, médios e ruins em cada critério ----------
   Afiliados do ranking dos últimos 30 dias, separados pela nota de cada critério (bom 9–10, médio 7–8, ruim 0–6).
   As curvas usam todo o histórico deles: o reembolso por dia desde a venda e as semanas de venda. */
const FXS=[{k:'b',l:'Bons',t:'9–10',f:x=>x>=9},{k:'m',l:'Médios',t:'7–8',f:x=>x>=7&&x<9},{k:'r',l:'Ruins',t:'0–6',f:x=>x<7}];
const limNota=(rg,y)=>{for(let j=1;j<rg.length;j++){const [x0,y0]=rg[j-1],[x1,y1]=rg[j];if((y0-y)*(y1-y)<=0&&y0!==y1)return x0+(y-y0)*(x1-x0)/(y1-y0)}return null};
function faixaTx(k){
  if(k==='fes')return {b:`na meta da Curva Afiliado ou acima (A ${n(META_FES.A)} · B ${n(META_FES.B)} · C ${n(META_FES.C)} em 30 dias)`,m:'de metade da meta até a meta',r:'abaixo da metade da meta'};
  const rg=REGUA[k](),a9=limNota(rg,9),a7=limNota(rg,7);
  if(k==='re60')return {b:`até ${num(a9,0)}%`,m:`${num(a9,0)}% a ${num(a7,0)}%`,r:`acima de ${num(a7,0)}%`};
  return {b:`US$ ${n(a9)} ou mais`,m:`US$ ${n(a7)} a ${n(a9)}`,r:`abaixo de US$ ${n(a7)}`}}
const FX_POR_QUE={
  re60:'Reembolso acumulado (pedido, alerta e disputa) em % da receita, dia a dia desde a venda, nas vendas da safra do filtro. Cheio = já caiu; pontilhado = previsto até o dia 60 (a mesma conta da nota).',
  lpf:'Lucro previsto por cliente na semana da venda (já descontado o reembolso que ainda vai cair). É o que sobra de cada cliente que o afiliado traz.',
  fes:'Clientes novos (FEs) por dia: média dos afiliados da faixa, semana a semana. Semana sem venda conta como zero depois da 1ª venda dele; só aparece a semana com 3+ afiliados na faixa.',
  aov:'Quanto cada cliente gasta no funil (FE + upsells + downsells) na semana da venda.'};
function faixasHtml(R){const {rk}=R;
  if(!rk.length)return '';
  const CR=curvasRe(rk.map(a=>a.i),0,FIM),WS=new Map(rk.map(a=>[a.i,semanas(a.i,a)]));
  const s1=FIM-((new Date(D0.getTime()+FIM*864e5).getUTCDay()+6)%7)-7,s0=s1-7*15,SEM=[];for(let s=s0;s<=s1;s+=7)SEM.push(s);
  const md=v=>{const s=v.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y),h=s.length>>1;return s.length<3?null:s.length%2?s[h]:(s[h-1]+s[h])/2};
  const md2=v=>{const s=[...v].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};   // mediana da faixa (um afiliado fora da curva não puxa a linha)
  const cards=EIXOS.map(e=>{
    const G=FXS.map(f=>({...f,af:rk.filter(a=>a.n[e.k]!=null&&f.f(a.n[e.k]))})),tx=faixaTx(e.k);
    let ch;
    if(e.k==='re60'){
      // a mesma conta da nota, na safra dos últimos 30 dias: o que já caiu até a idade média das vendas e o previsto até o dia 60,
      // pela curva de cada afiliado; a faixa = média ponderada pela receita
      const yAf=(a,d)=>{const cv=curvaAf(a.i).pts,sh=x=>reta(x,cv)/100,ia=Math.max(0.5,Math.min(60,a.idade??60)),sa=sh(ia)||1e-9;
        return d<=ia?a.agora*sh(d)/sa:a.agora+(a.re60-a.agora)*(sh(d)-sa)/Math.max(1e-9,1-sa)};
      const ok=a=>a.agora!=null&&a.re60!=null&&a.funil>0,DS=[];for(let d=0;d<=60;d+=2)DS.push(d);
      const gy=(af,d)=>{const v=af.filter(ok),b=v.reduce((t,a)=>t+a.funil,0);return b?v.reduce((t,a)=>t+a.funil*yAf(a,d),0)/b:null};
      const gIa=af=>{const v=af.filter(ok),b=v.reduce((t,a)=>t+a.funil,0);return b?v.reduce((t,a)=>t+a.funil*Math.min(60,a.idade),0)/b:null};
      const MI=rk.filter(ok),my=d=>md(MI.map(a=>yAf(a,d))),DT=[0,1,3,7,10,14,21,30,45,60];
      const tp=d=>tipPt(`Dia ${d} desde a venda`,G.map(g=>[`${g.l} (${g.af.length})`,pct(gy(g.af,d))]).concat([['Mediana',pct(my(d))]]));
      const TPS=new Map(DT.map(d=>[d,tp(d)]));
      const ser=[{cls:'md',pts:DS.map(d=>[d,my(d)]).filter(q=>q[1]!=null),dots:false}];
      G.forEach(g=>{const ia=gIa(g.af);if(ia==null)return;const xs=[...new Set(DS.concat([Math.round(ia*2)/2]))].sort((x,y)=>x-y),cut=Math.round(ia*2)/2;
        ser.push({cls:'fx '+g.k,pts:xs.filter(d=>d<=cut).map(d=>[d,gy(g.af,d)]),dots:false},{cls:'fx prev '+g.k,pts:xs.filter(d=>d>=cut).map(d=>[d,gy(g.af,d)]),dots:false},
          {cls:'fx pt '+g.k,pts:DT.map(d=>[d,gy(g.af,d),TPS.get(d)])})});
      ch=lc({al:'Reembolso acumulado por faixa',x0:0,x1:60,yMax:RE_MAX,W:520,H:200,ticks:[0,10,20,30,45,60].map(d=>[d,'dia '+d]),fmt:v=>pct(v,0),ser});
    }else{
      // por semana de venda: FEs = média por afiliado que vendeu; AOV e lucro = ponderados pelos FEs
      const sw=(a,s)=>WS.get(a.i).find(w=>w.s===s&&w.fes>0);
      const ini=new Map(rk.map(a=>{const w=WS.get(a.i).find(x=>x.fes>0);return [a.i,w?w.s:Infinity]}));
      const rit=(a,s)=>{if(s<ini.get(a.i))return null;const w=sw(a,s);return (w?w.fes:0)/7};
      const val=(af,s)=>{const ws=af.map(a=>sw(a,s)).filter(Boolean);if(!ws.length)return null;const fes=ws.reduce((t,w)=>t+w.fes,0);
        if(e.k==='fes'){const v=af.map(a=>rit(a,s)).filter(x=>x!=null);return v.length>=3?v.reduce((t,x)=>t+x,0)/v.length:null}const ok=ws.filter(w=>w[e.k]!=null),fo=ok.reduce((t,w)=>t+w.fes,0);return fo?ok.reduce((t,w)=>t+w[e.k]*w.fes,0)/fo:null};
      const V=G.map(g=>SEM.map(s=>val(g.af,s))),M=SEM.map(s=>md(rk.map(a=>{const w=sw(a,s);return e.k==='fes'?rit(a,s):w?w[e.k]:null})));
      const f=e.k==='fes'?(v=>v==null?'—':num(v,v<10?1:0)+'/dia'):usd,tp=k=>tipPt(`Semana de ${dTx(SEM[k])}`,G.map((g,j)=>[`${g.l} (${g.af.length})`,f(V[j][k])]).concat([['Mediana',f(M[k])]]));
      const pts=arr=>SEM.map((s,k)=>arr[k]==null?null:[s,arr[k],tp(k)]).filter(Boolean);
      ch=lc({al:e.l+' por faixa',x0:SEM[0],x1:SEM[SEM.length-1],W:520,H:200,ancora:true,ticks:SEM.filter((s,k)=>k%3===0||k===SEM.length-1).map(s=>[s,dTx(s)]),fmt:f,
        ser:[{cls:'md',pts:pts(M),dots:false}].concat(G.map((g,j)=>({cls:'fx '+g.k,pts:pts(V[j])})))});
    }
    return `<article class="pz-fc"><div class="pz-fh"><b><i style="background:${COR_K[e.k]}"></i>${e.l}</b><small>peso ${e.peso}</small></div>
      <p>${FX_POR_QUE[e.k]}</p>
      <ul class="pz-fl">${G.map(g=>`<li class="${g.k}"><i></i><span><b>${g.l}</b> ${tx[g.k]}</span><em>${g.af.length}</em></li>`).join('')}<li class="md"><i></i><span>Mediana dos ${rk.length}</span></li></ul>
      <div class="pz-ch">${ch}</div></article>`});
  return `<section class="pz-b"><div class="pz-bh"><h3><span class="pq-n">3</span>Por que essas réguas: bons, médios e ruins <small>passe o mouse nos pontos</small></h3></div>
      <p class="pz-fi">Os ${rk.length} afiliados do ranking (safra ${dTx(R.p0)} a ${dTx(R.p1)}, ${n(st.min)}+ FEs) separados pela nota de cada critério: <span class="fb">bons 9–10</span>, <span class="fm">médios 7–8</span> e <span class="fr">ruins 0–6</span>. As curvas usam todo o histórico deles. O pontilhado cinza é a mediana: o afiliado do meio.</p>
      <div class="pz-fx">${cards.join('')}</div></section>`}
function renderPremissas(){
  const el=document.getElementById('premissas');if(!el)return;
  const R=calcular(),{rk}=R,ord=[...rk].sort((x,y)=>y.pts-x.pts);st.pqOrd=ord;st.pqSafra=`safra ${dTx(R.p0)} a ${dTx(R.p1)}`;
  st.pqRef=EIXOS.map(e=>{const v=rk.map(a=>a.n[e.k]).filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null});
  // sim aberto num afiliado: recarrega os valores reais dele (os pesos podem ter mudado a nota)
  if(st.sim&&st.sim.id){const a=ord.find(x=>afId(x)===st.sim.id);if(!a)st.sim=null;else if(!st.sim.edit)st.sim={...simDe(a,nomeAf(a)),edit:false};else if(a)st.sim.ptsReal=a.pts}
  if(!st.sim&&ord.length)st.sim={...simDe(ord[0],nomeAf(ord[0])),edit:false};
  const soma=EIXOS.reduce((s,e)=>s+e.peso,0);
  const bar=EIXOS.map(e=>`<i style="flex:${Math.max(e.peso,0.0001)};background:${COR_K[e.k]}" title="${e.l}: ${soma?num(100*e.peso/soma,0):0}%">${soma&&e.peso/soma>=0.06?e.r+' '+num(100*e.peso/soma,0)+'%':''}</i>`).join('');
  const meio=ord.length?afId(ord[Math.floor(ord.length/2)]):'';
  el.innerHTML=`
  <div class="pz">
    <section class="pz-top"><div><h2>Como a nota de um afiliado é montada</h2>
        <p>Quatro critérios viram uma nota de 0 a 100. Bônus somam pontos e penalidades tiram. Edite pesos e pontos e veja o ranking mudar na hora (fica salvo só neste navegador).</p></div>
      <button type="button" class="pz-sim" id="pqSimBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Simular a nota de um afiliado</button></section>

    <section class="pz-b"><div class="pz-bh"><h3><span class="pq-n">1</span>Os 4 critérios e quanto cada um pesa <small>edite os pesos com − e + e as metas nos campos</small></h3>
        <div class="pz-acts"><span class="pq-soma${soma===100?'':' bad'}">Soma ${soma}${soma===100?' ✓':' · a nota usa a proporção'}</span><button type="button" class="pm-btn" id="pmPad">Restaurar padrão</button></div></div>
      <div class="pq-bar pz-bar" aria-label="Fatia de cada critério">${bar}</div>
      <div class="pz-cs">${EIXOS.map(e=>`<article class="pz-k"><div class="pz-kh"><b title="${e.l}"><i style="background:${COR_K[e.k]}"></i>${e.l}</b>
          <div class="ed stp"><button type="button" data-p="${e.k}" data-d="-5" aria-label="Diminuir o peso de ${e.l}">−</button><input type="number" min="0" max="100" step="1" inputmode="numeric" id="peso-${e.k}" data-k="${e.k}" value="${e.peso}" aria-label="Peso de ${e.l}"><button type="button" data-p="${e.k}" data-d="5" aria-label="Aumentar o peso de ${e.l}">+</button></div></div>
          <p>${POR_QUE[e.k]}</p>
          <p class="pz-meta pz-mt"><b>Meta:</b> ${META_ED[e.k]()}</p></article>`).join('')}</div></section>

    <section class="pz-b"><div class="pz-bh"><h3><span class="pq-n">2</span>Bônus e penalidades <small>edite os pontos com − e + e os limites nos campos</small></h3>
        <div class="pz-acts"><button type="button" class="pm-btn" id="ajPad">Restaurar padrão</button></div></div>
      <div class="pz-cs">${AJUSTES().map(a=>`<article class="pz-j ${a.t}"><div class="pz-kh"><b title="${a.nome}"><span class="pz-sg">${a.t==='bo'?'+':'−'}</span>${a.nome}</b>
          <div class="ed stp aj-stp"><button type="button" data-j="${a.k}" data-d="-${a.k==='prej'?5:1}" aria-label="Diminuir os pontos de ${a.nome}">−</button><span class="aj-sn">${a.t==='bo'?'+':'−'}</span><input type="number" min="0" max="100" step="1" inputmode="numeric" id="aj-${a.k}" data-j="${a.k}" value="${AJ[a.k]}" aria-label="Pontos máximos de ${a.nome}"><button type="button" data-j="${a.k}" data-d="${a.k==='prej'?5:1}" aria-label="Aumentar os pontos de ${a.nome}">+</button></div></div>
          <p>${a.o}</p><p class="pz-meta"><b>Quando:</b> ${a.quando}</p><p class="pz-meta"><b>Quanto:</b> ${a.vale}</p></article>`).join('')}</div></section>

    ${faixasHtml(R)}
  </div>
  <div class="pq-leg"><span>Notas: <span class="fb">9–10 bom</span> · <span class="fm">7–8 médio</span> · <span class="fr">0–6 ruim</span></span>
    <span>Curva Afiliado pela receita dos 3 meses até o fim da safra (2 fechados + o da safra): <span class="tag A">A</span> 80% · <span class="tag B">B</span> até 95% · <span class="tag C">C</span> o resto · ${SB} curva A com 100+</span>
    <button type="button" class="pq-lk" id="pqReg">Ver réguas completas →</button></div>
  <div class="pq-mod" id="pqMod" hidden><div class="pq-mi" role="dialog" aria-modal="true" aria-label="Réguas completas">${pqRegras()}</div></div>
  <div class="pq-mod pz-mod" id="pqSim" hidden><div class="pz-mi" role="dialog" aria-modal="true" aria-labelledby="pzTit">
    <div class="pz-mhd"><div><h2 id="pzTit">Simulador da nota</h2><p>Escolha um afiliado da safra do filtro e veja como a nota dele é montada. Mude os números para testar “e se…”.</p></div>
      <button type="button" class="pm-btn" id="pzFecha">Fechar ✕</button></div>
    <div class="pz-g">
      <aside class="pz-ls"><label class="ed pz-q"><input type="search" id="pzBusca" placeholder="Buscar afiliado" aria-label="Buscar afiliado" value="${esc(st.simQ||'')}">${LAPIS}</label>
        <div class="pz-at">${ord.length?`<button type="button" class="pm-btn" data-ir="${afId(ord[0])}">O melhor</button><button type="button" class="pm-btn" data-ir="${meio}">O do meio</button><button type="button" class="pm-btn" data-ir="${afId(ord[ord.length-1])}">O pior</button>`:''}</div>
        <div class="pz-lh"><span>#</span><span>Afiliado (${ord.length} no ranking)</span><span>Pontos</span></div>
        <div class="pz-list" id="pzList">${simLista()}</div></aside>
      <section class="pz-md"><div class="pz-qm"><span id="pzQuem"></span><button type="button" class="pm-btn" id="pzReal" disabled>↺ Voltar aos valores reais</button></div>
        <div id="pzCampos"></div><div class="pq-rd" id="pqRadar"></div></section>
      <section class="pz-rt"><h3 class="pz-h3">O resultado</h3><div id="pqPlacar"></div></section>
    </div></div></div>`;
  // pesos
  const salva=()=>{try{LS.setItem('ns-af-pesos',JSON.stringify(Object.fromEntries(EIXOS.map(x=>[x.k,x.peso]))))}catch(err){}};
  el.querySelectorAll('input[data-k]').forEach(i=>i.onchange=()=>{const e=EIXOS.find(x=>x.k===i.dataset.k);e.peso=Math.max(0,Math.min(100,Math.round(+i.value||0)));salva();render()});
  el.querySelectorAll('button[data-p]').forEach(b=>b.onclick=()=>{const e=EIXOS.find(x=>x.k===b.dataset.p);e.peso=Math.max(0,Math.min(100,e.peso+(+b.dataset.d)));salva();render();
    const f=document.querySelector(`button[data-p="${b.dataset.p}"][data-d="${b.dataset.d}"]`);if(f)f.focus()});
  const salvaAj=()=>{try{LS.setItem('ns-af-ajustes',JSON.stringify(AJ))}catch(err){}};
  let volta;
  el.querySelectorAll('input[data-j]').forEach(i=>i.onchange=()=>{AJ[i.dataset.j]=Math.max(0,Math.min(100,Math.round(+i.value||0)));salvaAj();render()});
  el.querySelectorAll('button[data-j]').forEach(b=>b.onclick=()=>{AJ[b.dataset.j]=Math.max(0,Math.min(100,AJ[b.dataset.j]+(+b.dataset.d)));salvaAj();render();
    const f=document.querySelector(`button[data-j="${b.dataset.j}"][data-d="${b.dataset.d}"]`);if(f)f.focus()});
  const ap=document.getElementById('ajPad');if(ap)ap.onclick=()=>{Object.assign(AJ,AJ_PADRAO);try{LS.removeItem('ns-af-ajustes')}catch(err){}volta(['volIni','volMax','reBIni','reBMax','cbIni','cbMax','prejIni','prejMax']);render()};
  const salvaMT=()=>{try{LS.setItem('ns-af-metas',JSON.stringify(MT))}catch(err){}};
  el.querySelectorAll('input[data-m]').forEach(i=>i.onchange=()=>{const v=parseFloat(String(i.value).replace(',','.'));
    if(isFinite(v)){MT[i.dataset.m]=v;fixMT(i.dataset.m);aplicaMT();salvaMT()}render();const f=document.querySelector(`input[data-m="${i.dataset.m}"]`);if(f)f.focus()});
  volta=ks=>{ks.forEach(k=>MT[k]=MT_PADRAO[k]);aplicaMT();salvaMT()};
  const pd=document.getElementById('pmPad');if(pd)pd.onclick=()=>{EIXOS.forEach(e=>e.peso=PESO_PADRAO[e.k]);try{LS.removeItem('ns-af-pesos')}catch(err){}volta(['re9','re7','lpf9','lpf7','fesA','fesB','fesC','aov9','aov7']);render()};
  // réguas
  const mod=document.getElementById('pqMod'),abreR=()=>{mod.hidden=false;document.getElementById('pqFecha').focus()},fechaR=()=>{mod.hidden=true;document.getElementById('pqReg').focus()};
  document.getElementById('pqReg').onclick=abreR;document.getElementById('pqFecha').onclick=fechaR;mod.onclick=e=>{if(e.target===mod)fechaR()};mod.onkeydown=e=>{if(e.key==='Escape')fechaR()};
  // simulador
  const sim=document.getElementById('pqSim'),btn=document.getElementById('pqSimBtn');
  const abreS=()=>{sim.hidden=false;st.simAberto=true;document.body.classList.add('modal-on');simPinta();const at=sim.querySelector('.pz-it[aria-pressed="true"]');if(at)at.scrollIntoView({block:'nearest'});document.getElementById('pzFecha').focus()};
  const fechaS=()=>{sim.hidden=true;st.simAberto=false;document.body.classList.remove('modal-on');btn.focus()};
  btn.onclick=abreS;document.getElementById('pzFecha').onclick=fechaS;sim.onclick=e=>{if(e.target===sim)fechaS()};sim.onkeydown=e=>{if(e.key==='Escape')fechaS()};
  const lista=document.getElementById('pzList');
  lista.onclick=e=>{const b=e.target.closest('.pz-it');if(b)simEscolhe(b.dataset.id)};
  sim.querySelectorAll('[data-ir]').forEach(b=>b.onclick=()=>{simEscolhe(b.dataset.ir);const it=lista.querySelector(`.pz-it[data-id="${b.dataset.ir}"]`);if(it)it.scrollIntoView({block:'nearest'})});
  document.getElementById('pzBusca').oninput=e=>{st.simQ=e.target.value;lista.innerHTML=simLista()};
  document.getElementById('pzReal').onclick=()=>{if(st.sim&&st.sim.id)simEscolhe(st.sim.id)};
  if(st.simAberto)abreS()}

/* ---------- página do afiliado (#af-<id>) ---------- */
const irPara=h=>pagina(h);
function abreAf(id){if(!id)return;if(st.pg!=='af')st.voltar=st.pg;irPara('af-'+id)}
function semanas(i,a){
  // por semana de venda (segunda a domingo): FEs, AOV, reembolso real até hoje, reembolso 60d previsto e lucro/cliente previsto
  const W=new Map();
  for(const r of DADOS.rows){if(r[0]!==i||r[1]>FIM)continue;const dt=new Date(D0.getTime()+r[1]*864e5),dw=(dt.getUTCDay()+6)%7,s=r[1]-dw;
    let w=W.get(s);if(!w)W.set(s,w={s,fes:0,fu:0,liq:0,custo:0,d60:0,d10:0,b10:0,idS:0});
    const fu=r[C.funil];w.fes+=r[C.fes];w.fu+=fu;w.liq+=r[C.liq_funil];w.custo+=r[C.custo_fs]+PCT_FS*Math.max(0,fu-r[C.funil_coberto]);
    w.d60+=D60(r);w.idS+=fu*Math.min(60,FIM-r[1]);if(r[1]<=FIM-10){w.d10+=D10(r);w.b10+=fu}}
  return [...W.values()].sort((x,y)=>x.s-y.s).map(w=>{const id=w.fu?w.idS/w.fu:60,maduro=w.s+6<=FIM-60;
    const prev=maduro?null:(w.b10>0?(w.d10+K_R10*R10G)/(w.b10+K_R10):(a.r10??R10G))*a.fator;
    const real=w.fu?w.d60/w.fu:null,re=maduro?real:Math.max(real??0,prev??0),fut=maduro?0:Math.max(0,re*w.fu-w.d60);
    return {s:w.s,fes:w.fes,aov:w.fes?w.fu/w.fes:null,real,re,maduro,lpf:w.fes?(w.liq-w.custo-fut)/w.fes:null,idade:id}})}
function grafSem(ws,k,tipo,fmt,p0,p1){
  const W=520,H=150,L=46,R=10,T=12,B=24,vs=ws.map(w=>w[k]).filter(v=>v!=null);if(!vs.length)return '<div class="vazio">Sem dado.</div>';
  let lo=Math.min(0,...vs),hi=Math.max(...vs,0);if(k==='re'){hi=Math.max(hi,...ws.map(w=>w.real??0))}if(hi===lo)hi=lo+1;const pad=(hi-lo)*.08;hi+=pad;if(lo<0)lo-=pad;
  const n0=ws.length,bw=(W-L-R)/n0,X=i=>L+bw*i+bw/2,Y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
  let s=`<svg class="gs" viewBox="0 0 ${W} ${H}" role="img">`;
  ws.forEach((w,i)=>{if(w.s+6>=p0&&w.s<=p1)s+=`<rect class="saf" x="${(L+bw*i).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H-T-B}"/>`});
  [lo,(lo+hi)/2,hi].forEach(v=>s+=`<line class="gr" x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L-5}" y="${(Y(v)+3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`);
  if(lo<0)s+=`<line class="zero" x1="${L}" x2="${W-R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`;
  const passo=Math.max(1,Math.ceil(n0/7));ws.forEach((w,i)=>{if(i%passo===0)s+=`<text x="${X(i).toFixed(1)}" y="${H-7}" text-anchor="middle">${dTx(w.s)}</text>`});
  if(tipo==='barra')ws.forEach((w,i)=>{const v=w[k];if(v==null)return;const y0=Y(Math.max(0,lo)),y=Y(v);s+=`<rect class="bar ${v<0?'neg':''}" x="${(X(i)-bw*.32).toFixed(1)}" y="${Math.min(y,y0).toFixed(1)}" width="${(bw*.64).toFixed(1)}" height="${Math.max(1,Math.abs(y0-y)).toFixed(1)}" rx="2"><title>${dTx(w.s)}: ${fmt(v)}</title></rect>`});
  else{const pts=(f,flt)=>ws.map((w,i)=>[i,w[f]]).filter(([i,v])=>v!=null&&flt(ws[i])).map(([i,v])=>`${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    if(k==='re'){s+=`<polyline class="ln" points="${pts('real',()=>true)}"/><polyline class="ln prev" points="${pts('re',w=>!w.maduro)}"/>`;
      ws.forEach((w,i)=>{if(w.re!=null)s+=`<circle class="${w.maduro?'pt':'pp'}" cx="${X(i).toFixed(1)}" cy="${Y(w.re).toFixed(1)}" r="3"><title>${dTx(w.s)}: ${w.maduro?'real':'previsto'} ${fmt(w.re)} · já caiu ${fmt(w.real)}</title></circle>`})}
    else{s+=`<polyline class="ln" points="${pts(k,()=>true)}"/>`;ws.forEach((w,i)=>{if(w[k]!=null)s+=`<circle class="pt" cx="${X(i).toFixed(1)}" cy="${Y(w[k]).toFixed(1)}" r="3"><title>${dTx(w.s)}: ${fmt(w[k])}</title></circle>`})}}
  return s+'</svg>'}
/* ---------- curvas do afiliado contra a mediana da curva dele ---------- */
const DC=[0,1,3,5,7,10,14,21,30,45,60];
const RT=(r,d)=>d===0?0:d===10?D10(r):d===60?D60(r):r[C['rt'+d]];
const mediana=v=>{const s=[...v].sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):null};
// reembolso + taxas acumulado até o dia d ÷ receita, só com as vendas que já têm d dias (por afiliado)
function curvasRe(ids,p0,p1){const M=new Map();ids.forEach(i=>M.set(i,DC.map(()=>[0,0])));
  for(const r of DADOS.rows){const o=M.get(r[0]);if(!o||r[1]<p0||r[1]>p1)continue;const age=FIM-r[1],fu=r[C.funil];
    DC.forEach((d,k)=>{if(age>=d){o[k][0]+=RT(r,d);o[k][1]+=fu}})}
  return M}
function lc(c){
  const W=c.W||540,H=c.H||180,L=52,R=14,T=16,B=26;
  const ys=c.ser.flatMap(s=>s.pts.map(p=>p[1])).concat(c.ys||[]).filter(v=>v!=null&&isFinite(v));
  if(!ys.length)return '<div class="vazio">Sem dado nesta safra.</div>';
  let lo=Math.min(0,...ys),hi=Math.max(0,...ys);if(hi===lo)hi=lo+1;const pd=(hi-lo)*.1;hi+=pd;if(lo<0)lo-=pd;
  if(c.yMax!=null)hi=Math.max(c.yMax,Math.max(...ys)*1.05);   // escala fixa (reembolso: até 35%)
  const X=x=>L+(x-c.x0)/((c.x1-c.x0)||1)*(W-L-R),Y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
  let s=`<svg class="lc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${c.al}">`;
  (c.band||[]).forEach(([a,b])=>s+=`<rect class="saf" x="${X(a).toFixed(1)}" y="${T}" width="${Math.max(1,X(b)-X(a)).toFixed(1)}" height="${H-T-B}"/>`);
  [lo,(lo+hi)/2,hi].forEach(v=>s+=`<line class="gr" x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L-7}" y="${(Y(v)+3.5).toFixed(1)}" text-anchor="end">${c.fmt(v)}</text>`);
  if(lo<0)s+=`<line class="zero" x1="${L}" x2="${W-R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`;
  c.ticks.forEach(([x,t],k)=>s+=`<text x="${X(x).toFixed(1)}" y="${H-8}" text-anchor="${c.ancora===false?'middle':k===0?'start':k===c.ticks.length-1?'end':'middle'}">${t}</text>`);
  if(c.extra)s+=c.extra(X,Y,T,H-B);
  for(const se of c.ser){if(se.pts.length>1)s+=`<polyline class="${se.cls}" points="${se.pts.map(q=>X(q[0]).toFixed(1)+','+Y(q[1]).toFixed(1)).join(' ')}"/>`;
    se.pts.forEach(q=>{if(se.dots===false&&!q[3])return;const cx=X(q[0]).toFixed(1),cy=Y(q[1]).toFixed(1);
      s+=`<circle class="${se.cls} dt${q[3]?' '+q[3]:''}" cx="${cx}" cy="${cy}" r="3.2"/>`;if(q[2])s+=`<circle class="hit" cx="${cx}" cy="${cy}" r="10" data-tip="${q[2]}"/>`})}
  return s+'</svg>'}
const tipPt=(t,linhas)=>regTip(`<div class="t1"><b>${t}</b></div><div class="kv">${linhas.map(([k,v])=>`<span>${k}</span><b>${v}</b>`).join('')}</div>`);
function renderAfiliado(R){
  const el=document.getElementById('afiliado');if(!el||st.pg!=='af')return;
  const {L,rk,fechada,dias,p0,p1}=R,a=L.find(x=>afId(x)===st.afId);
  const volta=`<button type="button" class="pm-btn" id="afVolta">← Voltar</button>`;
  if(!a){const nm=AFS.find(x=>String(x[0]).split(' ').pop()===st.afId);el.innerHTML=`<section class="pm-b"><div class="pm-bh"><div><h2>${esc(nm?fmtNome(nm[1]||nm[0]):'Afiliado')}</h2><p>Sem vendas na safra ${dTx(p0)} a ${dTx(p1)}. Escolha outra safra no topo.</p></div>${volta}</div></section>`;}
  else{
    const real=fechada||a.idade>=59.5,sx=real?'real':'prev.',rkc=rk.filter(x=>x.curva===a.curva).sort((x,y)=>y.pts-x.pts),pos=rkc.indexOf(a)+1;
    document.getElementById('titulo').textContent=nomeAf(a);
    const nome=esc(nomeAf(a)),cv=a.curva,cor=corAf(a);
    // conta da nota
    const cr=contaNota(a).map(c=>`<tr><td>${c.e.l}</td><td>${c.e.f(c.v)}</td><td>${c.e.meta(cv)}</td><td class="${fx(c.x)}">${num(c.x,1)}</td><td>${c.e.peso}</td><td>${num(c.pts,1)}</td></tr>`).join('');
    const aj=ajustesAf(a).map(j=>`<tr><td><span class="pz-sg ${j.t}">${j.t==='bo'?'+':'−'}</span>${j.nome}</td><td colspan="4" class="mo">${j.motivo}</td><td class="${j.pts>=0.05?'mais':j.pts<=-0.05?'menos':'zero'}">${ptsTx(j.pts)}</td></tr>`).join('');
    // grupo: afiliados da mesma curva na safra
    const G=L.filter(x=>x.curva===cv&&x.fes>0),CR=curvasRe(G.map(x=>x.i),p0,p1),meu=CR.get(a.i);
    const medRe=DC.map((d,k)=>{const v=G.map(x=>CR.get(x.i)[k]).filter(o=>o[1]>=3000).map(o=>o[0]/o[1]);return v.length>=3?mediana(v):null});
    const minha=DC.map((d,k)=>meu[k][1]>0?meu[k][0]/meu[k][1]:null);
    let ult=-1;DC.forEach((d,k)=>{if(minha[k]!=null)ult=k});
    const dTip=k=>tipPt(`Dia ${DC[k]} desde a venda`,[[nomeAf(a),minha[k]==null?'—':pct(minha[k])],[`Mediana da Curva Afiliado ${cv}`,medRe[k]==null?'—':pct(medRe[k])],['Base (receita com '+DC[k]+'+ dias)',usdC(meu[k][1])]]);
    const serAf=DC.map((d,k)=>minha[k]==null?null:[d,minha[k],dTip(k)]).filter(Boolean);
    const serMd=DC.map((d,k)=>medRe[k]==null?null:[d,medRe[k],dTip(k)]).filter(Boolean);
    // projeção até o dia 60 pela forma da curva média, a partir do último dia medido (o acumulado não desce)
    // dia a dia pela curva histórica dele: y(d) = real no último dia × % da curva dele em d ÷ % no último dia
    const ch=curvaAf(a.i),cvTx=ch.w>=0.005?`curva histórica dele (peso ${pct(ch.w,0)}, o resto da mediana geral)`:'mediana geral dos afiliados (ele ainda não tem venda com 60 dias)';
    const d0=ult>0?DC[ult]:null,c0=d0==null?null:Math.max(1,reta(d0,ch.pts)),prj=d=>minha[ult]*reta(d,ch.pts)/c0;
    const v60=d0==null?null:prj(60);
    const serPv=d0!=null&&d0<60?[[d0,minha[ult],null]].concat(Array.from({length:60-d0},(_,k)=>d0+k+1).map(d=>d<60?[d,prj(d),null]:
      [60,v60,tipPt('Dia 60 (projeção)',[['Vendas dele com idade para medir',pct(v60)],['Reembolso 60d da safra inteira ('+sx+')',pct(a.re60)],['Forma da projeção',ch.w>=0.005?`curva dele (${pct(ch.w,0)}) + mediana geral`:'mediana geral (sem venda de 60 dias)']]),'pf'])):[];
    // dia em que o lucro zera: reembolso acumulado alcança a margem antes do reembolso
    const be=a.funil?(a.liq-a.custo+a.d60)/a.funil:null,lin=serAf.concat(serPv.slice(1)).map(q=>[q[0],q[1]]);let dz=null;
    if(be!=null&&isFinite(be)){if(be<=0)dz=0;else for(let k=1;k<lin.length;k++){const [x0,y0]=lin[k-1],[x1,y1]=lin[k];if(y1>=be){dz=y1===y0?x1:x0+(be-y0)*(x1-x0)/(y1-y0);break}}}
    const chRe=lc({al:'Reembolso acumulado por dia',x0:0,x1:60,yMax:RE_MAX,ticks:[0,10,20,30,45,60].map(d=>[d,'dia '+d]),fmt:v=>pct(v,0),ys:be!=null&&be>0&&be<0.6?[be]:[],
      ser:[{cls:'md',pts:serMd},{cls:'af',pts:serAf},{cls:'af prev',pts:serPv,dots:false}],
      extra:(X,Y,t,b)=>dz==null?'':`<line class="be" x1="${X(dz).toFixed(1)}" x2="${X(dz).toFixed(1)}" y1="${t}" y2="${b}"/><text class="bel" x="${(dz>44?X(dz)-5:X(dz)+5).toFixed(1)}" y="${t+10}" text-anchor="${dz>44?'end':'start'}">${dz===0?'prejuízo desde a venda':'lucro 0 · dia '+num(dz,0)}</text>`});
    const msgRe=be==null||!isFinite(be)?'':`<div class="bz ${dz==null?'ok':'neg'}">${dz==null?`Lucro positivo até o dia 60 nas vendas que já dá para medir: o prejuízo começaria com ${pct(be)} de reembolso.`:dz===0?'Prejuízo desde a venda: a margem não cobre o CPA e os custos, mesmo sem reembolso.':`${ult>=0&&dz>DC[ult]?`Pela projeção pontilhada, feita pela ${cvTx}`:'Nas vendas dele que já têm idade para medir'}, o lucro zera por volta do dia ${num(dz,0)}, quando o reembolso chega a ${pct(be)} da receita.`}</div>`;
    // semanas: o afiliado contra a mediana da curva
    const ws=semanas(a.i,a),WS=new Map(G.map(x=>[x.i,new Map(semanas(x.i,x).map(w=>[w.s,w]))]));
    const medW=(s,k,mf)=>{const v=[];for(const m of WS.values()){const w=m.get(s);if(w&&w.fes>=mf&&w[k]!=null)v.push(w[k])}return v.length>=3?mediana(v):null};
    const nW=ws.length,passo=Math.max(1,Math.ceil(nW/7)),ticks=ws.map((w,i)=>[i,dTx(w.s)]).filter((x,i)=>i%passo===0);
    const band=[];ws.forEach((w,i)=>{if(w.s+6>=p0&&w.s<=p1)band.push([i-0.5,i+0.5])});
    const chW=(k,fmt,mf,tit)=>{const md=ws.map(w=>medW(w.s,k,mf));
      const tp=i=>tipPt(`${tit} · semana de ${dTx(ws[i].s)}`,[[nomeAf(a),ws[i][k]==null?'—':fmt(ws[i][k])],[`Mediana da Curva Afiliado ${cv}`,md[i]==null?'—':fmt(md[i])],['FEs dele na semana',n(ws[i].fes)]]);
      return lc({al:tit,x0:-0.5,x1:nW-0.5,ticks,ancora:false,fmt,band:st.per==='tudo'?[]:band,
        ser:[{cls:'md',pts:ws.map((w,i)=>md[i]==null?null:[i,md[i],tp(i)]).filter(Boolean)},
             {cls:'af',pts:ws.map((w,i)=>w[k]==null||(k!=='fes'&&w.fes<1)?null:[i,w[k],tp(i)]).filter(Boolean)}]})};
    const k=(l,v,m,c='')=>`<article class="kpi${c}"><span class="k">${l}</span><b class="v">${v}</b><span class="m">${m}</span></article>`;
    el.innerHTML=`
    <section class="afh${a.S?' ouro':''}"><div class="afh-l">${volta}
        <div class="afh-n"><h2>${a.S?SB+' ':`<span class="tag ${cv}">${cv}</span>`}${nome}</h2>
        <p>${PLB(a)} ${esc(a.af)} · Curva Afiliado ${a.S?'S (premium)':cv}${pos?` · <b>#${pos}</b> de ${rkc.length} no ranking da curva`:' · fora do ranking (poucos FEs)'} · safra ${dTx(p0)} a ${dTx(p1)} · <b>${real?'real':'previsto'}</b></p>${a.pl==='Vupim'?`<p class="vu-nt">${NOTA_VU}</p>`:''}</div></div>
      <div class="afh-s"><div class="afh-pt">${sc(a.pts)}<small>/100</small></div>
        <div class="afh-c">${num(a.base100,1)} base ${a.bonus>=0.05?`<span class="mais">+ ${num(a.bonus,1)} bônus</span>`:''} ${a.pen<=-0.05?`<span class="menos">− ${num(-a.pen,1)} pen.</span>`:''}</div></div></section>
    <section class="bigs afb">${k('Receita do funil',usdC(a.funil),`${n(a.fes)} FEs na safra`)}${k('Reembolso 60d '+sx,pct(a.re60),`até agora ${pct(a.agora)} · meta ${EIXOS[0].meta()}`)}
      ${k('Lucro/cliente '+sx,usd(a.lpf),`hoje ${usd(a.lpfHoje)} · meta ${EIXOS[1].meta()}`)}${k('FEs (30 dias)',n(a.fes30),`meta Curva Afiliado ${cv}: ${n(META_FES[cv])}`)}
      ${k('AOV',usd(a.aov),'meta '+EIXOS[3].meta())}${k('Líquido c/ call center',usd(a.lpc),'por cliente, 60 dias')}${k('Risco de chargeback',a.tdisp==null?'—':pct(a.tdisp),'disputas · limite '+P$(MT.cbIni))}</section>
    <section class="pm-b afn"><div class="pm-bh"><div><h2>Como a nota dele é montada</h2><p>Radar: linha cheia = ele · tracejado = média do ranking. Ao lado, a conta: nota de cada critério × peso, mais bônus e menos penalidades.</p></div></div>
      <div class="afn-g"><div class="afr" style="--c:${cor}">${radar(EIXOS.map(e=>a.n[e.k]),REF_N)}</div>
        <div class="tab"><table class="pm-t afct"><thead><tr><th>Critério</th><th>Resultado ${sx}</th><th>Meta (nota 9)</th><th>Nota</th><th>Peso</th><th>Pontos</th></tr></thead><tbody>${cr}
          <tr class="sub"><td colspan="5">Base (notas × pesos)</td><td>${num(a.base100,1)}</td></tr>
          <tr class="grp"><td colspan="6">Bônus e penalidades</td></tr>${aj}
          <tr class="tot"><td colspan="5">Pontuação = base ${num(a.base100,1)} ${a.bonus>=0.05?'+ bônus '+num(a.bonus,1):''} ${a.pen<=-0.05?'− penalidades '+num(-a.pen,1):''}</td><td>${num(a.pts,1)}</td></tr></tbody></table></div></div></section>
    <section class="pm-b afcv" style="--c:${cor}"><div class="pm-bh"><div><h2>Ele contra a mediana da Curva Afiliado ${cv}</h2><p>Mediana dos ${n(G.length)} afiliados da Curva Afiliado ${cv} na safra ${dTx(p0)} a ${dTx(p1)}. Passe o mouse nos pontos para ver os valores.</p></div>
        <div class="lg"><span><i></i>${nome}</span><span><i class="md"></i>Mediana da Curva Afiliado ${cv}</span><span><i class="pv"></i>Previsto</span><span><i class="be"></i>Lucro zero</span></div></div>
      <div class="afw">
        <div><h3>Reembolso acumulado por dia desde a venda</h3>${chRe}${msgRe}</div>
        <div><h3>FEs por semana</h3>${chW('fes',v=>n(v),1,'FEs')}</div>
        <div><h3>AOV por semana</h3>${chW('aov',v=>usd(v),3,'AOV')}</div>
        <div><h3>Lucro/cliente previsto por semana</h3>${chW('lpf',v=>usd(v),3,'Lucro/cliente previsto')}</div></div></section>`;}
  const b=document.getElementById('afVolta');if(b)b.onclick=()=>irPara(st.voltar&&st.voltar!=='af'?st.voltar:'ranking');
}

/* ---------- navegação e filtros ---------- */
const PGS={visao:['Visão geral','Visão geral dos afiliados'],ranking:['Ranking','Ranking dos afiliados'],premissas:['Premissas','Premissas da pontuação']};
function pagina(pg){const af=/^af-[A-Za-z0-9-]+$/.test(pg||'');if(af&&st.pg!=='af'&&st.pg)st.voltar=st.voltar||st.pg;
  st.pg=af?'af':PGS[pg]?pg:'ranking';if(af)st.afId=pg.slice(3);
  root.querySelectorAll('[data-pg]').forEach(b=>b.setAttribute('aria-current',b.dataset.pg===st.pg?'page':'false'));
  [...Object.keys(PGS),'af'].forEach(k=>document.getElementById('pg-'+k).hidden=st.pg!==k);document.getElementById('bigs').hidden=st.pg==='premissas'||st.pg==='af';
  const pq=st.pg==='premissas';if(!pq&&st.simAberto){st.simAberto=false;document.body.classList.remove('modal-on')}root.querySelector('.af-filtros').hidden=false;document.getElementById('safraLn').hidden=false;document.getElementById('rodape').hidden=pq;
  const sb=document.querySelector('.head .sub');if(sb){sb.dataset.orig=sb.dataset.orig||sb.textContent;sb.textContent=pq?'O que conta na nota do afiliado e quanto vale. Base: a safra e os filtros do topo.':sb.dataset.orig}
  document.body.classList.toggle('pg-pq',pq);
  document.getElementById('crumb').textContent=st.pg==='af'?'Afiliado':PGS[st.pg][0];
  document.getElementById('titulo').textContent=st.pg==='af'?'Afiliado':PGS[st.pg][1];cancelaEspera();esconde();
  if(st.pg==='af'){if(st.R)renderAfiliado(st.R);scrollTo(0,0)}}
root.querySelectorAll('[data-pg]').forEach(b=>b.onclick=()=>pagina(b.dataset.pg));

const sel=document.getElementById('fMes');
sel.innerHTML='<option value="">Safra: escolher mês…</option>'+[...MESES].reverse().map(k=>`<option value="${k}">Safra ${mesTx(k)}${k===dIso(FIM).slice(0,7)?' (aberta)':fimMes(k)<=FIM-60?' (fechada)':''}</option>`).join('');
function marca(v){document.querySelectorAll('#fPer button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===v)))}
document.getElementById('fPer').onclick=e=>{const b=e.target.closest('button');if(!b)return;st.per=b.dataset.v;marca(st.per);sel.value='';render()};
sel.onchange=()=>{if(!sel.value)return;st.per='mes';st.mes=sel.value;marca('');render()};
document.getElementById('fMin').onchange=e=>{st.min=+e.target.value;render()};
document.getElementById('fPlat').onclick=e=>{const b=e.target.closest('button');if(!b)return;st.plat=b.dataset.v;
  document.querySelectorAll('#fPlat button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render()};
document.getElementById('stamp').textContent=new Date(DADOS.gerado).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
document.getElementById('fimTx').textContent=ABERTO?`hoje (${dTx(FIM)}) ${HORA_HOJE}`:dTx(FIM)+'/'+dIso(FIM).slice(0,4);
pagina('ranking');
render();

function reagrupa(modo){if(modo===AGRUPA)return;AGRUPA=modo;try{LS.setItem('ns-af-agrupar',modo)}catch(e){}
  const g=agrupar(modo);AFS.splice(0,AFS.length,...g.afs);DADOS.rows=g.rows;MAPA_CONTA=g.mapa;
  OWN.clear();DADOS.rows.forEach(r=>{if(r[1]>M60)return;let o=OWN.get(r[0]);if(!o)OWN.set(r[0],o={d10:0,d60:0,b:0});o.d10+=D10(r);o.d60+=D60(r);o.b+=r[C.funil]});
  HIST.clear();DADOS.rows.forEach(r=>{if(r[1]>M60)return;let o=HIST.get(r[0]);if(!o)HIST.set(r[0],o={s:DCH.map(()=>0),b:0});DCH.forEach((d,k)=>o.s[k]+=RTH(r,d));o.b+=r[C.funil]});
  CURVA_AF.clear();
  const F=[...HIST.values()].filter(o=>o.b>=10000&&o.s[DCH.length-1]>0).map(formaAf);
  if(F.length>=5){const md=v=>{const s=[...v].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};let m=0;
    CURVA_MED.splice(0,CURVA_MED.length,...[[0,0]].concat(DCH.map((d,k)=>[d,m=Math.max(m,md(F.map(f=>f[k])))])))}
  st.sim=null;if(st.pg==='af')irPara('ranking');render()}

/* previsão do reembolso 60d (decisão do Douglas, 04/11): o que já caiu + a parte que ainda falta × a previsão de 10 dias.
   A parte que falta de cada venda = 1 − FRAC(idade); FRAC(d) = (d/60)^k, com k ajustado à curva mediana (≈ 0,53).
   Backtest (49 safras afiliado × semana já fechadas): erro médio 1,3 pp olhando até o D30, contra 2,4 pp do 10d × fator puro. */
function kEq(){const s=CURVA_MED.map(p=>p[1].toFixed(2)).join();if(kEq.s!==s){kEq.s=s;let b=0.53,be=1e18;
  for(let k=0.2;k<=1.2;k+=0.005){let e=0;for(const [d,v] of CURVA_MED)if(d>0)e+=((d/60)**k*100-v)**2;if(e<be){be=e;b=k}}kEq.k=b}return kEq.k}
function FRAC(d){return d<=0?0:d>=60?1:(d/60)**kEq()}
function curvaJanela(p1){const fim=dIso(Math.max(0,Math.min(p1,FIM))).slice(0,7),[y,m]=fim.split('-').map(Number),ini=new Date(Date.UTC(y,m-3,1)).toISOString().slice(0,7);
  const j0=Math.max(0,dIdx(ini+'-01')),j1=Math.min(FIM,fimMes(fim)),k=j0+'|'+j1+'|'+st.plat+'|'+AGRUPA,c=curvaJanela.c||(curvaJanela.c=new Map());if(c.has(k))return c.get(k);
  const fu=new Map();for(const r of DADOS.rows){if(r[1]<j0||r[1]>j1)continue;if(st.plat&&r[RPL]!==st.plat)continue;fu.set(r[0],(fu.get(r[0])||0)+r[C.funil])}
  const T=[...fu.values()].reduce((s,v)=>s+Math.max(0,v),0);let acc=0;const cv=new Map();
  [...fu].sort((a,b)=>b[1]-a[1]).forEach(([i,v])=>{cv.set(i,!T||v<=0?'C':acc<0.8*T?'A':acc<0.95*T?'B':'C');acc+=Math.max(0,v)});
  const o={cv,j0,j1,ini:ini<MESES[0]?MESES[0]:ini,fim};c.set(k,o);return o}

const DT={MAX:140,MAX_TXT:260,MIN:56,LIM:3000,XLS:'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'};
const ICO={xls:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 13h8M8 17h8M12 11v8"/></svg>',
  max:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  min:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  load:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>'};
function dtCriar(host,cfg){
  const dt={host,cfg,sort:null,w:null,arrastou:false};host._dt=dt;host.classList.add('dt-card');
  const cg='<colgroup>'+cfg.cols.map(()=>'<col>').join('')+'</colgroup>';
  host.innerHTML=`<div class="dt-scroll"><table class="dt-t">${cg}<thead><tr>${cfg.cols.map((c,i)=>`<th data-i="${i}" class="${c.num?'':'tl'}"${c.info?` title="${esc(c.info)}"`:''}><button type="button" class="th-sort"><span class="th-l">${esc(c.l)}</span>${c.info?'<i class="dt-info" aria-hidden="true">i</i>':''}<span class="sort-arrow">⇅</span></button><span class="col-resizer" aria-hidden="true"></span></th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="dt-total-wrap"><table class="dt-t">${cg}<tbody></tbody></table></div><div class="dt-hscroll"><div></div></div>`;
  const sc=host.querySelector('.dt-scroll'),tw=host.querySelector('.dt-total-wrap'),hs=host.querySelector('.dt-hscroll');
  hs.onscroll=()=>{sc.scrollLeft=hs.scrollLeft;tw.scrollLeft=hs.scrollLeft};
  sc.addEventListener('wheel',e=>{const dx=e.shiftKey?e.deltaY:e.deltaX;if(Math.abs(dx)>Math.abs(e.shiftKey?0:e.deltaY)){hs.scrollLeft+=dx;e.preventDefault()}},{passive:false});
  host.querySelectorAll('thead th').forEach(th=>{const i=+th.dataset.i;
    th.querySelector('.th-sort').onclick=()=>{dt.sortUser=true;dt.sort=dt.sort&&dt.sort.i===i?{i,dir:dt.sort.dir==='asc'?'desc':'asc'}:{i,dir:'desc'};dtCorpo(dt)};
    th.querySelector('.col-resizer').onmousedown=e=>dtArrastar(dt,i,e)});
  dtLinhas(dt,cfg.rows,cfg.total);return dt}
function dtLinhas(dt,rows,total){dt.cfg.rows=rows;dt.cfg.total=total;if(!dt.sortUser)dt.sort=dtSortPadrao(dt);dtCorpo(dt);dtTotal(dt);if(!dt.w)dtMedir(dt)}
/* ordem sem clique: do maior para o menor. 1ª coluna com data = mais recente primeiro; senão o 1º valor em US$; senão o
   1º número. cfg.ordem = índice da coluna; ordem:false = ordem da fonte (demonstrativos, DRE: a ordem das linhas é a conta) */
function dtSortPadrao(dt){const {cols,rows,ordem}=dt.cfg;if(ordem===false)return null;if(ordem!=null)return {i:ordem,dir:'desc'};
  const r0=(rows||[]).find(r=>r!=null);let v0=null;try{v0=r0?cols[0].v(r0):null}catch(e){}
  if(typeof v0==='string'&&/^\d{4}-\d{2}(-\d{2})?(T|$)/.test(v0))return {i:0,dir:'desc'};
  let i=cols.findIndex(c=>c.fmt==='moeda');if(i<0)i=cols.findIndex(c=>c.num);return i<0?null:{i,dir:'desc'}}
function dtOrdenadas(dt){const {rows,cols}=dt.cfg;if(!dt.sort)return rows;const c=cols[dt.sort.i],s=dt.sort.dir==='asc'?1:-1;
  return [...rows].sort((a,b)=>{const x=c.v(a),y=c.v(b),vx=x==null||x==='',vy=y==null||y==='';if(vx&&vy)return 0;if(vx)return 1;if(vy)return -1;  // vazio sempre no fim
    return s*(typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'pt-BR',{numeric:true}))})}
function dtTexto(c,r){if(c.t)return c.t(r);const v=c.v(r);if(v==null||v==='')return '—';
  if(c.fmt==='moeda')return usd(v);if(c.fmt==='inteiro')return n(v);if(typeof v==='number')return v.toLocaleString('pt-BR',{maximumFractionDigits:2});
  if(/^\d{4}-\d{2}-\d{2}$/.test(v))return fmtBR(v);return String(v)}
function dtCorpo(dt){const {cols}=dt.cfg,rs=dtOrdenadas(dt),lim=rs.slice(0,DT.LIM);dt.ordenadas=rs;
  dt.host.querySelectorAll('thead th').forEach((th,i)=>{const a=!!dt.sort&&dt.sort.i===i,ar=th.querySelector('.sort-arrow');th.querySelector('.th-sort').classList.toggle('active',a);ar.classList.toggle('active',a);ar.textContent=a?(dt.sort.dir==='asc'?'▲':'▼'):'⇅'});
  dt.host.querySelector('.dt-scroll tbody').innerHTML=lim.length?lim.map(r=>`<tr>${cols.map(c=>{const x=dtTexto(c,r);return `<td class="${c.num?'':'tl'}${c.cls?' '+c.cls(r):''}" title="${esc(x)}">${c.h?c.h(r):esc(x)}</td>`}).join('')}</tr>`).join('')
    +(rs.length>lim.length?`<tr class="dt-more"><td colspan="${cols.length}">Mostrando ${n(lim.length)} de ${n(rs.length)} linhas. O Excel traz todas.</td></tr>`:'')
    :`<tr><td colspan="${cols.length}" class="dt-empty">${esc(dt.cfg.vazio||'Sem dados.')}</td></tr>`}
function dtTotal(dt){const {cols,total,totalLabel}=dt.cfg,w=dt.host.querySelector('.dt-total-wrap');w.classList.toggle('hidden',!total);if(!total)return;
  w.querySelector('tbody').innerHTML=`<tr class="dt-total-row">${cols.map((c,i)=>{let v=null;if(i)try{v=c.v(total)}catch(e){}const x=i===0?(totalLabel||'Total'):v==null||v===''?'':dtTexto(c,total);return `<td class="${c.num?'':'tl'}" title="${esc(x)}">${esc(x)}</td>`}).join('')}</tr>`}
function dtMedir(dt,tent=0){const h=dt.host;if(!h.offsetWidth){if(tent<30&&h.isConnected)requestAnimationFrame(()=>dtMedir(dt,tent+1));return}
  // 1º render em layout automático: mede, limita (140 / 260 px) e só então fixa as larguras
  h.querySelectorAll('table.dt-t').forEach(t=>{t.style.tableLayout='auto';t.style.width='auto';t.querySelectorAll('col').forEach(c=>c.style.width='')});
  const tot=[...h.querySelectorAll('.dt-total-wrap:not(.hidden) td')].map((td,i)=>i?td.getBoundingClientRect().width:0);  // o total nunca corta
  const w=[...h.querySelectorAll('.dt-scroll thead th')].map((th,i)=>{const c=dt.cfg.cols[i];return Math.max(Math.min(th.getBoundingClientRect().width,c.max||(c.texto?DT.MAX_TXT:DT.MAX)),tot[i]||0)});
  const disp=h.querySelector('.dt-scroll').clientWidth-10,soma=w.reduce((a,b)=>a+b,0);
  dt.w=soma<disp?w.map(x=>x*disp/soma):w;dtAplicar(dt)}   // sobra espaço: distribui na proporção, sem rolagem
function dtAplicar(dt){const soma=dt.w.reduce((a,b)=>a+b,0);
  dt.host.querySelectorAll('table.dt-t').forEach(t=>{t.style.tableLayout='fixed';t.style.width=soma+'px';t.querySelectorAll('col').forEach((c,i)=>c.style.width=dt.w[i]+'px')});
  dt.host.querySelector('.dt-hscroll>div').style.width=soma+'px'}
function dtArrastar(dt,i,e){e.preventDefault();e.stopPropagation();if(!dt.w)dtMedir(dt);dt.arrastou=true;   // congela todas as larguras; a tabela cresce junto
  const x0=e.clientX,w0=dt.w[i];document.body.classList.add('dt-resizing');
  const mv=ev=>{dt.w[i]=Math.max(DT.MIN,w0+ev.clientX-x0);dtAplicar(dt)},up=()=>{removeEventListener('mousemove',mv);removeEventListener('mouseup',up);document.body.classList.remove('dt-resizing')};
  addEventListener('mousemove',mv);addEventListener('mouseup',up)}
let dtLib=null;
function dtCarregarExcel(){return dtLib||(dtLib=new Promise((ok,err)=>{if(window.ExcelJS)return ok(window.ExcelJS);const s=document.createElement('script');s.src=DT.XLS;
  s.onload=()=>ok(window.ExcelJS);s.onerror=()=>{dtLib=null;s.remove();err(new Error('sem internet para carregar o gerador de Excel'))};document.head.appendChild(s)}))}
async function dtExcel(dt,btn){
  const ex=dt.cfg.exportar||{},cols=dt.cfg.cols,rows=dt.ordenadas||dt.cfg.rows,titulo=ex.titulo||'Tabela',L=6;
  const val=(c,r)=>{let v=c.x?c.x(r):c.v(r);if(v==null||v===''||v==='—')return null;if(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v))v=v.slice(0,10).split('-').reverse().join('/');return v};
  const linhas=rows.map(r=>cols.map(c=>val(c,r))),hoje=new Date(),p2=x=>String(x).padStart(2,'0'),iso=`${hoje.getFullYear()}-${p2(hoje.getMonth()+1)}-${p2(hoje.getDate())}`;
  const arquivo=(ex.arquivo||titulo).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  btn.disabled=true;btn.classList.add('girando');btn.innerHTML=ICO.load;
  try{
    const ExcelJS=await dtCarregarExcel(),wb=new ExcelJS.Workbook();wb.created=hoje;
    const fmts=cols.map((c,i)=>{if(c.fmt)return c.fmt;let num=false,int=true;for(const l of linhas){const v=l[i];if(v==null)continue;if(typeof v!=='number')return 'texto';num=true;if(!Number.isInteger(v))int=false}return num?(int?'inteiro':'decimal'):'texto'});
    const numFmt=f=>({inteiro:'#,##0;[Red]-#,##0',decimal:'#,##0.00;[Red]-#,##0.00',moeda:'"US$" #,##0.00;[Red]-"US$" #,##0.00',pct:'0.0%;[Red]-0.0%'})[f];
    const ws=wb.addWorksheet(titulo.replace(/[\\/?*[\]:]/g,' ').slice(0,31)||'Planilha',{views:[{state:'frozen',xSplit:0,ySplit:L,topLeftCell:'A'+(L+1),showGridLines:false}]});
    const nF=Math.max(cols.length,8);
    for(let i=0;i<nF;i++){const col=ws.getColumn(i+1);if(i>=cols.length){col.width=12;continue}
      let m=cols[i].l.length+4,soma=0;const casas=fmts[i]==='inteiro'?0:2,tx=v=>(fmts[i]==='moeda'?'US$ ':'')+v.toLocaleString('pt-BR',{minimumFractionDigits:casas,maximumFractionDigits:casas});
      for(const l of linhas.slice(0,2000)){const v=l[i];if(v==null)continue;if(typeof v==='number')soma+=Math.abs(v);m=Math.max(m,(typeof v==='number'?tx(v):String(v)).length+3)}
      if(cols[i].soma)m=Math.max(m,tx(-soma).length+3);col.width=Math.max(8,Math.min(m,60));const f=numFmt(fmts[i]);if(f)col.numFmt=f}
    ws.getRow(1).height=26;ws.getRow(2).height=18;ws.getRow(3).height=6;ws.getRow(5).height=6;
    for(const r of [1,2])for(let c=1;c<=nF;c++)ws.getCell(r,c).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF202331'}};
    const t1=ws.getCell(1,1);t1.value=titulo;t1.font={bold:true,size:15,color:{argb:'FFFFFFFF'}};t1.alignment={vertical:'middle',indent:1};
    const t2=ws.getCell(2,1);t2.value=`NorthScale · gerado em ${p2(hoje.getDate())}/${p2(hoje.getMonth()+1)}/${hoje.getFullYear()} ${p2(hoje.getHours())}:${p2(hoje.getMinutes())} · ${n(linhas.length)} linha${linhas.length===1?'':'s'} · valores em US$`;
    t2.font={size:9,color:{argb:'FFB9C2E8'}};t2.alignment={indent:1};
    const filtros=(ex.filtros||[]).map(([a,b])=>`${a}: ${b}`).join('   ·   ')||'nenhum';
    ws.mergeCells(4,1,4,nF);const f4=ws.getCell(4,1);
    f4.value={richText:[{text:'Filtros aplicados: ',font:{bold:true,size:10,color:{argb:'FF3148C8'}}},{text:filtros+(ex.nota?'\n'+ex.nota:''),font:{size:10,color:{argb:'FF4B4F60'}}}]};
    f4.alignment={wrapText:true,vertical:'top'};const lt=Array.from({length:nF},(_,i)=>ws.getColumn(i+1).width||12).reduce((a,b)=>a+b,0);
    ws.getRow(4).height=Math.max(16,`Filtros aplicados: ${filtros}${ex.nota?'\n'+ex.nota:''}`.split('\n').reduce((s,l)=>s+Math.max(1,Math.ceil(l.length*1.1/lt)),0)*14);
    const vistos=new Map(),nomes=cols.map(c=>{const b=c.l.trim()||'Coluna',k=(vistos.get(b)||0)+1;vistos.set(b,k);return k===1?b:`${b} (${k})`});
    const temTotal=!!dt.cfg.total;
    ws.addTable({name:'Dados',ref:'A'+L,headerRow:true,totalsRow:temTotal,style:{theme:'TableStyleLight1',showRowStripes:true},
      columns:cols.map((c,i)=>({name:nomes[i],filterButton:true,...(!temTotal?{}:i===0?{totalsRowLabel:'Total'}:c.soma?{totalsRowFunction:'sum'}:{totalsRowFunction:'none'})})),
      rows:linhas.length?linhas:[cols.map((_,i)=>i?null:'Sem dados para os filtros aplicados')]});
    const cab=ws.getRow(L);cab.height=30;
    cols.forEach((c,i)=>{const cel=cab.getCell(i+1);cel.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF3148C8'}};cel.font={bold:true,size:10,color:{argb:'FFFFFFFF'}};
      cel.alignment={vertical:'middle',horizontal:fmts[i]==='texto'?'left':'right',wrapText:true}});
    if(temTotal){const r=ws.getRow(L+Math.max(linhas.length,1)+1);cols.forEach((_,i)=>{const cel=r.getCell(i+1);cel.font={bold:true,size:10};cel.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEEF1FD'}};cel.border={top:{style:'medium',color:{argb:'FF3148C8'}}}})}
    const buf=await wb.xlsx.writeBuffer(),a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));a.download=`${arquivo}-${iso}.xlsx`;a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast(`Planilha baixada: ${arquivo}-${iso}.xlsx`);
  }catch(e){ // sem internet para o ExcelJS: não perde a exportação, sai em CSV
    download(`${arquivo}-${iso}.csv`,[cols.map(c=>c.l),...linhas]);toast(`Não consegui gerar o Excel (${e.message}). Baixei em CSV.`);
  }finally{btn.disabled=false;btn.classList.remove('girando');btn.innerHTML=ICO.xls}
}

/* ---------- pedidos do afiliado (página do afiliado, embaixo) ----------
   Vêm de GET /api/metrics/affiliate-ranking/orders (dados_oficiais.afiliados_pedidos + produto, status e CPA do
   "Order"). A venda pertence ao afiliado do FE de origem; a safra é o dia do FE. Positivos = o que sai. Custo do
   produto: real da Full Stack na linha do FE quando o pedido foi achado no armazém; senão estimado (média real ×
   valor da venda), como na nota. */
const pdSt={busca:'',tipo:'todos'};
const pedCache=new Map();
const ST_TX={COMPLETED:'Aprovada',APPROVED:'Aprovada',REFUNDED:'Reembolsada',PARTIAL_REFUND:'Reembolso parcial',CHARGEBACK:'Chargeback',
  CHARGEBACK_LOST:'Chargeback perdido',CHARGEBACK_WON:'Chargeback ganho',CANCELED:'Cancelada',CANCELLED:'Cancelada',PENDING:'Pendente',
  'PENDING REVIEW':'Em análise',INSUFFICIENT_FUNDS:'Sem saldo'};
const stTx=s=>s==null?'—':ST_TX[String(s).toUpperCase()]||String(s).charAt(0).toUpperCase()+String(s).slice(1).toLowerCase().replace(/_/g,' ');
const usd2=v=>v==null||!isFinite(v)?'—':(v<-0.004?'-':'')+'US$ '+Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtBR=s=>s?String(s).slice(0,10).split('-').reverse().join('/'):'—';
const fmtEm=s=>s?fmtBR(s.slice(0,10))+' '+s.slice(11,16):'—';
function toast(m){let t=document.getElementById('pdToast');if(!t){t=document.body.appendChild(Object.assign(document.createElement('div'),{id:'pdToast'}));
  Object.assign(t.style,{position:'fixed',bottom:'20px',left:'50%',transform:'translateX(-50%)',zIndex:90,background:'var(--bg-elev)',color:'var(--fg1)',border:'1px solid var(--border)',borderRadius:'8px',padding:'10px 14px',font:'500 12px var(--f-body)',boxShadow:'var(--shadow-lg)'})}
  t.textContent=m;t.hidden=false;clearTimeout(t._t);t._t=setTimeout(()=>t.hidden=true,4000)}
function download(nome,linhas){const csv=linhas.map(l=>l.map(v=>v==null?'':/[;"\n]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v)).join(';')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));a.download=nome;a.click()}

// contas do afiliado (parceiro = todas as contas dele) e o pedido ao servidor (uma vez por afiliado × safra)
function contasDe(a){const cs=[];MAPA_CONTA.forEach((g,c)=>{if(g===a.i)cs.push(DADOS_CONTA.afs[c][0])});return cs}
function carregaPedidos(a,p0,p1){const contas=contasDe(a),k=contas.join(',')+'|'+p0+'|'+p1;
  if(!pedCache.has(k))pedCache.set(k,opts.buscarPedidos({contas,de:dIso(p0),ate:dIso(p1)}).catch(e=>{pedCache.delete(k);throw e}));
  return pedCache.get(k)}
function pedidosLinhas(lista){
  return lista.filter(p=>!st.plat||p.plataforma===st.plat).map(p=>{
    const bruto=+p.bruto||0,cpa=+p.cpa||0,re=+p.reembolso||0,al=+p.taxa_alerta||0,dtx=+p.taxa_disputa||0,liq=+p.liquido||0;
    const real=p.e_fe&&p.custo_fs!=null,custo=real?+p.custo_fs:p.armazem_achado?0:PCT_FS*bruto,call=+p.call_liquido||0;
    return {em:p.em,id:p.venda_id,pl:p.plataforma,et:p.etapa,pr:p.produto||'—',stt:stTx(p.status),bruto,cpa,re,red:p.reembolso_dia,al,dtx,
      cb:!!p.disputa,tx:bruto-cpa-re-al-dtx-liq,liq,custo,custoReal:real||!!p.armazem_achado,call,res:liq-custo+call}})}

const PD_COLS=[
  {l:'Data',v:r=>r.em,t:r=>fmtEm(r.em),texto:true,info:'Data e hora da venda. JVZoo no horário de Nova York; Vupim no de Brasília.'},
  {l:'Pedido',v:r=>r.id,texto:true,max:150},
  {l:'Plataforma',v:r=>r.pl,texto:true},
  {l:'Etapa',v:r=>r.et,h:r=>`<span class="pd-et ${r.et==='FE'?'FE':''}">${esc(r.et)}</span>`,texto:true},
  {l:'Produto',v:r=>r.pr,texto:true,max:210},
  {l:'Status',v:r=>r.stt,texto:true},
  {l:'Valor',v:r=>r.bruto,fmt:'moeda',num:true,soma:true,t:r=>usd2(r.bruto)},
  {l:'CPA',v:r=>r.cpa,fmt:'moeda',num:true,soma:true,t:r=>usd2(r.cpa),info:'CPA pago ao afiliado nesta venda.'},
  {l:'Reembolso',v:r=>r.re,fmt:'moeda',num:true,soma:true,t:r=>r.re?usd2(r.re):'—',cls:r=>r.re?'neg':'mut',info:'Valor devolvido ao cliente (regra do extrato JVZoo; na Vupim inclui o chargeback perdido).'},
  {l:'Dia do reembolso',v:r=>r.red,t:r=>r.red?fmtBR(r.red):'—',texto:true},
  {l:'Alerta',v:r=>r.al,fmt:'moeda',num:true,soma:true,t:r=>r.al?usd2(r.al):'—',cls:r=>r.al?'neg':'mut',info:'Taxa de alerta (US$ 23) cobrada pela JVZoo.'},
  {l:'Chargeback',v:r=>r.dtx,fmt:'moeda',num:true,soma:true,h:r=>r.cb||r.dtx?`${r.dtx?usd2(r.dtx):''} ${r.cb?'<span class="pd-tag">disputa</span>':''}`:'—',t:r=>r.dtx?usd2(r.dtx):r.cb?'disputa':'—',cls:r=>r.dtx||r.cb?'neg':'mut',info:'Taxa de disputa/chargeback (US$ 49 na JVZoo). A etiqueta marca a venda que teve disputa.'},
  {l:'Taxas plataforma',v:r=>r.tx,fmt:'moeda',num:true,soma:true,t:r=>usd2(r.tx),info:'Taxas da plataforma e impostos: valor − CPA − reembolso − alerta − chargeback − líquido.'},
  {l:'Líquido plataforma',v:r=>r.liq,fmt:'moeda',num:true,soma:true,t:r=>usd2(r.liq),cls:r=>r.liq<0?'neg':'',info:'O que a plataforma nos paga por esta venda (já sem CPA, reembolso e taxas).'},
  {l:'Custo produto',v:r=>r.custo,fmt:'moeda',num:true,soma:true,h:r=>r.custo?usd2(r.custo)+(r.custoReal?'':'<span class="pd-est">est.</span>'):'—',t:r=>usd2(r.custo),info:'Full Stack real (produto + separação + frete da fatura), lançado na linha do FE quando o pedido foi achado no armazém. Sem pedido no armazém: estimado pela média real da receita (est.).'},
  {l:'Call center',v:r=>r.call,fmt:'moeda',num:true,soma:true,t:r=>r.call?usd2(r.call):'—',cls:r=>r.call?'pos':'mut',info:'Líquido das vendas de call center do cliente, lançado no FE mais recente dele.'},
  {l:'Resultado',v:r=>r.res,fmt:'moeda',num:true,soma:true,t:r=>usd2(r.res),cls:r=>r.res<0?'neg':'pos',info:'Líquido plataforma − custo do produto + call center.'},
];
const PD_SOMA=['bruto','cpa','re','al','dtx','tx','liq','custo','call','res'];

function pedidosMontar(R){
  const el=document.getElementById('afiliado');if(!el||st.pg!=='af')return;
  let sec=document.getElementById('pdSec');if(!sec){sec=el.appendChild(Object.assign(document.createElement('section'),{id:'pdSec',className:'pd-sec'}))}
  const a=R.L.find(x=>afId(x)===st.afId);if(!a){sec.remove();return}
  const cab=(sub,cnt='')=>`<div class="pd-head"><div><h3>Pedidos ${cnt}</h3><p>${sub}</p></div><div class="pd-tools" id="pdTools"></div></div>`;
  const alvo=afId(a)+'|'+R.p0+'|'+R.p1+'|'+st.plat;sec.dataset.alvo=alvo;
  let pronto=false;
  carregaPedidos(a,R.p0,R.p1).then(lista=>{pronto=true;if(sec.dataset.alvo===alvo&&sec.isConnected)pedidosPinta(sec,R,a,pedidosLinhas(lista))})
    .catch(e=>{pronto=true;if(sec.dataset.alvo===alvo)sec.innerHTML=cab('Não consegui carregar os pedidos: '+esc(e.message||String(e)))});
  if(!pronto&&!sec.querySelector('#pdTab'))sec.innerHTML=cab('Carregando os pedidos…');
}
function pedidosPinta(sec,R,a,todos){
  const q=pdSt.busca.trim().toLowerCase(),rows=todos.filter(r=>(pdSt.tipo==='todos'||(pdSt.tipo==='re'&&(r.re||r.al))||(pdSt.tipo==='cb'&&(r.cb||r.dtx))||(pdSt.tipo==='fe'&&r.et==='FE'))
    &&(!q||String(r.id).toLowerCase().includes(q)||String(r.pr).toLowerCase().includes(q)));
  const T={};PD_SOMA.forEach(k=>T[k]=rows.reduce((s,r)=>s+(r[k]||0),0));
  const fes=rows.filter(r=>r.et==='FE').length,reemb=rows.filter(r=>r.re||r.al||r.dtx).length,cbs=rows.filter(r=>r.cb).length;
  const plTx=st.plat?` · só ${st.plat}`:'',contas=(a.contas||1)>1?` · ${a.contas} contas`:'';
  const cheia=sec.classList.contains('cheia');
  sec.innerHTML=`<div class="pd-head"><div><h3>Pedidos <span class="pd-cnt">${n(rows.length)}</span></h3><p>Safra ${dTx(R.p0)} a ${dTx(R.p1)}: todas as vendas cujo FE de origem caiu na safra (upsell, downsell e bump herdam o FE)${plTx}${contas}. Valores em US$; positivos = o que sai.</p></div><div class="pd-tools" id="pdTools"></div></div>`+
    `<div class="pd-kpis">
      <div class="pd-kpi"><div class="l">Valor vendido</div><div class="v">${usd(T.bruto)}</div><div class="s">${n(fes)} FEs · ${n(rows.length)} pedidos</div></div>
      <div class="pd-kpi"><div class="l">CPA pago</div><div class="v">${usd(T.cpa)}</div><div class="s">${fes?usd(T.cpa/fes)+' por FE':'—'}</div></div>
      <div class="pd-kpi"><div class="l">Reembolso + taxas</div><div class="v">${usd(T.re+T.al+T.dtx)}</div><div class="s">${T.bruto?pct((T.re+T.al+T.dtx)/T.bruto):'—'} do valor · ${n(reemb)} pedidos</div></div>
      <div class="pd-kpi"><div class="l">Chargebacks</div><div class="v">${n(cbs)}</div><div class="s">${usd(T.dtx)} em taxas</div></div>
      <div class="pd-kpi"><div class="l">Custo produto</div><div class="v">${usd(T.custo)}</div><div class="s">${T.bruto?pct(T.custo/T.bruto):'—'} do valor</div></div>
      <div class="pd-kpi"><div class="l">Resultado</div><div class="v" style="color:${T.res<0?'var(--danger)':'var(--success)'}">${usd(T.res)}</div><div class="s">${fes?usd(T.res/fes)+' por FE':'—'} · já caído</div></div>
    </div><div id="pdTab"></div>`;
  const tools=sec.querySelector('#pdTools');
  tools.innerHTML=`<input class="pd-busca" id="pdBusca" type="search" placeholder="Buscar pedido ou produto" value="${esc(pdSt.busca)}" aria-label="Buscar pedido ou produto">
    <div class="fgrp" id="pdTipo" style="height:32px">${[['todos','Todos'],['fe','Só FE'],['re','Com reembolso'],['cb','Com chargeback']].map(([v,l])=>`<button type="button" data-v="${v}" aria-pressed="${pdSt.tipo===v}">${l}</button>`).join('')}</div>
    <button type="button" class="dt-btn-excel" id="pdXls" title="Exportar para Excel" aria-label="Exportar para Excel">${ICO.xls}</button>
    <button type="button" class="dt-btn" id="pdFull" title="${cheia?'Sair da tela cheia (Esc)':'Ver em tela cheia'}">${cheia?ICO.min:ICO.max}<span>${cheia?'Sair':'Tela cheia'}</span></button>`;
  const repinta=()=>pedidosPinta(sec,R,a,todos);
  const b=tools.querySelector('#pdBusca');b.oninput=()=>{pdSt.busca=b.value;clearTimeout(b._t);b._t=setTimeout(()=>{repinta();const nb=document.getElementById('pdBusca');nb.focus();nb.setSelectionRange(nb.value.length,nb.value.length)},250)};
  tools.querySelector('#pdTipo').onclick=e=>{const x=e.target.closest('button');if(!x)return;pdSt.tipo=x.dataset.v;repinta()};
  tools.querySelector('#pdFull').onclick=()=>{const on=!sec.classList.contains('cheia');sec.classList.toggle('cheia',on);document.body.classList.toggle('pd-cheia',on);repinta()};
  const total={em:null,id:null,pl:null,et:null,pr:null,stt:null,red:null,...T};
  const dt=dtCriar(sec.querySelector('#pdTab'),{cols:PD_COLS,rows,total,ordem:0,totalLabel:`Total (${n(rows.length)})`,vazio:'Nenhum pedido com esses filtros.',
    exportar:{titulo:'Pedidos · '+nomeAf(a),arquivo:'pedidos-'+nomeAf(a),filtros:[['Safra',`${dTx(R.p0)} a ${dTx(R.p1)}`],['Plataforma',st.plat||'Todas'],['Tipo',pdSt.tipo],['Busca',pdSt.busca||'—']]}});
  tools.querySelector('#pdXls').onclick=e=>dtExcel(dt,e.currentTarget);
  sec._sair=()=>{sec.classList.remove('cheia');document.body.classList.remove('pd-cheia');repinta()};
}
_on(document,'keydown',e=>{if(e.key==='Escape'){const s=document.getElementById('pdSec');if(s&&s.classList.contains('cheia')&&s._sair)s._sair()}});
// a página do afiliado ganha a lista de pedidos embaixo (o render original continua o mesmo)
const _renderAfiliadoOrig=renderAfiliado;
renderAfiliado=function(R){_renderAfiliadoOrig(R);pedidosMontar(R)};


/* ---- todas as vendas de afiliados (Visão Geral e Reembolso Prev.): GET /api/metrics/affiliate-ranking/all-orders ---- */
let PED=null,PED_ERRO=null;
if(opts.buscarTodosPedidos)opts.buscarTodosPedidos().then(P=>{if(!root.isConnected)return;
  const ix=new Map(DADOS_CONTA.afs.map((a,i)=>[a[0],i])),c=P.col,n0=c.af.length,des=dIdx(P.d0),nova=new Int32Array(n0).fill(-1);
  let n=0;for(let i=0;i<n0;i++)if(ix.has(P.dic.conta[c.af[i]]))nova[i]=n++;
  const out={};for(const k in c)out[k]=[];
  for(let i=0;i<n0;i++){if(nova[i]<0)continue;for(const k in c){let v=c[k][i];
    if(k==='af')v=ix.get(P.dic.conta[v]);else if(k==='fe')v+=des;else if(k==='fid')v=v>=0?nova[v]:-1;out[k].push(v)}}
  PED={d0:P.d0,dic:P.dic,col:out,n};render()}).catch(e=>{PED_ERRO=e.message||String(e);render()});

/* ---------- tela Afiliados (lista com resultado, alertas e coorte) ----------
   Mesma conta do Ranking (calcular): mesma safra, filtros, agrupamento e página do afiliado. Acrescenta:
   big numbers da base, alertas automáticos, a tabela completa (com a lente CPA do dash do Mike: Status CPA) (a coorte de reembolso fica na aba Reembolso Prev.). CPA vem dos pedidos (prévia: pedidos embutidos). */
PGS.lista=['Visão Geral','Visão geral dos afiliados'];
const lsSt={filtro:null};
// régua do Status CPA do dash do Mike (ProfitConfig: saudável ≥ US$ 10, atenção ≥ US$ 0), aplicada ao lucro previsto por FE
const STATUS_CPA={ok:10,at:0};
const statusCpa=v=>v==null?null:v>=STATUS_CPA.ok?['Saudável','ok']:v>=STATUS_CPA.at?['Atenção','at']:['Renegociar','rn'];

// extras por linha do ranking: FEs por semana (8 semanas até o último dia), primeira e última venda, CPA da safra
function lsExtras(R){
  const X=new Map(),g=i=>{let o=X.get(i);if(!o)X.set(i,o={sem:Array(8).fill(0),pri:null,ult:null,f7:0,f28:0,cpa:null,tx:0});return o};
  for(const r of DADOS.rows){if(st.plat&&r[RPL]!==st.plat)continue;
    if(r[1]>=R.p0&&r[1]<=R.p1&&r[C.tx60])g(r[0]).tx+=r[C.tx60];   // taxas de alerta e disputa (chargeback) já cobradas
    const f=r[C.fes];if(!f)continue;const o=g(r[0]),d=r[1];
    if(o.pri==null||d<o.pri)o.pri=d;if(d<=FIM&&(o.ult==null||d>o.ult))o.ult=d;
    const k=Math.floor((FIM-d)/7);if(k>=0&&k<8)o.sem[7-k]+=f;
    if(d>FIM-7&&d<=FIM)o.f7+=f;else if(d>FIM-35&&d<=FIM-7)o.f28+=f}
  if(typeof PED!=='undefined'&&PED){const c=PED.col;for(let i=0;i<PED.n;i++){const fe=c.fe[i];if(fe<R.p0||fe>R.p1)continue;
    const conta=c.af[i],pl=DADOS_CONTA.afs[conta][2]||'JVZoo';if(st.plat&&pl!==st.plat)continue;const o=g(MAPA_CONTA[conta]);o.cpa=(o.cpa||0)+(c.cpa[i]||0)}}
  return X}

// tabelas largas (dtCriar): quando não cabem, as colunas de texto (menos a 1ª) encolhem até 96 px; o texto corta com "…" e
// aparece inteiro ao passar o mouse. Colunas de número nunca encolhem.
const _dtMedirOrig=dtMedir;
dtMedir=function(dt,tent=0){_dtMedirOrig(dt,tent);const h=dt.host,sc=h&&h.querySelector('.dt-scroll');if(!sc||!h.offsetWidth||!dt.w)return;
  const disp=sc.clientWidth-10,soma=dt.w.reduce((a,b)=>a+b,0);if(soma<=disp)return;
  const cols=dt.cfg.cols,MIN=96,enc=i=>i>0&&cols[i]&&cols[i].texto,folga=dt.w.reduce((s,x,i)=>s+(enc(i)?Math.max(0,x-MIN):0),0);if(folga<=0)return;
  const corte=Math.min(folga,soma-disp);dt.w=dt.w.map((x,i)=>enc(i)?x-Math.max(0,x-MIN)*corte/folga:x);dtAplicar(dt)};
// ordenação genérica de tabela simples: clique no cabeçalho (o valor vem de data-v; sem data-v, do texto). Vazio fica no fim.
function ordenaTabela(tb){if(!tb||!tb.tHead)return;const ths=[...tb.tHead.rows[0].cells];
  ths.forEach((th,j)=>{th.classList.add('ord');th.tabIndex=0;th.setAttribute('aria-sort','none');
    const go=()=>{const cur=th.getAttribute('aria-sort'),txt=th.dataset.tipo==='t',d=cur==='descending'?1:cur==='ascending'?-1:(txt?1:-1);
      ths.forEach(x=>x.setAttribute('aria-sort','none'));th.setAttribute('aria-sort',d>0?'ascending':'descending');
      const body=tb.tBodies[0],rows=[...body.rows].filter(r=>r.cells.length>1);
      const val=r=>{const c=r.cells[j];if(!c)return null;const v=c.dataset.v;return v===undefined?c.textContent.trim():v===''?null:(isNaN(+v)?v:+v)};
      rows.sort((a,b)=>{const x=val(a),y=val(b);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;
        return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'pt-BR'))*d}).forEach(r=>body.appendChild(r))};
    th.onclick=go;th.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}}})}
const spark=v=>{const W=84,H=22,m=Math.max(1,...v),p=v.map((x,i)=>[i*(W-4)/(v.length-1)+2,H-3-(x/m)*(H-6)]);
  const ln=p.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join(''),z=p[p.length-1];
  return `<svg class="ls-sp" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${ln}L${W-2} ${H-2}L2 ${H-2}Z" class="a"/><path d="${ln}" class="l"/><circle cx="${z[0].toFixed(1)}" cy="${z[1].toFixed(1)}" r="2.2" class="p"/></svg>`};
const diasTx=d=>d==null?'—':d<=0?'hoje':d===1?'ontem':`há ${d} d`;
const pctTx=(v,c=1)=>v==null?'—':pct(v,c);

// CPA L0 (lucro zero, de equilíbrio) = o CPA que deixa o lucro previsto em zero: CPA pago + lucro previsto (sem call center, como a nota).
// A tabela da Visão Geral mostra os valores em 3 modos: % da receita do funil, por cliente (FE) ou valor total da safra.
const LS_MODOS=[['pct','Percentual'],['cli','Por cliente'],['tot','Valor total']];
let lsModo='pct';try{const v=LS.getItem('ns-af-lsmodo');if(LS_MODOS.some(m=>m[0]===v))lsModo=v}catch(e){}
const CPA_IDEAL_INFO='CPA L0 (lucro zero): o maior CPA que ainda deixa lucro zero no funil inteiro (FE + upsells + downsells), já com o custo do produto e o reembolso previsto de 60 dias. = CPA pago + lucro previsto (sem call center, como a nota). Acima dele, cada cliente dá prejuízo. Passe o mouse no CPA para ver a diferença.';
// valor de um montante (US$ da safra) no modo da vez
const lsVal=(amt,r,m=lsModo)=>amt==null||!isFinite(amt)?null:m==='pct'?(r.funil?amt/r.funil:null):m==='cli'?(r.fes?amt/r.fes:null):amt;
const lsFmt=(v,m=lsModo)=>v==null?'—':m==='pct'?pct(v,1):usd(v);
// dica do CPA × L0 (no modo da vez)
function lsDifTip(r,m=lsModo){const c=lsVal(r.cpa,r,m),i=lsVal(r.ideal,r,m);if(c==null||i==null)return '';
  const d=c-i,acima=d>0,dTx=m==='pct'?num(Math.abs(d)*100,1)+' pp':usd(Math.abs(d)),un=m==='pct'?' da receita':m==='cli'?' por cliente':' na safra';
  const rel=i>0?` (${acima?'+':'−'}${num(Math.abs(c/i-1)*100,0)}%)`:'';
  const msg=i<=0?`<span class="neg">Mesmo com CPA zero o funil fica no prejuízo: o problema é o reembolso ou o custo.</span>`
    :`<b class="${acima?'neg':'pos'}">${dTx} ${acima?'acima':'abaixo'} do L0${rel}</b><br>${acima?'Cada cliente dá prejuízo: renegociar o CPA.':'Sobra margem: o CPA está saudável.'}`;
  return `<div class="t1"><b>CPA × L0</b><span>${m==='pct'?'% da receita':m==='cli'?'por cliente':'total da safra'}</span></div>
    <div class="ls-dif"><div>CPA pago <b>${lsFmt(c,m)}</b>${un}</div><div>CPA L0 (lucro zero) <b>${lsFmt(i,m)}</b></div><div>${msg}</div></div>
    <div class="nt">L0 = CPA pago + lucro previsto do funil (FE + upsells), sem call center.${m!=='cli'&&r.fes?` Por cliente: ${usd(r.cpa/r.fes)} × ${usd(r.ideal/r.fes)}.`:''}</div>`}
// as células com dica própria (data-tip) não ganham o title nativo do dtCriar (senão aparecem as duas dicas)
const _dtCorpoOrig=dtCorpo;
dtCorpo=function(dt){_dtCorpoOrig(dt);dt.host.querySelectorAll('td [data-tip]').forEach(s=>{const td=s.closest('td');if(td)td.removeAttribute('title')})};

function renderLista(R){
  const el=document.getElementById('lista');if(!el||st.pg!=='lista')return;
  const {L,t,p0,p1,dias,fechada}=R,A=calcAnt(R),X=lsExtras(R);
  // hoje aberto: a última semana (e as últimas 4) ainda não terminou; a comparação usa só a parte que já passou
  const k7=ABERTO?(6+FRAC_HOJE)/7:1,k28=ABERTO?(27+FRAC_HOJE)/28:1;
  const ativos=L.filter(a=>a.fes>0),idsAgora=new Set(ativos.map(a=>a.i));
  const novos=ativos.filter(a=>{const x=X.get(a.i);return x&&x.pri>=p0}),parados=A?A.L.filter(a=>a.fes>=10&&!idsAgora.has(a.i)):[];
  const cpaTot=ativos.reduce((s,a)=>s+((X.get(a.i)||{}).cpa||0),0),temCpa=typeof PED!=='undefined'&&!!PED;
  const top5=[...ativos].sort((x,y)=>y.funil-x.funil).slice(0,5).reduce((s,a)=>s+Math.max(0,a.funil),0),conc=t.funil?top5/t.funil:null;
  const concA=A&&A.t.funil?[...A.L].sort((x,y)=>y.funil-x.funil).slice(0,5).reduce((s,a)=>s+Math.max(0,a.funil),0)/A.t.funil:null;
  const sx=fechada?'real':'prev.';
  const vr=(v,va,modo,melhor)=>{if(v==null||va==null||!isFinite(v)||!isFinite(va)||(modo==='%'&&!va))return '<span class="var">—</span>';
    const d=modo==='%'?(v-va)/Math.abs(va):v-va,tx=modo==='%'?num(Math.abs(d)*100,1)+'%':modo==='pp'?num(Math.abs(d)*100,1)+' pp':modo==='usd'?usd(Math.abs(d)):num(Math.abs(d),0);
    if(Math.abs(d)<(modo==='%'||modo==='pp'?0.0005:0.5))return `<span class="var">= ${tx}</span>`;
    return `<span class="var ${(d>0)===(melhor>0)?'up':'down'}">${d>0?'▲':'▼'} ${tx}</span>`};
  const kpi=(l,v,var_,m,cls='')=>`<article class="kpi${cls}"><span class="k">${l}</span><b class="v">${v}</b>${var_}<span class="m">${m}</span></article>`;
  const bigs=kpi('Afiliados ativos',n(ativos.length),vr(ativos.length,A&&A.L.filter(a=>a.fes>0).length,'n',1),`${n(novos.length)} novos · ${n(parados.length)} parados`,' total')+
    kpi('Receita do funil',usdC(t.funil),vr(t.funil,A&&A.t.funil,'%',1),`${n(t.fes)} FEs · AOV ${usd(t.aov)}`)+
    kpi('CPA pago',temCpa?usdC(cpaTot):'…','<span class="var">&nbsp;</span>',temCpa&&t.fes?`${usd(cpaTot/t.fes)} por FE · L0 ${usd((cpaTot+t.liq-t.custo-t.fut)/t.fes)} · ${pct(cpaTot/t.funil,0)} da receita`:'carregando pedidos')+
    kpi(`Reembolso 60d <i>${sx}</i>`,pct(t.re60),vr(t.re60,A&&A.t.re60,'pp',-1),`já caiu ${pct(t.agora)} · meta ≤ ${P$(MT.re9)}`)+
    kpi(`Lucro/cliente <i>${sx}</i>`,usd(t.lpf),vr(t.lpf,A&&A.t.lpf,'usd',1),`com call center ${usd(t.fes?t.liqTot/t.fes:null)}`)+
    kpi('Concentração top 5',pctTx(conc,0),vr(conc,concA,'pp',-1),`da receita em 5 de ${n(ativos.length)} afiliados`);

  // ---- alertas automáticos (clicáveis: filtram a tabela) ----
  const rel=ativos.filter(a=>a.fes>=st.min);
  const AL=[
    {k:'re',cls:'bad',l:`reembolso 60d previsto acima de ${P$(MT.re7)}`,ids:rel.filter(a=>a.re60!=null&&a.re60*100>MT.re7)},
    {k:'prej',cls:'bad',l:`prejuízo por cliente pior que −US$ ${n(MT.prejIni)} (com call center)`,ids:rel.filter(a=>a.lpc!=null&&a.lpc<-MT.prejIni)},
    {k:'cb',cls:'warn',l:`disputas acima de ${P$(MT.cbIni)} das vendas (risco de chargeback)`,ids:ativos.filter(a=>a.tdisp!=null&&a.tdisp*100>MT.cbIni)},
    {k:'queda',cls:'warn',l:'caíram 40%+ na última semana (contra a média das 4 anteriores)',ids:ativos.filter(a=>{const x=X.get(a.i);return x&&x.f28/4>=20&&x.f7<=0.6*x.f28/4*k7})},
    {k:'parado',cls:'warn',l:'pararam: sem FE há 7+ dias (tinham volume no período anterior)',ids:parados},
    {k:'novo',cls:'good',l:'novos com bom começo (30+ FEs, nota 60+)',ids:novos.filter(a=>a.fes>=30&&a.pts!=null&&a.pts>=60)},
  ].map(a=>({...a,ids:a.ids.sort((x,y)=>y.funil-x.funil)}));
  const alertas=AL.map(a=>{const on=lsSt.filtro===a.k;const nomes=a.ids.slice(0,3).map(x=>esc(nomeAf(x))).join(', ')+(a.ids.length>3?` e mais ${a.ids.length-3}`:'');
    return `<button type="button" class="ls-al ${a.cls}${on?' on':''}${a.ids.length?'':' zero'}" data-al="${a.k}" ${a.ids.length?'':'disabled'} aria-pressed="${on}">
      <b>${n(a.ids.length)}</b><span class="t">${a.l}</span><span class="nm">${a.ids.length?nomes:'nenhum'}</span></button>`}).join('');

  // ---- tabela ----
  const filtro=lsSt.filtro&&AL.find(a=>a.k===lsSt.filtro);
  const base=lsSt.filtro==='parado'?parados:ativos,rows=filtro?filtro.ids:base;
  const linha=a=>{const x=X.get(a.i)||{sem:Array(8).fill(0)},s4=x.sem.slice(4).reduce((p,q)=>p+q,0),s0=x.sem.slice(0,4).reduce((p,q)=>p+q,0);
    const luc=a.liq-a.custo-a.fut;
    return {a,nome:nomeAf(a),curva:a.S?'S':a.curva,pts:a.pts,rank:a.rank,fes:a.fes,funil:a.funil,aov:a.aov,cpa:x.cpa,ideal:x.cpa==null?null:x.cpa+luc,
      luc,re:a.d60+a.fut,d60:a.d60,tx:x.tx||0,vendas:a.vendas,disp:a.disp,
      agora:a.agora,re60:a.re60,tdisp:a.tdisp,custo:a.custo,call:a.call,lpf:a.lpf,lpc:a.lpc,st:statusCpa(a.lpf),sem:x.sem,tend:s0?(s4/k28-s0)/s0:s4?1:null,
      ult:x.ult==null?null:FIM-x.ult}};
  const RS=rows.map(linha);
  const fechadaTx=fechada?'real':'previsto',M=lsModo,pc=M==='pct',vl=(k,info,o={})=>({l:o.l,v:r=>lsVal(r[k],r),num:true,fmt:pc?null:'moeda',t:r=>lsFmt(lsVal(r[k],r)),info,...o});
  const cpaH=k=>r=>{const v=lsVal(r[k],r);if(v==null)return r.cpa==null&&!temCpa?'…':'—';const tp=lsDifTip(r);
    return tp?`<span class="ls-cpa" data-tip="${regTip(tp)}">${lsFmt(v)}</span>`:lsFmt(v)};
  const cpaCls=r=>r.cpa==null||r.ideal==null?'':r.cpa>r.ideal?'neg':'pos';
  const un=pc?'em % da receita do funil':M==='cli'?'por cliente (÷ FEs)':'total da safra';
  const COLS_MODO=[
    ...(M==='cli'?[{l:'AOV',v:r=>r.aov,num:true,fmt:'moeda',t:r=>usd(r.aov),info:'Receita do funil ÷ FEs.'}]:[]),
    vl('cpa',`CPA pago na safra, ${un}. Vermelho: acima do CPA L0; verde: abaixo. Passe o mouse para ver a diferença.`,{l:'CPA',h:cpaH('cpa'),cls:cpaCls}),
    vl('ideal',CPA_IDEAL_INFO,{l:'CPA L0',h:cpaH('ideal')}),
    vl('re',`Reembolso de 60 dias ${fechadaTx} (valor devolvido + taxas de alerta e disputa), ${un}. Mesma conta do Ranking.`,
      {l:`Reembolso 60d ${fechada?'':'prev.'}`,h:r=>fechada?lsFmt(lsVal(r.re,r)):`<span title="Já caiu ${lsFmt(lsVal(r.d60,r))}; o resto é previsto">${lsFmt(lsVal(r.re,r))}</span>`,
       cls:r=>r.re60==null?'':r.re60*100<=MT.re9?'pos':r.re60*100>MT.re7?'neg':''}),
    pc?{l:'Chargeback',v:r=>r.tdisp,num:true,t:r=>pctTx(r.tdisp),cls:r=>r.tdisp!=null&&r.tdisp*100>MT.cbIni?'neg':'',info:`Disputas ÷ vendas (vendas com 30+ dias, mínimo 20). Vermelho: acima de ${P$(MT.cbIni)} (penalidade da nota).`}
      :vl('tx',`Taxas de alerta e disputa já cobradas (US$ 23 e US$ 49), ${un}. Já estão dentro do reembolso.`,{l:'Chargeback'}),
    vl('custo',`Custo do produto e frete (Full Stack real ou a média real onde não há pedido no armazém), ${un}.`,{l:pc?'Custo':M==='cli'?'Custo médio':'Custo produto'}),
    vl('luc',`Líquido ${fechadaTx}: receita − CPA − taxas − custo − reembolso de 60 dias, sem call center, ${un}. É o que define o Status CPA.`,
      {l:`Líquido ${fechada?'':'prev.'}`,cls:r=>r.luc==null?'':r.luc<0?'neg':'pos'}),
    vl('call',`Líquido do call center ligado aos clientes da safra, ${un}. Não entra na nota nem no CPA L0.`,{l:pc?'% Call center':'Call center',cls:r=>r.call?'pos':''}),
  ];
  const COLS=[
    {l:'Afiliado',v:r=>r.nome,texto:true,max:190,h:r=>{const a=r.a;return `<span class="ls-nm" data-af="${afId(a)}" data-tip="${regTip(tipAf(a,fechada))}" data-delay="1" tabindex="0">${a.S?SB:''}<span class="nmt">${esc(r.nome)}</span>${PLB(a)}</span>`}},
    {l:'Curva Afiliado',v:r=>r.curva,texto:true,h:r=>`<span class="tag ${r.curva}">${r.curva}</span>`},
    {l:'Nota',v:r=>r.pts,num:true,t:r=>r.pts==null?'—':num(r.pts,0),h:r=>r.pts==null?'—':`<span class="${r.rank?'':'ls-fora'}" title="${r.rank?'':'Fora do ranking: menos de '+st.min+' FEs na safra'}">${sc(r.pts)}</span>`,info:'Pontuação de 0 a 100 do Ranking (mesmas premissas). Esmaecida: fora do ranking por ter poucos FEs.'},
    {l:'FEs',v:r=>r.fes,num:true,fmt:'inteiro',soma:true},
    {l:'Receita funil',v:r=>r.funil,num:true,fmt:'moeda',soma:true,t:r=>usd(r.funil)},
    ...COLS_MODO,
    {l:'Status CPA',v:r=>r.st&&r.st[0],texto:true,h:r=>r.st?`<span class="ls-st ${r.st[1]}">${r.st[0]}</span>`:'—',info:`Régua do dash (Lucro real): lucro/cliente previsto ≥ US$ ${STATUS_CPA.ok} saudável, ≥ US$ ${STATUS_CPA.at} atenção, abaixo renegociar.`},
    {l:'Tendência 8 sem.',v:r=>r.tend,num:true,h:r=>`<span class="ls-tend">${spark(r.sem)}<small class="${r.tend==null?'':r.tend<-0.15?'neg':r.tend>0.15?'pos':''}">${r.tend==null?'':(r.tend>0?'+':'')+num(r.tend*100,0)+'%'}</small></span>`,info:'FEs por semana nas últimas 8 semanas (até o último dia com dados). %: últimas 4 contra as 4 anteriores.'},
    {l:'Última venda',v:r=>r.ult,num:true,t:r=>diasTx(r.ult),cls:r=>r.ult!=null&&r.ult>=7?'neg':''},
  ];
  // total: soma dos montantes das linhas (vale com e sem alerta); os % e "por cliente" saem das somas
  const sm=k=>RS.reduce((s,r)=>s+(r[k]||0),0),T={nome:null,curva:null,pts:filtro?null:t.pts};
  ['fes','funil','custo','call','luc','re','d60','tx','vendas','disp'].forEach(k=>T[k]=sm(k));
  T.cpa=temCpa?sm('cpa'):null;T.ideal=T.cpa==null?null:T.cpa+T.luc;T.aov=T.fes?T.funil/T.fes:null;
  T.re60=T.funil?T.re/T.funil:null;T.tdisp=T.vendas>=20?T.disp/T.vendas:null;

  el.innerHTML=`<section class="bigs ls-bigs">${bigs}</section>
    <section class="ls-als" aria-label="Alertas">${alertas}</section>
    <section class="pd-sec ls-sec" id="lsSec"><div class="pd-head"><div><h3>Afiliados <span class="pd-cnt">${n(RS.length)}</span>${filtro?`<button type="button" class="ls-chip" id="lsLimpa">${esc(filtro.l)} ×</button>`:''}</h3>
      <p>Safra ${dTx(p0)} a ${dTx(p1)} (${dias} dias)${st.plat?' · só '+st.plat:''}. Mesma conta do Ranking; clique no nome para abrir a página do afiliado. A nota esmaecida está fora do ranking (menos de ${n(st.min)} FEs).</p></div>
      <div class="pd-tools"><div class="fgrp" id="lsModo" role="group" aria-label="Mostrar valores">${LS_MODOS.map(([k,l])=>`<button type="button" data-v="${k}" aria-pressed="${k===M}">${l}</button>`).join('')}</div>
      <input class="pd-busca" id="lsBusca" type="search" placeholder="Buscar afiliado" aria-label="Buscar afiliado">
      <button type="button" class="dt-btn-excel" id="lsXls" title="Exportar para Excel" aria-label="Exportar para Excel">${ICO.xls}</button></div></div>
      <div id="lsTab"></div></section>`;
  const dt=dtCriar(el.querySelector('#lsTab'),{cols:COLS,rows:RS,total:T,ordem:4,totalLabel:filtro?`Total (${n(RS.length)})`:`Total da base (${n(RS.length)})`,vazio:'Nenhum afiliado com esses filtros.',
    exportar:{titulo:'Visão geral dos afiliados',arquivo:'afiliados',filtros:[['Safra',`${dTx(p0)} a ${dTx(p1)}`],['Plataforma',st.plat||'Todas'],['Alerta',filtro?filtro.l:'—']]}});
  const b=el.querySelector('#lsBusca');b.oninput=()=>{const q=b.value.trim().toLowerCase();dtLinhas(dt,q?RS.filter(r=>r.nome.toLowerCase().includes(q)||String(r.a.af).toLowerCase().includes(q)):RS,T)};
  el.querySelector('#lsXls').onclick=e=>dtExcel(dt,e.currentTarget);
  el.querySelectorAll('#lsModo button').forEach(x=>x.onclick=()=>{if(x.dataset.v===lsModo)return;lsModo=x.dataset.v;
    try{LS.setItem('ns-af-lsmodo',lsModo)}catch(e){}const y=scrollY;renderLista(R);scrollTo(0,y)});
  el.querySelectorAll('[data-al]').forEach(x=>x.onclick=()=>{lsSt.filtro=lsSt.filtro===x.dataset.al?null:x.dataset.al;renderLista(R)});
  const lp=el.querySelector('#lsLimpa');if(lp)lp.onclick=()=>{lsSt.filtro=null;renderLista(R)};
}

// navegação: a Visão Geral tem duas subabas, Afiliados (lista) e Pontuação por curva (visao: a Visão geral do site, com
// os big numbers dos critérios e os blocos A/B/C). Nela somem as abas Ranking/Premissas; o menu marca a tela da vez.
PGS.visao=['Visão Geral','Visão geral dos afiliados'];
const ehVg=p=>p==='lista'||p==='visao';
const _paginaLs=pagina;
pagina=function(p){_paginaLs(p);const ls=st.pg==='lista',vg=ehVg(st.pg)||(st.pg==='af'&&ehVg(st.voltar));
  const b=document.getElementById('bigs');if(b&&ls)b.hidden=true;
  root.querySelectorAll('.subtabs').forEach(x=>x.hidden=x.classList.contains('vg')?!ehVg(st.pg):vg);
  const grupo=vg?'lista':'ranking';
  root.querySelectorAll('.side-item[data-pg]').forEach(x=>x.classList.toggle('is-active',x.dataset.pg===grupo));
  if(ls&&st.R)renderLista(st.R)};
const _renderLs=render;
render=function(){_renderLs.apply(this,arguments);if(st.pg==='lista'&&st.R)renderLista(st.R)};

/* ---------- tela Reembolso Prev. (Afiliados › Reembolso Prev.) ----------
   História: 1) quando o lucro vira zero; 2) onde o reembolso pesa mais (mês, semana, Curva Afiliado, produto, caminho no funil);
   2 inclui produto e caminho no funil (pelos pedidos); 3) quem puxa a curva (top N melhores e piores contra a mediana); 4) afiliado × mês da safra.
   Limpeza de 05/11: saíram ticket médio do funil, nota (circular: a nota vem do reembolso), kit e as 5 curvas de upsell (o caminho no
   funil explica as cinco). Clique numa série = detalhe por afiliado, produto, caminho e valor; botão Alertas = popup com o que chama atenção.
   Mesma conta do Ranking (calcular): reembolso = devolvido + taxas de alerta e disputa; 60d previsto = o que já caiu +
   o que ainda vai cair (fator 10d→60d do afiliado). Margem antes do reembolso = (líquido − custo + reembolso já caído)
   ÷ receita: é o teto de reembolso para ter lucro em 60 dias. Lucro do funil, sem call center (como a nota).
   Curva por dia: real = medido nas vendas da safra que já têm aquela idade (mínimo 5% da receita e US$ 1 mil); depois, projeção até o 60d previsto
   pela forma da curva (mediana geral; a do próprio afiliado quando é um afiliado só). CPA vem dos pedidos.
   Cores das séries: pelo resultado (menor reembolso 60d = cor forte; maior = cor fria), paleta validada p/ daltonismo. */
PGS.reemb=['Reembolso Prev.','Reembolso previsto'];
const rpSt={f:{cv:'',fx:'',nt:''},n:5,sem:4,modo:'af',ord:null,abertos:new Set(),busca:''};
const RP_FX=[{k:'f1',l:'< US$ 370',s:'< 370',a:-1e9,b:370},{k:'f2',l:'US$ 370–390',s:'370–390',a:370,b:390},{k:'f3',l:'US$ 390–410',s:'390–410',a:390,b:410},{k:'f4',l:'≥ US$ 410',s:'410+',a:410,b:1e9}];
const RP_NT=[{k:'n5',l:'acima de 100',s:'100+',a:100,b:1e9},{k:'n4',l:'80–100',s:'80–100',a:80,b:100},{k:'n3',l:'60–80',s:'60–80',a:60,b:80},
  {k:'n2',l:'40–60',s:'40–60',a:40,b:60},{k:'n1',l:'20–40',s:'20–40',a:20,b:40},{k:'n0',l:'abaixo de 20',s:'< 20',a:-1e9,b:20}];
const rpFaixa=v=>v==null?null:(RP_FX.find(f=>v>=f.a&&v<f.b)||{}).k||null;
const rpNota=v=>v==null?null:(RP_NT.find(f=>v>=f.a&&v<f.b)||{}).k||null;
const RP_CV=[['S','S (premium)'],['A','A'],['B','B'],['C','C']];
const RP_DIM={cv:{l:'Curva Afiliado',op:RP_CV.map(([k,l])=>({k,l:k,s:l}))},fx:{l:'Ticket médio do funil',op:RP_FX},nt:{l:'Nota do afiliado',op:RP_NT}};
const RP_TAB=[1,3,5,7,10,14,21,30,45];   // colunas da tabela (o dia 60 é o total)
// ordenação da tabela: valor de cada coluna (nulo vai para o fim); sem ordem escolhida = receita (afiliados) / mês mais novo (safras)
const RP_ORD={nome:l=>l.srt??l.rot,cv:l=>l.na?{S:0,A:1,B:2,C:3}[l.na.S?'S':l.na.curva]:null,nota:l=>l.na?l.na.pts:null,fes:l=>l.c.fes,funil:l=>l.c.funil,
  cpa:l=>l.c.cpa==null?null:l.c.cpa/l.c.funil,ideal:l=>l.c.cpa==null?null:l.c.cpa/l.c.funil+l.c.luc,custo:l=>l.c.custo/l.c.funil,fim:l=>l.c.fim,rus:l=>l.c.fim*l.c.funil,luc:l=>l.c.luc};
RP_TAB.forEach(d=>RP_ORD['d'+d]=l=>rpVal(l.c.pts,d));
const RP_TXT=new Set(['nome','cv']);
const rpSemIni=d=>{const w=new Date(D0.getTime()+d*864e5).getUTCDay();return d-((w+6)%7)};
const rpIsoSem=s=>{const t=new Date(s+'T12:00:00Z'),dn=(t.getUTCDay()+6)%7;t.setUTCDate(t.getUTCDate()-dn+3);const y=t.getUTCFullYear(),f=new Date(Date.UTC(y,0,4));
  return [y,1+Math.round(((t-f)/864e5-3+((f.getUTCDay()+6)%7))/7)]};
const rpPP=k=>k==='t'?[0,FIM]:k==='p'?periodo():k.startsWith('m:')?[Math.max(0,dIdx(k.slice(2)+'-01')),Math.min(FIM,fimMes(k.slice(2)))]:[Math.max(0,+k.slice(2)),Math.min(FIM,+k.slice(2)+6)];
const rpPct=(v,c=1)=>v==null||!isFinite(v)?'—':pct(v,c);
const rpPp=v=>num(Math.abs(v*100),1).replace(/,0$/,'')+' pp';
// cor pelo resultado: o menor reembolso 60d ganha a cor mais forte; o maior, a mais fria (6 tons, --rk0 … --rk5)
const RK=6,rpRk=(i,n)=>`var(--rk${n<=1?0:Math.round(i*(RK-1)/(n-1))})`;
const rpPinta=ss=>{const o=ss.filter(s=>s&&!s.med).sort((a,b)=>a.c.fim-b.c.fim);o.forEach((s,i)=>s.cor=rpRk(i,o.length));return ss};
const ICO_FS='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
const ICO_AL='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const ICO_FIL='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 3H2l8 9.46V19l4 2v-8.54z"/></svg>';

// ---- acumulados por coorte (mês, semana, safra do topo, tudo) × afiliado ----
/* Curva da safra inteira, dia a dia (04/11): em cada dia d, cada venda entra com o real se já tem d dias; senão com o que
   já caiu + a previsão de 10 dias do afiliado × a parte da curva entre a idade dela e o dia d (FRAC(d) − FRAC(idade)).
   No dia 60 bate exatamente com o reembolso 60d do Ranking. Cheia = 50%+ da receita da safra já tem aquela idade. */
const RP_EV=[1,3,5,7,10,14,17,21,25,30,35,40,45,50,55,60];
const rpRowAt=(r,d)=>{if(DCH.includes(d))return RTH(r,d);let a=0,va=0;for(const x of DCH){if(x>d)return va+(RTH(r,x)-va)*(d-a)/(x-a);a=x;va=RTH(r,x)}return va};
let RPA=null,RPC=null,RPK=null,RP_IDS=null;
function rpPrepara(){
  RPA=new Map();RPC=new Map();const [p0,p1]=periodo(),NE=RP_EV.length,FE=RP_EV.map(FRAC);
  const add=(k,r,age,fa,rd)=>{let m=RPA.get(k);if(!m)RPA.set(k,m=new Map());let o=m.get(r[0]);
    if(!o)m.set(r[0],o={fu:0,fes:0,mf:Array(NE).fill(0),mr:Array(NE).fill(0),yD:Array(NE).fill(0),yF:Array(NE).fill(0)});
    const fu=r[C.funil];o.fu+=fu;o.fes+=r[C.fes];
    for(let j=0;j<NE;j++){const d=RP_EV[j];if(age>=d){o.mf[j]+=fu;o.mr[j]+=rd[j]}else{o.yD[j]+=D60(r);o.yF[j]+=fu*(FE[j]-fa)}}};
  for(const r of DADOS.rows){if(r[1]>FIM||r[1]<0)continue;if(st.plat&&r[RPL]!==st.plat)continue;
    const age=FIM-r[1],fa=FRAC(age),rd=RP_EV.map(d=>age>=d?rpRowAt(r,d):0);
    add('t',r,age,fa,rd);add('m:'+dIso(r[1]).slice(0,7),r,age,fa,rd);add('w:'+rpSemIni(r[1]),r,age,fa,rd);if(r[1]>=p0&&r[1]<=p1)add('p',r,age,fa,rd)}
  // CPA dos pedidos (positivo = o que sai), nas mesmas coortes
  RPK=null;if(typeof PED!=='undefined'&&PED){RPK=new Map();const c=PED.col,ad=(k,g,v)=>{let m=RPK.get(k);if(!m)RPK.set(k,m=new Map());m.set(g,(m.get(g)||0)+v)};
    for(let i=0;i<PED.n;i++){const d=c.fe[i];if(d>FIM||d<0)continue;const conta=c.af[i];if(st.plat&&(DADOS_CONTA.afs[conta][2]||'JVZoo')!==st.plat)continue;
      const g=MAPA_CONTA[conta],v=c.cpa[i]||0;if(!v)continue;ad('t',g,v);ad('m:'+dIso(d).slice(0,7),g,v);ad('w:'+rpSemIni(d),g,v);if(d>=p0&&d<=p1)ad('p',g,v)}}}
const rpCalc=k=>{if(!RPC.has(k))RPC.set(k,new Map(calcular(rpPP(k)).L.map(a=>[a.i,a])));return RPC.get(k)};
const rpVal=(pts,d)=>reta(d,pts.map(p=>[p[0],p[1]]));

// coorte (k) de um conjunto de afiliados (ids = Set ou null = todos)
function rpCoorte(k,ids){
  const acc=RPA.get(k);if(!acc)return null;const M=rpCalc(k),K=RPK&&RPK.get(k),NE=RP_EV.length;
  const o={fu:0,fes:0,mf:Array(NE).fill(0),mx:Array(NE).fill(0),funil:0,liq:0,custo:0,d60:0,fut:0,cpa:RPK?0:null,n:0};
  acc.forEach((x,i)=>{if(ids&&!ids.has(i))return;const a=M.get(i),p60=a?a.p60:0;o.fu+=x.fu;o.fes+=x.fes;
    for(let j=0;j<NE;j++){o.mf[j]+=x.mf[j];o.mx[j]+=x.mr[j]+x.yD[j]+p60*x.yF[j]}
    if(a){o.funil+=a.funil;o.liq+=a.liq;o.custo+=a.custo;o.d60+=a.d60;o.fut+=a.fut;o.n++}if(K&&o.cpa!=null)o.cpa+=K.get(i)||0});
  if(o.funil<=0)return null;
  o.re60=(o.d60+o.fut)/o.funil;o.agora=o.d60/o.funil;o.mg=(o.liq+o.d60-o.custo)/o.funil;o.lucUsd=o.liq-o.custo-o.fut;o.luc=o.lucUsd/o.funil;
  // curva da safra: cheia enquanto 50%+ da receita já tem aquela idade (e pelo menos US$ 1 mil); depois, pontilhada
  let dl=0,ok=true,v=0;const pts=[[0,0,true]];
  for(let j=0;j<NE;j++){const d=RP_EV[j],real=ok&&o.mf[j]>=Math.max(0.5*o.fu,1000);if(!real)ok=false;else dl=d;
    v=Math.max(v,o.mx[j]/o.fu);pts.push([d,v,real])}
  pts[pts.length-1][1]=Math.max(v,o.re60);
  o.pts=pts;o.dl=dl;o.fim=pts[pts.length-1][1];o.obs=RP_EV.map((d,j)=>o.mf[j]/o.fu);
  o.zero=o.mg<=0?0:null;if(o.zero==null)for(let d=0;d<=60;d+=0.25)if(rpVal(pts,d)>=o.mg){o.zero=d;break}
  return o}

/* ---------- gráfico de linhas (dias 0–60): real cheio, previsto pontilhado e suave, marcador no dia 60, rótulo da cor da série ---------- */
const RPG=new Map();
const rpNice=x=>{const p=10**Math.floor(Math.log10(x)),m=x/p;return (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p};
function rpDesenha(id){
  const cfg=RPG.get(id),box=document.getElementById(id);if(!cfg||!box||!box.isConnected)return;
  const svg=box.querySelector('svg'),tt=box.querySelector('.rp-tt'),W=Math.max(280,Math.floor(box.clientWidth)),H=cfg.h||240;
  const ser=cfg.series.filter(s=>s&&s.pts&&s.pts.length);
  if(!ser.length){svg.setAttribute('viewBox',`0 0 ${W} 60`);svg.setAttribute('width',W);svg.setAttribute('height',60);svg.innerHTML=`<text x="${W/2}" y="34" text-anchor="middle" class="rp-vz">Sem vendas com esses filtros.</text>`;return}
  const lbW=Math.min(cfg.lbW||(W<460?112:150),Math.round(W*0.36)),L=42,R=lbW+10,T=14,B=24,maxC=Math.max(6,Math.floor((lbW-56)/6));
  let lo=0,hi=0;ser.forEach(s=>s.pts.forEach(p=>{lo=Math.min(lo,p[1]);hi=Math.max(hi,p[1])}));(cfg.refs||[]).forEach(r=>{hi=Math.max(hi,r.v)});
  const step=rpNice(Math.max(0.01,(hi-lo)/4));hi=Math.ceil(hi*1.04/step)*step;lo=lo<0?Math.floor(lo*1.04/step)*step:0;
  const X=d=>L+d/60*(W-L-R),Y=v=>T+(hi-v)/(hi-lo)*(H-T-B),f1=v=>v.toFixed(1);
  let g='';
  for(let v=lo;v<=hi+1e-9;v+=step)g+=`<line class="${Math.abs(v)<1e-9?'rp-z':'rp-gr'}" x1="${L}" x2="${f1(X(60))}" y1="${f1(Y(v))}" y2="${f1(Y(v))}"/><text class="rp-ax" x="${L-6}" y="${f1(Y(v)+3.5)}" text-anchor="end">${num(v*100,0)}%</text>`;
  (W-L-R<240?[0,30,60]:W-L-R<380?[0,14,30,45,60]:[0,7,14,21,30,45,60]).forEach(d=>{g+=`<text class="rp-ax" x="${f1(X(d))}" y="${H-6}" text-anchor="${d===0?'start':d===60?'end':'middle'}">${d===0?'dia 0':d===60?'D60':d}</text>`});
  (cfg.refs||[]).forEach(r=>{g+=`<line class="rp-ref" x1="${L}" x2="${f1(X(60))}" y1="${f1(Y(r.v))}" y2="${f1(Y(r.v))}"/><text class="rp-refl" x="${L+4}" y="${f1(Y(r.v)-4)}">${r.rot}</text>`});
  (cfg.marks||[]).forEach(m=>{if(m.d==null)return;const x=X(m.d);g+=`<line class="rp-be" x1="${f1(x)}" x2="${f1(x)}" y1="${T}" y2="${H-B}"/><text class="rp-bel" x="${f1(m.d>40?x-5:x+5)}" y="${T+9}" text-anchor="${m.d>40?'end':'start'}">${m.rot}</text>`});
  const pl=a=>a.map(p=>f1(X(p[0]))+','+f1(Y(p[1]))).join(' ');
  // a pior série embaixo, a melhor por cima
  [...ser].reverse().forEach(s=>{const re=s.pts.filter(p=>p[2]),pv=s.pts.filter(p=>!p[2]);if(re.length&&pv.length)pv.unshift(re[re.length-1]);
    const cl=`rp-l${s.med?' med':''}${cfg.hl?(s.nome===cfg.hl?' hl':' fad'):''}`,cor=`style="stroke:${s.cor}"`;
    if(re.length>1)g+=`<polyline class="${cl}" ${cor} points="${pl(re)}"/>`;if(pv.length>1)g+=`<polyline class="${cl} pv" ${cor} points="${pl(pv)}"/>`;
    const z=s.pts[s.pts.length-1];g+=`<circle class="rp-d60${z[2]?'':' pv'}" cx="${f1(X(z[0]))}" cy="${f1(Y(z[1]))}" r="${s.med?4:3.5}" style="fill:${s.cor}"/>`});
  // rótulos no fim, da cor da série, afastados para não encostar (12 px)
  const lb=ser.map(s=>({s,y:Y(s.pts[s.pts.length-1][1])})).sort((a,b)=>a.y-b.y);
  for(let i=1;i<lb.length;i++)lb[i].y=Math.max(lb[i].y,lb[i-1].y+12);
  const sob=lb.length?lb[lb.length-1].y-(H-B+4):0;if(sob>0)lb.forEach(x=>x.y-=sob);for(let i=0;i<lb.length;i++)lb[i].y=Math.max(lb[i].y,T+4+i*12);
  const x0=X(60);
  lb.forEach(({s,y})=>{const v=s.pts[s.pts.length-1][1],yv=Y(v),nm=s.nome.length>maxC?s.nome.slice(0,maxC-1)+'…':s.nome;
    g+=`${Math.abs(y-yv)>2?`<path class="rp-lk" d="M${f1(x0+5)} ${f1(yv)}L${f1(x0+10)} ${f1(y)}"/>`:''}<text class="rp-lb${s.med?' med':''}${s.q?' ck':''}${cfg.hl?(s.nome===cfg.hl?' hl':' fad'):''}" data-i="${ser.indexOf(s)}" x="${f1(x0+13)}" y="${f1(y+3.5)}" style="fill:${s.cor}"><tspan class="n">${esc(nm)}</tspan> <tspan class="v">${s.fmt?s.fmt(v):rpPct(v)}</tspan></text>`});
  g+=`<line class="rp-cx" x1="0" x2="0" y1="${T}" y2="${H-B}" visibility="hidden"/><g class="rp-dots"></g><rect class="rp-hit" x="${L}" y="${T}" width="${f1(X(60)-L)}" height="${H-T-B}"/>`;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('width',W);svg.setAttribute('height',H);svg.innerHTML=g;
  // passar o mouse: linha vertical no dia + valores de todas as séries
  const hit=svg.querySelector('.rp-hit'),cx=svg.querySelector('.rp-cx'),dots=svg.querySelector('.rp-dots');
  const sai=()=>{cx.setAttribute('visibility','hidden');dots.innerHTML='';tt.hidden=true};
  hit.onpointerleave=sai;
  // clique: abre o detalhe da série mais perto do ponteiro (ou do rótulo clicado)
  const clic=ser.some(s=>s.q);if(clic){hit.classList.add('ck');svg.querySelectorAll('.rp-lb.ck').forEach(x=>x.onclick=()=>rpDrillAbre(ser[+x.dataset.i],cfg));
    hit.onclick=e=>{const bb=svg.getBoundingClientRect(),px=(e.clientX-bb.left)*W/bb.width,py=(e.clientY-bb.top)*H/bb.height,d=Math.max(0,Math.min(60,Math.round((px-L)/(X(60)-L)*60)));
      const s=ser.filter(x=>x.q).map(x=>({x,dy:Math.abs(Y(rpVal(x.pts,d))-py)})).sort((a,b)=>a.dy-b.dy)[0];if(s)rpDrillAbre(s.x,cfg)}}
  hit.onpointermove=e=>{const bb=svg.getBoundingClientRect(),px=(e.clientX-bb.left)*W/bb.width,d=Math.max(0,Math.min(60,Math.round((px-L)/(X(60)-L)*60))),x=X(d);
    cx.setAttribute('x1',f1(x));cx.setAttribute('x2',f1(x));cx.setAttribute('visibility','visible');
    const vs=ser.map(s=>{const re=s.pts.filter(p=>p[2]),dl=re[re.length-1][0];return {s,v:rpVal(s.pts,d),real:d<=dl}}).sort((a,b)=>b.v-a.v);
    dots.innerHTML=vs.map(o=>`<circle cx="${f1(x)}" cy="${f1(Y(o.v))}" r="4" style="fill:${o.s.cor}"/>`).join('');
    tt.innerHTML=`<b>${cfg.ttTit?cfg.ttTit(d):'Dia '+d+' depois da venda'}</b>`+vs.slice(0,16).map(o=>`<div class="r"><i style="background:${o.s.cor}"></i><span class="n">${esc(o.s.nome)}</span><span class="v">${o.s.fmt?o.s.fmt(o.v):rpPct(o.v)}${o.real?'':' <em>prev.</em>'}</span>${o.s.extra?`<small>${o.s.extra}</small>`:''}</div>`).join('')+(vs.length>16?`<div class="r"><span class="n">e mais ${vs.length-16}</span></div>`:'');
    if(clic)tt.insertAdjacentHTML('beforeend','<div class="rp-tth">Clique na linha para ver o porquê</div>');tt.hidden=false;const bw=box.clientWidth,tw=tt.offsetWidth,lx=x*bb.width/W;tt.style.left=(lx+14+tw>bw?Math.max(0,lx-14-tw):lx+14)+'px';tt.style.top='8px'};
}
const rpGrafHtml=(id,aria)=>`<div class="rp-g" id="${id}"><svg role="img" aria-label="${esc(aria||'')}"></svg><div class="rp-tt" hidden></div></div>`;
const rpGraf=(id,cfg)=>{RPG.set(id,cfg);return rpGrafHtml(id,cfg.aria)};
const rpFsBtn=(id,tit)=>`<button type="button" class="rp-fs" data-fs="${id}" data-fst="${esc(tit)}" title="Tela cheia" aria-label="Abrir em tela cheia: ${esc(tit)}">${ICO_FS}</button>`;
const rpLeg=itens=>`<div class="rp-leg">${itens.map(x=>`<span><i class="${x.cls||''}" style="${x.cor?'background:'+x.cor:''}"></i>${x.l}</span>`).join('')}</div>`;
let rpRz=null;_on(window,'resize',()=>{clearTimeout(rpRz);rpRz=setTimeout(()=>{if(st.pg!=='reemb')return;const f=RPG.get('rpGF');if(f)f.h=Math.max(320,innerHeight-190);RPG.forEach((c,id)=>rpDesenha(id))},120)});

// tela cheia: o mesmo gráfico, grande, num modal (Esc ou × fecha)
function rpTelaCheia(id,tit){
  const cfg=RPG.get(id),raiz=document.getElementById('reemb');if(!cfg||!raiz)return;
  let m=document.getElementById('rpFull');if(!m){m=Object.assign(document.createElement('div'),{id:'rpFull',className:'rp-full'});raiz.appendChild(m)}
  const card=document.getElementById(id).closest('.rp-card,.rp-s'),sub=card&&card.querySelector('.rp-dest,.rp-sub');
  m.innerHTML=`<div class="rp-fin" role="dialog" aria-modal="true" aria-label="${esc(tit)}"><div class="rp-fh"><div><h3>${esc(tit)}</h3>${sub?`<p>${sub.innerHTML}</p>`:''}</div><button type="button" class="rp-x" aria-label="Fechar">×</button></div>${rpGrafHtml('rpGF',tit)}</div>`;
  RPG.set('rpGF',{...cfg,h:Math.max(320,innerHeight-190),lbW:Math.max(cfg.lbW||0,200)});
  m.hidden=false;document.body.classList.add('modal-on');rpDesenha('rpGF');
  const fecha=()=>{m.hidden=true;RPG.delete('rpGF');document.body.classList.remove('modal-on');window.removeEventListener('keydown',esc_)},esc_=e=>{if(e.key==='Escape')fecha()};
  m.querySelector('.rp-x').onclick=fecha;m.onclick=e=>{if(e.target===m)fecha()};window.addEventListener('keydown',esc_);m.querySelector('.rp-x').focus()}

// nota clicável: abre a mesma ficha do Ranking (radar, conta da nota e curva), fixa no centro
let rpFixo=false;const RP_FICHA=new Map();
const _escRp=esconde;esconde=function(){if(rpFixo)return;return _escRp.apply(this,arguments)};
const _mosRp=mostra;mostra=function(){if(rpFixo)return;return _mosRp.apply(this,arguments)};
function rpFechaFicha(){if(!rpFixo)return;rpFixo=false;const t=document.getElementById('tip');t.classList.remove('fixo');_escRp();
  const b=document.getElementById('rpBack');if(b)b.hidden=true;document.body.classList.remove('modal-on')}
function rpAbreFicha(k){const o=RP_FICHA.get(k);if(!o)return;cancelaEspera();_escRp();
  const t=document.getElementById('tip'),raiz=document.getElementById('reemb');
  let b=document.getElementById('rpBack');if(!b){b=Object.assign(document.createElement('div'),{id:'rpBack',className:'rp-back'});raiz.appendChild(b);b.onclick=rpFechaFicha}
  t.innerHTML=`<button type="button" class="rp-x rp-tx" aria-label="Fechar">×</button>`+tipAf(o.a,o.fechada).replace(/<div class="nt">[^<]*<\/div>/,
    `<div class="nt rp-ntb"><span>${esc(o.ctx)}</span><button type="button" class="ls-chip" data-af="${afId(o.a)}">Abrir página do afiliado →</button></div>`);
  t.classList.add('on','largo','fixo');t.classList.toggle('ouro',!!o.a.S);t.setAttribute('aria-hidden','false');t.style.left='';t.style.top='';
  rpFixo=true;b.hidden=false;document.body.classList.add('modal-on');t.querySelector('.rp-tx').onclick=rpFechaFicha}
_on(window,'keydown',e=>{if(e.key==='Escape')rpFechaFicha()});

/* ---------- a tela ---------- */
let rpEspera=null;
/* ---------- 3. kit, produto e upsell (05/11): pelos pedidos, cada um ligado ao FE de origem (PED.col.fid) ----------
   Sessão = o FE + os upsells, downsells e bumps que herdaram esse FE (mesma atribuição do painel). Kit e produto = os do FE.
   Reembolso = devolvido + alerta + disputa, pelo dia em que caiu. Curva igual à das outras quebras (real cheio, previsto
   pontilhado); o que falta cair vem da taxa de 60 dias do próprio grupo nas vendas com 60+ dias (todas as safras), com
   credibilidade de US$ 20 mil puxando para a taxa geral. */
const RP_PI=new Map();
function rpProd(k){let o=RP_PI.get(k);if(o)return o;const nm=PED.dic.produto[k]||'',U=nm.toUpperCase();
  const m1=U.match(/OTO\s*(\d)/),m2=U.match(/\bDS\s*-?\s*(\d)/);
  const passo=m1?'OTO'+m1[1]:m2?'DS'+m2[1]:/\bOB\b|BUMP|VIP-UPGRADE/.test(U)?'Bump':null;
  const s=nm.replace(/^\s*(FE|Last\s*Chance\s*\d*)\s*-\s*/i,''),m=s.match(/^(.*?)[\s\-\/]*(\d+)\s*(bottles?|potes?)\b/i);
  const fam=(m?m[1]:s.split(/\s[\/-]\s/)[0]).replace(/[\s\-\/]+$/,'').trim()||'—';
  o={passo,fam,famK:fam.toLowerCase().replace(/\s+/g,' '),kit:m?+m[2]:null};RP_PI.set(k,o);return o}
let RP_PD=null;   // por pedido: dia da venda e dias até o reembolso (calculado uma vez)
function rpPedDias(){if(RP_PD&&RP_PD.ped===PED)return RP_PD;const c=PED.col,N=PED.n,d0=new Int32Array(N),off=new Int32Array(N).fill(-1);
  for(let i=0;i<N;i++){d0[i]=c.em[i]?dIdx(c.em[i].slice(0,10)):c.fe[i];if(c.red[i])off[i]=Math.max(0,dIdx(c.red[i])-d0[i])}
  return RP_PD={ped:PED,d0,off}}
/* chaves por pedido que não dependem do período: sessão (FE de origem), caminho no funil e faixa de valor da sessão */
let RP_CK=null,RP_CAMTOP=null,RP_PT=0.25;
const RP_VAL=[['v0','só FE'],['v1','até US$ 150'],['v2','US$ 150–300'],['v3','US$ 300–500'],['v4','US$ 500+']];
const RP_VALC=[['v0','só FE'],['v1','até 150'],['v2','150–300'],['v3','300–500'],['v4','500+']];
function rpPedChaves(){
  if(RP_CK&&RP_CK.ped===PED)return RP_CK;const c=PED.col,ET=PED.dic.etapa,N=PED.n;
  const sess=new Int32Array(N),vUp=new Float64Array(N),passos=new Map(),ORD={OTO1:1,DS1:2,OTO2:3,DS2:4,OTO3:5,DS3:6};
  for(let i=0;i<N;i++){const s=c.fid[i]>=0?c.fid[i]:i;sess[i]=s;if(s!==i&&ET[c.et[i]]!=='FE'){vUp[s]+=c.bruto[i]||0;let l=passos.get(s);if(!l)passos.set(s,l=[]);l.push(i)}}
  const camS=new Map(),longo=new Map(),cam=new Array(N),val=new Array(N),fam=new Array(N),nomeFam=new Map();
  const camDe=s=>{let k=camS.get(s);if(k)return k;const P=rpProd(c.pr[s]),fe=P.kit?P.kit+'p':'FE';
    const l=(passos.get(s)||[]).map(i=>{const pp=rpProd(c.pr[i]),e=ET[c.et[i]],pa=pp.passo||(e==='Upsell'?'UP':e==='Downsell'?'DS':'Bump');return {pa,k:pp.kit,o:ORD[pa]||9}})
      .filter(x=>x.pa!=='Bump').sort((a,b)=>a.o-b.o);
    const cur=x=>x.pa==='OTO1'?(x.k?x.k+'p':'UP1'):x.pa==='DS1'?'DS'+(x.k?x.k+'p':''):x.pa==='OTO2'?'UP2':x.pa==='OTO3'?'UP3':x.pa.startsWith('DS')?'DS':x.pa;
    const lon=x=>x.pa==='OTO1'?'Upsell 1'+(x.k?` de ${x.k} potes`:''):x.pa==='DS1'?'Downsell 1'+(x.k?` de ${x.k} potes`:''):x.pa==='OTO2'?'Upsell 2':x.pa==='OTO3'?'Upsell 3':x.pa.startsWith('DS')?'downsell':'upsell';
    k=[fe,...l.map(cur)].join('+');camS.set(s,k);if(!longo.has(k))longo.set(k,[P.kit?`FE de ${P.kit} potes`:'FE',...l.map(lon)].join(' → ')+(l.length?'':' (sem upsell)'));return k};
  for(let i=0;i<N;i++){const s=sess[i],P=rpProd(c.pr[s]);cam[i]=camDe(s);fam[i]=P.famK;if(!nomeFam.has(P.famK))nomeFam.set(P.famK,P.fam);
    const u=vUp[s];val[i]=!u?'v0':u<=150?'v1':u<=300?'v2':u<=500?'v3':'v4'}
  return RP_CK={ped:PED,sess,cam,val,fam,longo,nomeFam}}
// chave de um pedido numa dimensão (o caminho fora dos 6 maiores da safra vira "outros")
const rpChave=(dim,i,CK)=>dim==='cam'?(RP_CAMTOP&&!RP_CAMTOP.has(CK.cam[i])?'outros':CK.cam[i]):dim==='fam'?CK.fam[i]:dim==='val'?CK.val[i]:null;
function rpPedidos(IDS){
  if(typeof PED==='undefined'||!PED||!PED.col.fid)return null;
  const c=PED.col,ET=PED.dic.etapa,[p0,p1]=periodo(),NE=RP_EV.length,FEv=RP_EV.map(FRAC),N=PED.n,{d0,off:OFF}=rpPedDias(),CK=rpPedChaves(),K=20000;
  const ok=i=>{const conta=c.af[i];return !(st.plat&&(DADOS_CONTA.afs[conta][2]||'JVZoo')!==st.plat)&&!(IDS&&!IDS.has(MAPA_CONTA[conta]))};
  // os 6 caminhos com mais receita na safra (o resto vira "outros")
  const rc=new Map();for(let i=0;i<N;i++){const fe=c.fe[i];if(fe<p0||fe>p1||fe>FIM||!ok(i))continue;rc.set(CK.cam[i],(rc.get(CK.cam[i])||0)+(c.bruto[i]||0))}
  RP_CAMTOP=new Set([...rc].sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0]));
  const D={fam:new Map(),cam:new Map(),val:new Map()},tot={hb:0,hr:0};
  const novo=()=>({fu:0,n:0,ses:0,mf:Array(NE).fill(0),mr:Array(NE).fill(0),yD:Array(NE).fill(0),yF:Array(NE).fill(0),hb:0,hr:0});
  for(let i=0;i<N;i++){const fe=c.fe[i];if(fe<0||fe>FIM||!ok(i))continue;
    const age=FIM-d0[i];if(age<0)continue;
    const b=c.bruto[i]||0,r=(c.re[i]||0)+(c.al[i]||0)+(c.dt[i]||0),of=r?(OFF[i]>=0?OFF[i]:Math.min(age,30)):0,eFE=ET[c.et[i]]==='FE';
    const mad=age>=60,r60=of<=60?r:0,naSafra=fe>=p0&&fe<=p1;if(mad){tot.hb+=b;tot.hr+=r60}
    for(const dim in D){const k=rpChave(dim,i,CK);let o=D[dim].get(k);if(!o)D[dim].set(k,o=novo());
      if(mad){o.hb+=b;o.hr+=r60}
      if(!naSafra)continue;o.fu+=b;o.n++;if(eFE)o.ses++;
      for(let j=0;j<NE;j++){const d=RP_EV[j];if(age>=d){o.mf[j]+=b;if(of<=d)o.mr[j]+=r}else{o.yD[j]+=r;o.yF[j]+=b*(FEv[j]-FRAC(age))}}}}
  const pT=tot.hb?tot.hr/tot.hb:0;RP_PT=pT||RP_PT;
  for(const dim in D)D[dim].forEach(o=>{if(!o.fu){o.c=null;return}const pg=(o.hr+K*pT)/(o.hb+K);
    let dl=0,okk=true,v=0;const pts=[[0,0,true]];
    for(let j=0;j<NE;j++){const real=okk&&o.mf[j]>=Math.max(0.5*o.fu,1000);if(!real)okk=false;else dl=RP_EV[j];
      v=Math.max(v,(o.mr[j]+o.yD[j]+pg*o.yF[j])/o.fu);pts.push([RP_EV[j],v,real])}
    o.c={funil:o.fu,pts,dl,fim:pts[pts.length-1][1]}});
  return {D,CK,pT}}
// cards de produto e caminho no funil (entram na seção 2)
function rpSecUpsell(IDS,card,[p0,p1],cCurva){
  const R=rpPedidos(IDS);
  if(!R){const msg=typeof PED_ERRO!=='undefined'&&PED_ERRO?'Não foi possível ler os pedidos.':'Carregando os pedidos…';
    const vz=x=>`<article class="rp-card w3"><div class="rp-ch"><h4>${x}</h4></div><p class="rp-vz">${msg}</p></article>`;
    return vz('Por caminho no funil')+vz('Por valor do upsell')+cCurva+vz('Por produto do FE')}
  const {D,CK}=R,ser=(dim,lista,lg)=>lista.map(([k,l])=>{const o=D[dim].get(k);if(!o||!o.c)return null;
    return {nome:l,pts:o.c.pts,c:o.c,extra:`${lg?esc(lg(k))+' · ':''}${n(o.ses)} sessões · ${usdC(o.fu)}`,q:{p:[p0,p1],ids:IDS,k:[dim,k]}}}).filter(Boolean);
  const fams=[...D.fam.entries()].filter(([,o])=>o.c).sort((a,b)=>b[1].fu-a[1].fu).slice(0,6).map(([k])=>[k,CK.nomeFam.get(k)||k]);
  const cams=[...D.cam.entries()].filter(([k,o])=>o.c&&k!=='outros').sort((a,b)=>b[1].fu-a[1].fu).map(([k])=>[k,k]);if(D.cam.get('outros'))cams.push(['outros','outros']);
  return card('Por caminho no funil','Potes do FE + o que levou depois (12p = Upsell 1 de 12 potes · UP2 = Upsell 2 · DS = downsell); bump não conta. Os 6 caminhos com mais receita.',
      ser('cam',cams,k=>k==='outros'?'os outros caminhos':CK.longo.get(k)||k),'rpGC','w3')+
    card('Por valor do upsell','Sessão inteira, pela soma em US$ dos upsells, downsells e bumps que o cliente levou. 300–500 = quase sempre o Upsell 1 de 12 potes.',
      ser('val',RP_VALC,k=>(RP_VAL.find(x=>x[0]===k)||[0,k])[1]),'rpGV','w3')+cCurva+
    card('Por produto do FE','Os 6 produtos com mais receita na safra; sessão inteira (FE + upsells).',ser('fam',fams),'rpGP','w3')}

/* ---------- detalhe de uma série (clique na linha): por que está bom ou ruim ----------
   Pelos pedidos da série: em cada quebra (afiliado, produto, caminho, valor da sessão), o reembolso 60d de cada item e o
   efeito dele no reembolso da série em US$ = (taxa do item − taxa da série) × receita do item. Taxa 60d de cada item: o que
   já caiu + o que falta cair (receita × (1 − FRAC(idade))) × taxa a priori, que mistura a taxa do próprio item (o que caiu ÷
   o esperado até a idade) com a da série, por credibilidade (US$ 15 mil). Venda com 60+ dias = só o real. */
function rpDrillCalc(q,alvo){
  const c=PED.col,N=PED.n,{d0,off:OFF}=rpPedDias(),CK=rpPedChaves(),[a,b]=q.p,K=15000;
  // no caminho, o valor da sessão já vem do próprio caminho: fica de fora
  const dims=q.af?['sem','fam','cam','val']:q.k&&q.k[0]==='cam'?['af','fam']:q.k&&q.k[0]==='val'?['af','fam','cam']:['af','fam','cam','val'];
  const z=()=>({B:0,F:0,E:0,U:0,ses:0}),T=z(),T10={B:0,F:0},G={};dims.forEach(d=>G[d]=new Map());
  for(let i=0;i<N;i++){const fe=c.fe[i];if(fe<a||fe>b||fe>FIM)continue;const conta=c.af[i];
    if(st.plat&&(DADOS_CONTA.afs[conta][2]||'JVZoo')!==st.plat)continue;const g=MAPA_CONTA[conta];if(q.ids&&!q.ids.has(g))continue;
    if(q.k&&rpChave(q.k[0],i,CK)!==q.k[1])continue;
    const age=FIM-d0[i];if(age<0)continue;const bb=c.bruto[i]||0,r=(c.re[i]||0)+(c.al[i]||0)+(c.dt[i]||0),of=r?(OFF[i]>=0?OFF[i]:Math.min(age,30)):0;
    const fr=FRAC(age),F=age>=60?(of<=60?r:0):r,E=bb*fr,U=bb*(1-fr),fe1=PED.dic.etapa[c.et[i]]==='FE'?1:0;
    T.B+=bb;T.F+=F;T.E+=E;T.U+=U;T.ses+=fe1;if(age>=10){T10.B+=bb;if(of<=10)T10.F+=r}
    for(const d of dims){const k=d==='af'?g:d==='sem'?rpSemIni(fe):rpChave(d==='cam'?'camR':d,i,CK)??(d==='cam'?CK.cam[i]:null);
      let o=G[d].get(k);if(!o)G[d].set(k,o=z());o.B+=bb;o.F+=F;o.E+=E;o.U+=U;o.ses+=fe1}}
  if(!T.B)return null;
  const taxa=(o,pri)=>{const zz=o.E/(o.E+K),cl=o.E?o.F/o.E:pri;return (o.F+o.U*(zz*cl+(1-zz)*pri))/o.B};
  // calibra pela série do gráfico: a taxa a priori é a que faz o total bater com o 60d da curva
  let pri=RP_PT,est;if(alvo!=null&&T.U>1){pri=Math.max(0,(alvo*T.B-T.F)/T.U);est=alvo}else est=taxa(T,RP_PT);
  const out={T,est,d10:T10.B>=Math.max(1000,0.3*T.B)?T10.F/T10.B:null,dims:[]};
  const TA=rpCalc('t'),nome=(d,k)=>d==='af'?(TA.get(k)?nomeAf(TA.get(k)):'Afiliado '+k):d==='fam'?(CK.nomeFam.get(k)||k):d==='val'?(RP_VAL.find(x=>x[0]===k)||[0,k])[1]:d==='sem'?'semana de '+dTx(Math.max(0,k)):k;
  const TIT={af:'Por afiliado',fam:'Por produto do FE',cam:'Por caminho no funil',val:'Por valor do upsell',sem:'Por semana da safra'},TX={af:'afiliado',fam:'produto',cam:'caminho',val:'valor do upsell',sem:'semana'};
  for(const d of dims){const it=[...G[d]].map(([k,o])=>({k,nome:nome(d,k),o,tx:taxa(o,pri),sh:o.B/T.B,af:d==='af'?TA.get(k):null,lg:d==='cam'?CK.longo.get(k):null}));
    if(it.length<2)continue;
    // ajuste para a média ponderada dos itens fechar no 60d da série (os efeitos somam zero)
    const sw=it.reduce((p,x)=>p+x.tx*x.o.B,0),fa=sw>0?est*T.B/sw:1;it.forEach(x=>{x.tx*=fa;x.imp=(x.tx-est)*x.o.B});
    it.sort((x,y)=>Math.abs(y.imp)-Math.abs(x.imp));
    let top=it.slice(0,6);const resto=it.slice(6);
    if(resto.length){const o=z();let sr=0;resto.forEach(x=>{for(const kk in o)o[kk]+=x.o[kk];sr+=x.tx*x.o.B});const tx=sr/o.B;top.push({k:'_r',nome:`outros (${resto.length})`,o,tx,imp:(tx-est)*o.B,sh:o.B/T.B,resto:true})}
    top.sort((x,y)=>y.imp-x.imp);out.dims.push({d,tit:TIT[d],tx:TX[d],it:top})}
  return out}
function rpDrillAbre(s,cfg){
  if(!s||!s.q)return;const raiz=document.getElementById('reemb');if(!raiz)return;
  let m=document.getElementById('rpDrill');if(!m){m=Object.assign(document.createElement('div'),{id:'rpDrill',className:'rp-full'});raiz.appendChild(m)}
  const ped=typeof PED!=='undefined'&&PED&&PED.col.fid;const R=ped?rpDrillCalc(s.q,s.c?s.c.fim:null):null,ref=RP_REF||{};
  const v60=s.c?s.c.fim:null,dif=v60!=null&&ref.re60!=null?v60-ref.re60:null,ruim=dif!=null&&dif>0.005,bom=dif!=null&&dif<-0.005;
  let corpo='';
  if(!R)corpo=`<p class="rp-vz">${ped?'Sem pedidos nessa série.':'Carregando os pedidos…'}</p>`;
  else{const mx=Math.max(1,...R.dims.flatMap(x=>x.it.map(y=>Math.abs(y.imp))));
    const lin=(x,d)=>{const cls=x.tx>R.est+0.02?'neg':x.tx<R.est-0.02?'pos':'',w=Math.min(50,50*Math.abs(x.imp)/mx);
      const nm=x.af?`<span class="rp-dnm ls-nm" data-af="${afId(x.af)}" tabindex="0" title="Abrir a página do afiliado">${esc(x.nome)}</span>`:`<span class="rp-dnm" title="${esc(x.lg||x.nome)}">${esc(x.nome)}</span>`;
      return `<div class="rp-drow${x.resto?' rs':''}">${nm}<span class="rp-dsh" title="${rpPct(x.sh,0)} da receita da série · ${usdC(x.o.B)}"><i style="width:${Math.max(2,x.sh*100).toFixed(1)}%"></i></span><span class="rp-dpc ${cls}">${rpPct(x.tx)}</span>
        <span class="rp-dim"><span class="rp-bar rp-dbar"><i class="${x.imp>0?'n':'p'}" style="width:${w.toFixed(1)}%"></i></span><b class="${x.imp>0?'neg':'pos'}">${x.imp>=0?'+':'−'}${usdC(Math.abs(x.imp))}</b></span></div>`};
    const cab=`<div class="rp-drow rp-dhd"><span></span><span>receita</span><span>60d</span><span>efeito no reembolso</span></div>`;
    corpo=`<div class="rp-dgrid">${R.dims.map(x=>`<article class="rp-card"><h4>${x.tit}</h4>${cab}${x.it.map(y=>lin(y,x.d)).join('')}</article>`).join('')}</div>`;
    // por que: os 3 itens que mais empurram na direção do resultado
    const sinal=ruim?1:bom?-1:0,todos=R.dims.flatMap(x=>x.it.filter(y=>!y.resto&&y.imp*sinal>0).map(y=>({...y,dt:x.tx}))).sort((a,b)=>Math.abs(b.imp)-Math.abs(a.imp)).slice(0,3);
    s._pq=todos.length?`${ruim?'O que mais puxa para cima':'O que mais ajuda'}: ${todos.map(y=>`<b>${esc(y.nome)}</b> (${y.dt}, ${rpPct(y.tx)}, ${y.imp>=0?'+':'−'}${usdC(Math.abs(y.imp))})`).join(' · ')}.`:''}
  const kp=(l,v,m2,cl='')=>`<div class="rp-dk1${cl}"><span>${l}</span><b>${v}</b><small>${m2}</small></div>`;
  const cabTx=v60==null?'':`<b>${esc(s.nome)}</b> fecha 60 dias com <b class="${ruim?'neg':bom?'pos':''}">${rpPct(v60)}</b> de reembolso${dif!=null?`, ${rpPp(dif)} ${dif>0?'acima':'abaixo'} da safra (${rpPct(ref.re60)})`:''}. ${s._pq||''}`;
  m.innerHTML=`<div class="rp-fin rp-dfin" role="dialog" aria-modal="true" aria-label="${esc('Detalhe: '+s.nome)}"><div class="rp-fh"><div><h3><i class="rp-dsw" style="background:${s.cor}"></i>${esc(s.nome)} <small>${esc(cfg&&cfg.aria||'')}</small></h3><p>${cabTx}</p></div><button type="button" class="rp-x" aria-label="Fechar">×</button></div>
    <div class="rp-dk">${kp('Reembolso 60d',rpPct(v60),s.c&&s.c.dl<60?'previsto':'real',ruim?' neg':bom?' pos':'')}${kp('Safra do topo',rpPct(ref.re60),'referência')}${kp('Dia 10 (real)',R&&R.d10!=null?rpPct(R.d10):'—','vendas com 10+ dias')}${kp('Receita',R?usdC(R.T.B):'—',R?n(R.T.ses)+' FEs':'')}</div>
    ${corpo}<p class="rp-nota">Cada linha: barra cinza = parte da receita da série; 60d = reembolso previsto do item (vermelho = acima da série, verde = abaixo); efeito = quanto o item soma (+) ou tira (−) do reembolso da série em US$, pela diferença de taxa × receita. Conta pelos pedidos; pode diferir um pouco do valor do gráfico.</p></div>`;
  m.hidden=false;document.body.classList.add('modal-on');
  const fecha=()=>{m.hidden=true;document.body.classList.remove('modal-on');window.removeEventListener('keydown',esc_)},esc_=e=>{if(e.key==='Escape')fecha()};
  m.querySelector('.rp-x').onclick=fecha;m.onclick=e=>{if(e.target===m)fecha();else if(e.target.closest('[data-af]'))fecha()};window.addEventListener('keydown',esc_);m.querySelector('.rp-x').focus()}

/* ---------- alertas (popup): reembolso alto cedo, tendência das últimas semanas, quebras e afiliados que puxam a safra ---------- */
let RP_REF=null;
function rpAlertas(o,zd){
  const A=[],ref10=rpVal(o.pts,10),ttl=id=>{const c=RPG.get(id);return c?c.aria:''};
  if(zd!=null)A.push({n:zd<=30?3:2,k:1,t:zd===0?'A safra já começa no prejuízo':`A safra fecha no prejuízo: o lucro vira zero no dia ${num(zd,0)}`,x:`Reembolso previsto de ${rpPct(o.re60)} contra o teto de ${rpPct(o.mg)} (prejuízo previsto de ${usd(-o.lucUsd)}). Depois do dia ${num(zd,0)}, cada reembolso é prejuízo.`,alvo:{id:'rpG0'}});
  // reembolso alto cedo: dia 10 real ≥ 20%, ou 5 pp acima da safra (a pior série de cada gráfico)
  RPG.forEach((cfg,id)=>{if(id==='rpG0'||id==='rpGF')return;const ss=cfg.series.filter(s=>s&&s.c&&!s.med),tot=ss.reduce((p,s)=>p+s.c.funil,0);
    let pior=null;ss.forEach(s=>{if(s.c.dl<10||s.c.funil<Math.max(10000,0.03*tot))return;const v=rpVal(s.c.pts,10);if(v>=0.2||v>=ref10+0.05){if(!pior||v>pior.v)pior={s,v}}});
    if(pior)A.push({n:pior.v>=0.2?3:2,k:pior.v,t:`${pior.s.nome}: ${rpPct(pior.v)} de reembolso nos 10 primeiros dias`,x:`${ttl(id)}. A safra toda está em ${rpPct(ref10)} no dia 10 (${rpPp(pior.v-ref10)} a mais).`,alvo:{id,serie:pior.s.nome}})});
  // tendência: a semana mais recente contra as anteriores, no maior dia que ela já tem real
  const sw=(RPG.get('rpG2')||{series:[]}).series.filter(s=>s&&s.c);
  if(sw.length>=3){const u=sw[sw.length-1],ant=sw.slice(0,-1),d=[7,5,3,1].find(x=>u.c.dl>=x&&ant.every(s=>s.c.dl>=x));
    if(d){const vu=rpVal(u.c.pts,d),va=ant.reduce((p,s)=>p+rpVal(s.c.pts,d),0)/ant.length,df=vu-va;
      if(Math.abs(df)>=0.02)A.push({n:df>0?2:1,k:Math.abs(df),t:`Semana ${u.nome.replace('*','')} ${df>0?'devolvendo mais rápido':'devolvendo menos'}: ${rpPct(vu)} no dia ${d}`,x:`As ${ant.length} semanas anteriores tinham ${rpPct(va)} no mesmo dia (${df>0?'+':'−'}${rpPp(df)}).`,alvo:{id:'rpG2',serie:u.nome}})}}
  // mês atual contra o anterior no mesmo dia
  const sm=(RPG.get('rpG1')||{series:[]}).series.filter(s=>s&&s.c);
  if(sm.length>=2){const u=sm[sm.length-1],a=sm[sm.length-2],d=[10,7,5,3].find(x=>u.c.dl>=x&&a.c.dl>=x);
    if(d){const df=rpVal(u.c.pts,d)-rpVal(a.c.pts,d);if(Math.abs(df)>=0.02)A.push({n:df>0?2:1,k:Math.abs(df),t:`${u.nome.replace('*','')} ${df>0?'pior':'melhor'} que ${a.nome.replace('*','')} no dia ${d}`,x:`${rpPct(rpVal(u.c.pts,d))} contra ${rpPct(rpVal(a.c.pts,d))} (${df>0?'+':'−'}${rpPp(df)}).`,alvo:{id:'rpG1',serie:u.nome}})}}
  // quebras que puxam a safra: produto, caminho e Curva Afiliado com 5%+ da receita e 6 pp acima da safra
  [['rpGP','produto'],['rpGC','caminho'],['rpGV','upsell'],['rpG3','Curva Afiliado']].forEach(([id,l])=>{const ss=(RPG.get(id)||{series:[]}).series.filter(s=>s&&s.c&&s.nome!=='outros'),tot=ss.reduce((p,s)=>p+s.c.funil,0);
    const pi=ss.filter(s=>s.c.funil>=0.05*tot&&s.c.fim>=o.re60+0.06).sort((a,b)=>b.c.fim-a.c.fim)[0];
    if(pi)A.push({n:2,k:pi.c.fim-o.re60,t:`${l==='caminho'?'Caminho ':l==='upsell'?'Upsell de US$ ':l==='produto'?'':'Curva '}${pi.nome}: ${rpPct(pi.c.fim)} de reembolso em 60 dias`,x:`${rpPp(pi.c.fim-o.re60)} acima da safra (${rpPct(o.re60)}), com ${rpPct(pi.c.funil/tot,0)} da receita${l==='caminho'&&pi.extra?' · '+pi.extra.split(' · ')[0]:''}.`,alvo:{id,serie:pi.nome}})});
  // afiliados que puxam: 5%+ da receita da safra e 6 pp acima da safra; e o melhor grande, como destaque bom
  const sp=(RPG.get('rpG6')||{series:[]}).series.filter(s=>s&&s.c&&!s.med);
  sp.filter(s=>s.c.funil>=0.05*o.funil&&s.c.fim>=o.re60+0.06).slice(0,2).forEach(s=>A.push({n:2,k:s.c.fim-o.re60,t:`${s.nome} puxa a safra para cima: ${rpPct(s.c.fim)}`,x:`${rpPct(s.c.funil/o.funil,0)} da receita da safra e ${rpPp(s.c.fim-o.re60)} acima dela.`,alvo:{id:'rpG6',serie:s.nome}}));
  const sb=(RPG.get('rpG5')||{series:[]}).series.filter(s=>s&&s.c&&!s.med&&s.c.funil>=0.05*o.funil&&s.c.fim<=o.re60-0.05)[0];
  if(sb)A.push({n:1,k:o.re60-sb.c.fim,t:`${sb.nome} segura o reembolso: ${rpPct(sb.c.fim)}`,x:`${rpPct(sb.c.funil/o.funil,0)} da receita da safra e ${rpPp(o.re60-sb.c.fim)} abaixo dela.`,alvo:{id:'rpG5',serie:sb.nome},bom:true});
  return A.sort((a,b)=>b.n-a.n||(b.k||0)-(a.k||0)).slice(0,8)}
const RP_NIV={3:['alto','Alerta'],2:['medio','Atenção'],1:['bom','Destaque']};
function rpAlertasAbre(A){
  const raiz=document.getElementById('reemb');if(!raiz)return;let m=document.getElementById('rpAl');
  if(!m){m=Object.assign(document.createElement('div'),{id:'rpAl',className:'rp-full'});raiz.appendChild(m)}
  m.innerHTML=`<div class="rp-fin rp-alfin" role="dialog" aria-modal="true" aria-label="Alertas do reembolso"><div class="rp-fh"><div><h3>O que chama atenção nesta safra</h3><p>${A.length?`${n(A.length)} ${A.length>1?'pontos':'ponto'}, do mais urgente ao destaque bom. Clique para ir ao gráfico.`:'Nada fora do normal com esses filtros.'}</p></div><button type="button" class="rp-x" aria-label="Fechar">×</button></div>
    <div class="rp-alis">${A.map((a,i)=>{const nv=a.bom?RP_NIV[1]:RP_NIV[a.n];return `<article class="rp-ali ${nv[0]}"><span class="rp-aln">${nv[1]}</span><div><b>${esc(a.t)}</b><p>${esc(a.x)}</p></div><button type="button" class="rp-alv" data-i="${i}">Ver no gráfico →</button></article>`}).join('')}</div></div>`;
  m.hidden=false;document.body.classList.add('modal-on');
  const fecha=()=>{m.hidden=true;document.body.classList.remove('modal-on');window.removeEventListener('keydown',esc_)},esc_=e=>{if(e.key==='Escape')fecha()};
  m.querySelector('.rp-x').onclick=fecha;m.onclick=e=>{if(e.target===m)fecha()};window.addEventListener('keydown',esc_);
  m.querySelectorAll('.rp-alv').forEach(b=>b.onclick=()=>{fecha();rpVai(A[+b.dataset.i].alvo)});m.querySelector('.rp-x').focus()}
// vai até o gráfico e acende a série (as outras ficam apagadas por alguns segundos)
function rpVai(alvo){const g=document.getElementById(alvo.id);if(!g)return;const card=g.closest('.rp-card')||g.closest('.rp-s');
  card.scrollIntoView({behavior:'smooth',block:'center'});card.classList.remove('rp-pulse');void card.offsetWidth;card.classList.add('rp-pulse');
  const cfg=RPG.get(alvo.id);if(cfg&&alvo.serie){cfg.hl=alvo.serie;rpDesenha(alvo.id);clearTimeout(rpVai.t);rpVai.t=setTimeout(()=>{if(RPG.get(alvo.id)===cfg){cfg.hl=null;rpDesenha(alvo.id)}},6000)}}

function renderReemb(R){
  const el=document.getElementById('reemb');if(!el||st.pg!=='reemb')return;
  if(typeof PED!=='undefined'&&!PED&&!PED_ERRO&&!rpEspera)rpEspera=setTimeout(()=>{rpEspera=null;if(st.pg==='reemb'&&st.R)renderReemb(st.R)},600);
  rpFechaFicha();rpPrepara();RPG.clear();RP_FICHA.clear();
  const [p0,p1]=periodo(),P=rpCalc('p'),F=rpSt.f;
  // classes de cada afiliado: Curva Afiliado (receita dos 3 meses até o fim da safra), ticket médio e nota (pela safra do topo)
  const cls=new Map();P.forEach((a,i)=>cls.set(i,{cv:a.S?'S':a.curva,fx:rpFaixa(a.aov),nt:rpNota(a.pts)}));
  const passa=(c,sem)=>Object.keys(F).every(d=>d===sem||!F[d]||c[d]===F[d]);
  const ids=sem=>{if(!Object.keys(F).some(d=>d!==sem&&F[d]))return null;const s=new Set();cls.forEach((c,i)=>{if(passa(c,sem))s.add(i)});return s};
  const IDS=ids();RP_IDS=IDS;
  const ativos=Object.keys(F).filter(d=>F[d]),opDe=d=>RP_DIM[d].op.find(o=>o.k===F[d]);
  const filtroTx=[...ativos.map(d=>RP_DIM[d].l+' '+opDe(d).l),st.plat?'só '+st.plat:''].filter(Boolean).join(' · ');
  const o=rpCoorte('p',IDS);
  // ---- filtros da tela: sempre abertos (04/11), com os ativos e o Limpar no topo ----
  const cnt=(d,v)=>{let k=0;cls.forEach(c=>{if(passa(c,d)&&(!v||c[d]===v))k++});return k};
  const J=curvaJanela(p1),janTx=`${mesTx(J.ini)} a ${mesTx(J.fim)}`;
  const dica={cv:`pela receita de ${janTx}`,fx:'AOV do funil na safra',nt:'pontuação do Ranking na safra'};
  const linha=d=>`<div class="rp-frow"><span class="rp-fl">${RP_DIM[d].l}<small>${dica[d]}</small></span><div class="fgrp" data-dim="${d}">`+
    [{k:'',l:d==='cv'?'Todas':'Todos'},...RP_DIM[d].op].map(op=>{const on=F[d]===op.k,q=cnt(d,op.k);
      return `<button data-v="${op.k}" aria-pressed="${on}"${q||on?'':' disabled class="rp-off"'}${op.s&&op.s!==op.l&&d==='cv'?` title="${op.s}"`:''}>${op.l} <small class="rp-q">${n(q)}</small></button>`}).join('')+`</div></div>`;
  const fil=`<section class="rp-fbox" aria-label="Filtros desta tela">
    <div class="rp-fbar"><span class="rp-ftit">${ICO_FIL}Filtros</span>
      <div class="rp-ativos">${ativos.length?ativos.map(d=>`<button type="button" class="rp-chip" data-tira="${d}" title="Tirar este filtro">${RP_DIM[d].l}: <b>${opDe(d).l}</b> ×</button>`).join('')+`<button type="button" class="rp-limpa" id="rpLimpa">Limpar</button>`:`<span class="rp-semf">Todos os afiliados da safra · ${n(cls.size)}</span>`}</div>
      <span class="rp-filtx">Safra ${dTx(p0)} a ${dTx(p1)} · Curva Afiliado por ${janTx}</span><span id="rpAlSlot"></span></div>
    <div class="rp-fpan" id="rpFpan">${linha('cv')}${linha('fx')}${linha('nt')}
      <p class="rp-fnota">O número em cada botão = afiliados com os outros filtros aplicados. Curva Afiliado = receita do funil dos 2 meses fechados + o mês da safra (S = A com 100+ pontos).</p></div></section>`;
  if(!o){el.innerHTML=fil+`<section class="pd-sec"><p class="rp-vz">Nenhum afiliado com ${filtroTx||'vendas'} na safra de ${dTx(p0)} a ${dTx(p1)}. Troque um dos filtros acima.</p></section>`;rpLigaFiltros(el,R);return}

  // ---- 1. quando o lucro vira zero ----
  const c100=v=>'US$ '+num(Math.abs(v*100),0),neg=o.luc<0,zd=o.zero;
  const zTx=zd==null?'não vira zero em 60 dias':zd===0?'prejuízo desde a venda':'vira zero no dia '+num(zd,0);
  const hero=`<p class="rp-hist">Na safra de <b>${dTx(p0)} a ${dTx(p1)}</b>${filtroTx?' ('+filtroTx+')':''}, de cada <b>US$ 100</b> vendidos no funil sobram <b>${c100(o.mg)}</b> depois do CPA, das taxas e do custo do produto. O reembolso previsto em 60 dias leva <b class="${o.re60>o.mg?'neg':''}">${c100(o.re60)}</b>.
    ${neg?`O lucro <b class="neg">${zTx}</b> e a safra fecha com <b class="neg">prejuízo de ${usd(-o.lucUsd)}</b> (${c100(o.luc)} a cada US$ 100).`:`A safra fecha com <b class="pos">lucro de ${usd(o.lucUsd)}</b> (${c100(o.luc)} a cada US$ 100).`}
    Para ter lucro em 60 dias, o reembolso precisa ficar <b>abaixo de ${rpPct(o.mg)}</b>${neg?`: faltam <b class="neg">${rpPp(o.re60-o.mg)}</b>`:`: há folga de <b class="pos">${rpPp(o.mg-o.re60)}</b>`}. A meta do ranking é ${P$(MT.re9)}.</p>`;
  const kpi=(l,v,m,c='')=>`<article class="kpi${c}"><span class="k">${l}</span><b class="v">${v}</b><span class="m">${m}</span></article>`;
  const bigs=kpi('Reembolso 60d previsto',rpPct(o.re60),`já caiu ${rpPct(o.agora)} · meta ≤ ${P$(MT.re9)}`,' total')+
    kpi('Teto para lucro > 0',rpPct(o.mg),'margem antes do reembolso (já sem CPA, taxas e custo)')+
    kpi('Lucro vira zero',zd==null?'não vira':zd===0?'dia 0':'dia '+num(zd,0),zd==null?'lucro positivo no dia 60':zd===0?'a margem já começa negativa':`depois disso, cada reembolso é prejuízo`,zd!=null?(zd<=30?' rp-bad':' rp-warn'):' rp-good')+
    kpi('Lucro previsto em 60 dias',usd(o.lucUsd),`${rpPct(o.luc)} da receita · ${usd(o.fes?o.lucUsd/o.fes:null)} por cliente`,neg?' rp-bad':' rp-good')+
    kpi('Receita da safra',usdC(o.funil),`${n(o.fes)} FEs${o.cpa!=null?' · CPA '+rpPct(o.cpa/o.funil,0)+' da receita':''}`);
  const qS={p:[p0,p1],ids:IDS};RP_REF={re60:o.re60};
  const sRe={nome:'Reembolso',cor:'var(--rp-2)',pts:o.pts,c:o,q:qS},sLu={nome:'Lucro previsto',cor:'var(--rp-1)',pts:o.pts.map(p=>[p[0],o.mg-p[1],p[2]]),c:{...o,fim:o.re60},q:qS};
  const gPrin=rpGraf('rpG0',{h:300,lbW:170,aria:'Reembolso acumulado e lucro previsto por dia desde a venda',series:[sRe,sLu],
    refs:[{v:MT.re9/100,rot:'meta do ranking '+P$(MT.re9)}],marks:[{d:zd,rot:zd===0?'prejuízo desde a venda':zd==null?null:'lucro 0 · dia '+num(zd,0)}].filter(m=>m.rot)});

  // ---- 2. onde o reembolso pesa mais: mês, semana, Curva Afiliado, ticket médio e nota ----
  const meses=MESES.filter(m=>RPA.has('m:'+m));
  const sMes=meses.map(m=>{const c=rpCoorte('m:'+m,IDS);return c&&{nome:mesTx(m)+(fimMes(m)>FIM?'*':''),pts:c.pts,c,extra:`teto ${rpPct(c.mg)} · ${usdC(c.funil)}`,q:{p:rpPP('m:'+m),ids:IDS}}}).filter(Boolean);
  const NS=[4,6,8,12].includes(rpSt.sem)?rpSt.sem:4;
  const sems=[...RPA.keys()].filter(k=>k.startsWith('w:')).map(k=>+k.slice(2)).sort((a,b)=>a-b).slice(-NS);
  const sSem=sems.map(w=>{const c=rpCoorte('w:'+w,IDS),[y,nn]=rpIsoSem(dIso(Math.max(0,w)));
    return c&&{nome:`${nn}ª sem.`+(w+6>FIM?'*':''),pts:c.pts,c,extra:`${nn}ª semana de ${y} (${dTx(Math.max(0,w))} a ${dTx(w+6)}) · teto ${rpPct(c.mg)}`,q:{p:rpPP('w:'+w),ids:IDS}}}).filter(Boolean);
  const porDim=(d,nome)=>{const idd=ids(d);return RP_DIM[d].op.map(op=>{const s=new Set();cls.forEach((c,i)=>{if(c[d]===op.k&&(!idd||idd.has(i)))s.add(i)});
    const c=s.size?rpCoorte('p',s):null;return c&&{nome:nome(op),pts:c.pts,c,extra:`${n(s.size)} afiliados · teto ${rpPct(c.mg)}`,q:{p:[p0,p1],ids:s}}}).filter(Boolean)};
  const sCv=porDim('cv',op=>op.k==='S'?'S':op.k);
  const dest=ss=>{const v=ss.filter(s=>s.c.funil>=Math.max(5000,0.02*o.funil));if(v.length<2)return '';const so=[...v].sort((a,b)=>b.c.fim-a.c.fim),pi=so[0],me=so[so.length-1];
    return `<p class="rp-dest">Maior: <b>${esc(pi.nome.replace('*',''))}</b> ${rpPct(pi.c.fim)} · menor: <b>${esc(me.nome.replace('*',''))}</b> ${rpPct(me.c.fim)} · diferença de ${rpPp(pi.c.fim-me.c.fim)}.</p>`};
  const peq=ss=>{const tot=ss.reduce((p,s)=>p+s.c.funil,0);return ss.filter(s=>s.c.funil>=0.01*tot)};   // fora: série com menos de 1% da receita do gráfico (amostra pequena)
  const card=(t,sub,ss0,id,w,ext='')=>{const ss=rpPinta(peq(ss0)),fo=ss0.length-ss.length;
    return `<article class="rp-card ${w}"><div class="rp-ch"><h4>${t}</h4><div class="rp-cht">${ext}${rpFsBtn(id,t)}</div></div><p class="rp-sub">${sub}${fo?` ${fo} com menos de 1% da receita fora do gráfico.`:''}</p>${dest(ss)}${rpGraf(id,{h:230,series:ss,aria:t})}</article>`};
  const semSel=`<select class="fsel rp-semsel" id="rpSem" aria-label="Quantas semanas mostrar">${[4,6,8,12].map(v=>`<option value="${v}"${v===NS?' selected':''}>Últimas ${v}</option>`).join('')}</select>`;
  const quebras=card('Por mês da safra','Todas as safras; * = ainda aberta.',sMes,'rpG1','w3')+card('Por semana da safra','Segunda a domingo; * = ainda aberta.',sSem,'rpG2','w3',semSel)+
    rpSecUpsell(IDS,card,[p0,p1],card('Por Curva Afiliado',`Safra do topo; Curva Afiliado por ${janTx}.`,sCv,'rpG3','w3'));

  // ---- 3. quem puxa a curva: top N melhores e piores contra a mediana ----
  const N=Math.max(1,Math.min(15,rpSt.n|0||5));
  const rk=[...P.values()].filter(a=>a.rank&&a.re60!=null&&(!IDS||IDS.has(a.i)));
  const curAf=a=>{const c=rpCoorte('p',new Set([a.i]));return c&&{nome:nomeAf(a),pts:c.pts,c,a,extra:`${n(a.fes)} FEs · nota ${a.pts==null?'—':num(a.pts,0)}`,q:{p:[p0,p1],ids:new Set([a.i]),af:true}}};
  const todos=rk.map(curAf).filter(Boolean).sort((x,y)=>x.c.fim-y.c.fim);
  let med=null;if(todos.length>=3){const md=v=>{const s=[...v].sort((a,b)=>a-b),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};
    med={nome:'Mediana',med:true,cor:'var(--fg2)',extra:`${n(todos.length)} afiliados do ranking`,pts:[0,...DCH].map(d=>[d,md(todos.map(t=>rpVal(t.pts,d))),todos.filter(t=>d<=t.c.dl).length*2>=todos.length])}}
  const mel=rpPinta(todos.slice(0,N).map(t=>({...t}))),pio=rpPinta(todos.slice(-N).reverse().map(t=>({...t})));
  const mf=med?med.pts[med.pts.length-1][1]:null,mm=s=>s.length?s.reduce((p,t)=>p+t.c.fim,0)/s.length:null;
  const topo=`<div class="rp-nbox"><label for="rpN">Quantos afiliados</label><input id="rpN" class="pd-busca" type="number" min="1" max="15" step="1" value="${N}" inputmode="numeric"></div>`;
  const quem=todos.length<2?`<p class="rp-vz">Poucos afiliados no ranking com esses filtros (mínimo de ${n(st.min)} FEs).</p>`:
    `<div class="rp-duo"><article class="rp-card"><div class="rp-ch"><h4>Os ${n(mel.length)} melhores <small>menor reembolso 60d</small></h4><div class="rp-cht">${rpFsBtn('rpG5','Os '+mel.length+' melhores contra a mediana')}</div></div><p class="rp-dest">Média deles: <b class="pos">${rpPct(mm(mel))}</b> contra a mediana de ${rpPct(mf)}.</p>${rpGraf('rpG5',{h:260,series:[...mel,med].filter(Boolean),aria:'Melhores afiliados contra a mediana'})}</article>
      <article class="rp-card"><div class="rp-ch"><h4>Os ${n(pio.length)} piores <small>maior reembolso 60d</small></h4><div class="rp-cht">${rpFsBtn('rpG6','Os '+pio.length+' piores contra a mediana')}</div></div><p class="rp-dest">Média deles: <b class="neg">${rpPct(mm(pio))}</b> contra a mediana de ${rpPct(mf)}.</p>${rpGraf('rpG6',{h:260,series:[...pio,med].filter(Boolean),aria:'Piores afiliados contra a mediana'})}</article></div>`;

  // ---- 4. afiliado × mês da safra (ou safra × afiliado) ----
  const tab=rpTabela(IDS,meses);

  el.innerHTML=fil+`
    <section class="pd-sec rp-s"><div class="pd-head"><div><h3><span class="rp-n">1</span>Quando o lucro vira zero</h3></div></div>
      ${hero}<section class="bigs rp-bigs">${bigs}</section>
      <div class="rp-ch rp-g0h">${rpLeg([{l:'Reembolso acumulado (% da receita)',cor:'var(--rp-2)'},{l:'Lucro previsto (% da receita)',cor:'var(--rp-1)'},{l:'linha cheia = 50%+ da receita já real · pontilhada = previsto · ● = dia 60',cls:'tx'}])}<div class="rp-cht">${rpFsBtn('rpG0','Reembolso × lucro previsto, dia a dia')}</div></div>${gPrin}
      <p class="rp-nota">Lucro = receita − CPA − taxas − custo do produto − reembolso (sem call center, como a nota do ranking). O lucro cai na mesma medida em que o reembolso sobe; ele vira zero quando o reembolso alcança o teto (${rpPct(o.mg)}).</p></section>
    <section class="pd-sec rp-s"><div class="pd-head"><div><h3><span class="rp-n">2</span>Onde o reembolso pesa mais</h3><p>Curva de reembolso acumulado por safra. <b>Clique numa linha para ver o porquê</b> (por afiliado, produto, caminho no funil e valor do upsell). Linha cheia = a maior parte (50%+) da receita já tem aquela idade; pontilhada = previsto até o dia 60 (●). Na frente de cada curva, o reembolso de 60 dias. Cor forte = menor reembolso; cor fria = maior. Passe o mouse para ver cada dia.</p></div></div>
      <div class="rp-quad">${quebras}</div></section>
    <section class="pd-sec rp-s"><div class="pd-head"><div><h3><span class="rp-n">3</span>Quem puxa a curva</h3><p>Afiliados do ranking (${n(st.min)}+ FEs) na safra do topo, pelo reembolso 60d. Cada um com a própria curva; em cinza, a mediana de todos.</p></div><div class="pd-tools">${topo}</div></div>
      ${quem}</section>
    <section class="pd-sec rp-s" id="rpTabS">${tab}</section>
    <p class="rp-nota rp-como"><b>Como calculamos.</b> Reembolso = valor devolvido + taxas de alerta e disputa, acumulado por dia desde a venda. A curva é da safra inteira: em cada dia, a venda que já tem aquela idade entra com o real; a que não tem, com o que já caiu + a parte da curva que falta até aquele dia (pela curva (dia/60)^${num(kEq(),2)}, ajustada à mediana) × a previsão de 10 dias (reembolso de 10 dias × fator do afiliado). É a mesma conta da nota do Ranking. Teto = (líquido − custo + reembolso já caído) ÷ receita. CPA dos pedidos. Filtros de ticket: abaixo de US$ 370, 370–390, 390–410 e US$ 410+ (a meta de AOV do ranking); de nota, de 20 em 20 pontos. Produto e caminho no funil: pelos pedidos, com o upsell na sessão do FE de origem; o que falta cair vem da taxa de 60 dias do próprio grupo nas vendas com 60+ dias.</p>`;
  RPG.forEach((c,id)=>rpDesenha(id));
  rpLigaFiltros(el,R);
  {const A=rpAlertas(o,zd),slot=el.querySelector('#rpAlSlot'),nA=A.filter(a=>a.n>=2&&!a.bom).length;
   if(slot){slot.innerHTML=`<button type="button" class="rp-alb${A.some(a=>a.n>=3)?' alto':nA?' medio':''}" title="O que chama atenção nesta safra">${ICO_AL}Alertas <b>${n(A.length)}</b></button>`;slot.firstChild.onclick=()=>rpAlertasAbre(A)}
   const ch=[p0,p1,st.plat,st.min,typeof AGRUPA!=='undefined'?AGRUPA:'',JSON.stringify(rpSt.f)].join('|'),pronto=typeof PED==='undefined'||PED;
   if(pronto&&(rpSt.auto||ch!==rpSt.alCh)){rpSt.auto=false;rpSt.alCh=ch;if(A.length)setTimeout(()=>{if(st.pg==='reemb')rpAlertasAbre(A)},350)}}
  const ni=el.querySelector('#rpN');if(ni)ni.onchange=()=>{const v=Math.max(1,Math.min(15,Math.round(+ni.value)||5));rpSt.n=v;renderReemb(R)};
  const ss=el.querySelector('#rpSem');if(ss)ss.onchange=()=>{rpSt.sem=+ss.value;renderReemb(R)};
  el.querySelectorAll('[data-fs]').forEach(b=>b.onclick=()=>rpTelaCheia(b.dataset.fs,b.dataset.fst));
  rpLigaTabela(el,R);
}
function rpLigaFiltros(el,R){
  el.querySelectorAll('.rp-fpan .fgrp[data-dim] button').forEach(b=>b.onclick=()=>{rpSt.f[b.parentElement.dataset.dim]=b.dataset.v;renderReemb(R)});
  el.querySelectorAll('[data-tira]').forEach(b=>b.onclick=()=>{rpSt.f[b.dataset.tira]='';renderReemb(R)});
  const lp=el.querySelector('#rpLimpa');if(lp)lp.onclick=()=>{for(const d in rpSt.f)rpSt.f[d]='';renderReemb(R)};
}

// ---- tabela: afiliado › mês da safra (ou mês › afiliado), com Curva Afiliado, nota e reembolso acumulado por dia ----
// barra do lucro líquido: a partir do meio, verde para a direita (lucro), vermelha para a esquerda (prejuízo); meia barra = 20% (acima disso, cheia)
const rpBarra=v=>{if(v==null||!isFinite(v))return '';const w=Math.min(50,50*Math.abs(v)/0.2);return `<span class="rp-bar" aria-hidden="true"><i class="${v<0?'n':'p'}" style="width:${w.toFixed(1)}%"></i></span>`};
// CPA e CPA L0 (% da receita) com a dica da diferença; o ideal = CPA + lucro líquido previsto (zera o lucro)
function rpCpaTds(c){if(c.cpa==null)return '<td>…</td><td>…</td>';const r={cpa:c.cpa,ideal:c.cpa+c.lucUsd,funil:c.funil,fes:c.fes},k=regTip(lsDifTip(r,'pct'));
  const span=v=>`<span class="ls-cpa" data-tip="${k}">${rpPct(v/c.funil)}</span>`;
  return `<td class="rp-cpa ${r.cpa>r.ideal?'neg':'pos'}">${span(r.cpa)}</td><td>${span(r.ideal)}</td>`}
function rpTabela(IDS,meses){
  const T=rpCalc('t'),P=rpCalc('p'),[p0,p1]=periodo(),af=rpSt.modo==='af',q=rpSt.busca.trim().toLowerCase();
  const lin=(c,rot,extra)=>c&&{c,rot,...extra};
  const cor=(v,d)=>{if(v==null)return '';const cv=reta(d,CURVA_MED)/100,me=MT.re9/100*cv,li=MT.re7/100*cv;return v<=me?'g':v<=li?'y':'r'};
  const mesFech=m=>fimMes(m)<=FIM-60,safraTop=`safra do topo (${dTx(p0)} a ${dTx(p1)})`;
  const grupos=[];
  if(af){const lista=[...RPA.get('t')].filter(([i,x])=>x.fu>0&&(!IDS||IDS.has(i))).map(([i])=>T.get(i)).filter(Boolean).sort((x,y)=>y.funil-x.funil);
    for(const a of lista){const nm=nomeAf(a);if(q&&!nm.toLowerCase().includes(q)&&!String(a.af).toLowerCase().includes(q))continue;
      const s=new Set([a.i]);
      // sem venda na safra do topo: mostra (esmaecidas) a Curva e a nota da safra mais recente em que ele vendeu
      let na=P.get(a.i),fech=p1<=FIM-60,ctx='Nota na '+safraTop,fb=false;
      if(!na||na.pts==null)for(const m of [...meses].reverse()){const x=rpCalc('m:'+m).get(a.i);
        if(x&&x.pts!=null){na=x;fech=mesFech(m);ctx=`Sem venda na ${safraTop}: nota da safra ${mesTx(m)}`;fb=true;break}}
      grupos.push({k:'a'+a.i,p:lin(rpCoorte('t',s),nm,{a,na,fech,ctx,fb}),
        f:[...meses].reverse().map(m=>lin(rpCoorte('m:'+m,s),mesTx(m)+(fimMes(m)>FIM?' (aberta)':''),{srt:m,na:rpCalc('m:'+m).get(a.i),fech:mesFech(m),ctx:'Nota na safra '+mesTx(m)})).filter(Boolean)})}}
  else{for(const m of [...meses].reverse()){const acc=RPA.get('m:'+m),M=rpCalc('m:'+m);
      const fs=[...acc].filter(([i,x])=>x.fu>0&&(!IDS||IDS.has(i))).map(([i])=>M.get(i)).filter(Boolean).sort((x,y)=>y.funil-x.funil)
        .filter(a=>!q||nomeAf(a).toLowerCase().includes(q)).map(a=>lin(rpCoorte('m:'+m,new Set([a.i])),nomeAf(a),{a,na:a,fech:mesFech(m),ctx:'Nota na safra '+mesTx(m)})).filter(Boolean);
      const p=lin(rpCoorte('m:'+m,IDS),mesTx(m)+(fimMes(m)>FIM?' (aberta)':''),{srt:m});if(p&&(fs.length||!q))grupos.push({k:'m'+m,p,f:fs})}}
  const O=rpSt.ord;if(O&&RP_ORD[O.k]){const gv=RP_ORD[O.k],cmp=(x,y)=>{const a=gv(x),b=gv(y);if(a==null&&b==null)return 0;if(a==null)return 1;if(b==null)return -1;
    return (typeof a==='string'||typeof b==='string'?String(a).localeCompare(String(b),'pt-BR'):a-b)*O.d};grupos.sort((g,h)=>cmp(g.p,h.p));grupos.forEach(g=>g.f.sort(cmp))}
  rpTabela.ult=grupos;
  const th=(k,l,cls='',tit='')=>`<th data-ord="${k}" class="ord${cls?' '+cls:''}" tabindex="0" aria-sort="${O&&O.k===k?(O.d>0?'ascending':'descending'):'none'}"${tit?` title="${tit}"`:''}>${l}</th>`;
  let nk=0;
  const cel=(l,filho)=>{const c=l.c,nm=l.a?`<span class="ls-nm" data-af="${afId(l.a)}" tabindex="0">${l.a.S?SB:''}<span class="nmt">${esc(l.rot)}</span></span>`:esc(l.rot);
    let cvH='',ntH='';if(l.na){const cvv=l.na.S?'S':l.na.curva,fb=l.fb?' rp-fb':'';cvH=`<span class="tag ${cvv}${fb}" title="${l.fb?esc(l.ctx).replace('nota','Curva'):'Curva Afiliado '+cvv}">${cvv}</span>`;
      if(l.na.pts!=null){const k='f'+(++nk);RP_FICHA.set(k,{a:l.na,fechada:l.fech,ctx:l.ctx});ntH=`<button type="button" class="rp-nt${fb}" data-ficha="${k}" title="${esc(l.ctx)} · clique para ver a conta da nota">${sc(l.na.pts)}</button>`}}
    return `<td class="tl rp-nm">${filho?'':`<button type="button" class="rp-tg" aria-label="Abrir">›</button>`}${nm}</td><td class="rp-cc">${cvH}</td><td class="rp-cc">${ntH}</td><td>${n(c.fes)}</td><td>${usdC(c.funil)}</td>
      ${rpCpaTds(c)}<td>${rpPct(c.custo/c.funil)}</td>
      ${RP_TAB.map(d=>{const v=rpVal(c.pts,d),pv=d>c.dl;return `<td class="hc ${cor(v,d)}${pv?' pv':''}" title="${pv?'previsto':'real'}">${rpPct(v)}</td>`}).join('')}
      <td class="hc ${cor(c.fim,60)}${c.dl<60?' pv':''}" title="${c.dl<60?'previsto':'real'}"><b>${rpPct(c.fim)}</b></td><td class="rp-rus" title="${c.dl<60?`Já caiu ${usd(c.d60)} · previsto até o dia 60 ${usd(Math.max(0,c.fim*c.funil-c.d60))}`:'Real (60+ dias)'}"><b>${usdC(c.fim*c.funil)}</b></td><td class="rp-lq ${c.luc<0?'neg':'pos'}">${rpBarra(c.luc)}<b>${rpPct(c.luc)}</b></td>`};
  const corpo=grupos.map(g=>{const ab=rpSt.abertos.has(g.k)||!!q&&!af;
    return `<tr class="rp-pai${ab?' ab':''}" data-k="${g.k}">${cel(g.p,false)}</tr>`+g.f.map(l=>`<tr class="rp-fi" data-p="${g.k}"${ab?'':' hidden'}>${cel(l,true)}</tr>`).join('')}).join('');
  return `<div class="pd-head"><div><h3><span class="rp-n">4</span>Reembolso por ${af?'afiliado e safra':'safra e afiliado'} <span class="pd-cnt">${n(grupos.length)}</span></h3>
      <p>Clique na linha para abrir ${af?'as safras do afiliado':'os afiliados da safra'}; clique na nota para ver a conta; clique no cabeçalho para ordenar (as linhas de dentro seguem a mesma ordem). % da receita do funil. Reembolso acumulado até o dia N: fundo cheio = real, <span class="rp-hach">hachurado</span> = previsto (ainda não aconteceu). Cor pela meta do ranking proporcional ao dia (verde até ${P$(MT.re9)} no dia 60, amarelo até ${P$(MT.re7)}). Nota e Curva Afiliado: ${af?'na linha do afiliado, da safra do topo; nas safras, a de cada mês':'a de cada mês'}. Lucro líquido = depois de CPA, taxas, custo e reembolso 60d, sem call center.</p></div>
    <div class="pd-tools"><div class="fgrp" id="rpModo" aria-label="Ordem da tabela"><button data-v="af" aria-pressed="${af}">Afiliado › Safra</button><button data-v="safra" aria-pressed="${!af}">Safra › Afiliado</button></div>
      <button type="button" class="ls-chip" id="rpAbre">${grupos.length&&grupos.every(g=>rpSt.abertos.has(g.k))?'Fechar todos':'Abrir todos'}</button>
      <input class="pd-busca" id="rpBusca" type="search" placeholder="Buscar afiliado" aria-label="Buscar afiliado" value="${esc(rpSt.busca)}">
      <button type="button" class="dt-btn-excel" id="rpXls" title="Exportar para Excel (CSV)" aria-label="Exportar">${ICO.xls}</button></div></div>
    <div class="rp-tw"><table class="rp-t"><thead><tr>${th('nome',af?'Afiliado / safra':'Safra / afiliado','tl')}${th('cv','Curva','rp-cc','Curva Afiliado (A/B/C/S)')}${th('nota','Nota','rp-cc','Pontuação do Ranking')}${th('fes','FEs')}${th('funil','Receita')}${th('cpa','CPA','','CPA pago ÷ receita do funil. Vermelho: acima do CPA L0; verde: abaixo. Passe o mouse para ver a diferença.')}${th('ideal','CPA L0','',esc(CPA_IDEAL_INFO)+' Aqui, em % da receita do funil.')}${th('custo','Custo','','Custo do produto (Full Stack) ÷ receita')}
      ${RP_TAB.map(d=>th('d'+d,'D'+d)).join('')}${th('fim','60d','','Reembolso total de 60 dias (real ou previsto)')}${th('rus','Reemb. US$','','Reembolso de 60 dias em US$ (valor devolvido + taxas de alerta e disputa): o que já caiu + o previsto até o dia 60. Clique para ordenar do maior para o menor; passe o mouse para ver quanto já caiu.')}${th('luc','Lucro líquido','rp-lqh','Lucro líquido previsto em % da receita: (líquido − custo − reembolso que ainda vai cair) ÷ receita. A barra vai para a direita (verde) quando sobra lucro e para a esquerda (vermelho) quando dá prejuízo; meia barra = 20% da receita (acima disso, cheia).')}</tr></thead>
      <tbody>${corpo||`<tr><td class="tl" colspan="${RP_TAB.length+11}">Nenhum afiliado com esses filtros.</td></tr>`}</tbody></table></div>`;
}
function rpLigaTabela(el,R){
  const s=el.querySelector('#rpTabS');if(!s)return;const meses=MESES.filter(m=>RPA.has('m:'+m));
  const re=()=>{const foco=document.activeElement&&document.activeElement.id==='rpBusca';s.innerHTML=rpTabela(RP_IDS,meses);rpLigaTabela(el,R);
    if(foco){const b=s.querySelector('#rpBusca');b.focus();b.setSelectionRange(b.value.length,b.value.length)}};
  s.querySelectorAll('#rpModo button').forEach(b=>b.onclick=()=>{rpSt.modo=b.dataset.v;rpSt.abertos.clear();rpSt.ord=null;re()});
  s.querySelectorAll('th[data-ord]').forEach(h=>{const go=()=>{const k=h.dataset.ord,O=rpSt.ord;rpSt.ord={k,d:O&&O.k===k?-O.d:RP_TXT.has(k)?1:-1};re()};
    h.onclick=go;h.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}}});
  s.querySelector('#rpAbre').onclick=()=>{const g=rpTabela.ult||[],todos=g.length&&g.every(x=>rpSt.abertos.has(x.k));rpSt.abertos.clear();if(!todos)g.forEach(x=>rpSt.abertos.add(x.k));re()};
  const b=s.querySelector('#rpBusca');let t=null;b.oninput=()=>{clearTimeout(t);t=setTimeout(()=>{rpSt.busca=b.value;re()},200)};
  s.querySelectorAll('[data-ficha]').forEach(x=>x.onclick=e=>{e.stopPropagation();rpAbreFicha(x.dataset.ficha)});
  s.querySelectorAll('tr.rp-pai').forEach(tr=>tr.onclick=e=>{if(e.target.closest('[data-af],[data-ficha]'))return;const k=tr.dataset.k,ab=!rpSt.abertos.has(k);
    ab?rpSt.abertos.add(k):rpSt.abertos.delete(k);tr.classList.toggle('ab',ab);s.querySelectorAll(`tr.rp-fi[data-p="${k}"]`).forEach(x=>x.hidden=!ab)});
  s.querySelector('#rpXls').onclick=()=>{const L=[[rpSt.modo==='af'?'Afiliado':'Safra',rpSt.modo==='af'?'Safra':'Afiliado','Curva Afiliado','Nota','FEs','Receita US$','CPA %','CPA L0 %','Custo %',...RP_TAB.map(d=>'Reemb. D'+d+' %'),'Reemb. 60d %','Reemb. 60d US$','Já caiu US$','Real ou previsto','Lucro líquido %']];
    const f=v=>v==null||!isFinite(v)?'':(v*100).toFixed(2).replace('.',','),row=(a,b,l)=>{const c=l.c,na=l.na;return [a,b,na?(na.S?'S':na.curva):'',na&&na.pts!=null?na.pts.toFixed(1).replace('.',','):'',c.fes,c.funil.toFixed(2).replace('.',','),c.cpa==null?'':f(c.cpa/c.funil),c.cpa==null?'':f(c.cpa/c.funil+c.luc),f(c.custo/c.funil),...RP_TAB.map(d=>f(rpVal(c.pts,d))),f(c.fim),(c.fim*c.funil).toFixed(2).replace('.',','),c.d60.toFixed(2).replace('.',','),c.dl>=60?'real':'previsto',f(c.luc)]};
    (rpTabela.ult||[]).forEach(g=>{L.push(row(g.p.rot,'Total',g.p));g.f.forEach(l=>L.push(row(g.p.rot,l.rot,l)))});
    download('reembolso_por_'+(rpSt.modo==='af'?'afiliado_safra':'safra_afiliado')+'.csv',L)};
}

// navegação: a tela esconde as abas Ranking/Premissas e os big numbers do ranking; o menu marca o item da vez
const _paginaRp=pagina;
pagina=function(p){rpFechaFicha();const ant=st.pg;_paginaRp(p);const rp=st.pg==='reemb';if(rp&&ant!=='reemb'&&!(ant==='af'&&st.voltar==='reemb'))rpSt.auto=true;
  if(rp||(st.pg==='af'&&st.voltar==='reemb')){const b=document.getElementById('bigs');if(b)b.hidden=true;root.querySelectorAll('.subtabs').forEach(x=>x.hidden=true)}
  const vgp=p=>p==='lista'||p==='visao';
  const grupo=st.pg==='af'?(vgp(st.voltar)?'lista':st.voltar==='reemb'?'reemb':'ranking'):vgp(st.pg)?'lista':rp?'reemb':'ranking';
  root.querySelectorAll('.side-item[data-pg]').forEach(x=>x.classList.toggle('is-active',x.dataset.pg===grupo));
  if(rp&&st.R)renderReemb(st.R)};
const _renderRp=render;
render=function(){_renderRp.apply(this,arguments);if(st.pg==='reemb'&&st.R)renderReemb(st.R)};

/* ---------- filtros flutuantes (Visão Geral, Ranking, Reembolso Prev.) ----------
   Quando a barra de filtros sai da tela, um selo discreto no alto do conteúdo mostra os filtros aplicados (os que fogem
   do padrão em destaque; alerta da Visão Geral e filtros do Reembolso Prev. com "×" para tirar). "Alterar" abre a própria
   barra de filtros num painel flutuante: os mesmos botões, sem lógica duplicada; ela volta ao lugar ao fechar. */
(function(){
  const RT=typeof root!=='undefined'?root:document;
  const onX=(t,ev,fn,o)=>typeof _on==='function'?_on(t,ev,fn,o):t.addEventListener(ev,fn,o);
  const bar=RT.querySelector('.af-filtros'),af=RT.querySelector('.af');if(!bar||!af)return;
  const PAD={per:'30d',agr:'parceiro',plat:'',min:30};
  const ICO_F='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>';
  const sel=document.createElement('div');sel.className='af-flt';sel.hidden=true;
  const pop=document.createElement('div');pop.className='af-flt-pop';pop.hidden=true;pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Filtros');
  const ph=document.createElement('div');ph.className='af-flt-ph';
  af.appendChild(sel);af.appendChild(pop);
  let aberto=false,chave='';
  const topo=()=>parseFloat(getComputedStyle(af).getPropertyValue('--af-topo'))||0;
  const fora=()=>{const r=(aberto?ph:bar).getBoundingClientRect();return r.bottom<topo()+2};
  const apertado=s=>{const b=bar.querySelector(s+' button[aria-pressed="true"]');return b?b.textContent.trim():''};
  function chips(){const C=[];
    C.push({t:st.per==='mes'&&st.mes?'Safra '+mesTx(st.mes):apertado('#fPer')||'Período',nd:st.per!==PAD.per});
    if(typeof AGRUPA!=='undefined')C.push({t:AGRUPA==='conta'?'Por conta':'Por parceiro',nd:AGRUPA!==PAD.agr});
    C.push({t:st.plat||'Todas as plataformas',nd:st.plat!==PAD.plat});
    C.push({t:`Ranking ${st.min}+ FEs`,nd:+st.min!==PAD.min});
    if(st.pg==='lista'&&lsSt.filtro){const b=RT.querySelector(`[data-al="${lsSt.filtro}"] .t`);C.push({t:'Alerta: '+(b?b.textContent.trim():lsSt.filtro),nd:true,x:'ls'})}
    if(st.pg==='reemb')for(const d in rpSt.f){const v=rpSt.f[d];if(!v)continue;
      const g=RT.querySelector(`.rp-fpan .fgrp[data-dim="${d}"]`),b=g&&g.querySelector(`button[data-v="${v}"]`),l=g&&g.parentElement.querySelector('.rp-fl');
      const vt=b?[...b.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():v,lt=l?l.firstChild.textContent.trim():'';
      C.push({t:lt?lt+': '+vt:vt,nd:true,x:'rp:'+d})}
    return C}
  // embaixo, centralizado no conteúdo: não cobre o cabeçalho fixo das tabelas; o painel abre para cima
  function posiciona(){const r=af.getBoundingClientRect(),cx=Math.round(Math.min(Math.max(r.left+r.width/2,180),innerWidth-180));
    sel.style.left=cx+'px';pop.style.left=cx+'px';pop.style.bottom=(16+sel.offsetHeight+8)+'px';pop.style.maxWidth=Math.max(280,Math.min(r.width-32,1180))+'px'}
  function atualiza(){if(!sel.isConnected)return;
    if(!aberto&&!fora()){sel.hidden=true;chave='';return}
    const C=chips(),k=JSON.stringify(C)+aberto;
    if(k!==chave){chave=k;
      sel.innerHTML=`<span class="i" title="Filtros aplicados">${ICO_F}</span>`+C.map(c=>`<span class="c${c.nd?' nd':''}">${esc(c.t)}${c.x?`<button type="button" class="x" data-x="${c.x}" aria-label="Tirar o filtro ${esc(c.t)}" title="Tirar este filtro">×</button>`:''}</span>`).join('<span class="s" aria-hidden="true">·</span>')+
        `<button type="button" class="alt" aria-expanded="${aberto}">${aberto?'Fechar':'Alterar'}</button>`}
    sel.hidden=false;posiciona()}
  function abre(){if(aberto)return;aberto=true;ph.style.height=bar.offsetHeight+'px';bar.replaceWith(ph);pop.appendChild(bar);pop.hidden=false;atualiza()}
  function fecha(){if(!aberto)return;aberto=false;pop.hidden=true;ph.replaceWith(bar);atualiza()}
  sel.addEventListener('click',e=>{const x=e.target.closest('.x');
    if(x){const k=x.dataset.x;if(k==='ls'){lsSt.filtro=null;if(st.R)renderLista(st.R)}else if(k.startsWith('rp:')){rpSt.f[k.slice(3)]='';if(st.R)renderReemb(st.R)}
      requestAnimationFrame(atualiza);return}
    if(e.target.closest('.alt'))aberto?fecha():abre()});
  onX(document,'click',e=>{if(aberto&&!pop.contains(e.target)&&!sel.contains(e.target)&&e.target.isConnected)fecha()},true);
  onX(document,'keydown',e=>{if(e.key==='Escape'&&aberto)fecha()});
  onX(document,'scroll',()=>{if(aberto&&!fora())fecha();else atualiza()},{capture:true,passive:true});
  onX(window,'resize',()=>{chave='';atualiza()});
  af.addEventListener('click',()=>requestAnimationFrame(atualiza));
  const _rF=render;render=function(){_rF.apply(this,arguments);requestAnimationFrame(atualiza)};
  const _pF=pagina;pagina=function(p){_pF(p);requestAnimationFrame(atualiza)};
})();


const marcaAgr=()=>root.querySelectorAll('#fAgr button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===AGRUPA)));
root.querySelectorAll('#fAgr button').forEach(b=>b.onclick=()=>{reagrupa(b.dataset.v);marcaAgr()});marcaAgr();
// premissas: quem não é admin vê e simula, mas não salva para todos
const _renderPremissasOrig=renderPremissas;
renderPremissas=function(){_renderPremissasOrig.apply(this,arguments);const el=document.getElementById('premissas');
  if(el&&!el.querySelector('.pq-aviso'))el.insertAdjacentHTML('afterbegin',opts.podeEditar
    ?'<div class="pq-aviso">As mudanças aqui valem para todos (ficam salvas no dash). Só administradores mudam.</div>'
    :'<div class="pq-aviso">Só administradores mudam as premissas. Suas mudanças aqui são uma simulação: valem só nesta tela e somem ao sair.</div>')};
const _paginaOrig=pagina;
pagina=function(p){_paginaOrig(p);root.querySelector('.af').classList.toggle('em-af',st.pg==='af')};
// altura do topo fixo do dash → cabeçalhos das tabelas grudam logo abaixo dele (muda no celular)
const ajustaTopo=()=>{const t=document.querySelector('.top'),af=root.querySelector('.af');if(!af)return;
  const fixo=t&&getComputedStyle(t).position==='sticky';af.style.setProperty('--af-topo',(fixo?Math.round(t.getBoundingClientRect().height):0)+'px')};
ajustaTopo();_on(window,'resize',ajustaTopo);
render();   // de novo, já com os avisos das Premissas
// tela de entrada: Visão Geral (lista; subaba visao) ou Reembolso Prev. (reemb); o padrão é o Ranking
if(['lista','visao','reemb','premissas'].includes(opts.pagina))pagina(opts.pagina);

return {destroy(){_offs.forEach(f=>f());clearTimeout(_salvaT);['espBar','pdToast'].forEach(id=>{const b=document.getElementById(id);if(b)b.remove()});
  ['rpFull','rpDrill','rpAl','rpBack'].forEach(id=>{const b=document.getElementById(id);if(b)b.remove()});
  document.body.classList.remove('modal-on','pg-pq','pd-cheia','dt-resizing');root.innerHTML=''}};
}
window.NSAfRanking={montar};
})();
