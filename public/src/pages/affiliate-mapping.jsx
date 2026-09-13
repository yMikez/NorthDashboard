/* global React, Icon, fmtCurrency, fmtInt, platBadge, fmtDateTime, SkelTableRows */
/* Integração NorthScale Afiliados — espelho do mapeamento de identidade.
     AffiliateMappingPanel   status da integração + fila de NÃO mapeados +
                             afiliados mapeados + ações (admin)
     AffiliateMappingDrawer  o mesmo painel em drawer (botão da aba Afiliados)
     AmMappedChip            chip "mapeado / não mapeado" pras linhas
   API: GET /api/metrics/affiliate-mapping (leitura, quem tem a aba) e
        POST /api/admin/affiliate-mapping (sync/backfill, admin). */

const { useState: useStateAM, useEffect: useEffectAM } = React;

const AM_PLAT_NAMES = { buygoods: 'BuyGoods', digistore24: 'Digistore24', jvzoo: 'JVZoo' };
const AM_INPUT = { padding: '7px 10px', fontSize: 12, color: 'var(--fg1)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--f-mono)', minWidth: 0, width: '100%' };

// Navegação COM reload: o estado global de filtros (app.jsx) é lido da
// URL só no boot, então um pushState não aplicaria `aff`/`search`.
function amGo(route, extra) {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(extra)) { if (v == null || v === '') params.delete(k); else params.set(k, v); }
  const qs = params.toString();
  window.location.assign('/' + route + (qs ? '?' + qs : ''));
}

function amAgo(iso) {
  if (!iso) return 'nunca';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `${Math.floor(s / 60)} min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)} h atrás`;
  return `${Math.floor(s / 86400)} d atrás`;
}

// Chip de identidade no sistema de afiliados. `mapped` = {id, name, status}
// ou null; `platformSlug` diz se a plataforma participa do contrato (CB e
// Cartpanda ficam fora — sem chip).
function AmMappedChip({ mapped, platformSlug, size = 9 }) {
  if (platformSlug && !AM_PLAT_NAMES[platformSlug]) return null;
  const base = { display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--f-mono)', fontSize: size, fontWeight: 600, padding: '1px 6px', borderRadius: 'var(--r-full)', whiteSpace: 'nowrap', border: '1px solid transparent' };
  if (!mapped) {
    return (
      <span title="Conta sem mapeamento no NorthScale Afiliados — está na fila de não mapeados" style={{ ...base, color: 'var(--warning)', background: 'color-mix(in oklab, var(--warning) 12%, transparent)', borderColor: 'color-mix(in oklab, var(--warning) 35%, transparent)' }}>
        <Icon name="alert-triangle" size={size}/> não mapeado
      </span>
    );
  }
  const inactive = mapped.status !== 'active';
  return (
    <span title={`Afiliado do sistema: ${mapped.name} (${mapped.id}) · ${inactive ? 'acesso ao painel não liberado' : 'ativo'}`} style={{ ...base, color: inactive ? 'var(--fg4)' : 'var(--success)', background: `color-mix(in oklab, ${inactive ? 'var(--fg4)' : 'var(--success)'} 12%, transparent)`, borderColor: `color-mix(in oklab, ${inactive ? 'var(--fg4)' : 'var(--success)'} 35%, transparent)` }}>
      <Icon name="link" size={size}/> {mapped.name}{inactive ? ' · inativo' : ''}
    </span>
  );
}

function useAffiliateMapping(tick) {
  const [state, setState] = useStateAM({ status: 'loading', data: null, error: null });
  useEffectAM(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    window.NSApi.fetchAffiliateMapping()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: null }); })
      .catch((err) => { if (!cancelled) setState({ status: 'error', data: null, error: err.message }); });
    return () => { cancelled = true; };
  }, [tick]);
  return state;
}

