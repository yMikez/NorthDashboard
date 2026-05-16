// Fallback de classificação de produto via IA. O classifier regex
// (productClassification.ts) cobre os padrões documentados de SKU/nome
// (ClickBank "Family-6-FE", DigiStore "M3 - X (6 Bottles)"). Quando um
// produto vem com nome fora desses padrões, family/bottles ficam null
// e o COGS+frete daquele produto vira $0 pra sempre.
//
// Aqui usamos o Claude (mesma API key do chat) pra LER o nome do produto
// e extrair { family, bottles, bonusBottles, type } — preenchendo o gap
// sem precisar de regra regex nova pra cada variação de nome.
//
// Roda sob demanda (botão admin em /costs), NÃO em cada ingestão: chamar
// a API em todo pedido adicionaria latência+custo em 100% dos casos pra
// resolver <5%. O batch pega os mesmos gaps de forma revisável e barata.

import { getAnthropicClient, ANTHROPIC_MODEL } from './ai';
import { normalizeFamily } from './productClassification';
import { logger } from '../logger';

export interface AiClassifyInput {
  id: string;
  externalId: string;
  name: string;
}

export interface AiClassifyResult {
  id: string;
  family: string | null;
  bottles: number | null;
  bonusBottles: number | null;
  type: 'FRONTEND' | 'UPSELL' | 'DOWNSELL' | 'BUMP' | 'SMS_RECOVERY' | null;
  confidence: 'high' | 'medium' | 'low';
}

const BATCH_SIZE = 30;

const SYSTEM = `Você classifica produtos de nutra (suplementos) vendidos via ClickBank/Digistore24.
Dado o NOME e SKU de cada produto, extraia:
- family: a marca/linha do produto, em PascalCase sem espaços (ex: "Glyco Pulse" -> "GlycoPulse", "NeuroMind Pro" -> "NeuroMindPro", "Flex-ImmuneGuard" -> "FlexImmuneGuard"). null se impossível inferir.
- bottles: número de potes/frascos da oferta principal (inteiro). Ex: "(6 Bottles)" -> 6, "3 frascos" -> 3. null se não der pra saber.
- bonusBottles: potes BÔNUS adicionais em combos ("6 + 2 Bottles" -> bonusBottles 2; "Buy 3 Get 3" -> 3). null/0 se não houver.
- type: papel no funil. FRONTEND (oferta de entrada, "M1/M2/M3", "FE"), UPSELL ("UP1/UP2"), DOWNSELL ("DW1/DS"), BUMP (order bump), SMS_RECOVERY ("RC"). null se incerto.
- confidence: "high" se o nome é explícito, "medium" se inferido, "low" se chute.

Responda APENAS com um array JSON, um objeto por produto, na mesma ordem recebida:
[{"id":"...","family":"GlycoPulse","bottles":6,"bonusBottles":0,"type":"FRONTEND","confidence":"high"}, ...]
Sem texto fora do JSON.`;

/**
 * Classifica um lote de produtos via Claude. Resiliente: erro de parse ou
 * de API num batch não derruba os outros — produtos do batch problemático
 * voltam como low-confidence nulos (UI/endpoint decide se ignora).
 */
export async function aiClassifyProducts(
  products: AiClassifyInput[],
): Promise<AiClassifyResult[]> {
  if (products.length === 0) return [];
  const client = getAnthropicClient();
  const out: AiClassifyResult[] = [];

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const userContent = batch
      .map((p) => `id=${p.id} | sku=${p.externalId} | nome="${p.name}"`)
      .join('\n');

    try {
      const resp = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      });
      const text = resp.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
      // Modelo às vezes embrulha em ```json — extrai o array bruto.
      const jsonStr = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const parsed: unknown = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) throw new Error('resposta não é array');

      for (const raw of parsed as Array<Record<string, unknown>>) {
        const id = typeof raw.id === 'string' ? raw.id : null;
        if (!id) continue;
        const familyRaw = typeof raw.family === 'string' && raw.family.trim()
          ? raw.family.trim()
          : null;
        const typeRaw = typeof raw.type === 'string' ? raw.type.toUpperCase() : null;
        const validType =
          typeRaw === 'FRONTEND' || typeRaw === 'UPSELL' || typeRaw === 'DOWNSELL'
          || typeRaw === 'BUMP' || typeRaw === 'SMS_RECOVERY'
            ? (typeRaw as AiClassifyResult['type'])
            : null;
        out.push({
          id,
          family: familyRaw ? normalizeFamily(familyRaw) : null,
          bottles: Number.isFinite(Number(raw.bottles)) && Number(raw.bottles) > 0
            ? Math.round(Number(raw.bottles))
            : null,
          bonusBottles: Number.isFinite(Number(raw.bonusBottles)) && Number(raw.bonusBottles) > 0
            ? Math.round(Number(raw.bonusBottles))
            : null,
          type: validType,
          confidence:
            raw.confidence === 'high' || raw.confidence === 'low'
              ? raw.confidence
              : 'medium',
        });
      }
    } catch (err) {
      logger.error({ err, batchStart: i }, 'aiClassifyProducts batch failed');
      // Batch falhou — devolve nulos low pra esses produtos não sumirem.
      for (const p of batch) {
        out.push({
          id: p.id,
          family: null,
          bottles: null,
          bonusBottles: null,
          type: null,
          confidence: 'low',
        });
      }
    }
  }

  return out;
}
