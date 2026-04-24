export type DigistoreEvent =
  | 'on_payment'
  | 'payment'
  | 'on_refund'
  | 'refund'
  | 'on_chargeback'
  | 'chargeback'
  | 'on_payment_missed'
  | 'payment_missed'
  | 'on_payment_denial'
  | 'payment_denial'
  | 'on_rebill_cancelled'
  | 'rebill_cancelled'
  | 'on_rebill_resumed'
  | 'rebill_resumed'
  | 'on_last_paid_day'
  | 'last_paid_day'
  | 'connection_test'
  | string;

export type DigistoreBillingType =
  | 'single_payment'
  | 'installment'
  | 'subscription'
  | string;

/**
 * Shape of a parsed Digistore24 IPN body (Generic IPN type, form-urlencoded flat).
 * All values arrive as strings — numeric/boolean conversion happens in the parser.
 */
export type DigistorePayload = Record<string, string>;
