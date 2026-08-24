// Formato do GET https://api.logicall.io/transactions?key=&start_date=&end_date=
// Observado em 2026-08-24 (38 transações). É um export de CRM/gateway:
// uma linha por TRANSAÇÃO (SALE hoje; REFUND/VOID/CHARGEBACK previstos pelos
// campos refundReason/chargeback*), com items[] do pedido.

export interface LogicallItem {
  productId?: string;
  transactionItemId?: string;
  product?: string;           // "NeuroMindPro 6 Bottles Special"
  sku?: string;               // "NSNMP6"
  price?: string;
  shipping?: string;
  salesTax?: string;
  quantity?: string;
  fulfillmentStatus?: string; // "PENDING" | "SHIPPED" | ...
  dateShipped?: string;
  dateDelivered?: string;
  trackingNumber?: string;
  productType?: string;       // "OFFER"
}

export interface LogicallTransaction {
  transactionId: number | string;
  parentTxnId?: number | string | null;
  orderId?: string | null;
  clientOrderId?: string | null;
  actualOrderId?: number | string | null;
  customerId?: number | string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  txnType?: string | null;        // "SALE" | "REFUND" | "VOID" | "CHARGEBACK" | ...
  responseType?: string | null;   // "SUCCESS" | "DECLINED" | "ERROR"
  responseText?: string | null;
  totalAmount?: string | null;
  currencyCode?: string | null;
  dateCreated?: string | null;    // "2026-08-22 10:42:47" (wall clock, sem TZ)
  dateUpdated?: string | null;
  orderAgentName?: string | null; // "LC-1287" | "lc-ai-process"
  orderType?: string | null;      // "NEW_SALE" | ...
  billingCycleNumber?: number | string | null;
  isChargedback?: string | number | null;
  chargebackAmount?: string | null;
  chargebackDate?: string | null;
  refundReason?: string | null;
  emailAddress?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  items?: LogicallItem[] | null;
  [k: string]: unknown;
}

export interface LogicallResponse {
  result: string;       // "SUCCESS"
  message?: string;
  totalResults?: number;
  data?: LogicallTransaction[];
}
