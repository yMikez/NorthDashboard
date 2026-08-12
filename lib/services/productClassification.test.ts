import { describe, expect, it } from 'vitest';
import { classifyProduct, normalizeFamily } from './productClassification';

// Nomes reais de produção (BuyGoods). Travam a classificação que alimenta o
// funil multi-stage do NeuroMind e o role correto dos downsells.
describe('classifyProduct — BuyGoods nomes reais', () => {
  const cases: Array<[string, string, { type: string; step: number | null; family: string }]> = [
    ['neu6', 'Neuro Mind Pro 6 Bottles', { type: 'FRONTEND', step: 1, family: 'NeuroMindPro' }],
    ['neu6u', 'Neuro Mind Pro 6 Bottles (Upgrade)', { type: 'UPSELL', step: 2, family: 'NeuroMindPro' }],
    ['nig6u', 'Night Calm 6 Bottles (Upgrade)', { type: 'UPSELL', step: 3, family: 'NightCalm' }],
    ['fleimu33u', 'Flex Guard + Immune Guard 6 Bottles (Upgrade)', { type: 'UPSELL', step: 4, family: 'FlexImmuneGuard' }],
    ['neu3d', 'Neuro Mind Pro 3 Bottles (Last Chance)', { type: 'DOWNSELL', step: 2, family: 'NeuroMindPro' }],
    ['nig3d', 'Night Calm 3 Bottles (Last Chance)', { type: 'DOWNSELL', step: 3, family: 'NightCalm' }],
  ];
  it.each(cases)('%s "%s"', (cod, name, exp) => {
    const c = classifyProduct(cod, name);
    expect(c.type).toBe(exp.type);
    expect(c.funnelStep).toBe(exp.step);
    expect(c.family).toBe(exp.family);
  });
});

describe('normalizeFamily', () => {
  it('canonicalizes the 4 known family spellings across CB/D24', () => {
    expect(normalizeFamily('NeuroMindPro')).toBe('NeuroMindPro');
    expect(normalizeFamily('NeuroMind Pro')).toBe('NeuroMindPro');
    expect(normalizeFamily('neurompro')).toBe('NeuroMindPro');
    expect(normalizeFamily('GlycoPulse')).toBe('GlycoPulse');
    expect(normalizeFamily('Glyco Pulse')).toBe('GlycoPulse');
    expect(normalizeFamily('ThermoBurnPro')).toBe('ThermoBurnPro');
    expect(normalizeFamily('Thermo Burn Pro')).toBe('ThermoBurnPro');
    expect(normalizeFamily('MaxVitalize')).toBe('MaxVitalize');
    expect(normalizeFamily('MaxVitaliz')).toBe('MaxVitalize');
    expect(normalizeFamily('Max Vitalize')).toBe('MaxVitalize');
  });

  it('keeps unknown families as-is', () => {
    expect(normalizeFamily('VisionGuard')).toBe('VisionGuard');
  });

  it('canonicalizes Flex-ImmuneGuard com hífen e variações', () => {
    expect(normalizeFamily('Flex-ImmuneGuard')).toBe('FlexImmuneGuard');
    expect(normalizeFamily('Flex Immune Guard')).toBe('FlexImmuneGuard');
    expect(normalizeFamily('FlexImmuneGuard')).toBe('FlexImmuneGuard');
  });

  it('canonicalizes NightCalm', () => {
    expect(normalizeFamily('NightCalm')).toBe('NightCalm');
    expect(normalizeFamily('Night Calm')).toBe('NightCalm');
  });

  it('FlexGuard e ImmuneGuard isolados são famílias próprias', () => {
    expect(normalizeFamily('Flex Guard')).toBe('FlexGuard');
    expect(normalizeFamily('FlexGuard')).toBe('FlexGuard');
    expect(normalizeFamily('Immune Guard')).toBe('ImmuneGuard');
    expect(normalizeFamily('ImmuneGuard')).toBe('ImmuneGuard');
  });

  it('combo "Flex + Imune guard" continua FlexImmuneGuard (não cai em FlexGuard)', () => {
    expect(normalizeFamily('Flex + Imune guard')).toBe('FlexImmuneGuard');
    expect(normalizeFamily('Flex Guard + Immune Guard')).toBe('FlexImmuneGuard');
  });
});

