// Redes de afiliados — parte PURA (sem banco): leitura dos eventos do n8n e
// das linhas da conferência, e as regras de mescla do contrato
// (docs/integracoes/redes.md):
//   - campo nulo que chega não apaga o gravado;
//   - venda atribuída não volta pra pendente;
//   - a leitura (conferência) vence o evento quando divergem: depois de uma
//     leitura, um evento atrasado só preenche o que ainda está vazio.

export type NetworkSaleSource = 'event' | 'read';

export interface NetworkRef {
  id: string;
  name: string;
  status: string;
  operationMode: string | null;
  jvzooAffiliateIds: string[];
}

export interface MemberRef {
  id: string;
  networkId: string;
  publicId: string | null;
  name: string;
  status: string;
}

/** Campos de network_sales (nomes do model Prisma). null = "não veio". */
export interface NetworkSaleFields {
  networkId: string;
  memberId: string | null;
  conversionId: string | null;
  productId: string | null;
  productName: string | null;
  jvzooProductId: string | null;
  soldAt: Date | null;
  amountUsd: number | null;
  isTest: boolean | null;
  state: string | null;
  refundedAt: Date | null;
  transactionType: string | null;
  attributionStatus: string | null;
  attributionReason: string | null;
  networkCpa: number | null;
  memberAmount: number | null;
  networkMargin: number | null;
  commissionStatus: string | null;
  commissionAvailableAt: Date | null;
  commissionPaidAt: Date | null;
  clickIcCode: string | null;
  clickId: string | null;
  clickedAt: Date | null;
  clickPageUrl: string | null;
  clickReferrer: string | null;
  clickSuspect: boolean | null;
  tid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  sub1: string | null;
  sub2: string | null;
  sub3: string | null;
  sub4: string | null;
  sub5: string | null;
  adClick: Record<string, unknown> | null;
}

export interface ParsedNetworkSale {
  transactionId: string;
  /** paykey da venda (WP-…/AP-…): é o transaction_id do postback S2S */
  paykey: string | null;
  network: NetworkRef;
  member: MemberRef | null;
  fields: NetworkSaleFields;
}

export interface ParsedNetworkCheckout {
  sessionId: string;
  network: NetworkRef;
  member: MemberRef | null;
  productId: string | null;
  jvzooProductId: string | null;
  jvzooClickId: string | null;
  funnelId: string | null;
  at: Date;
  country: string | null;
  tid: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  sub1: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
export const str = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  return t ? t : null;
};
/** Dinheiro do contrato: texto com 2 casas ("69.00"). */
export const money = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const date = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null);

export function parseNetworkRef(v: unknown): NetworkRef | null {
  const n = obj(v);
  const id = str(n?.id);
  if (!n || !id) return null;
  const ids = new Set<string>();
  const one = str(n.jvzoo_affiliate_id);
  if (one) ids.add(one);
  if (Array.isArray(n.jvzoo_affiliate_ids)) for (const x of n.jvzoo_affiliate_ids) { const s = str(x); if (s) ids.add(s); }
  return {
    id,
    name: str(n.name) ?? id,
    status: str(n.status) ?? 'active',
    operationMode: str(n.operation_mode),
    jvzooAffiliateIds: [...ids],
  };
}

export function parseMemberRef(v: unknown, networkId: string): MemberRef | null {
  const m = obj(v);
  const id = str(m?.id);
  if (!m || !id) return null;
  return { id, networkId, publicId: str(m.public_id), name: str(m.name) ?? str(m.public_id) ?? id, status: str(m.status) ?? 'active' };
}

/**
 * Compra (evento do n8n ou item de /conversions). Os dois têm o mesmo
 * formato; a leitura só não traz traffic/postback/jvzoo.
 */
export function parseNetworkSale(body: unknown): ParsedNetworkSale | { error: string } {
  const b = obj(body);
  if (!b) return { error: 'corpo não é objeto' };
  const network = parseNetworkRef(b.network);
  if (!network) return { error: 'network.id ausente' };
  const sale = obj(b.sale) ?? {};
  const transactionId = str(sale.transaction_id) ?? str(obj(b.postback)?.transaction_id);
  if (!transactionId) return { error: 'sale.transaction_id ausente' };
  const member = parseMemberRef(b.member, network.id);
  const product = obj(b.product) ?? {};
  const attribution = obj(b.attribution) ?? {};
  const amounts = obj(b.amounts) ?? {};
  const commission = obj(b.commission) ?? {};
  const click = obj(b.click) ?? {};
  const traffic = obj(b.traffic) ?? {};
  const utm = obj(traffic.utm) ?? obj(click.utm) ?? {};
  const sub = obj(traffic.sub) ?? {};
  const adClick = obj(traffic.ad_click);
  return {
    transactionId,
    paykey: str(sale.paykey),
    network,
    member,
    fields: {
      networkId: network.id,
      memberId: member?.id ?? null,
      conversionId: str(sale.conversion_id),
      productId: str(product.id),
      productName: str(product.name) ?? str(obj(b.jvzoo)?.product_name),
      jvzooProductId: str(product.jvzoo_product_id),
      soldAt: date(sale.sold_at),
      amountUsd: money(sale.amount) ?? money(obj(b.jvzoo)?.amount),
      isTest: bool(sale.is_test),
      state: str(sale.state),
      refundedAt: date(sale.refunded_at),
      transactionType: str(b.transaction_type),
      attributionStatus: str(attribution.status),
      attributionReason: str(attribution.reason),
      networkCpa: money(amounts.network_cpa),
      memberAmount: money(amounts.member_amount),
      networkMargin: money(amounts.network_margin),
      commissionStatus: str(commission.status),
      commissionAvailableAt: date(commission.available_at),
      commissionPaidAt: date(commission.paid_at),
      clickIcCode: str(click.ic_code),
      clickId: str(click.click_id),
      clickedAt: date(click.clicked_at),
      clickPageUrl: str(click.page_url),
      clickReferrer: str(click.referrer),
      clickSuspect: bool(click.suspect),
      // Só o do tráfego: a leitura não traz `traffic`, e o click_id não é o tid.
      tid: str(traffic.tid),
      utmSource: str(utm.source),
      utmMedium: str(utm.medium),
      utmCampaign: str(utm.campaign),
      utmContent: str(utm.content),
      utmTerm: str(utm.term),
      sub1: str(sub.sub1),
      sub2: str(sub.sub2),
      sub3: str(sub.sub3),
      sub4: str(sub.sub4),
      sub5: str(sub.sub5),
      adClick: adClick && Object.values(adClick).some((x) => x != null) ? adClick : null,
    },
  };
}

