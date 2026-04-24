export type PlatformSlug = 'clickbank' | 'digistore24';

export type NormalizedProductType = 'FRONTEND' | 'UPSELL' | 'DOWNSELL' | 'BUMP';

export type NormalizedOrderStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REFUNDED'
  | 'CHARGEBACK'
  | 'CANCELED';

export type NormalizedBillingType =
  | 'SINGLE_PAYMENT'
  | 'INSTALLMENT'
  | 'SUBSCRIPTION'
  | 'UNKNOWN';

export interface NormalizedOrder {
  platformSlug: PlatformSlug;
  externalId: string;
  parentExternalId: string | null;
  previousTransactionId: string | null;
  vendorAccount: string | null;

  productExternalId: string;
  productName: string;
  productType: NormalizedProductType;

  affiliateExternalId: string | null;
  affiliateNickname: string | null;

  customerExternalId: string | null;
  customerEmail: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerLanguage: string | null;

  status: NormalizedOrderStatus;
  eventType: string;
  billingType: NormalizedBillingType;
  paySequenceNo: number | null;
  numberOfInstallments: number | null;

  currencyOriginal: string;
  grossAmountOrig: number;
  grossAmountUsd: number;
  taxAmount: number;
  fees: number;
  netAmountUsd: number;
  cpaPaidUsd: number;

  paymentMethod: string | null;
  country: string | null;
  state: string | null;
  city: string | null;

  funnelSessionId: string | null;
  funnelStep: number | null;
  clickId: string | null;
  trackingId: string | null;
  campaignKey: string | null;
  trafficSource: string | null;
  deviceType: string | null;
  browser: string | null;

  detailsUrl: string | null;

  orderedAt: Date;
  rawMetadata: Record<string, unknown>;
}

export type IngestSource =
  | 'n8n-clickbank'
  | 'n8n-digistore24'
  | 'polling-clickbank'
  | 'polling-digistore24';

export interface IngestResult {
  externalId: string;
  platformSlug: PlatformSlug;
  created: boolean;
}
