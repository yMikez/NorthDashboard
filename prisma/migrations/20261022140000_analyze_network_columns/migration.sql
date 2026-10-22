-- Estatística das colunas novas networkId (migração 20261022120000).
-- Sem ela o planner estima "networkId IS NULL" em 0,5% dos pedidos (o
-- default pra coluna nunca analisada) quando é quase 100% — e os filtros
-- networkId IS NULL das abas de afiliados podem trocar pra plano ruim.
ANALYZE "Order";
ANALYZE "Affiliate";