describe('classifyProduct (ClickBank SKU patterns)', () => {
  it('parses FE without variant', () => {
    const r = classifyProduct('NeuroMindPro-6-FE');
    expect(r).toEqual({
      family: 'NeuroMindPro',
      type: 'FRONTEND',
      funnelStep: 1,
      variant: null,
      bottles: 6,
      bonusBottles: null,
    });
  });

  it('parses FE with split-test variant', () => {
    const r = classifyProduct('NeuroMindPro-6-FE-vs2');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('FRONTEND');
    expect(r.variant).toBe('vs2');
    expect(r.bottles).toBe(6);
  });

  it('UP1 → UPSELL step 2', () => {
    const r = classifyProduct('NeuroMindPro-6-UP1-vsnova');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(2);
    expect(r.variant).toBe('vsnova');
  });

  it('UP2 → UPSELL step 3', () => {
    const r = classifyProduct('GlycoPulse-3-UP2');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(3);
    expect(r.family).toBe('GlycoPulse');
  });

  it('DW1 → DOWNSELL', () => {
    const r = classifyProduct('NeuroMindPro-3-DW1-V1');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(2);
    expect(r.variant).toBe('V1');
  });

  it('RC SKU with "{N}e{M}" combo bottles → SMS_RECOVERY, primary + bonus', () => {
    const r = classifyProduct('NeuroMindPro-2e1-RC');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('SMS_RECOVERY');
    expect(r.bottles).toBe(2); // primary count from "2e1"
    expect(r.bonusBottles).toBe(1); // bonus count from "2e1"
  });

  it('RC SKU with "6e2" combo (6 primary + 2 bonus)', () => {
    const r = classifyProduct('NeuroMindPro-6e2-RC');
    expect(r.bottles).toBe(6);
    expect(r.bonusBottles).toBe(2);
    expect(r.type).toBe('SMS_RECOVERY');
  });

  it('non-RC SKU has bonusBottles=null', () => {
    const r = classifyProduct('NeuroMindPro-6-FE');
    expect(r.bonusBottles).toBeNull();
  });

  // Variantes futuras: classifier aceita UP3+, DW2+, DW3+ via regex genérico
  it('UP3 → UPSELL step 4', () => {
    const r = classifyProduct('NeuroMindPro-3-UP3-V1');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(4);
    expect(r.variant).toBe('V1');
  });

  it('DW2 → DOWNSELL step 3', () => {
    const r = classifyProduct('NeuroMindPro-1-DW2-V1');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(3);
    expect(r.variant).toBe('V1');
  });

  it('DW3 sem variante → DOWNSELL step 4', () => {
    const r = classifyProduct('NeuroMindPro-2-DW3');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(4);
    expect(r.variant).toBeNull();
  });
});