// Configuração das chaves (admin): as mesmas IntegrationSetting da Logicall.
function AmKeysForm({ onChanged }) {
  const [settings, setSettings] = useStateAM(null);
  const [vals, setVals] = useStateAM({ 'affiliates.dashboardApiKey': '', 'affiliates.integrationApiKey': '', 'affiliates.apiUrl': '' });
  const [busy, setBusy] = useStateAM(null);
  const [msg, setMsg] = useStateAM(null);
  useEffectAM(() => {
    let cancelled = false;
    window.NSApi.adminListIntegrationSettings()
      .then((d) => { if (!cancelled) setSettings(d); })
      .catch(() => { if (!cancelled) setSettings({ settings: [], envOverrides: {} }); });
    return () => { cancelled = true; };
  }, []);
  const current = (key) => settings?.settings?.find((s) => s.key === key);
  const envLocked = (key) => Boolean(settings?.envOverrides?.[key]);
  // `value` explícito: "Limpar" manda '' (apaga) sem depender do state
  // atualizado no mesmo tick.
  async function save(key, value) {
    setBusy(key); setMsg(null);
    try {
      await window.NSApi.adminSaveIntegrationSetting(key, value);
      setSettings(await window.NSApi.adminListIntegrationSettings());
      setVals((v) => ({ ...v, [key]: '' }));
      setMsg({ ok: true, text: value ? 'salvo' : 'apagado' });
      onChanged && onChanged();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(null); }
  }
  const rows = [
    ['affiliates.dashboardApiKey', 'CHAVE QUE ACEITAMOS', 'DASHBOARD_API_KEY deles — X-Api-Key do webhook e do metrics', 'password'],
    ['affiliates.integrationApiKey', 'CHAVE QUE ENVIAMOS', 'INTEGRATION_API_KEY deles — X-Api-Key ao ler o mapping', 'password'],
    ['affiliates.apiUrl', 'URL DA API', 'padrão https://api.thenorthscales.com', 'text'],
  ];
  const rowStyle = { display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) 1fr auto', gap: 8, alignItems: 'center' };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map(([key, label, hint, type]) => (
        <div key={key} style={rowStyle}>
          <span className="f-label" title={hint}>{label}</span>
          <input type={type} style={AM_INPUT} value={vals[key]} onChange={(e) => setVals((v) => ({ ...v, [key]: e.target.value }))}
            placeholder={envLocked(key) ? 'definida por env' : (current(key)?.value || hint)} disabled={envLocked(key)}/>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" disabled={busy != null || !vals[key] || envLocked(key)} onClick={() => save(key, vals[key])}>Salvar</button>
            {current(key) && !envLocked(key) && (
              <button className="btn btn-ghost" disabled={busy != null} title="apagar" onClick={() => save(key, '')}>Limpar</button>
            )}
          </div>
        </div>
      ))}
      {msg && <div style={{ fontSize: 11, color: msg.ok ? 'var(--success)' : 'var(--danger)', fontFamily: 'var(--f-mono)' }}>{msg.text}</div>}
    </div>
  );
}

