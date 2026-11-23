/* global React */
// Análise › Simulador de Funil — metas sobre o real de um produto (conversão de
// cada etapa, CPA, devolução, taxa, fulfillment e lucro do call center) e o
// resultado até o lucro final, com análises salvas por nome.
// Regras: docs/kb/simulador-funil.md.
//
// A tela é o motor funnel-sim-engine.js (JS puro): aqui só buscamos a base e
// montamos o motor no container. A conta é feita no navegador: base, período,
// plataforma e metas mudam sem voltar ao servidor. Filtros próprios (a barra
// global some nesta rota: ROUTES_OWN_FILTERS em shell.jsx).

const { useState: useStateFS, useEffect: useEffectFS, useRef: useRefFS } = React;

function FunnelSimPage({ user }) {
  const boxRef = useRefFS(null);
  const [estado, setEstado] = useStateFS({ carregando: true, erro: null });

  useEffectFS(() => {
    let vivo = true;
    let tela = null;
    window.NSApi.fetchFunnelSimBase()
      .then((dados) => {
        if (!vivo || !boxRef.current) return;
        if (!dados || !dados.linhas || !dados.linhas.length) {
          setEstado({ carregando: false, erro: 'Ainda não há vendas publicadas pelo time de dados para montar o funil.' });
          return;
        }
        setEstado({ carregando: false, erro: null });
        tela = window.NSFunnelSim.montar(boxRef.current, {
          dados,
          user: { id: user?.id, role: user?.role },
          api: {
            listar: () => window.NSApi.fetchFunnelSimulations(),
            criar: (body) => window.NSApi.createFunnelSimulation(body),
            atualizar: (id, body) => window.NSApi.updateFunnelSimulation(id, body),
            apagar: (id) => window.NSApi.deleteFunnelSimulation(id),
          },
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
            Não consegui abrir o simulador: {estado.erro}
          </div>
        </div>
      )}
      <div ref={boxRef}/>
    </>
  );
}

Object.assign(window, { FunnelSimPage });