describe('classifyProduct (DigiStore name patterns)', () => {
  it('parses M3 (FE) from name', () => {
    const r = classifyProduct('686069', 'M3 - NeuroMind Pro (6 Bottles)');
    expect(r).toEqual({
      family: 'NeuroMindPro',
      type: 'FRONTEND',
      funnelStep: 1,
      variant: null,
      bottles: 6,
      bonusBottles: null,
    });
  });

  it('parses M1 → FRONTEND (CSV truth, even though it sounds like upsell)', () => {
    const r = classifyProduct('667688', 'M1 - Glyco Pulse (2 Bottles)');
    expect(r.type).toBe('FRONTEND');
    expect(r.bottles).toBe(2);
    expect(r.family).toBe('GlycoPulse');
  });

  it('parses UP1-vsnova split-test variant from name', () => {
    const r = classifyProduct('685258', 'UP1-vsnova - MaxVitalize (6 Bottles)');
    expect(r.type).toBe('UPSELL');
    expect(r.variant).toBe('vsnova');
    expect(r.family).toBe('MaxVitalize');
  });

  it('parses DW1 → DOWNSELL', () => {
    const r = classifyProduct('686849', 'DW1 - NeuroMind Pro (3 Bottles)');
    expect(r.type).toBe('DOWNSELL');
    expect(r.family).toBe('NeuroMindPro');
  });

  it('parses RC with "6 + 2 Bottles" → SMS_RECOVERY with bonusBottles', () => {
    const r = classifyProduct('685067', 'RC - Glyco Pulse (6 + 2 Bottles)');
    expect(r.type).toBe('SMS_RECOVERY');
    expect(r.bottles).toBe(6);
    expect(r.bonusBottles).toBe(2);
    expect(r.family).toBe('GlycoPulse');
  });

  // Variantes novas (Apr/2026 +): UP3, DW2, DW3 com famílias novas
  it('UP3 - Flex-ImmuneGuard com bonus bottles', () => {
    const r = classifyProduct('688490', 'UP3 - Flex-ImmuneGuard (3 + 3 Bottles)');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(4);
    expect(r.bottles).toBe(3);
    expect(r.bonusBottles).toBe(3);
  });

  it('DW2 - NightCalm sem bonus', () => {
    const r = classifyProduct('688481', 'DW2 - NightCalm (3 Bottles)');
    expect(r.family).toBe('NightCalm');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(3);
    expect(r.bottles).toBe(3);
    expect(r.bonusBottles).toBeNull();
  });

  it('DW3 - Flex-ImmuneGuard com bonus', () => {
    const r = classifyProduct('688485', 'DW3 - Flex-ImmuneGuard (1 + 1 Bottles)');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(4);
    expect(r.bottles).toBe(1);
    expect(r.bonusBottles).toBe(1);
  });

  // Combo D24 escrito com "+" no nome da família (caso real em prod:
  // "DS3 - FlexGuard + ImmuneGuard (1+1 Bottles)"). Antes ficava family=null
  // (o "+" não estava na classe de chars da família) → produto não listado.
  it('DS3 - FlexGuard + ImmuneGuard combo (+ no nome, 1+1 sem espaços)', () => {
    const r = classifyProduct('700345', 'DS3 - FlexGuard + ImmuneGuard (1+1 Bottles)');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('DOWNSELL');
    expect(r.bottles).toBe(1);
    expect(r.bonusBottles).toBe(1);
  });

  // ── Formato NOVO do Digistore: sem " - ", potes sem parênteses, $preço,
  //    prefixo de variante "V1", tipo DS com letra (DS1a). Antes vazava o
  //    prefixo do tipo pra dentro da família ("M1 Cognizil", "V1 Thermo...").
  it('novo: "M1 Cognizil 2 Bottles" (sem hífen/parênteses) → Cognizil FE', () => {
    const r = classifyProduct('705232', 'M1 Cognizil 2 Bottles');
    expect(r.family).toBe('Cognizil');
    expect(r.type).toBe('FRONTEND');
    expect(r.bottles).toBe(2);
  });

  it('novo: FE de Cognizil consolidam na mesma família', () => {
    const m1 = classifyProduct('705232', 'M1 Cognizil 2 Bottles');
    const m2 = classifyProduct('705238', 'M2 Cognizil 3 Bottles');
    expect(m1.family).toBe('Cognizil');
    expect(m2.family).toBe('Cognizil');
  });

  it('novo: "DS1a Cognizil 3 Bottles $120" (sufixo $preço + DS com letra) → Cognizil DOWNSELL', () => {
    const r = classifyProduct('705244', 'DS1a Cognizil 3 Bottles $120');
    expect(r.family).toBe('Cognizil');
    expect(r.type).toBe('DOWNSELL');
    expect(r.bottles).toBe(3);
  });

  it('novo: "DS3 FlexGuard + ImmuneGuard (1 + 1 Bottles)" (combo sem hífen) → FlexImmuneGuard', () => {
    const r = classifyProduct('705246', 'DS3 FlexGuard + ImmuneGuard (1 + 1 Bottles)');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('DOWNSELL');
    expect(r.bottles).toBe(1);
    expect(r.bonusBottles).toBe(1);
  });

  it('prefixo de variante "V1" é removido da família', () => {
    const r = classifyProduct('690816', 'DW1 - V1 Thermo Burn Pro (3 Bottles)');
    expect(r.family).toBe('ThermoBurnPro');
    expect(r.type).toBe('DOWNSELL');
    expect(r.bottles).toBe(3);
  });

  it('"Digest Flow" (D24) normaliza pra DigestFlow (unifica com BG)', () => {
    const r = classifyProduct('690817', 'DW2 - Digest Flow (3 Bottles)');
    expect(r.family).toBe('DigestFlow');
    expect(r.type).toBe('DOWNSELL');
  });

  it('"ProstaFlow" normaliza consistente', () => {
    expect(classifyProduct('691995', 'DW2 - ProstaFlow (3 Bottles)').family).toBe('ProstaFlow');
    expect(normalizeFamily('Prostaflow')).toBe('ProstaFlow');
  });
});

describe('classifyProduct (cross-sell & unknown)', () => {
  it('returns family=null for non-matching SKU when name also missing', () => {
    const r = classifyProduct('SomeRandomSKU', null);
    expect(r.family).toBeNull();
    expect(r.type).toBe('UPSELL');
  });

  it('returns family=null for unrecognized name pattern', () => {
    const r = classifyProduct('999999', 'Something weird (not a pattern)');
    expect(r.family).toBeNull();
  });
});

