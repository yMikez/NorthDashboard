export type ClickBankTransactionType =
  | 'SALE'
  | 'BILL'
  | 'RFND'
  | 'CGBK'
  | 'INS'
  | 'TEST_SALE'
  | 'TEST_BILL'
  | 'TEST_RFND'
  | 'TEST_CGBK'
  | string;

export type ClickBankLineItemType =
  | 'ORIGINAL'
  | 'UPSELL'
  | 'DOWNSELL'
  | 'BUMP'
  | string;

export interface ClickBankCommonTracking {
  deviceType?: string;
  country?: string;
  trackingType?: string;
  os?: string;
  city?: string;
  useragent?: string;
  clickTimestamp?: string;
  clickId?: string;
  osVersion?: string;
  browser?: string;
  browserVersion?: string;
  deviceModel?: string;
  state?: string;
  deviceBrand?: string;
  browserLang?: string;
}

export interface ClickBankLineItem {
  accountAmount: number;
  affiliatePayout: number;
  downloadUrl?: string;
  itemNo: string;
  lineItemType: ClickBankLineItemType;
  productDiscount?: number;
  productPrice: number;
  productTitle: string;
  quantity: number;
  recurring?: boolean;
  shippable?: boolean;
  shippingAmount?: number;
  shippingLiable?: boolean;
  taxAmount?: number;
}

export interface ClickBankUpsell {
  upsellFlowId?: number;
  upsellFlowName?: string;
  upsellOriginalReceipt?: string;
  upsellSession?: string;
  upsellPath?: string;
}

export interface ClickBankVendorVariables {
  cbitems?: string;
  template?: string;
  ad?: string;
  aff_sub1?: string;
  aff_sub2?: string;
  aff_sub3?: string;
  cbfid?: string;
  traffic_type?: string;
  traffic_source?: string;
  creative?: string;
  offer?: string;
  campaign?: string;
  campaignkey?: string;
  adgroup?: string;
  tid?: string;
  vtid?: string;
  [key: string]: string | undefined;
}

export interface ClickBankCustomerAddress {
  address1?: string;
  address2?: string;
  city?: string;
  country?: string;
  county?: string;
  postalCode?: string;
  state?: string;
}

export interface ClickBankCustomerParty {
  address?: ClickBankCustomerAddress;
  email?: string;
  firstName?: string;
  fullName?: string;
  lastName?: string;
  phoneNumber?: string;
}

export interface ClickBankCustomer {
  shipping?: ClickBankCustomerParty;
  billing?: ClickBankCustomerParty;
}

export interface ClickBankIngestPayload {
  affiliate?: string;
  attemptCount?: number;
  commonTrackingParameters?: ClickBankCommonTracking;
  currency: string;
  customer?: ClickBankCustomer;
  lineItems: ClickBankLineItem[];
  orderLanguage?: string;
  paymentMethod?: string;
  receipt: string;
  role?: string;
  totalAccountAmount: number;
  totalOrderAmount: number;
  totalShippingAmount?: number;
  totalTaxAmount?: number;
  transactionTime: string;
  transactionType: ClickBankTransactionType;
  upsell?: ClickBankUpsell;
  vendor?: string;
  vendorVariables?: ClickBankVendorVariables;
  version?: number;
}