function AffiliateMappingPanel({ isAdmin, compact = false, onChanged }) {
  const [tick, setTick] = useStateAM(0);
  const [tab, setTab] = useStateAM('unmapped');
  const [busy, setBusy] = useStateAM(null);
  const [msg, setMsg] = useStateAM(null);
  const [showKeys, setShowKeys] = useStateAM(false);
  const [q, setQ] = useStateAM('');
  const state = useAffiliateMapping(tick);
  const d = state.data;
  const st = d?.status;
  const counts = d?.counts;
  const canAct = isAdmin != null ? isAdmin : Boolean(d?.isAdmin);
  const refresh = () => { setTick((t) => t + 1); onChanged && onChanged(); };

  async function act(action, opts) {
    setBusy(action); setMsg(null);
    try {
      const r = await window.NSApi.adminAffiliateMapping(action, opts);
      if (action === 'sync') {
        setMsg({ ok: true, text: `reconciliação ${r.mode}: ${r.items} itens · ${r.applied} aplicados · ${r.unchanged} iguais · ${r.stale} atrasados${r.invalid ? ` · ${r.invalid} inválidos` : ''}${r.removed ? ` · ${r.removed} removidos` : ''}${r.reprocess ? ` · ${r.reprocess.ordersUpdated} pedidos reatribuídos` : ''}` });
      } else {
        setMsg({ ok: true, text: `backfill${r.dryRun ? ' (simulação)' : ''}: ${r.accounts} contas · ${r.resolved} resolvidas · ${r.unresolved} sem mapeamento · ${r.ordersUpdated} pedidos gravados · ${r.queued} enfileiradas` });
      }
      refresh();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(null); }
  }

  const sub = !st ? '' : !st.configured.inbound
    ? 'Chave de entrada não configurada — webhook e metrics respondem 503.'
    : st.running ? 'Reconciliando agora…'
    : st.lastRunAt
      ? `Última reconciliação ${amAgo(st.lastRunAt)} · ${st.lastOk ? 'ok' : `ERRO: ${st.lastError || '?'}`}${st.lastStats && st.lastStats.items != null ? ` · ${st.lastStats.items} itens` : ''} · último webhook ${amAgo(st.lastWebhookAt)}${st.webhooks24h ? ` (${st.webhooks24h} em 24h)` : ''}`
      : `Configurada · aguardando a primeira reconciliação (45 s após o boot)${st.lastWebhookAt ? ` · último webhook ${amAgo(st.lastWebhookAt)}` : ''}`;

  const qn = q.trim().toLowerCase();
  const unmappedRows = (d?.unmapped?.rows || []).filter((r) => !qn || [r.externalId, r.altExternalId, r.nickname].some((x) => (x || '').toLowerCase().includes(qn)));
  const mappedRows = (d?.mapped || []).filter((r) => !qn || r.name.toLowerCase().includes(qn) || r.affiliateId.toLowerCase().includes(qn) || r.platforms.some((p) => p.externalId.includes(qn)));

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head" style={{ flexWrap: 'wrap' }}>
        <div className="panel-title" style={{ minWidth: 0 }}>
          <span className="panel-eyebrow">SISTEMA DE AFILIADOS · NORTHSCALE AFILIADOS</span>
          <div className="panel-sub" style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>{state.status === 'error' ? `Erro: ${state.error}` : sub}</div>
        </div>
        {canAct && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" disabled={busy != null} title="Puxa só o que mudou desde a última rodada (updated_since)" onClick={() => act('sync', {})}>
              <Icon name="refresh" size={12}/> {busy === 'sync' ? 'sincronizando…' : 'Sincronizar'}
            </button>
            <button className="btn btn-ghost" disabled={busy != null} title="Lê o mapping inteiro (carga inicial / recuperação) e reprocessa todas as contas" onClick={() => act('sync', { full: true })}>Carga completa</button>
            <button className="btn btn-ghost" disabled={busy != null} title="Grava o affiliate_id em TODAS as transações históricas das contas mapeadas e enfileira as sem mapeamento" onClick={() => act('backfill', {})}>
              {busy === 'backfill' ? 'processando…' : 'Backfill histórico'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowKeys((v) => !v)} title="Chaves e URL da integração"><Icon name="plug" size={12}/> Chaves</button>
          </div>
        )}
      </div>

      {msg && <div style={{ fontSize: 11, fontFamily: 'var(--f-mono)', color: msg.ok ? 'var(--success)' : 'var(--danger)', marginBottom: 8 }}>{msg.text}</div>}
      {showKeys && canAct && (
        <div style={{ padding: '8px 0 12px', borderBottom: '1px solid var(--border-soft)', marginBottom: 12 }}>
          <AmKeysForm onChanged={refresh}/>
          <div style={{ fontSize: 10, color: 'var(--fg5)', marginTop: 8, fontFamily: 'var(--f-mono)', lineHeight: 1.5 }}>
            Endpoints expostos: POST /api/integrations/affiliates/webhook · GET /api/integrations/affiliates/metrics?period=7d|30d|mtd|custom. Env vars DASHBOARD_API_KEY / INTEGRATION_API_KEY / AFFILIATES_API_URL têm precedência sobre o banco.
          </div>
        </div>
      )}

      {counts && (
        <div className="mini-kpis" style={{ marginBottom: 12 }}>
          <div className="mini-kpi">
            <div className="l">Afiliados mapeados</div>
            <div className="v">{fmtInt(counts.affiliates)}</div>
            <div className="s">{fmtInt(counts.active)} ativos{counts.removed ? ` · ${fmtInt(counts.removed)} removidos` : ''}</div>
          </div>
          <div className="mini-kpi">
            <div className="l">IDs de plataforma</div>
            <div className="v">{fmtInt(counts.platformIds)}</div>
            <div className="s">{Object.entries(counts.byPlatform || {}).map(([k, v]) => `${AM_PLAT_NAMES[k] || k} ${v}`).join(' · ') || '—'}</div>
          </div>
          <div className="mini-kpi">
            <div className="l">Contas do dashboard</div>
            <div className="v">{fmtInt(counts.accountsMapped)}<span style={{ fontSize: 12, color: 'var(--fg4)', marginLeft: 6 }}>mapeadas</span></div>
            <div className="s">{fmtInt(counts.accountsUnmapped)} sem mapeamento (BG · D24 · JVZ)</div>
          </div>
          <div className={`mini-kpi ${d.unmapped.total > 0 ? 'is-alert' : ''}`}>
            <div className="l">Fila de não mapeados</div>
            <div className="v" style={d.unmapped.total > 0 ? { color: 'var(--warning)' } : {}}>{fmtInt(d.unmapped.total)}</div>
            <div className="s">{fmtInt(counts.ordersMapped)} pedidos com affiliate_id</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 10px', flexWrap: 'wrap' }}>
        <div className="seg">
          <button className={tab === 'unmapped' ? 'is-active' : ''} onClick={() => setTab('unmapped')}>Não mapeados<span style={{ marginLeft: 6, opacity: 0.6 }}>{fmtInt(d?.unmapped?.total || 0)}</span></button>
          <button className={tab === 'mapped' ? 'is-active' : ''} onClick={() => setTab('mapped')}>Mapeados<span style={{ marginLeft: 6, opacity: 0.6 }}>{fmtInt((d?.mapped || []).length)}</span></button>
        </div>
        <div className="select-btn" style={{ padding: '0 10px', width: 'min(260px, 100%)' }}>
          <Icon name="search" size={13}/>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ID, nome ou nick…"
            style={{ background: 'transparent', border: 0, color: 'var(--fg1)', outline: 'none', flex: 1, fontFamily: 'var(--f-mono)', fontSize: 12 }}/>
        </div>
        <div style={{ flex: 1 }}/>
        <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={refresh} title="Recarregar"><Icon name="refresh" size={11}/></button>
      </div>

      {tab === 'unmapped' && (
        <div className="tbl-wrap" style={{ margin: 0, padding: 0, maxHeight: compact ? 360 : 560, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Plataforma</th>
                <th title="Identificador que chegou no webhook de venda e não existe no mapeamento (normalizado: minúsculas). É o que precisa ser cadastrado no NorthScale Afiliados.">ID na plataforma</th>
                <th title="Outro identificador do mesmo payload (username/ID numérico)">Alternativo</th>
                <th>Nome no IPN</th>
                <th className="num" title="Eventos de venda que caíram aqui (ou nº de pedidos da conta, no backfill)">Eventos</th>
                <th className="num">Receita 90d</th>
                <th>Primeiro</th>
                <th>Último</th>
                <th>Último pedido</th>
                <th/>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && <SkelTableRows rows={5} cols={10}/>}
              {state.status === 'ready' && unmappedRows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 20, opacity: 0.6 }}>
                  {qn ? 'Nada com esse termo.' : 'Fila vazia — toda venda das 3 plataformas resolveu pra um affiliate_id.'}
                </td></tr>
              )}
              {unmappedRows.map((r) => {
                const pb = platBadge(r.platform);
                return (
                  <tr key={r.id}>
                    <td><span className={`plat ${pb.cls}`}>{pb.short}</span></td>
                    <td className="cell-mono" style={{ fontWeight: 600 }}>{r.externalId}</td>
                    <td className="cell-mono" style={{ color: 'var(--fg4)' }}>{r.altExternalId || '—'}</td>
                    <td>{r.nickname || '—'}</td>
                    <td className="num cell-mono">{fmtInt(r.count)}</td>
                    <td className="num cell-mono" style={{ color: 'var(--money)' }}>{r.revenue90d ? fmtCurrency(r.revenue90d, 'USD', 0) : '—'}</td>
                    <td className="cell-mono" style={{ fontSize: 11 }}>{fmtDateTime(r.firstSeen)}</td>
                    <td className="cell-mono" style={{ fontSize: 11 }}>{fmtDateTime(r.lastSeen)}</td>
                    <td className="cell-mono" style={{ fontSize: 11, color: 'var(--fg4)' }}>{r.eventId || '—'}</td>
                    <td>
                      <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} title="Abrir as transações desta conta"
                        onClick={() => amGo('transactions', { search: r.altExternalId || r.externalId })}>
                        <Icon name="receipt" size={10}/> ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'mapped' && (
        <div className="tbl-wrap" style={{ margin: 0, padding: 0, maxHeight: compact ? 360 : 560, overflowY: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Afiliado (sistema)</th>
                <th>affiliate_id</th>
                <th>Status</th>
                <th>IDs por plataforma</th>
                <th>Atualizado</th>
                <th/>
              </tr>
            </thead>
            <tbody>
              {state.status === 'loading' && <SkelTableRows rows={5} cols={6}/>}
              {state.status === 'ready' && mappedRows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, opacity: 0.6 }}>
                  {qn ? 'Nada com esse termo.' : 'Nenhum afiliado recebido ainda — rode a carga completa ou aguarde o webhook.'}
                </td></tr>
              )}
              {mappedRows.map((r) => (
                <tr key={r.affiliateId} style={r.removed ? { opacity: 0.5 } : undefined}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td className="cell-mono" style={{ fontSize: 11, color: 'var(--fg4)' }}>{r.affiliateId}</td>
                  <td>
                    {r.removed
                      ? <span className="badge neutral">REMOVIDO</span>
                      : r.status === 'active' ? <span className="badge ok">ATIVO</span> : <span className="badge warn">INATIVO</span>}
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {r.platforms.length === 0 && <span style={{ color: 'var(--fg5)' }}>— nenhum</span>}
                    {r.platforms.map((p) => { const pb = platBadge(p.platform); return (
                      <span key={`${p.platform}:${p.externalId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8, marginBottom: 2 }}>
                        <span className={`plat ${pb.cls}`}>{pb.short}</span><span className="cell-mono" style={{ fontSize: 11 }}>{p.externalId}</span>
                      </span>
                    ); })}
                  </td>
                  <td className="cell-mono" style={{ fontSize: 11 }}>{fmtDateTime(r.occurredAt)}</td>
                  <td>
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} title="Filtrar o dashboard por este afiliado"
                      onClick={() => amGo('leaderboard', { aff: r.affiliateId })}>
                      <Icon name="filter" size={10}/> filtrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AffiliateMappingDrawer({ onClose, isAdmin, onChanged }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer" style={{ width: 960, maxWidth: '100vw' }}>
        <div className="drawer-head" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ fontSize: 10 }}>AFILIADOS · MAPEAMENTO</div>
            <h3 style={{ margin: '4px 0 6px' }}>Quem é quem no sistema de afiliados</h3>
            <div style={{ fontSize: 12, color: 'var(--fg4)', maxWidth: 640, lineHeight: 1.45 }}>
              O NorthScale Afiliados é a fonte de verdade da identidade (affiliate_id + IDs em cada plataforma). Cada venda de BuyGoods, Digistore24 e JVZoo é resolvida contra esse espelho; o que não casa entra na fila abaixo até o ID ser cadastrado lá.
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="drawer-body">
          <AffiliateMappingPanel isAdmin={isAdmin} onChanged={onChanged}/>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { AffiliateMappingPanel, AffiliateMappingDrawer, AmMappedChip });
