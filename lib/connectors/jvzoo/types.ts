/**
 * Shape do webhook JVZoo (formato novo, nomes longos — transaction_type,
 * transaction_id, transactionPayouts...) proxied via n8n como
 * form-urlencoded flat. Todos os valores chegam como string; conversão
 * numérica/data acontece no parser.
 *
 * transaction_type observados (JVZIPN): SALE, BILL (rebill), RFND,
 * CGBK (chargeback), INSF (insufficient funds), CANCEL-REBILL,
 * UNCANCEL-REBILL, TEST (botão de teste do painel).
 */
export type JvzooPayload = Record<string, string>;

/** Item do array JSON em transactionPayouts. */
export interface JvzooPayout {
  payee_amount?: string;
  payee_user_id?: string;
  payee_name?: string;
  // 'VENDOR' | 'JV' | 'AFFILIATES' | 'JVZOO DOT COM' (fee da plataforma)
  payout_type?: string;
  payment_processor?: string;
  payout_status?: string;
}
