// Parser do WEBHOOK Cartpanda → NormalizedOrder[].
//
// Um webhook = um pedido com line_items[]. Geramos UMA Order por line item:
//   - FE (up_sell_id=0)        → externalId `${orderId}-${lineId}`, FRONTEND
//   - upsell (up_sell_id>0)    → idem, UPSELL (ou DOWNSELL por up_sell_type)
//   - todas com parentExternalId = funnelSessionId = orderId (a sessão = o
//     pedido). Reprocessar o mesmo evento é idempotente (externalId estável).
//
// Status vem do EVENTO: paid/upsell → APPROVED, refunded → REFUNDED,
// chargeback → CHARGEBACK. Em refund, marca só as linhas reembolsadas (ou
// todas, se nenhuma vier flagada — caso comum de reembolso total).
//
// CPA (affiliate_amount) e taxa da plataforma (cartpanda_pay_split_amount) são
// do PEDIDO → atribuídas à linha FE; os agregados (total cpa/fees/net por
// plataforma) ficam corretos. Receita por linha = price × quantity (preço de
// lista da oferta). NOTA: descontos/cupons de nível-pedido NÃO são subtraídos
// — raro nos funis de nutra do usuário (preço fixo por oferta); se virar
// problema, alocar o desconto por linha.
//
// MOEDA: os amounts (total_price, line.price, split_fee, affiliate_amount) vêm
// na MOEDA DA LOJA (base currency, ex BRL) — `order.currency` é "USD" mesmo em
// loja BRL e NÃO deve ser usado. A Cartpanda manda a taxa base→USD no próprio
// payload (exchange_rate_USD / actual_exchange_rate), por-transação. Convertemos
// tudo pra USD com essa taxa (sem API externa). grossAmountOrig guarda o valor
// na moeda base; grossAmountUsd o convertido. Ver resolveUsd().

import type {
  NormalizedOrder,
  NormalizedOrderStatus,
  NormalizedProductType,
} from '../../shared/types';
import type { CartpandaWebhook, CartpandaOrder, CartpandaLineItem } from './types';

export function parseCartpandaWebhook(wh: CartpandaWebhook): NormalizedOrder[] {
  const order = wh.order;
  if (!order || order.id == null) {
    throw new Error('Cartpanda webhook missing order.id');
  }
  const event = (wh.event || '').toLowerCase();
  const orderId = String(order.id);
  const { baseCcy, toUsd } = resolveUsd(order);
  const orderStatus = mapStatus(event, order);
  const cpaTotal = parseMoney(order.affiliate_amount);
  // Taxa da plataforma = o $ que a Cartpanda reteve (cartpanda_pay_split_amount),
  // não split_fee (que é %/taxa-base). Fallback pro split_fee se ausente.
  const feeTotal = parseMoney(
    order.all_payments?.[0]?.cartpanda_pay_split_amount
    ?? order.payment?.cartpanda_pay_split_amount
    ?? order.payment?.split_fee,
  );
  const country = notEmpty(order.address?.country_code);
  const affId = notEmpty(order.afid);
  const affSlug = notEmpty(order.affiliate_slug);
  const cust = order.customer ?? {};
  const orderedAt = parseTimestamp(order.created_at ?? order.processed_at);
  const vendor = notEmpty(order.shop?.slug) ?? (order.shop_id != null ? String(order.shop_id) : null);
  const lines = order.line_items ?? [];

  // Linha FE = primeira sem up_sell. Carrega o CPA + a taxa do pedido.
  const feIdx = lines.findIndex((l) => lineType(l).type === 'FRONTEND');
  const feLineIdx = feIdx === -1 ? 0 : feIdx;

  // Em refund, se NENHUMA linha vier flagada como reembolsada, é reembolso
  // total → marca todas. Se vier flag, marca só as flagadas.
  const anyLineFlagged = lines.some(
    (l) => Number(l.is_refunded) === 1 || Number(l.refunded_quantity) > 0,
  );

  // Pedido sem line_items (raro) → 1 Order única com o total do pedido.
  if (lines.length === 0) {
    const gross = round2(parseMoney(order.total_price ?? toUnits(order.unformatted_total_price)));
    return [buildOrder({
      orderId, lineSuffix: 'main', productExternalId: orderId, productName: notEmpty(order.name) ?? '',
      type: 'FRONTEND', step: 1, gross, fee: feeTotal, cpa: cpaTotal, status: orderStatus,
      baseCcy, toUsd, country, affId, affSlug, cust, order, orderedAt, vendor, event, lineRaw: null,
    })];
  }

  return lines.map((line, i) => {
    const qty = Number(line.quantity) || 1;
    const gross = round2(parseMoney(line.price) * qty);
    const t = lineType(line);
    const isFe = i === feLineIdx;
    const cpa = isFe ? cpaTotal : 0;
    const fee = isFe ? feeTotal : 0;

    let status = orderStatus;
    if (event === 'order.refunded') {
      const refunded =
        Number(line.is_refunded) === 1 || Number(line.refunded_quantity) > 0 || !anyLineFlagged;
      status = refunded ? 'REFUNDED' : 'APPROVED';
    }

    return buildOrder({
      orderId,
      lineSuffix: String(line.id),
      productExternalId:
        notEmpty(line.sku) ?? (line.product_id != null ? String(line.product_id) : null) ?? notEmpty(line.name) ?? 'unknown',
      productName: notEmpty(line.name) ?? notEmpty(line.title) ?? '',
      type: t.type,
      step: t.step,
      gross,
      fee,
      cpa,
      status,
      baseCcy,
      toUsd,
      country,
      affId,
      affSlug,
      cust,
      order,
      orderedAt,
      vendor,
      event,
      lineRaw: line,
    });
  });
}

