/* global React */
// Afiliados › Ranking — nota de 0 a 100 de cada afiliado, curva ABC + S,
// Premissas (pesos, metas, bônus e penalidades) e a página do afiliado com
// todos os pedidos. Regras: docs/kb/ranking-afiliados.md.
//
// A tela em si é o motor do painel de afiliados do time de dados
// (affiliate-ranking-engine.js, gerado — não editar à mão): aqui só buscamos
// os dados e as premissas e montamos o motor dentro do container. A nota é
// calculada no navegador: safra, filtros e premissas mudam sem voltar ao
// servidor. Filtros próprios (a barra global não se aplica: ROUTES_OWN_FILTERS).

const { useState: useStateAR, useEffect: useEffectAR, useRef: useRefAR } = React;

function AffiliateRankingPage({ user }) {
  const boxRef = useRefAR(null);
  const [estado, setEstado] = useStateAR({ carregando: true, erro: null });

  useEffectAR(() => {
    let vivo = true;
    let tela = null;
    Promise.all([window.NSApi.fetchAffiliateRanking(), window.NSApi.fetchAffiliateScoreConfig()])
      .then(([dados, cfg]) => {
        if (!vivo || !boxRef.current) return;
        setEstado({ carregando: false, erro: null });
        if (!dados || !dados.rows || !dados.rows.length) {
          setEstado({ carregando: false, erro: 'Ainda não há vendas de afiliados publicadas pelo time de dados.' });
          return;
        }
        tela = window.NSAfRanking.montar(boxRef.current, {
          dados,
          premissas: cfg && cfg.premissas,
          podeEditar: user?.role === 'ADMIN',
          salvarPremissas: (premissas) => window.NSApi.saveAffiliateScoreConfig(premissas),
          buscarPedidos: (q) => window.NSApi.fetchAffiliateRankingOrders(q),
        });
      })
      .catch((e) => { if (vivo) setEstado({ carregando: false, erro: e.message || String(e) }); });
    return () => { vivo = false; if (tela) tela.destroy(); };
  }, []);

  return (
    <>
      {estado.carregando && (
        <div className="content">
          <SkelMiniKpis/>
          <SkelTablePanel/>
        </div>
      )}
      {estado.erro && (
        <div className="content">
          <div className="panel" style={{ padding: 20, color: 'var(--fg3)' }}>
            Não consegui abrir o ranking: {estado.erro}
          </div>
        </div>
      )}
      <div ref={boxRef}/>
    </>
  );
}

Object.assign(window, { AffiliateRankingPage });