describe('classifyProduct (BuyGoods natural-language names)', () => {
  it('Neuro Mind Pro 6 Bottles → FE', () => {
    const r = classifyProduct('neuromindpro', 'Neuro Mind Pro 6 Bottles');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('FRONTEND');
    expect(r.funnelStep).toBe(1);
    expect(r.bottles).toBe(6);
    expect(r.bonusBottles).toBeNull();
  });

  it('Neuro Mind Pro 6 Bottles (Upgrade) → UP1', () => {
    const r = classifyProduct('neuromindpro-up', 'Neuro Mind Pro 6 Bottles (Upgrade)');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(2);
    expect(r.bottles).toBe(6);
  });

  it('Neuro Mind Pro 3 Bottles (Last Chance) → DW1 [parens, formato real]', () => {
    const r = classifyProduct('neu3d', 'Neuro Mind Pro 3 Bottles (Last Chance)');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(2);
    expect(r.bottles).toBe(3);
  });

  it('Neuro Mind Pro 3 Bottles Last Chance → DW1 [sem parens]', () => {
    const r = classifyProduct('neuromindpro-lc', 'Neuro Mind Pro 3 Bottles Last Chance');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(2);
    expect(r.bottles).toBe(3);
  });

  it('Night Calm 6 Bottles (Upgrade) → UP2', () => {
    const r = classifyProduct('nightcalm-up', 'Night Calm 6 Bottles (Upgrade)');
    expect(r.family).toBe('NightCalm');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(3);
    expect(r.bottles).toBe(6);
  });

  it('Night Calm 3 Bottles (Last Chance) → DW2 [formato real BuyGoods]', () => {
    const r = classifyProduct('nig3d', 'Night Calm 3 Bottles (Last Chance)');
    expect(r.family).toBe('NightCalm');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(3);
    expect(r.bottles).toBe(3);
  });

  it('Flex Guard + Immune Guard 6 Bottles (Upgrade) → UP3', () => {
    const r = classifyProduct('flexguard-up', 'Flex Guard + Immune Guard 6 Bottles (Upgrade)');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(4);
    expect(r.bottles).toBe(6);
  });

  it('Flex + Imune guard 3 + 3 Bottles (sem marcador) → FE combo (nova regra)', () => {
    // Convenção 2026-05: sem (Upgrade)/(Downsell)/FREE = FRONTEND.
    // Pra ser UP3 a vendor precisa colocar "(Upgrade 3)" explícito no nome.
    const r = classifyProduct('flexguard-combo', 'Flex + Imune guard 3 + 3 Bottles');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('FRONTEND');
    expect(r.bottles).toBe(3);
    expect(r.bonusBottles).toBe(3);
  });

  it('Flex + Imune guard 1 + 1 Bottles (Last Chance) → DW3 combo', () => {
    const r = classifyProduct('flexguard-lc', 'Flex + Imune guard 1 + 1 Bottles (Last Chance)');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(4);
    expect(r.bottles).toBe(1);
    expect(r.bonusBottles).toBe(1);
  });

  it('Digest Flow + Neuro Mind Pro 6 Bottles (Upgrade) → classifica (família própria)', () => {
    const r = classifyProduct('digneu33u', 'Digest Flow + Neuro Mind Pro 6 Bottles (Upgrade)');
    expect(r.family).not.toBeNull();
    expect(r.bottles).toBe(6);
    expect(r.type).toBe('UPSELL');
  });

  it('Digest Flow + Neuro Mind Pro 2 Bottles (Last Chance) → classifica DOWNSELL', () => {
    const r = classifyProduct('digneu11d', 'Digest Flow + Neuro Mind Pro 2 Bottles (Last Chance)');
    expect(r.family).not.toBeNull();
    expect(r.bottles).toBe(2);
    expect(r.type).toBe('DOWNSELL');
  });

  it('Neuro Mind Pro 2 Bottles (qtd menor) → FE', () => {
    const r = classifyProduct('neuromindpro-2', 'Neuro Mind Pro 2 Bottles');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('FRONTEND');
    expect(r.bottles).toBe(2);
  });

  it('não conflita com Digistore parenthesized name', () => {
    const r = classifyProduct('667690', 'M3 - Glyco Pulse (6 Bottles)');
    expect(r.family).toBe('GlycoPulse');
    expect(r.type).toBe('FRONTEND');
    expect(r.bottles).toBe(6);
  });
});