// ---------------------- helpers ----------------------

interface BuildArgs {
  orderId: string;
  lineSuffix: string;
  productExternalId: string;
  productName: string;
  type: NormalizedProductType;
  step: number;
  gross: number;   // na moeda base (ex BRL)
  fee: number;     // na moeda base
  cpa: number;     // na moeda base
  status: NormalizedOrderStatus;
  baseCcy: string; // moeda real do pedido (ex BRL)
  toUsd: number;   // multiplicador base→USD (1 se já USD)
  country: string | null;
  affId: string | null;
  affSlug: string | null;
  cust: NonNullable<CartpandaOrder['customer']>;
  order: CartpandaOrder;
  orderedAt: Date;
  vendor: string | null;
  event: string;
  lineRaw: CartpandaLineItem | null;
}

function buildOrder(a: BuildArgs): NormalizedOrder {
  // gross/fee/cpa chegam na moeda base (ex BRL); convertemos pra USD com a taxa
  // do payload. net é calculado já em USD.
  const grossUsd = round2(a.gross * a.toUsd);
  const feeUsd = round2(a.fee * a.toUsd);
  const cpaUsd = round2(a.cpa * a.toUsd);
  const netUsd = round2(grossUsd - feeUsd - cpaUsd);
  return {
    platformSlug: 'cartpanda',
    externalId: `${a.orderId}-${a.lineSuffix}`,
    parentExternalId: a.orderId, // a sessão = o pedido
    previousTransactionId: null,
    vendorAccount: a.vendor,

    productExternalId: a.productExternalId,
    productName: a.productName,
    productType: a.type,

    affiliateExternalId: a.affId ?? a.affSlug,
    affiliateNickname: a.affSlug,

    customerExternalId: notEmpty(a.cust.email) ?? notEmpty(a.order.email),
    customerEmail: notEmpty(a.cust.email) ?? notEmpty(a.order.email),
    customerFirstName: notEmpty(a.cust.first_name),
    customerLastName: notEmpty(a.cust.last_name),
    customerLanguage: null,

    status: a.status,
    eventType: a.event || 'order.paid',
    billingType: 'SINGLE_PAYMENT',
    paySequenceNo: null,
    numberOfInstallments: null,

    currencyOriginal: a.baseCcy,
    grossAmountOrig: a.gross,  // valor na moeda base (ex BRL)
    grossAmountUsd: grossUsd,  // convertido pela taxa do payload
    taxAmount: 0,
    fees: feeUsd,
    netAmountUsd: netUsd,
    cpaPaidUsd: cpaUsd,

    paymentMethod: notEmpty(a.order.payment?.type) ?? notEmpty(a.order.payment_type),
    country: a.country,
    state: notEmpty(a.order.address?.province_code),
    city: notEmpty(a.order.address?.city),

    funnelSessionId: a.orderId,
    funnelStep: a.step,
    clickId: null,
    trackingId: null,
    campaignKey: null,
    trafficSource: null,
    deviceType: null,
    browser: null,

    detailsUrl: notEmpty(a.order.thank_you_page),

    orderedAt: a.orderedAt,
    // rawMetadata enxuto: o payload bruto é gigante (shop_info, settings...).
    // Guardamos só evento + a linha + resumo do pedido.
    rawMetadata: {
      event: a.event,
      orderId: a.orderId,
      lineItem: a.lineRaw as unknown as Record<string, unknown> | null,
      orderSummary: {
        number: a.order.number ?? a.order.order_number ?? null,
        baseCurrency: a.baseCcy,
        usdRate: a.toUsd,
        total_price: a.order.total_price ?? null,
        affiliate_slug: a.order.affiliate_slug ?? null,
        afid: a.order.afid ?? null,
        affiliate_amount: a.order.affiliate_amount ?? null,
        status_id: a.order.status_id ?? null,
      },
    },
  };
}