export function parseNetworkCheckout(body: unknown): ParsedNetworkCheckout | { error: string } {
  const b = obj(body);
  if (!b) return { error: 'corpo não é objeto' };
  const network = parseNetworkRef(b.network);
  if (!network) return { error: 'network.id ausente' };
  const checkout = obj(b.checkout) ?? {};
  const sessionId = str(checkout.session_id) ?? str(obj(b.postback)?.session_id);
  if (!sessionId) return { error: 'checkout.session_id ausente' };
  const traffic = obj(b.traffic) ?? {};
  const utm = obj(traffic.utm) ?? {};
  const product = obj(b.product) ?? {};
  return {
    sessionId,
    network,
    member: parseMemberRef(b.member, network.id),
    productId: str(product.id),
    jvzooProductId: str(product.jvzoo_product_id),
    jvzooClickId: str(checkout.jvzoo_click_id),
    funnelId: str(checkout.funnel_id),
    at: date(checkout.at) ?? date(b.occurred_at) ?? date(b.received_at) ?? new Date(),
    country: str(checkout.country),
    tid: str(traffic.tid),
    utmSource: str(utm.source),
    utmCampaign: str(utm.campaign),
    sub1: str(obj(traffic.sub)?.sub1),
  };
}

/** Linha gravada (o que importa pra mescla). */
export type StoredNetworkSale = Partial<Record<keyof NetworkSaleFields, unknown>> & {
  attributionStatus: string;
  lastSource: string;
};

const ATTRIBUTED = 'attributed';

/**
 * Campos a gravar. `existing` null = criação. Devolve só o que muda (pra um
 * update) — e sempre attributionStatus na criação.
 */
export function mergeNetworkSale(
  existing: StoredNetworkSale | null,
  incoming: NetworkSaleFields,
  source: NetworkSaleSource,
): Partial<NetworkSaleFields> & { attributionStatus?: string; lastSource: NetworkSaleSource } {
  const out: Partial<NetworkSaleFields> & { attributionStatus?: string; lastSource: NetworkSaleSource } = { lastSource: source };
  // Depois de uma leitura, evento atrasado só preenche o que está vazio.
  const fillOnly = existing != null && source === 'event' && existing.lastSource === 'read';
  // Atribuída não volta pra pendente: o evento "pending" chega sem
  // integrante/valores e não pode desfazer o que já foi atribuído.
  const keepAttribution = existing?.attributionStatus === ATTRIBUTED && incoming.attributionStatus === 'pending';
  const attributionKeys = new Set<keyof NetworkSaleFields>(['attributionStatus', 'attributionReason', 'memberId', 'networkCpa', 'memberAmount', 'networkMargin']);
  for (const key of Object.keys(incoming) as Array<keyof NetworkSaleFields>) {
    const value = incoming[key];
    if (value == null) continue;                                     // nulo não apaga
    if (keepAttribution && attributionKeys.has(key)) continue;
    if (fillOnly && existing![key] != null) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  if (!existing) out.attributionStatus = incoming.attributionStatus ?? 'pending';
  return out;
}

/** O que só o evento traz (postback): é o que a marca órfã pode completar. */
const EVENT_ONLY_KEYS: Array<keyof NetworkSaleFields> = [
  'transactionType', 'tid', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
  'sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'adClick',
];

/**
 * O postback S2S da conta da rede manda o paykey (WP-…/AP-…) no lugar do
 * transaction_id da IPN. O evento que chega antes da venda existir no
 * NorthAffiliates fica gravado pelo paykey ("pending"); quando a venda
 * aparece com `sale.paykey`, essa marca órfã é juntada à da venda: o
 * tráfego que veio vazio é preenchido com o dela. Atribuição e valores
 * nunca vêm da órfã (ela é sempre pendente).
 */
export function foldPaykeyMark(incoming: NetworkSaleFields, orphan: StoredNetworkSale): NetworkSaleFields {
  const out = { ...incoming };
  for (const key of EVENT_ONLY_KEYS) {
    if (out[key] == null && orphan[key] != null) (out as Record<string, unknown>)[key] = orphan[key];
  }
  return out;
}

/** Datas do contrato: dia de America/Sao_Paulo (UTC−3 fixo, como o resto do dash). */
export function brtDay(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}
export function brtDayOffset(d: Date, days: number): string {
  return brtDay(new Date(d.getTime() + days * 86_400_000));
}