// Convenção nova (vendor BuyGoods 2026-05): (Upgrade N) / (Downsell N)
// explícito no nome — derruba a regra ancorada-na-família. Sem marcador
// = FRONTEND. FREE em qualquer lugar = SMS_RECOVERY.
describe('classifyProduct (BuyGoods nova convenção: Upgrade N / Downsell N / FREE)', () => {
  it('"Upgrade 1" explícito → UP1 independente da família', () => {
    const r = classifyProduct('any', 'Neuro Mind Pro 6 Bottles (Upgrade 1)');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(2);
    expect(r.bottles).toBe(6);
  });

  it('"Upgrade 2" explícito → UP2 (mesmo em família não-NightCalm)', () => {
    const r = classifyProduct('any', 'Glyco Pulse 6 Bottles (Upgrade 2)');
    expect(r.family).toBe('GlycoPulse');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(3);
  });

  it('"Upgrade 3" explícito → UP3', () => {
    const r = classifyProduct('any', 'Neuro Mind Pro 6 Bottles (Upgrade 3)');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(4);
  });

  it('"Downsell 1" explícito → DW1', () => {
    const r = classifyProduct('any', 'Neuro Mind Pro 3 Bottles (Downsell 1)');
    expect(r.family).toBe('NeuroMindPro');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(2);
    expect(r.bottles).toBe(3);
  });

  it('"Downsell 2" explícito → DW2', () => {
    const r = classifyProduct('any', 'Night Calm 3 Bottles (Downsell 2)');
    expect(r.family).toBe('NightCalm');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(3);
  });

  it('"Downsell 3" explícito → DW3 (mesmo em família NeuroMindPro)', () => {
    const r = classifyProduct('any', 'Neuro Mind Pro 1 Bottle (Downsell 3)');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(4);
    expect(r.bottles).toBe(1);
  });

  it('sem marcador no nome → FRONTEND (qualquer família)', () => {
    const r = classifyProduct('any', 'Glyco Pulse 3 Bottles');
    expect(r.family).toBe('GlycoPulse');
    expect(r.type).toBe('FRONTEND');
    expect(r.funnelStep).toBe(1);
  });

  it('"FREE" no nome → SMS_RECOVERY (recuperação)', () => {
    const r = classifyProduct('any', 'Glyco Pulse 1 FREE Bottle');
    expect(r.type).toBe('SMS_RECOVERY');
    expect(r.funnelStep).toBe(1);
    expect(r.bottles).toBe(1);
  });

  it('"FREE" mesmo com (Upgrade) → SMS_RECOVERY override', () => {
    const r = classifyProduct('any', 'Neuro Mind Pro 2 Bottles FREE Shipping (Upgrade)');
    expect(r.type).toBe('SMS_RECOVERY');
    expect(r.bottles).toBe(2);
  });

  it('"free" em minúscula também detecta', () => {
    const r = classifyProduct('any', 'Night Calm 1 free Bottle');
    expect(r.type).toBe('SMS_RECOVERY');
  });

  it('"freeze" / "freedom" NÃO é detectado como FREE (word boundary)', () => {
    // \bfree\b NÃO casa com "freeze" (next char é "z") — fica como FE.
    const r = classifyProduct('any', 'Freeze Power 6 Bottles');
    expect(r.type).toBe('FRONTEND');
  });

  it('retrocompat: "(Upgrade)" sem N + família NightCalm → UP2', () => {
    const r = classifyProduct('nig6u', 'Night Calm 6 Bottles (Upgrade)');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(3);
  });

  it('retrocompat: "(Last Chance)" sem N + família FlexImmuneGuard → DW3', () => {
    const r = classifyProduct('fleimu', 'Flex Guard + Immune Guard 1 Bottle (Last Chance)');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('DOWNSELL');
    expect(r.funnelStep).toBe(4);
  });

  it('combo "3 + 3 Bottles (Upgrade 3)" preserva bonus', () => {
    const r = classifyProduct('any', 'Flex + Imune Guard 3 + 3 Bottles (Upgrade 3)');
    expect(r.family).toBe('FlexImmuneGuard');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(4);
    expect(r.bottles).toBe(3);
    expect(r.bonusBottles).toBe(3);
  });
});

// NeuroPulsePro vs NeuroMindPro — produtos distintos com codenames idênticos
// no BG. Disambiguação obrigatoriamente vem pelo NOME do IPN (codename é
// ambíguo). Testa que a normalização de família reconhece "Neuro Pulse Pro"
// e que dois nomes diferentes com o mesmo codename produzem famílias
// diferentes.
describe('classifyProduct (BuyGoods collision: NeuroMindPro ↔ NeuroPulsePro)', () => {
  it('"Neuro Pulse Pro 6 Bottles" → NeuroPulsePro FE', () => {
    const r = classifyProduct('neu6', 'Neuro Pulse Pro 6 Bottles');
    expect(r.family).toBe('NeuroPulsePro');
    expect(r.type).toBe('FRONTEND');
    expect(r.bottles).toBe(6);
  });

  it('"Neuro Pulse Pro 3 Bottles (Upgrade 1)" → NeuroPulsePro UP1', () => {
    const r = classifyProduct('neu3u', 'Neuro Pulse Pro 3 Bottles (Upgrade 1)');
    expect(r.family).toBe('NeuroPulsePro');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(2);
  });

  it('"Neuro Pulse 6 Bottles" (sem "Pro") também canonicaliza pra NeuroPulsePro', () => {
    const r = classifyProduct('neu6', 'Neuro Pulse 6 Bottles');
    expect(r.family).toBe('NeuroPulsePro');
  });

  it('mesmo codename, nomes diferentes → famílias diferentes', () => {
    const mindpro = classifyProduct('neu6', 'Neuro Mind Pro 6 Bottles');
    const pulse = classifyProduct('neu6', 'Neuro Pulse Pro 6 Bottles');
    expect(mindpro.family).toBe('NeuroMindPro');
    expect(pulse.family).toBe('NeuroPulsePro');
    expect(mindpro.type).toBe('FRONTEND');
    expect(pulse.type).toBe('FRONTEND');
  });
});