/**
 * Resolve a moeda base do pedido e o multiplicador base→USD.
 *
 * order.currency é "USD" mesmo em loja BRL → NÃO usar. A moeda real é a da
 * loja (payment.currency / shop.settings_general.base_currency). A taxa é a
 * que a Cartpanda aplicou nesta transação (exchange_rate_USD / actual_exchange
 * _rate), presente no payload. Fallback: deriva da razão valor-pago-USD ÷
 * total-base. Loja já em USD → toUsd = 1 (sem conversão).
 */
function resolveUsd(order: CartpandaOrder): { baseCcy: string; toUsd: number } {
  const pay = order.payment ?? {};
  const altPay = order.all_payments?.[0] ?? order.transactions?.[0] ?? {};
  const baseCcy = (
    pay.currency
    || order.shop_info?.settings_general?.base_currency
    || order.shop?.settings_general?.base_currency
    || order.currency
    || 'USD'
  ).toUpperCase();

  if (baseCcy === 'USD') return { baseCcy, toUsd: 1 };

  let rate = Number(order.exchange_rate_USD ?? pay.actual_exchange_rate ?? altPay.actual_exchange_rate);
  if (!(rate > 0)) {
    // Deriva a taxa do total pago em USD ÷ total na moeda base.
    const paidUsd = Number(pay.actual_price_paid ?? altPay.actual_price_paid);
    const paidCcy = (pay.actual_price_paid_currency ?? altPay.actual_price_paid_currency ?? '').toUpperCase();
    const totalBase = parseMoney(order.total_price);
    if (paidCcy === 'USD' && paidUsd > 0 && totalBase > 0) rate = paidUsd / totalBase;
  }
  return { baseCcy, toUsd: rate > 0 ? rate : 1 };
}

function mapStatus(event: string, order: CartpandaOrder): NormalizedOrderStatus {
  if (event.includes('chargeback') || Number(order.chargeback_received) === 1) return 'CHARGEBACK';
  if (event.includes('refund')) return 'REFUNDED';
  // paid / upsell / created / qualquer outro com pagamento → aprovado.
  return 'APPROVED';
}

/**
 * Papel no funil a partir da linha. up_sell_id>0 ou up_sell_type "Upsell N" →
 * UPSELL (step N+1). "Downsell N" → DOWNSELL. Senão FRONTEND (step 1).
 */
function lineType(line: CartpandaLineItem): { type: NormalizedProductType; step: number } {
  const t = (line.up_sell_type ?? '').toLowerCase();
  if (/down\s*sell|downsell/.test(t)) {
    const n = parseInt((t.match(/(\d+)/) ?? [])[1] ?? '1', 10);
    return { type: 'DOWNSELL', step: n + 1 };
  }
  if (Number(line.up_sell_id) > 0 || /up\s*sell|upsell/.test(t)) {
    const n = parseInt((t.match(/(\d+)/) ?? [])[1] ?? '1', 10);
    return { type: 'UPSELL', step: n + 1 };
  }
  return { type: 'FRONTEND', step: 1 };
}

function notEmpty(v: string | number | undefined | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Parse de valor monetário tolerante: número direto, ou string em formato BR
 * ("1.234,56" → 1234.56; "5,88" → 5.88) ou US ("5.88"). Vírgula seguida de
 * 1-2 dígitos no fim = separador decimal; senão = milhar.
 */
function parseMoney(v: number | string | undefined | null): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toUnits(cents: number | undefined): number {
  return cents != null && Number.isFinite(cents) ? cents / 100 : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Timestamp: ISO com Z/offset → parse direto. "YYYY-MM-DD HH:mm:ss" (formato
 * antigo sem fuso) → tratado como UTC. Payloads novos da Cartpanda usam ISO
 * UTC (.000000Z), então pedidos reais são inequívocos.
 */
function parseTimestamp(raw: string | undefined): Date {
  if (!raw) return new Date();
  const s = String(raw).trim();
  if (s.includes('T') || /[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
