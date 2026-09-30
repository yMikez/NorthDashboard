// Catálogo de filtros de teste (entities/normalizeScope/precisionTools):
// grafias reais do banco, incluindo a duplicata Lumicept × LumiCept e o par
// NeuroMindPro × NeuroPulsePro que o matching NÃO pode confundir.

import type { ScopeCatalog } from './entities';

export const TEST_CATALOG: ScopeCatalog = {
  platforms: [
    { slug: 'buygoods', label: 'BuyGoods' },
    { slug: 'cartpanda', label: 'Cartpanda' },
    { slug: 'clickbank', label: 'ClickBank' },
    { slug: 'digistore24', label: 'Digistore24' },
    { slug: 'jvzoo', label: 'JVZoo' },
  ],
  familySpellings: [
    { value: 'NeuroMindPro', skus: 40 },
    { value: 'NeuroPulsePro', skus: 12 },
    { value: 'Lumicept', skus: 5 },
    { value: 'LumiCept', skus: 2 },
    { value: 'Lumicept Gummies', skus: 3 },
    { value: 'GlycoPulse', skus: 20 },
  ],
  mainFamilies: ['GlycoPulse', 'Lumicept', 'Lumicept Gummies', 'NeuroMindPro', 'NeuroPulsePro'],
  familyEntries: [],
  countries: [{ code: 'US', orders: 1000 }, { code: 'CA', orders: 120 }, { code: 'AU', orders: 80 }],
  nsAffiliates: [
    { id: 'aff_1', name: 'Nitro Company', orders: 50 },
    { id: 'aff_2', name: 'Sem Pedido', orders: 0 },
  ],
};