// ── Cartpanda (platform-aware) ───────────────────────────────────────────────
// Família vem do nome (1º segmento / sem "- FE"); o PAPEL é só best-effort aqui
// porque o connector (up_sell_id) é a fonte de verdade. O ponto crítico: FE e
// upsells do MESMO produto têm que cair na MESMA família pro funil conectar.
describe('classifyProduct (cartpanda)', () => {
  it('FE: "Horse Peak Gelatin - FE 6 Bottles" → família "Horse Peak Gelatin"', () => {
    const r = classifyProduct('HORSEPEAKFE-6BOTTLES', 'Horse Peak Gelatin - FE 6 Bottles', 'cartpanda');
    expect(r.family).toBe('Horse Peak Gelatin');
    expect(r.bottles).toBe(6);
  });

  it('upsell com pipe: "Horse Peak Gelatin | 6 Bottles | Upsell 01" → mesma família', () => {
    const r = classifyProduct('HORSEPEAKGELATINUP1-6BOTTLES', 'Horse Peak Gelatin | 6 Bottles | Upsell 01', 'cartpanda');
    expect(r.family).toBe('Horse Peak Gelatin');
    expect(r.bottles).toBe(6);
    expect(r.type).toBe('UPSELL'); // best-effort do nome
  });

  it('FE e upsell do mesmo produto compartilham a família (funil conecta)', () => {
    const fe = classifyProduct('HORSEPEAKFE-3BOTTLES', 'Horse Peak Gelatin - FE 3 Bottles', 'cartpanda');
    const up = classifyProduct('HORSEPEAKGELATINUP1-9BOTTLES', 'Horse Peak Gelatin | 9 Bottles | Upsell 01', 'cartpanda');
    expect(fe.family).toBe(up.family);
    expect(fe.family).toBe('Horse Peak Gelatin');
  });

  it('"Giant Power | 6 Bottles | Upsell 02-Default" → família "Giant Power" (sem pipe sujo)', () => {
    const r = classifyProduct('GIANTPOWERUP2-6BOTTLES', 'Giant Power | 6 Bottles | Upsell 02-Default', 'cartpanda');
    expect(r.family).toBe('Giant Power');
    expect(r.type).toBe('UPSELL');
    expect(r.funnelStep).toBe(3); // UP2 → step 3 (best-effort)
  });

  it('downsell: "Giant Power | 3 Bottles | Downsell 02.1-De" → DOWNSELL, mesma família', () => {
    const r = classifyProduct('GIANTPOWERUP2-3BOTTLES', 'Giant Power | 3 Bottles | Downsell 02.1-De', 'cartpanda');
    expect(r.family).toBe('Giant Power');
    expect(r.type).toBe('DOWNSELL');
  });

  it('combo no nome: "GlycoPulse + ProstaFlow | 3+3 Bottles | Upsell 03" → família + bônus', () => {
    const r = classifyProduct('GLYCOPROSTAUP3-6BOTTLES', 'GlycoPulse + ProstaFlow | 3+3 Bottles | Upsell 03', 'cartpanda');
    expect(r.family).toBe('GlycoPulse + ProstaFlow');
    expect(r.bottles).toBe(3);
    expect(r.bonusBottles).toBe(3);
  });

  it('sem platform=cartpanda, o nome com "|" cairia no classificador errado', () => {
    // Garantia de que o roteamento por plataforma é o que conserta — o mesmo
    // nome sem a flag NÃO produz a família limpa (regex genérico do BuyGoods).
    const certo = classifyProduct('GIANTPOWERUP2-6BOTTLES', 'Giant Power | 6 Bottles | Upsell 02-Default', 'cartpanda');
    const errado = classifyProduct('GIANTPOWERUP2-6BOTTLES', 'Giant Power | 6 Bottles | Upsell 02-Default');
    expect(certo.family).toBe('Giant Power');
    expect(errado.family).not.toBe('Giant Power');
  });
});

