/* Análise › Simulador de Funil — motor da tela (JS puro, sem React).
 * Montado por funnel-sim.jsx: window.NSFunnelSim.montar(container, { dados, api, user }) → { destroy }.
 * dados = GET /api/metrics/funnel-sim (base diária por plataforma × família do FE × dia do FE × etapa).
 * Tudo é calculado no navegador: base, plataforma, período, metas e etapas mudam sem voltar ao servidor.
 * Regras e fórmulas: docs/kb/simulador-funil.md. Estilos: public/styles/funnel-sim.css (escopo .fsim).
 */
(function () {
  'use strict';

  /* ---------- formatação ---------- */
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd = (v) => (v < -0.5 ? '−' : '') + 'US$ ' + nf0.format(Math.abs(Math.round(v)));
  const usd2 = (v) => (v < -0.005 ? '−' : '') + 'US$ ' + nf2.format(Math.abs(v));
  const usdK = (v) => { const a = Math.abs(v); const s = v < 0 ? '−' : ''; if (a >= 1e6) return s + 'US$ ' + nf2.format(a / 1e6) + ' mi'; if (a >= 1e4) return s + 'US$ ' + nf1.format(a / 1e3) + ' mil'; return s + 'US$ ' + nf0.format(a); };
  const pct = (v) => (v < -0.05 ? '−' : '') + nf1.format(Math.abs(v)) + '%';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parseNum = (s) => { if (s == null) return null; s = String(s).trim().replace(/\s|US\$|\$|%/g, ''); if (!s) return null; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const v = Number(s); return isFinite(v) ? v : null; };
  const inFmt = (v, dec) => (v == null ? '' : (dec ? nf2 : nf0).format(v).replace(/,00$/, '').replace(/(,\d)0$/, '$1'));
  const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = (d) => d.toISOString().slice(0, 10);
  const addD = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const br = (s) => { const [, m, d] = s.split('-'); return d + '/' + m; };
  const brY = (s) => { const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y; };
  const r2 = (v) => Math.round(v * 100) / 100;
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem('ns-funnel-sim.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('ns-funnel-sim.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
  };

  /* ---------- ícones (traços do Lucide) ---------- */
  const P = {
    rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    folder: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    pkg: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    cal: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  };
  const ico = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

  /* ---------- definições ---------- */
  const ETAPA_INFO = {
    FE: { nome: 'Front-end', tipo: 'fe' }, Bump: { nome: 'Order bump', tipo: 'ob' },
    OTO1: { nome: 'OTO1', tipo: 'up' }, OTO2: { nome: 'OTO2', tipo: 'up' }, OTO3: { nome: 'OTO3', tipo: 'up' },
    DS1: { nome: 'DS1', tipo: 'ds' }, DS2: { nome: 'DS2', tipo: 'ds' }, DS3: { nome: 'DS3', tipo: 'ds' },
  };
  const PADRAO = ['FE', 'OTO1', 'OTO2', 'OTO3', 'DS1', 'DS2', 'DS3'];
  const TIPOS = { fe: 'FE', up: 'UP', ds: 'DS', ob: 'BUMP', info: 'INFO' };
  // ruim = subir é ruim (cor da diferença)
  const PARAMS = [
    { k: 'vendas', nome: 'Vendas FE', un: 'qtd', dec: 0, step: 100, ruim: false },
    { k: 'reemb', nome: 'Reembolso', tag: 'prev. D60', un: '%', dec: 1, step: 0.1, ruim: true },
    { k: 'cb', nome: 'Chargeback', tag: 'prev. D60', un: '%', dec: 1, step: 0.1, ruim: true },
    { k: 'alerta', nome: 'Alertas', tag: 'prev. D60', un: '%', dec: 1, step: 0.1, ruim: true },
    { k: 'taxas', nome: 'Taxas', tag: 'alerta + disputa', un: '%', dec: 1, step: 0.1, ruim: true },
    { k: 'dev', nome: 'Devol. Total', tag: 'soma', un: '%', dec: 1, calc: true, ruim: true },
    { k: 'fee', nome: 'Taxa da plataforma', un: '%', dec: 1, step: 0.1, ruim: true },
    { k: 'ff', nome: 'Fulfillment', un: '%', dec: 1, step: 0.1, ruim: true },
    { k: 'cc', nome: 'Lucro call center', un: '%', dec: 1, step: 0.1, ruim: false },
  ];
  const PK = PARAMS.filter((p) => !p.calc).map((p) => p.k);
  const DEVK = ['reemb', 'cb', 'alerta', 'taxas'];
  const PADRAO_P = { fee: 7.9, ff: 9 }; // valem quando a fonte não traz o dado
  const LINHAS = [['Receita bruta', 'rb', 'sub', 1], ['CPA', 'cpa', 'ind', -1], ['Receita após CPA', 'aposCpa', 'sub', 1], ['Taxa plataforma', 'fee', 'ind', -1], ['Fulfillment', 'ff', 'ind', -1],
    ['Pré-devolução', 'antesDev', 'sub', 1], ['Reembolso', 'reemb', 'ind', -1], ['Chargeback', 'cb', 'ind', -1], ['Alertas', 'alerta', 'ind', -1], ['Taxas', 'taxas', 'ind', -1],
    ['Lucro do funil', 'funil', 'sub', 1], ['Lucro call center', 'cc', 'ind', 1]];

  /** Conta do funil: a mesma para o Real e para a Simulação (docs/kb/simulador-funil.md). */
  function calcula(Pm, etapas) {
    const fes = Pm.vendas || 0, ffp = (Pm.ff || 0) / 100; let rb = 0, vendas = 0, cpa = 0; const linhas = [];
    for (const e of etapas) {
      const v = fes * (e.conv || 0) / 100; const r = v * (e.preco || 0); const c = v * (e.cpa || 0); const f = r * ffp;
      rb += r; vendas += v; cpa += c; linhas.push({ id: e.id, vendas: v, rb: r, cpa: c, ff: f, total: r - c - f });
    }
    const fee = rb * (Pm.fee || 0) / 100, ff = rb * ffp;
    const reemb = rb * (Pm.reemb || 0) / 100, cb = rb * (Pm.cb || 0) / 100, alerta = rb * (Pm.alerta || 0) / 100, taxas = rb * (Pm.taxas || 0) / 100;
    const dev = reemb + cb + alerta + taxas, aposCpa = rb - cpa, antesDev = aposCpa - fee - ff, funil = antesDev - dev, cc = rb * (Pm.cc || 0) / 100, final = funil + cc;
    return { fes, rb, vendas, cpa, linhas, aposCpa, fee, ff, antesDev, reemb, cb, alerta, taxas, dev, funil, cc, final, aov: fes ? rb / fes : 0 };
  }

  function montar(box, opts) {
    const DADOS = opts.dados; const api = opts.api || {}; const user = opts.user || {};
    const C = {}; DADOS.campos.slice(4).forEach((c, i) => { C[c] = i; });
    const N = DADOS.campos.length - 4;
    const st = { produto: null, plat: 'todas', periodo: { preset: '30d', de: null, ate: null }, sim: {}, etapas: [], atual: null, base: null, ver: 'sim' };
    let REAL = null, R_REAL = null, R_SIM = null, SALVAS = [], confirmaId = null, toastT = null, toastUndo = null, seq = 0, dpSel = null, dpMes = null;
    const ultimo = {};
    const $ = (s) => box.querySelector(s);
    const $$ = (s) => [...box.querySelectorAll(s)];

    box.innerHTML = `<div class="fsim">
      <div class="fs-filters" role="toolbar" aria-label="Filtros do simulador">
        <span class="f-label">Base do funil</span>
        <div class="fs-popw"><button class="select-btn" data-id="btnProduto" type="button" aria-haspopup="true">${ico('pkg')}<span data-id="lblProduto">—</span>${ico('down')}</button><div class="fs-pop" data-id="popProduto" hidden></div></div>
        <span class="fs-sep"></span><span class="f-label">Plataforma</span>
        <div class="fs-popw"><button class="select-btn" data-id="btnPlat" type="button" aria-haspopup="true">${ico('plug')}<span data-id="lblPlat">JVZoo + Vupim</span>${ico('down')}</button><div class="fs-pop" data-id="popPlat" hidden style="min-width:180px"></div></div>
        <span class="fs-sep"></span><span class="f-label">Período</span>
        <div class="fs-popw"><button class="select-btn" data-id="btnPeriodo" type="button" aria-haspopup="true">${ico('cal')}<span data-id="lblPeriodo">Últimos 30 dias</span>${ico('down')}</button><div class="fs-pop" data-id="popPeriodo" hidden></div></div>
        <span class="date-chip" data-id="chipDatas"></span>
        <span class="fs-spacer"></span>
        <span class="fs-info"><span class="fs-dot"></span><span data-id="dataInfo"></span></span>
        <div class="fs-popw"><button class="fs-btn sm" data-id="btnLista" type="button" aria-haspopup="true">${ico('folder')}Análises salvas <span class="fs-count" data-id="nSalvas">0</span></button><div class="fs-pop right fs-listpop" data-id="popLista" hidden></div></div>
        <button class="fs-btn sm ghost" data-id="rstTudo" type="button">${ico('eraser')}Voltar tudo ao real</button>
      </div>
      <div class="fs-body">
        <div class="fs-blocks">
          <div class="fs-head"><div><div class="fs-eyebrow">Análise · simulador de funil</div><h2>A oferta fecha <em>no azul?</em></h2>
            <p class="fs-lead">Escolha uma base para puxar o real (opcional) e digite as metas nos campos. Campo vazio usa o real, mostrado em cinza. O resultado ao lado recalcula a cada número.</p></div><div data-id="loadedBox"></div></div>
          <section class="fs-panel" aria-labelledby="fsTParams">
            <div class="fs-ph"><div><h3 class="fs-pt" id="fsTParams"><span class="fs-step">1</span>Parâmetros gerais</h3><div class="fs-psub">Metas da oferta inteira, em % da receita bruta. O CPA fica no funil, na etapa que paga.</div></div>
              <button class="fs-btn sm" data-id="rstParams" type="button">${ico('rotate')}Voltar ao real</button></div>
            <div class="fs-pgrid" data-id="pgrid"></div><p class="fs-note" data-id="noteParams"></p>
          </section>
          <section class="fs-panel" aria-labelledby="fsTFunil">
            <div class="fs-ph"><div><h3 class="fs-pt" id="fsTFunil"><span class="fs-step">2</span>Funil detalhado</h3><div class="fs-psub">Conversão em % das vendas FE, cada etapa independente. Fulfillment = receita da etapa × % do bloco 1.</div></div>
              <button class="fs-btn sm" data-id="rstEtapas" type="button">${ico('rotate')}Voltar ao real</button></div>
            <div class="fs-tw"><table class="fs-tbl" data-id="tblFunil"></table></div>
            <div class="fs-removed" data-id="removidas" hidden></div>
            <div class="fs-tools"><span class="f-label">Incluir etapa</span>
              <button class="fs-btn sm" type="button" data-add="info">${ico('plus')}Infoproduto</button><button class="fs-btn sm" type="button" data-add="up">${ico('plus')}Upsell</button>
              <button class="fs-btn sm" type="button" data-add="ds">${ico('plus')}Downsell</button><button class="fs-btn sm" type="button" data-add="ob">${ico('plus')}Order bump</button>
              <span class="fs-kbd"><kbd>Enter</kbd> próximo campo · <kbd>Esc</kbd> volta ao real · <kbd>↑</kbd><kbd>↓</kbd> ajustam</span></div>
          </section>
          <p class="fs-src" data-id="fonte"></p>
        </div>
        <aside class="fs-cart" data-id="cart" aria-labelledby="fsTRes">
          <div class="fs-cart-h"><div class="row1"><h3 class="fs-pt" id="fsTRes"><span class="fs-step">3</span>Resultado</h3><span class="fs-count" data-id="nAjustes" hidden></span></div>
            <div class="fs-seg" role="group" aria-label="Cenário mostrado"><button type="button" class="on" data-ver="sim" aria-pressed="true">Simulação</button><button type="button" data-ver="real" aria-pressed="false">Real</button><button type="button" data-ver="dif" aria-pressed="false">Diferença</button></div></div>
          <div class="fs-cart-tot"><div class="fs-total"><span class="n" data-id="totN">Lucro final</span><span class="v" data-id="totV">—</span></div><div class="fs-cmp" data-id="totCmp"></div><div data-id="verdict" aria-live="polite"></div></div>
          <div class="fs-lines" data-id="cartLines"></div>
          <div class="fs-cart-x"><div class="fs-facts" data-id="facts"></div><div data-id="levBox"></div></div>
          <div class="fs-cart-save"><div class="fs-popw"><button class="fs-btn cta block" data-id="btnSalvar" type="button">${ico('save')}Salvar análise</button><div class="fs-pop fs-savepop" data-id="popSalvar" hidden style="top:auto;bottom:calc(100% + 6px);left:0;right:0;min-width:0"></div></div></div>
        </aside>
      </div>
      <div class="fs-mob"><div><div class="l">Lucro final · simulação</div><div class="v" data-id="mobV">—</div></div><button class="fs-btn sm" type="button" data-id="mobVer">Ver resultado</button></div>
      <div class="fs-toast" data-id="toast" role="status" aria-live="polite" hidden><span data-id="toastMsg"></span><button type="button" data-id="toastAct" hidden>Desfazer</button></div>
    </div>`;
    const el = (id) => box.querySelector(`[data-id="${id}"]`);

    function toast(m, undo) {
      el('toastMsg').textContent = m; toastUndo = undo || null; el('toastAct').hidden = !undo; el('toast').hidden = false;
      clearTimeout(toastT); toastT = setTimeout(() => { if (el('toast')) el('toast').hidden = true; toastUndo = null; }, undo ? 6000 : 2800);
    }

    /* ---------- dados reais (linha: plataforma, produto, dia, etapa, valores...) ---------- */
    const platOk = (l) => st.plat === 'todas' || l[0] === st.plat;
    function agregaReal(prod, de, ate) {
      if (!prod) return { tipo: 'nenhuma', fes: 0, params: {}, etapas: {}, padrao: {} };
      const pi = DADOS.produtos.indexOf(prod); const d0 = (D(de) - D(DADOS.de)) / 864e5, d1 = (D(ate) - D(DADOS.de)) / 864e5;
      const S = DADOS.etapas.map(() => new Array(N).fill(0));
      for (const l of DADOS.linhas) { if (l[1] !== pi || l[2] < d0 || l[2] > d1 || !platOk(l)) continue; const s = S[l[3]]; for (let i = 0; i < N; i++) s[i] += l[4 + i]; }
      const tot = new Array(N).fill(0); S.forEach((s) => s.forEach((v, i) => { tot[i] += v; }));
      const fes = S[0][C.vendas];
      if (!fes) return { tipo: 'dados', fes: 0, params: {}, etapas: {}, padrao: {} };
      const bp = tot[C.bruto_prev] || tot[C.bruto]; const ffOk = tot[C.bruto_fs] > 0, feeOk = tot[C.fee] > 0;
      const params = {
        vendas: fes, reemb: tot[C.reemb] / bp * 100, cb: tot[C.cb] / bp * 100, alerta: tot[C.alerta] / bp * 100, taxas: tot[C.taxas] / bp * 100,
        fee: feeOk ? tot[C.fee] / tot[C.bruto] * 100 : PADRAO_P.fee, ff: ffOk ? tot[C.custo_fs] / tot[C.bruto_fs] * 100 : PADRAO_P.ff, cc: tot[C.call_liq] / tot[C.bruto] * 100,
      };
      const etapas = {}; DADOS.etapas.forEach((e, i) => { const v = S[i][C.vendas]; if (v > 0) etapas[e] = { vendas: v, preco: S[i][C.bruto] / v, conv: v / fes * 100, cpa: S[i][C.cpa] / v }; });
      return { tipo: 'dados', fes, params, etapas, padrao: { fee: !feeOk, ff: !ffOk }, ffCob: tot[C.bruto_fs] / tot[C.bruto] * 100 };
    }
    function etapasDoProduto(prod) {
      if (!prod) return PADRAO;
      const pi = DADOS.produtos.indexOf(prod); const tem = new Set();
      for (const l of DADOS.linhas) if (l[1] === pi && platOk(l)) tem.add(DADOS.etapas[l[3]]);
      const ids = DADOS.etapas.filter((e) => tem.has(e)); return ids.length ? ids : PADRAO;
    }
    function fesNoPeriodo(de, ate) {
      const d0 = (D(de) - D(DADOS.de)) / 864e5, d1 = (D(ate) - D(DADOS.de)) / 864e5; const n = new Array(DADOS.produtos.length).fill(0);
      for (const l of DADOS.linhas) if (l[3] === 0 && l[2] >= d0 && l[2] <= d1 && platOk(l)) n[l[1]] += l[4];
      return n;
    }

    const realP = (k) => (k === 'dev' ? (REAL.params.reemb == null ? null : DEVK.reduce((a, x) => a + (REAL.params[x] || 0), 0)) : REAL.params[k]);
    const usadoP = (k) => (k === 'dev' ? DEVK.reduce((a, x) => a + usadoP(x), 0) : (st.sim[k] != null ? st.sim[k] : (REAL.params[k] ?? 0)));
    function usadoE(e) {
      const r = REAL.etapas[e.id] || {};
      return { id: e.id, preco: e.precoSim != null ? e.precoSim : (r.preco || 0), conv: e.id === 'FE' ? 100 : (e.convSim != null ? e.convSim : (r.conv || 0)), cpa: e.cpaSim != null ? e.cpaSim : (r.cpa || 0) };
    }
    const etapasUsadas = () => st.etapas.filter((e) => !e.removida).map(usadoE);
    const etapasReais = () => st.etapas.filter((e) => !e.custom).map((e) => { const r = REAL.etapas[e.id] || {}; return { id: e.id, preco: r.preco || 0, conv: e.id === 'FE' ? 100 : (r.conv || 0), cpa: r.cpa || 0 }; });
    const temReal = () => REAL.tipo !== 'nenhuma' && REAL.fes > 0;
    const usadosP = () => { const o = {}; PK.forEach((k) => { o[k] = usadoP(k); }); return o; };
    const nomeEtapa = (e) => (e.custom ? e.nome : ETAPA_INFO[e.id].nome);
    const nAjustes = () => Object.keys(st.sim).length + st.etapas.reduce((a, e) => a + (e.custom ? 1 : 0) + (e.removida ? 1 : 0) + (!e.custom ? [e.precoSim, e.convSim, e.cpaSim].filter((x) => x != null).length : 0), 0);

    /* ---------- período ---------- */
    function presets() {
      const ate = DADOS.ate, d = D(ate); const y = d.getUTCFullYear(), m = d.getUTCMonth();
      const ini = iso(new Date(Date.UTC(y, m, 1))), pIni = iso(new Date(Date.UTC(y, m - 1, 1))), pFim = iso(new Date(Date.UTC(y, m, 0)));
      const cl = (s) => (s < DADOS.de ? DADOS.de : s);
      return [{ id: '7d', nome: 'Últimos 7 dias', de: cl(addD(ate, -6)), ate }, { id: '30d', nome: 'Últimos 30 dias', de: cl(addD(ate, -29)), ate },
        { id: '90d', nome: 'Últimos 90 dias', de: cl(addD(ate, -89)), ate }, { id: 'mes', nome: 'Este mês (' + MESES[m] + ')', de: cl(ini), ate },
        { id: 'mesp', nome: 'Mês passado (' + MESES[(m + 11) % 12] + ')', de: cl(pIni), ate: pFim }, { id: 'tudo', nome: 'Tudo (desde ' + br(DADOS.de) + ')', de: DADOS.de, ate }];
    }
    function setPeriodo(p) {
      const pr = presets().find((x) => x.id === p.preset); if (pr) p = { preset: p.preset, de: pr.de, ate: pr.ate };
      st.periodo = p; el('lblPeriodo').textContent = pr ? pr.nome : 'Personalizado'; el('chipDatas').textContent = br(p.de) + ' → ' + br(p.ate);
    }

    /* ---------- legenda: real + diferença ---------- */
    function capHtml(real, sim, fmt, ruim, un) {
      if (real == null) return '<span>sem real</span>';
      let h = `<span>Real ${fmt(real)}</span>`;
      if (sim != null) {
        const d = sim - real;
        if (Math.abs(d) > 1e-9) {
          const up = d > 0; const cls = (up === !!ruim) ? 'up-bad' : 'up-good';
          h += `<span class="dl ${cls}">${up ? '▲' : '▼'} ${un === 'pp' ? nf1.format(Math.abs(d)) + ' p.p.' : un === 'usd' ? nf2.format(Math.abs(d)) : nf0.format(Math.abs(d))}</span>`;
        }
      }
      return h;
    }
    const fmtP = (p, v) => (v == null ? '—' : p.un === '%' ? pct(v) : nf0.format(v));

    /* ---------- bloco 1 ---------- */
    function renderParams() {
      const tr = temReal();
      el('pgrid').innerHTML = PARAMS.map((p) => {
        if (p.calc) return `<div class="fs-pcard calc"><div class="pl">${p.nome}<span class="fs-tagx">${p.tag}</span></div><div class="big" data-id="u_dev"></div><div class="fs-cap" data-id="cap_dev"></div></div>`;
        const sv = st.sim[p.k], rv = tr ? realP(p.k) : null;
        const tag = REAL.padrao && REAL.padrao[p.k] ? 'padrão definido' : p.k === 'ff' && tr ? `custo real em ${nf0.format(REAL.ffCob)}%` : (p.tag || '');
        return `<div class="fs-pcard ${sv != null ? 'on' : ''}" data-id="pc_${p.k}"><label for="fs_p_${p.k}">${p.nome}${tag ? `<span class="fs-tagx">${tag}</span>` : ''}</label>
          <span class="fs-inp ${sv != null ? 'on' : ''}"><input id="fs_p_${p.k}" name="fs_p_${p.k}" data-pk="${p.k}" data-step="${p.step}" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="${rv != null ? esc(inFmt(rv, p.dec)) : '0'}" value="${esc(inFmt(sv, p.dec))}"><span class="u">${p.un === 'qtd' ? '' : p.un}</span></span>
          <div class="fs-cap" data-id="cap_${p.k}"></div>
          <button class="fs-ico rst" type="button" data-rp="${p.k}" title="Voltar ao real" aria-label="Voltar ${esc(p.nome)} ao real" ${sv != null ? '' : 'hidden'}>${ico('rotate')}</button></div>`;
      }).join('');
      const plat = st.plat === 'todas' ? 'JVZoo + Vupim' : DADOS.plataformas[st.plat];
      el('noteParams').textContent = REAL.tipo === 'nenhuma' ? 'Sem base: digite os valores. Campo vazio vale zero.'
        : REAL.fes ? `Real de ${nf0.format(REAL.fes)} FEs (${plat}), ${br(st.periodo.de)}–${br(st.periodo.ate)}. Devoluções pela previsão D60 (safra fechada = real)${DADOS.temPrevisao === false ? ' — ainda não publicada neste ambiente, por isso zeradas' : ''}. Fulfillment = custo real da Full Stack nos pedidos achados no armazém${REAL.padrao.ff ? '; este produto não tem nenhum no período, então vale o padrão de ' + nf1.format(PADRAO_P.ff) + '%' : ''}.`
          : 'Este produto não teve vendas nesse período ou plataforma. Troque o filtro ou digite os valores.';
    }
    function updateParams() {
      const tr = temReal();
      for (const p of PARAMS) {
        const cap = el('cap_' + p.k); if (!cap) continue;
        if (p.calc) { el('u_dev').textContent = pct(usadoP('dev')); const any = DEVK.some((k) => st.sim[k] != null); cap.innerHTML = capHtml(tr ? realP('dev') : null, any ? usadoP('dev') : null, pct, true, 'pp'); continue; }
        cap.innerHTML = capHtml(tr ? realP(p.k) : null, st.sim[p.k], (v) => fmtP(p, v), p.ruim, p.un === '%' ? 'pp' : 'n');
      }
    }

    /* ---------- bloco 2 ---------- */
    function renderFunil() {
      const h = `<thead><tr><th>Etapa</th><th class="num bl">Conversão<span class="fs-small">% do FE</span></th><th class="num">Preço<span class="fs-small">US$ / venda</span></th><th class="num">CPA<span class="fs-small">US$ / venda</span></th>
        <th class="num bl">Receita bruta<span class="fs-small">vendas · % do total</span></th><th class="num">Custos<span class="fs-small">CPA · fulfillment</span></th><th class="num">Resultado<span class="fs-small">receita − custos</span></th><th aria-label="Ações"></th></tr></thead>`;
      const body = st.etapas.filter((e) => !e.removida).map((e) => {
        const tipo = e.custom ? e.tipo : ETAPA_INFO[e.id].tipo; const isFE = e.id === 'FE'; const r = temReal() ? REAL.etapas[e.id] : null;
        const nome = e.custom ? `<span class="fs-inp fs-nminp"><input data-en="${e.id}" name="fs_n_${e.id}" value="${esc(e.nome)}" aria-label="Nome da etapa" autocomplete="off"></span>` : `<span>${esc(ETAPA_INFO[e.id].nome)}</span>`;
        const inp = (attr, val, ph, un, pre, step, lbl) => `<span class="fs-inp ${pre ? 'pre' : ''} ${val != null ? 'on' : ''}"><input ${attr} data-step="${step}" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${lbl} de ${esc(nomeEtapa(e))}" placeholder="${esc(ph)}" value="${esc(inFmt(val, 1))}"><span class="u">${un}</span></span>`;
        return `<tr><td><span class="fs-name"><span class="fs-typ ${tipo}">${TIPOS[tipo]}</span>${nome}<span class="fs-cpatag" data-id="ct_${e.id}" hidden>CPA</span></span></td>
          <td class="num bl inc">${isFE ? '<div class="rv">100%</div><div class="fs-cap">base do funil</div>' : inp(`data-ec="${e.id}" name="fs_c_${e.id}"`, e.convSim, r ? inFmt(r.conv, 1) : '0', '%', false, 0.5, 'Conversão') + `<div class="fs-cap" data-id="cc_${e.id}"></div>`}</td>
          <td class="num inc">${inp(`data-ep="${e.id}" name="fs_pr_${e.id}"`, e.precoSim, r ? inFmt(r.preco, 1) : '0', '$', true, 1, 'Preço')}<div class="fs-cap" data-id="cp_${e.id}"></div></td>
          <td class="num inc">${inp(`data-ek="${e.id}" name="fs_k_${e.id}"`, e.cpaSim, r ? inFmt(r.cpa || 0, 1) : '0', '$', true, 1, 'CPA')}<div class="fs-cap" data-id="ck_${e.id}"></div></td>
          <td class="num bl"><div class="rv" data-id="fr_${e.id}"></div><div class="fs-cap"><span data-id="fv_${e.id}"></span><span><span data-id="fp_${e.id}"></span> <span class="fs-share"><i data-id="fs_${e.id}"></i></span></span></div></td>
          <td class="num"><div class="rv" data-id="fk_${e.id}"></div><div class="fs-cap col" data-id="ff_${e.id}"></div></td>
          <td class="num"><div class="rv" data-id="ft_${e.id}"></div></td>
          <td class="fs-acts"><button class="fs-ico" type="button" data-re="${e.id}" title="Voltar etapa ao real" aria-label="Voltar etapa ao real" hidden>${ico('rotate')}</button>${isFE ? '' : `<button class="fs-ico" type="button" data-rm="${e.id}" title="${e.custom ? 'Excluir etapa' : 'Tirar do funil'}" aria-label="${e.custom ? 'Excluir etapa' : 'Tirar etapa do funil'}">${ico('x')}</button>`}</td></tr>`;
      }).join('');
      el('tblFunil').innerHTML = h + `<tbody>${body}</tbody><tfoot><tr><td>Total do funil</td><td class="num bl" data-id="tAov" style="color:var(--fg4)"></td><td></td><td></td>
        <td class="num bl"><div data-id="tR"></div><div class="fs-cap" data-id="tV"></div></td><td class="num"><div data-id="tK"></div><div class="fs-cap col" data-id="tF"></div></td><td class="num" data-id="tT"></td><td></td></tr></tfoot>`;
      const rm = st.etapas.filter((e) => e.removida && !e.custom); const bx = el('removidas'); bx.hidden = !rm.length;
      bx.innerHTML = rm.length ? '<span>Fora do funil simulado:</span>' + rm.map((e) => `<span class="fs-rmchip">${esc(ETAPA_INFO[e.id].nome)}<button type="button" data-volta="${e.id}">Devolver</button></span>`).join('') : '';
    }
    function updateFunil() {
      const byId = {}; R_SIM.linhas.forEach((l) => { byId[l.id] = l; }); const tr = temReal();
      for (const e of st.etapas) {
        if (e.removida || !el('fr_' + e.id)) continue; const l = byId[e.id]; const u = usadoE(e); const r = tr ? REAL.etapas[e.id] : null;
        if (e.id !== 'FE') el('cc_' + e.id).innerHTML = capHtml(r ? r.conv : null, e.convSim, pct, false, 'pp');
        el('cp_' + e.id).innerHTML = capHtml(r ? r.preco : null, e.precoSim, (v) => nf2.format(v), false, 'usd');
        el('ck_' + e.id).innerHTML = capHtml(r ? (r.cpa || 0) : null, e.cpaSim, (v) => nf2.format(v), true, 'usd');
        el('fr_' + e.id).textContent = usd(l.rb);
        el('fv_' + e.id).textContent = nf0.format(l.vendas) + ' vendas';
        el('fp_' + e.id).textContent = R_SIM.rb ? pct(l.rb / R_SIM.rb * 100) : '0%';
        el('fs_' + e.id).style.width = (R_SIM.rb ? Math.min(100, l.rb / R_SIM.rb * 100) : 0) + '%';
        el('fk_' + e.id).innerHTML = `<span class="v-neg">${usd(-(l.cpa + l.ff))}</span>`;
        el('ff_' + e.id).innerHTML = `<span>CPA ${l.cpa ? usd(l.cpa) : '0'}</span><span>FF ${usd(l.ff)}</span>`;
        el('ft_' + e.id).innerHTML = `<span class="${l.total >= 0 ? '' : 'v-neg'}">${usd(l.total)}</span>`;
        el('ct_' + e.id).hidden = !(u.cpa >= 1); // centavos de CPA em upsell não marcam a etapa
        const rb = box.querySelector(`[data-re="${e.id}"]`); if (rb) rb.hidden = !(e.precoSim != null || e.convSim != null || e.cpaSim != null);
      }
      const T = R_SIM; const res = T.rb - T.cpa - T.ff;
      el('tV').textContent = nf0.format(T.vendas) + ' vendas'; el('tR').textContent = usd(T.rb);
      el('tK').innerHTML = `<span class="v-neg">${usd(-(T.cpa + T.ff))}</span>`; el('tF').innerHTML = `<span>CPA ${usd(T.cpa)}</span><span>FF ${usd(T.ff)}</span>`;
      el('tT').innerHTML = `<span class="${res >= 0 ? '' : 'v-neg'}">${usd(res)}</span>`; el('tAov').textContent = 'AOV ' + usd2(T.aov);
    }

    /* ---------- bloco 3 ---------- */
    function alavancas() {
      const Pm = usadosP(), E = etapasUsadas(), base = calcula(Pm, E).final; if (!Pm.vendas) return [];
      const out = [], add = (txt, mod, foco) => { out.push({ txt, d: mod() - base, foco }); };
      E.forEach((e) => {
        if (e.id === 'FE') return; const et = st.etapas.find((x) => x.id === e.id);
        add(`+1 p.p. de conversão no ${et ? nomeEtapa(et) : e.id}`, () => calcula(Pm, E.map((x) => (x.id === e.id ? { ...x, conv: x.conv + 1 } : x))).final, `[data-ec="${e.id}"]`);
      });
      add('−US$ 10 no CPA do FE', () => calcula(Pm, E.map((x) => (x.id === 'FE' ? { ...x, cpa: Math.max(0, x.cpa - 10) } : x))).final, '[data-ek="FE"]');
      add('+US$ 10 no preço do FE', () => calcula(Pm, E.map((x) => (x.id === 'FE' ? { ...x, preco: x.preco + 10 } : x))).final, '[data-ep="FE"]');
      [['reemb', 'Reembolso'], ['alerta', 'Alertas'], ['cb', 'Chargeback'], ['ff', 'Fulfillment']].forEach(([k, n]) => add(`−1 p.p. de ${n}`, () => calcula({ ...Pm, [k]: Math.max(0, Pm[k] - 1) }, E).final, `#fs_p_${k}`));
      add('+1 p.p. de lucro do call center', () => calcula({ ...Pm, cc: Pm.cc + 1 }, E).final, '#fs_p_cc');
      return out.filter((x) => x.d > 0.5).sort((a, b) => b.d - a.d).slice(0, 4);
    }
    function renderCart() {
      const tr = temReal(); if (!tr && st.ver !== 'sim') st.ver = 'sim';
      const ver = st.ver, R = ver === 'real' ? R_REAL : R_SIM;
      el('cartLines').innerHTML = LINHAS.map(([n, k, c, sg]) => {
        if (ver === 'dif') {
          const d = sg * (R_SIM[k] - R_REAL[k]);
          const txt = Math.abs(d) < 0.5 ? '<span class="fs-small">—</span>' : `<span class="${d > 0 ? 'up-good' : 'up-bad'}">${d > 0 ? '▲' : '▼'} ${usd(Math.abs(d))}</span>`;
          return `<div class="fs-cl ${c}"><span class="n">${n}</span><span class="v">${txt}</span><span class="p"></span></div>`;
        }
        const v = sg * R[k]; const p = R.rb ? v / R.rb * 100 : 0; const col = (k === 'funil' || k === 'antesDev') ? (v >= 0 ? 'v-pos' : 'v-neg') : '';
        const key = ver + k, fl = ultimo[key] != null && Math.abs(ultimo[key] - v) > 0.5 ? ' flash' : ''; ultimo[key] = v;
        return `<div class="fs-cl ${c}${fl}"><span class="n">${n}</span><span class="v ${col}">${usd(v)}</span><span class="p">${pct(p)}</span></div>`;
      }).join('');
      if (ver === 'dif') {
        const d = R_SIM.final - R_REAL.final; el('totN').textContent = 'Diferença';
        el('totV').innerHTML = `<span class="${d >= 0 ? 'up-good' : 'up-bad'}">${d >= 0 ? '▲' : '▼'} ${usd(Math.abs(d))}</span>`;
        el('totCmp').innerHTML = `<span>Simulação <b>${usd(R_SIM.final)}</b></span><span>Real <b>${usd(R_REAL.final)}</b></span>`;
      } else {
        const f = R.final, fp = R.rb ? f / R.rb * 100 : 0, d = R_SIM.final - R_REAL.final;
        el('totN').textContent = ver === 'real' ? 'Lucro final · real' : 'Lucro final';
        el('totV').innerHTML = `<span class="${f >= 0 ? 'v-pos' : 'v-neg'}">${usd(f)}</span>`;
        el('totCmp').innerHTML = `<span>${pct(fp)} da receita bruta</span>` + (tr && ver === 'sim' ? (Math.abs(d) < 0.5 ? '<span>igual ao real</span>' : `<span>vs real: <b class="${d >= 0 ? 'up-good' : 'up-bad'}">${d >= 0 ? '▲' : '▼'} ${usdK(Math.abs(d))}</b></span>`) : tr ? `<span>Simulação: <b>${usd(R_SIM.final)}</b></span>` : '');
      }
      const S = ver === 'real' ? R_REAL : R_SIM; const funp = S.rb ? S.funil / S.rb * 100 : 0, ccp = S.rb ? S.cc / S.rb * 100 : 0;
      const fe = S.linhas.find((l) => l.id === 'FE'); const cpaFE = fe && fe.vendas ? fe.cpa / fe.vendas : 0; const cpaEq = S.fes ? cpaFE + S.final / S.fes : 0;
      el('verdict').innerHTML = !S.rb ? '' : S.final >= 0
        ? `<div class="fs-verdict pos">${ico('ok')}<span>Fecha no azul. ${S.funil < 0 ? `O funil perde ${pct(-funp)} da receita e o call center cobre, com folga de ${pct(ccp + funp)}.` : 'O funil já é positivo sem o call center.'}</span></div>`
        : `<div class="fs-verdict neg">${ico('warn')}<span>Fecha no vermelho. Para empatar, o call center precisa render ${pct(-funp)} da receita (está em ${pct(ccp)}) ou o CPA do FE cair para ${usd2(cpaEq)}.</span></div>`;
      el('facts').innerHTML = `<div class="fs-fact"><div class="l">AOV (receita ÷ FE)</div><div class="v">${usd2(S.aov)}</div></div><div class="fs-fact"><div class="l">Lucro por FE</div><div class="v ${S.final >= 0 ? 'v-pos' : 'v-neg'}">${S.fes ? usd2(S.final / S.fes) : '—'}</div></div>
        <div class="fs-fact"><div class="l">CPA de equilíbrio</div><div class="v">${S.fes ? usd2(cpaEq) : '—'}</div></div><div class="fs-fact"><div class="l">Call center p/ empatar</div><div class="v">${S.rb ? pct(Math.max(0, -funp)) : '—'}</div></div>`;
      const lev = ver === 'real' ? [] : alavancas();
      el('levBox').innerHTML = lev.length ? `<div class="fs-levh">Onde mexer<span>efeito no lucro final</span></div><div class="fs-lev">${lev.map((x, i) => `<button type="button" data-lev="${i}"><span>${esc(x.txt)}</span><b>+${usdK(x.d)}</b></button>`).join('')}</div>` : '';
      el('levBox').querySelectorAll('[data-lev]').forEach((b) => { b.onclick = () => { const t = box.querySelector(lev[+b.dataset.lev].foco); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.focus({ preventScroll: true }); } }; });
      el('mobV').innerHTML = `<span class="${R_SIM.final >= 0 ? 'v-pos' : 'v-neg'}">${usd(R_SIM.final)}</span>`;
      $$('[data-ver]').forEach((b) => { const on = b.dataset.ver === ver; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); if (b.dataset.ver !== 'sim') b.disabled = !tr; });
      const n = nAjustes(); const na = el('nAjustes'); na.hidden = !n; na.textContent = n + (n === 1 ? ' ajuste' : ' ajustes');
    }

    function update() {
      R_REAL = calcula(temReal() ? REAL.params : {}, etapasReais()); R_SIM = calcula(usadosP(), etapasUsadas());
      updateParams(); updateFunil(); renderCart(); renderLoaded();
    }
    const renderAll = () => { renderParams(); renderFunil(); update(); };
    const recarregaReal = () => { REAL = agregaReal(st.produto, st.periodo.de, st.periodo.ate); };
    const lembra = () => ls.set('base', { produto: st.produto, plat: st.plat, periodo: st.periodo });

    /* ---------- etapas ---------- */
    const novaEtapa = (id) => ({ id, custom: false, removida: false, precoSim: null, convSim: null, cpaSim: null });
    function montaEtapas(prod, manter) {
      const ids = etapasDoProduto(prod); const velho = {}; (manter || []).forEach((e) => { velho[e.id] = e; });
      return [...ids.map((id) => (velho[id] ? { ...novaEtapa(id), ...velho[id], custom: false } : novaEtapa(id))), ...(manter || []).filter((e) => e.custom)];
    }
    function addEtapa(tipo) {
      const nomes = { info: 'Infoproduto', up: 'Upsell extra', ds: 'Downsell extra', ob: 'Order bump extra' }, precos = { info: 150, up: 174, ds: 97, ob: 27 };
      const id = 'X' + Date.now().toString(36) + (seq++);
      st.etapas.push({ id, custom: true, tipo, nome: nomes[tipo], removida: false, precoSim: precos[tipo], convSim: null, cpaSim: null });
      renderFunil(); update(); const t = box.querySelector(`[data-ec="${id}"]`); if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); }
      toast(nomes[tipo] + ' incluído. Digite a conversão esperada.');
    }
    const fotografa = () => JSON.stringify({ sim: st.sim, etapas: st.etapas });
    const restaura = (f) => { const o = JSON.parse(f); st.sim = o.sim; st.etapas = o.etapas; renderAll(); };

    /* ---------- eventos (no container; o clique fora fecha os menus) ---------- */
    const campoDe = (t) => (t.dataset.ep ? 'precoSim' : t.dataset.ec ? 'convSim' : t.dataset.ek ? 'cpaSim' : null);
    function aplicaValor(t) {
      const wrap = t.closest('.fs-inp');
      if (t.dataset.pk) {
        const k = t.dataset.pk; const v = parseNum(t.value); if (v == null) delete st.sim[k]; else st.sim[k] = v;
        wrap.classList.toggle('on', v != null); el('pc_' + k).classList.toggle('on', v != null); const b = box.querySelector(`[data-rp="${k}"]`); if (b) b.hidden = v == null; update(); return;
      }
      const id = t.dataset.ep || t.dataset.ec || t.dataset.ek || t.dataset.en; if (!id) return; const e = st.etapas.find((x) => x.id === id); if (!e) return;
      if (t.dataset.en) { e.nome = t.value.slice(0, 40); update(); return; }
      const campo = campoDe(t); e[campo] = parseNum(t.value); wrap.classList.toggle('on', e[campo] != null); update();
    }
    function onInput(ev) { const t = ev.target; if (t instanceof HTMLInputElement && t.closest('.fs-inp')) aplicaValor(t); }
    function onFocusOut(ev) {
      const t = ev.target; if (!(t instanceof HTMLInputElement)) return;
      if (t.dataset.pk) { const p = PARAMS.find((x) => x.k === t.dataset.pk); t.value = inFmt(st.sim[p.k], p.dec); return; }
      const c = campoDe(t); if (!c) return; const e = st.etapas.find((x) => x.id === (t.dataset.ep || t.dataset.ec || t.dataset.ek)); if (e) t.value = inFmt(e[c], 1);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { const p = $$('.fs-pop').find((x) => !x.hidden); if (p) { p.hidden = true; const b = p.parentElement.querySelector('button'); if (b) b.focus(); return; } }
      const t = ev.target; if (!(t instanceof HTMLInputElement) || !t.closest('.fs-inp') || t.dataset.en) return;
      if (ev.key === 'Enter') { ev.preventDefault(); const all = $$('.fs-blocks .fs-inp input'); const nx = all[all.indexOf(t) + (ev.shiftKey ? -1 : 1)]; if (nx) { nx.focus(); nx.select(); } return; }
      if (ev.key === 'Escape') { ev.preventDefault(); t.value = ''; aplicaValor(t); return; }
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        ev.preventDefault(); const step = (+t.dataset.step || 1) * (ev.shiftKey ? 10 : 1);
        const atual = parseNum(t.value) ?? parseNum(t.placeholder) ?? 0; let v = Math.round((atual + (ev.key === 'ArrowUp' ? step : -step)) * 100) / 100; if (v < 0) v = 0;
        t.value = inFmt(v, t.dataset.pk === 'vendas' ? 0 : 1); aplicaValor(t);
      }
    }
    function onDocClick(ev) { $$('.fs-pop').forEach((p) => { if (!p.hidden && !p.parentElement.contains(ev.target)) p.hidden = true; }); }
    function onClick(ev) {
      const b = ev.target.closest('button'); if (!b || !box.contains(b)) return; const id = b.dataset.id;
      if (id === 'toastAct') { if (toastUndo) { const f = toastUndo; toastUndo = null; restaura(f); el('toast').hidden = true; } return; }
      if (b.dataset.ver) { if (b.disabled) return; st.ver = b.dataset.ver; renderCart(); return; }
      if (b.dataset.rp) { delete st.sim[b.dataset.rp]; renderParams(); update(); const t = box.querySelector('#fs_p_' + b.dataset.rp); if (t) t.focus(); return; }
      if (b.dataset.re) { const e = st.etapas.find((x) => x.id === b.dataset.re); e.convSim = null; e.cpaSim = null; if (!e.custom) e.precoSim = null; renderFunil(); update(); return; }
      if (b.dataset.rm) {
        const f = fotografa(); const i = st.etapas.findIndex((x) => x.id === b.dataset.rm); const nome = nomeEtapa(st.etapas[i]);
        if (st.etapas[i].custom) st.etapas.splice(i, 1); else st.etapas[i].removida = true; renderFunil(); update(); toast(nome + ' saiu do funil.', f); return;
      }
      if (b.dataset.volta) { st.etapas.find((x) => x.id === b.dataset.volta).removida = false; renderFunil(); update(); return; }
      if (b.dataset.add) { addEtapa(b.dataset.add); return; }
      if (id === 'rstParams') { if (!Object.keys(st.sim).length) return; const f = fotografa(); st.sim = {}; renderParams(); update(); toast('Parâmetros voltaram ao real.', f); return; }
      if (id === 'rstEtapas') { const f = fotografa(); st.etapas.forEach((e) => { if (!e.custom) { e.precoSim = null; e.convSim = null; e.cpaSim = null; e.removida = false; } }); renderFunil(); update(); toast('Etapas voltaram ao real.', f); return; }
      if (id === 'rstTudo') { const f = fotografa(); st.sim = {}; st.etapas = montaEtapas(st.produto, []); renderAll(); toast('Tudo voltou ao real.', f); return; }
      if (id === 'btnPeriodo') { togglePop('popPeriodo', renderPopPeriodo); return; }
      if (id === 'btnProduto') { togglePop('popProduto', renderPopProduto); return; }
      if (id === 'btnPlat') { togglePop('popPlat', renderPopPlat); return; }
      if (id === 'btnSalvar') { togglePop('popSalvar', renderPopSalvar); return; }
      if (id === 'btnLista') { togglePop('popLista', renderPopLista); return; }
      if (id === 'mobVer') { el('cart').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
    function togglePop(pid, fn) {
      const p = el(pid); const abrir = p.hidden; $$('.fs-pop').forEach((x) => { x.hidden = true; });
      if (abrir) { fn(p); p.hidden = false; const f = p.querySelector('.sel,input,button'); if (f) f.focus({ preventScroll: true }); }
    }
    box.addEventListener('input', onInput); box.addEventListener('focusout', onFocusOut); box.addEventListener('keydown', onKey); box.addEventListener('click', onClick);
    document.addEventListener('click', onDocClick);

    /* ---------- período (atalhos à esquerda, calendário à direita) ---------- */
    function renderPopPeriodo(p) {
      const ps = presets(); if (!dpMes) { const d = D(st.periodo.ate); dpMes = [d.getUTCFullYear(), d.getUTCMonth()]; }
      p.innerHTML = `<div class="fs-dp"><div class="fs-dp-at">${ps.map((x) => `<button class="fs-opt ${st.periodo.preset === x.id ? 'sel' : ''}" type="button" data-pp="${x.id}">${x.nome}<span class="fs-meta">${br(x.de)}–${br(x.ate)}</span></button>`).join('')}
        <div class="fs-popsep"></div><button class="fs-opt ${st.periodo.preset === 'custom' ? 'sel' : ''}" type="button" data-pp="custom">Personalizado…</button></div><div class="fs-dp-cal" data-id="dpCal"></div></div>`;
      p.querySelectorAll('[data-pp]').forEach((b) => b.addEventListener('click', (ev) => {
        ev.stopPropagation(); const id = b.dataset.pp; if (id === 'custom') { dpSel = null; desenhaCal(); return; }
        const x = ps.find((y) => y.id === id); aplicaPeriodo({ preset: id, de: x.de, ate: x.ate }); p.hidden = true;
      }));
      desenhaCal();
    }
    function desenhaCal() {
      const c = el('dpCal'); if (!c) return; const [y, m] = dpMes; const dow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const de = dpSel || st.periodo.de, ate = dpSel || st.periodo.ate; let cells = ''; for (let i = 0; i < dow; i++) cells += '<span></span>';
      for (let d = 1; d <= n; d++) { const s = iso(new Date(Date.UTC(y, m, d))); const fora = s < DADOS.de || s > DADOS.ate; cells += `<button type="button" class="fs-day ${s === de || s === ate ? 'edge' : s > de && s < ate ? 'in' : ''}" data-dd="${s}" aria-label="${brY(s)}" ${fora ? 'disabled' : ''}>${d}</button>`; }
      c.innerHTML = `<div class="fs-dp-h"><button type="button" data-mv="-1" aria-label="Mês anterior">‹</button><span>${MESES[m]} ${y}</span><button type="button" data-mv="1" aria-label="Próximo mês">›</button></div>
        <div class="fs-dp-grid">${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((w) => `<span class="wd" aria-hidden="true">${w}</span>`).join('')}${cells}</div>
        <div class="fs-dp-hint">${dpSel ? 'Agora clique no último dia.' : '1º clique = início, 2º = fim. Dados de ' + br(DADOS.de) + ' a ' + br(DADOS.ate) + '.'}</div>`;
      c.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); let [yy, mm] = dpMes; mm += Number(b.dataset.mv); if (mm < 0) { mm = 11; yy--; } if (mm > 11) { mm = 0; yy++; } dpMes = [yy, mm]; desenhaCal(); }));
      c.querySelectorAll('[data-dd]').forEach((b) => b.addEventListener('click', (ev) => {
        ev.stopPropagation(); const s = b.dataset.dd;
        if (!dpSel) { dpSel = s; desenhaCal(); } else { const a = s < dpSel ? s : dpSel, z = s < dpSel ? dpSel : s; dpSel = null; aplicaPeriodo({ preset: 'custom', de: a, ate: z }); el('popPeriodo').hidden = true; }
      }));
    }
    function aplicaPeriodo(p) { setPeriodo(p); recarregaReal(); lembra(); renderAll(); }

    /* ---------- base do funil e plataforma ---------- */
    function renderPopProduto(p) {
      const n = fesNoPeriodo(st.periodo.de, st.periodo.ate); const ordem = DADOS.produtos.map((nome, i) => ({ nome, n: n[i] })).sort((a, b) => b.n - a.n);
      p.innerHTML = `<button class="fs-opt ${!st.produto ? 'sel' : ''}" type="button" data-prod="">Sem base<span class="fs-meta">oferta nova, à mão</span></button>
        <div class="fs-popsep"></div><div class="fs-poph">Produtos · FEs em ${br(st.periodo.de)}–${br(st.periodo.ate)}${st.plat === 'todas' ? '' : ' · ' + DADOS.plataformas[st.plat]}</div>`
        + ordem.map((x) => `<button class="fs-opt ${st.produto === x.nome ? 'sel' : ''} ${x.n ? '' : 'dim'}" type="button" data-prod="${esc(x.nome)}">${esc(x.nome)}<span class="fs-meta">${x.n ? nf0.format(x.n) + ' FE' : 'sem vendas'}</span></button>`).join('');
      p.querySelectorAll('[data-prod]').forEach((b) => b.addEventListener('click', () => { escolheBase(b.dataset.prod || null); p.hidden = true; el('btnProduto').focus(); }));
    }
    function renderPopPlat(p) {
      const ops = [['todas', 'JVZoo + Vupim'], ...DADOS.plataformas.map((n, i) => [i, n])];
      p.innerHTML = ops.map(([v, n]) => `<button class="fs-opt ${st.plat === v ? 'sel' : ''}" type="button" data-plat="${v}">${n}</button>`).join('');
      p.querySelectorAll('[data-plat]').forEach((b) => b.addEventListener('click', () => {
        const v = b.dataset.plat; st.plat = v === 'todas' ? 'todas' : Number(v); p.hidden = true;
        atualizaBaseUI(); lembra(); if (st.produto) { st.etapas = montaEtapas(st.produto, st.etapas); recarregaReal(); renderAll(); } el('btnPlat').focus();
      }));
    }
    function atualizaBaseUI() {
      el('lblProduto').textContent = st.produto || 'Sem base'; el('btnProduto').classList.toggle('on', !!st.produto);
      const semPer = !st.produto; ['btnPeriodo', 'btnPlat'].forEach((s) => { el(s).disabled = semPer; el(s).title = semPer ? 'Escolha um produto para puxar o real' : ''; });
      el('lblPlat').textContent = st.plat === 'todas' ? 'JVZoo + Vupim' : DADOS.plataformas[st.plat]; el('btnPlat').classList.toggle('on', st.plat !== 'todas');
    }
    function escolheBase(prod) {
      if (!prod && st.produto) {
        PK.forEach((k) => { st.sim[k] = r2(usadoP(k)); });
        st.etapas.forEach((e) => { const u = usadoE(e); e.precoSim = r2(u.preco); e.cpaSim = r2(u.cpa); if (e.id !== 'FE') e.convSim = r2(u.conv); });
        st.produto = null; atualizaBaseUI(); recarregaReal(); lembra(); renderAll(); toast('Sem base: os valores em uso viraram simulação.'); return;
      }
      st.produto = prod; atualizaBaseUI(); st.etapas = montaEtapas(prod, st.etapas); recarregaReal(); lembra(); renderAll();
    }

    /* ---------- análises salvas (API do painel) ---------- */
    const snapshotEstado = () => ({
      produto: st.produto, plat: st.plat, periodo: { ...st.periodo }, sim: { ...st.sim },
      etapas: st.etapas.map((e) => ({ id: e.id, custom: !!e.custom, tipo: e.tipo || null, nome: e.custom ? e.nome : null, removida: !!e.removida, precoSim: e.precoSim ?? null, convSim: e.convSim ?? null, cpaSim: e.cpaSim ?? null })),
    });
    const assinatura = (o) => JSON.stringify(o);
    const sujo = () => st.atual && st.base !== assinatura(snapshotEstado());
    const podeMexer = (s) => user.role === 'ADMIN' || !s.createdById || s.createdById === user.id;
    async function carregaSalvas() {
      if (!api.listar) return;
      try { const r = await api.listar(); SALVAS = (r && r.simulations) || []; el('nSalvas').textContent = SALVAS.length; const pl = el('popLista'); if (!pl.hidden) renderPopLista(pl); } catch (e) { el('nSalvas').textContent = '!'; }
    }
    function renderLoaded() {
      const bx = el('loadedBox'); if (!st.atual) { bx.innerHTML = ''; return; }
      bx.innerHTML = `<span class="fs-loaded">${ico('file')}<b title="${esc(st.atual.nome)}">${esc(st.atual.nome)}</b>${sujo() ? `<span class="st">· alterada</span>${st.atual.pode ? '<button class="fs-btn sm" type="button" data-id="atuRapido">Atualizar</button>' : ''}` : ''}<button class="fs-ico" type="button" data-id="fechaAnalise" title="Fechar análise" aria-label="Fechar análise">${ico('x')}</button></span>`;
      el('fechaAnalise').onclick = () => { st.atual = null; st.base = null; renderLoaded(); };
      const a = el('atuRapido'); if (a) a.onclick = () => salvar(false, st.atual.nome);
    }
    function renderPopSalvar(p) {
      const sug = st.atual ? st.atual.nome : `${st.produto || 'Oferta nova'}${st.produto ? ' · ' + br(st.periodo.de) + '–' + br(st.periodo.ate) : ''}`;
      const atualizar = st.atual && st.atual.pode;
      p.innerHTML = `<label for="fsNomeAnalise">Nome da análise</label><input id="fsNomeAnalise" name="fsNomeAnalise" maxlength="120" value="${esc(sug)}" autocomplete="off">
        <div class="row">${atualizar ? `<button class="fs-btn sm" type="button" data-id="svNova">Salvar como nova</button><button class="fs-btn sm cta" type="button" data-id="svAtu">Atualizar “${esc(st.atual.nome.slice(0, 18))}${st.atual.nome.length > 18 ? '…' : ''}”</button>` : '<button class="fs-btn sm cta" type="button" data-id="svNova">Salvar análise</button>'}</div><div class="msg" data-id="svMsg" role="alert" hidden></div>`;
      const inp = p.querySelector('#fsNomeAnalise'); setTimeout(() => { inp.focus(); inp.select(); }, 0);
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); salvar(!atualizar); } });
      el('svNova').onclick = (ev) => { ev.stopPropagation(); salvar(true); }; if (atualizar) el('svAtu').onclick = (ev) => { ev.stopPropagation(); salvar(false); };
    }
    async function salvar(nova, nomeFixo) {
      const inp = box.querySelector('#fsNomeAnalise'); const nome = (nomeFixo || (inp && inp.value) || '').trim(); const msg = el('svMsg');
      if (!nome) { if (msg) { msg.textContent = 'Dê um nome para a análise.'; msg.hidden = false; } return; }
      const btns = $$('[data-id="svNova"],[data-id="svAtu"],[data-id="atuRapido"]'); btns.forEach((b) => { b.disabled = true; }); const b0 = btns[btns.length - 1]; const txt0 = b0 ? b0.textContent : ''; if (b0) b0.textContent = 'Salvando…';
      const est = snapshotEstado();
      const body = { name: nome, product: st.produto || null, params: est, summary: { lucro_final: Math.round(R_SIM.final), receita_bruta: Math.round(R_SIM.rb), lucro_final_real: temReal() ? Math.round(R_REAL.final) : null } };
      try {
        if (nova || !st.atual) { const r = await api.criar(body); st.atual = { id: r.id, nome, pode: true }; } else { await api.atualizar(st.atual.id, body); st.atual = { id: st.atual.id, nome, pode: true }; }
        st.base = assinatura(est); el('popSalvar').hidden = true; renderLoaded(); toast('Análise salva: ' + nome); carregaSalvas();
      } catch (e) {
        const t = (e && e.message) || 'Não deu para salvar agora. Tente de novo em alguns segundos.';
        if (msg) { msg.textContent = t; msg.hidden = false; } else toast(t);
      } finally { btns.forEach((b) => { b.disabled = false; }); if (b0 && b0.isConnected) b0.textContent = txt0; }
    }
    function renderPopLista(p) {
      if (!SALVAS.length) { p.innerHTML = '<div class="fs-empty">Nenhuma análise salva ainda. Ajuste a simulação e clique em <b>Salvar análise</b>.</div>'; return; }
      p.innerHTML = SALVAS.map((s) => {
        const lf = s.summary && s.summary.lucro_final; const pa = s.params || {};
        const base = !pa.produto ? 'Sem base' : `${pa.produto} · ${pa.periodo && pa.periodo.de ? br(pa.periodo.de) + '–' + br(pa.periodo.ate) : ''}`;
        const dt = s.updatedAt ? brY(s.updatedAt.slice(0, 10)) : '';
        return `<div class="fs-sv ${st.atual && st.atual.id === s.id ? 'sel' : ''}" role="button" tabindex="0" data-open="${s.id}"><span class="st" title="${esc(s.name)}">${esc(s.name)}</span>
          <span class="sr">${lf != null ? `<span class="lf ${lf >= 0 ? 'v-pos' : 'v-neg'}">${usdK(lf)}</span>` : ''}${confirmaId === s.id ? `<span class="fs-confirm">Apagar?<button class="fs-btn sm" type="button" data-delok="${s.id}">Apagar</button><button class="fs-btn sm" type="button" data-delno="1">Manter</button></span>` : podeMexer(s) ? `<button class="fs-ico" type="button" data-del="${s.id}" title="Apagar análise" aria-label="Apagar análise ${esc(s.name)}">${ico('trash')}</button>` : ''}</span>
          <span class="sm">${esc(base)} · ${esc(s.createdByName || 'alguém do time')} · ${dt}</span></div>`;
      }).join('');
      p.querySelectorAll('[data-open]').forEach((d) => {
        const abrir = (ev) => { if (ev.target.closest('button')) return; abreAnalise(d.dataset.open); p.hidden = true; };
        d.addEventListener('click', abrir); d.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(ev); } });
      });
      p.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); confirmaId = b.dataset.del; renderPopLista(p); }));
      p.querySelectorAll('[data-delno]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); confirmaId = null; renderPopLista(p); }));
      p.querySelectorAll('[data-delok]').forEach((b) => b.addEventListener('click', async (ev) => {
        ev.stopPropagation(); const id = b.dataset.delok; confirmaId = null;
        try { await api.apagar(id); if (st.atual && st.atual.id === id) { st.atual = null; st.base = null; renderLoaded(); } toast('Análise apagada.'); carregaSalvas(); } catch (e) { toast((e && e.message) || 'Não deu para apagar agora. Tente de novo.'); }
      }));
    }
    function abreAnalise(id) {
      const s = SALVAS.find((x) => x.id === id); if (!s) return; const pa = s.params || {};
      const prod = !pa.produto ? null : DADOS.produtos.includes(pa.produto) ? pa.produto : undefined;
      if (prod === undefined) { toast('O produto desta análise não está mais nos dados.'); return; }
      st.produto = prod; st.plat = pa.plat == null ? 'todas' : pa.plat; atualizaBaseUI();
      if (pa.periodo && pa.periodo.de) setPeriodo({ ...pa.periodo });
      st.sim = {}; for (const k of PK) if (pa.sim && pa.sim[k] != null) st.sim[k] = pa.sim[k];
      st.etapas = montaEtapas(prod, (pa.etapas || []).map((e) => ({ ...e })));
      recarregaReal(); st.atual = { id: s.id, nome: s.name, pode: podeMexer(s) }; renderAll(); st.base = assinatura(snapshotEstado()); renderLoaded();
      toast('Análise aberta: ' + s.name);
    }

    /* ---------- início ---------- */
    el('dataInfo').textContent = 'JVZoo + Vupim · dados até ' + brY(DADOS.ate);
    el('fonte').textContent = 'Fonte: ' + DADOS.fonte + ' Devoluções = previsão D60 do modelo do time de dados (safra fechada = real), em % da receita bruta. Call center = líquido de Logicall, Tauk e SalesBound atribuído ao FE mais recente do cliente; safras recentes ainda vão receber mais. Conversão = vendas da etapa ÷ FEs da mesma safra. CPA = CPA pago por venda da etapa. Taxa e fulfillment sem dado usam o padrão definido (7,9% e 9%). Regras: docs/kb/simulador-funil.md.';
    const salvo = ls.get('base');
    if (salvo && (salvo.produto === null || DADOS.produtos.includes(salvo.produto))) { st.produto = salvo.produto; st.plat = salvo.plat ?? 'todas'; setPeriodo(salvo.periodo && salvo.periodo.de ? salvo.periodo : { preset: '30d' }); }
    else { setPeriodo({ preset: '30d' }); const n = fesNoPeriodo(st.periodo.de, st.periodo.ate); let top = 0; n.forEach((v, i) => { if (v > n[top]) top = i; }); st.produto = DADOS.produtos[top] || null; }
    atualizaBaseUI(); st.etapas = montaEtapas(st.produto, []); recarregaReal(); renderAll(); carregaSalvas();

    return {
      destroy() {
        clearTimeout(toastT);
        box.removeEventListener('input', onInput); box.removeEventListener('focusout', onFocusOut); box.removeEventListener('keydown', onKey); box.removeEventListener('click', onClick);
        document.removeEventListener('click', onDocClick);
        box.innerHTML = '';
      },
    };
  }

  window.NSFunnelSim = { montar, calcula };
})();
