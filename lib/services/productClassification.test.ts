import { describe, expect, it } from 'vitest';
import { classifyProduct, normalizeFamily } from './productClassification';

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