// Auditoria prod 2026-08-03: sufixos de variante reais da D24 que caíam no
// fallback (UPSELL sem família) ou viravam FRONTEND com família-lixo, a
// escada do DS (DS2/DS3 ficavam todos em step 2) e as grafias divergentes
// que duplicavam famílias no filtro de Produto.
describe('classifyProduct (D24 sufixos de variante + escada DS — auditoria 2026-08-03)', () => {
  const cases: Array<[string, { type: string; step: number; family: string }]> = [
    ['UP1A - NeuroMind Pro (6 Bottles)',       { type: 'UPSELL', step: 2, family: 'NeuroMindPro' }],
    ['UP1B - NeuroMind Pro (12 Bottles)',      { type: 'UPSELL', step: 2, family: 'NeuroMindPro' }],
    ['UP1.1 - NeuroPulse Pro (12 Bottles)',    { type: 'UPSELL', step: 2, family: 'NeuroPulsePro' }],
    ['UP1.2A - NeuroPulse Pro (12 Bottles)',   { type: 'UPSELL', step: 2, family: 'NeuroPulsePro' }],
    ['UP2b Lumicept Gummies (6 Bottles) $114', { type: 'UPSELL', step: 3, family: 'Lumicept Gummies' }],
    ['DS1 - Retra Burn (3 Bottles)',           { type: 'DOWNSELL', step: 2, family: 'RetraBurn' }],
    ['DS1.1 - Hawaiian Harmony (12 Bottles)',  { type: 'DOWNSELL', step: 2, family: 'Hawaiian Harmony' }],
    ['DS1a Cognizil 3 Bottles $120',           { type: 'DOWNSELL', step: 2, family: 'Cognizil' }],
    ['DS2 - Night Calm (3 Bottles)',           { type: 'DOWNSELL', step: 3, family: 'NightCalm' }],
    ['DS2.1 - Lumicept (6 Bottles)',           { type: 'DOWNSELL', step: 3, family: 'Lumicept' }],
    ['DS3 - Blessed Kit (5 Bottles)',          { type: 'DOWNSELL', step: 4, family: 'Blessed Kit' }],
    ['M1 - AFF -  NeuroMind Pro (2 Bottles)',  { type: 'FRONTEND', step: 1, family: 'NeuroMindPro' }],
    ['M1 - B - Glyco Pulse (2 Bottles)',       { type: 'FRONTEND', step: 1, family: 'GlycoPulse' }],
  ];
  it.each(cases)('"%s"', (name, exp) => {
    const c = classifyProduct('123456', name);
    expect(c.type).toBe(exp.type);
    expect(c.funnelStep).toBe(exp.step);
    expect(c.family).toBe(exp.family);
  });

  it('DS3 combo com grafia invertida → FlexImmuneGuard', () => {
    const c = classifyProduct('123457', 'DS3 ImuneGuard + FlexyGuard (1+1 Bottles)');
    expect(c.type).toBe('DOWNSELL');
    expect(c.funnelStep).toBe(4);
    expect(c.family).toBe('FlexImmuneGuard');
  });
});

describe('normalizeFamily — duplicatas do filtro (auditoria 2026-08-03)', () => {
  it('colapsa grafias divergentes na canônica', () => {
    expect(normalizeFamily('Retra Burn')).toBe('RetraBurn');
    expect(normalizeFamily('RetraBurn')).toBe('RetraBurn');
    expect(normalizeFamily('Mindtrex')).toBe('MindTrex');
    expect(normalizeFamily('MindTrex')).toBe('MindTrex');
    expect(normalizeFamily('Evo Slim')).toBe('EvoSlim');
    expect(normalizeFamily('LumiCept')).toBe('Lumicept');
    expect(normalizeFamily('Luminacept')).toBe('Lumicept');
    expect(normalizeFamily('Horse Peak Gelatin - TK')).toBe('Horse Peak Gelatin');
  });
  it('Lumicept Gummies segue família própria (produto distinto)', () => {
    expect(normalizeFamily('Lumicept Gummies')).toBe('Lumicept Gummies');
  });
});

// Auditoria JVZoo 2026-08-12 — o papel da JVZoo passou a sair do NOME
// (CONNECTOR_ROLE_PLATFORMS perdeu 'jvzoo'), então o classificador precisa
// ler os 28 SKUs reais dessa plataforma sem cair no fallback cego.
describe('classifyProduct — JVZoo (papel pelo nome)', () => {
  it('sem marcador → FRONTEND', () => {
    const c = classifyProduct('446375', 'Neuro Mind Pro 6 Bottles', 'jvzoo');
    expect(c.type).toBe('FRONTEND');
    expect(c.family).toBe('NeuroMindPro');
    expect(c.bottles).toBe(6);
  });

  it('"(Upgrade)" → UPSELL', () => {
    const c = classifyProduct('446376', 'Neuro Mind Pro 6 Bottles (Upgrade)', 'jvzoo');
    expect(c.type).toBe('UPSELL');
    expect(c.family).toBe('NeuroMindPro');
  });

  it('"(Last Chance)" → DOWNSELL (era contado como upsell)', () => {
    const c = classifyProduct('444187', 'Neuro Mind Pro 3 Bottles (Last Chance)', 'jvzoo');
    expect(c.type).toBe('DOWNSELL');
    expect(c.bottles).toBe(3);
  });

  it('"(LastChance)" colado também → DOWNSELL', () => {
    const c = classifyProduct('446217', 'Hawaiian Harmony 6 Bottles (LastChance)', 'jvzoo');
    expect(c.type).toBe('DOWNSELL');
  });

  it('combo abreviado "3B+ ... 3B" ganha família e potes (era COGS $0)', () => {
    const c = classifyProduct('444185', 'FlexGuard 3B+ ImmuneGuard 3B (Upgrade)', 'jvzoo');
    expect(c.family).toBe('FlexImmuneGuard');
    expect(c.bottles).toBe(3);
    expect(c.bonusBottles).toBe(3);
    expect(c.type).toBe('UPSELL');
  });

  it('combo abreviado com espaço antes do "+" também casa', () => {
    const c = classifyProduct('446331', 'FlexGuard 3B + ImmuneGuard 3B (Upgrade)', 'jvzoo');
    expect(c.family).toBe('FlexImmuneGuard');
    expect(c.bottles).toBe(3);
  });

  it('combo abreviado com "(LastChance)" → DOWNSELL (o único papel errado dos 28)', () => {
    const c = classifyProduct('444191', 'FlexGuard 1B+ ImmuneGuard 1B (LastChance)', 'jvzoo');
    expect(c.family).toBe('FlexImmuneGuard');
    expect(c.type).toBe('DOWNSELL');
    expect(c.bottles).toBe(1);
  });

  it('combo sem regra de normalização vira família própria, não null', () => {
    const c = classifyProduct('445591', 'NightCalm 3B + FlexGuard 3B (Upgrade)', 'jvzoo');
    expect(c.family).toBe('NightCalm + FlexGuard');
    expect(c.type).toBe('UPSELL');
  });

  it('combo com "Bottles" por extenso segue no caminho antigo (sem regressão)', () => {
    const c = classifyProduct('x', 'Flex + Imune Guard 3 + 3 Bottles (Upgrade 3)', 'buygoods');
    expect(c.family).toBe('FlexImmuneGuard');
    expect(c.type).toBe('UPSELL');
    expect(c.funnelStep).toBe(4);
  });

  it('nome comum não é sequestrado pelo padrão de combo', () => {
    expect(classifyProduct('x', 'Neuro Mind Pro 6 Bottles', 'jvzoo').type).toBe('FRONTEND');
    expect(classifyProduct('x', 'Hawaiian Harmony 12 Bottles (Upgrade)', 'jvzoo').bottles).toBe(12);
  });
});

describe('classifyProduct — vocabulário de downsell', () => {
  it('"(Downsell)" sem número → DOWNSELL (135 pedidos BuyGoods estavam FRONTEND)', () => {
    const c = classifyProduct('x', 'Luminacept 3 Bottles (Downsell)', 'buygoods');
    expect(c.type).toBe('DOWNSELL');
    expect(c.family).toBe('Lumicept');
  });

  it('"(Down Sell)" com espaço também', () => {
    expect(classifyProduct('x', 'Glyco Pulse 3 Bottles (Down Sell)', 'buygoods').type)
      .toBe('DOWNSELL');
  });

  it('"(Downsell N)" numerado continua ancorando no N', () => {
    const c = classifyProduct('x', 'Neuro Mind Pro 3 Bottles (Downsell 2)', 'buygoods');
    expect(c.type).toBe('DOWNSELL');
    expect(c.funnelStep).toBe(3);
  });

  it('"(Last Chance N)" numerado passou a ser lido (a regex nunca casava)', () => {
    const c = classifyProduct('x', 'Neuro Mind Pro 3 Bottles (Last Chance 2)', 'buygoods');
    expect(c.type).toBe('DOWNSELL');
    expect(c.funnelStep).toBe(3);
  });

  it('"(Last Chance)" sem número segue ancorado na família', () => {
    expect(classifyProduct('x', 'Neuro Mind Pro 3 Bottles (Last Chance)', 'buygoods').funnelStep)
      .toBe(2);
  });
});

describe('normalizeFamily — duplicatas por capitalização', () => {
  it('unifica Memovance na grafia que tem custo cadastrado', () => {
    expect(classifyProduct('x', 'Memovance Pro 6 Bottles', 'jvzoo').family).toBe('Memovance PRO');
    expect(classifyProduct('x', 'Memovance PRO 6 Bottles', 'buygoods').family).toBe('Memovance PRO');
  });

  it('unifica Blessed Kit', () => {
    expect(classifyProduct('x', 'Blessed kit 5 Bottles (Upgrade)', 'jvzoo').family).toBe('Blessed Kit');
  });
});
