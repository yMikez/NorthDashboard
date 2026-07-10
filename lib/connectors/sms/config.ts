// Mapa FIXO das subcontas Twilio da stack de SMS (Mautic → n8n → Twilio).
// 4 subcontas, 1 número cada. Constante de configuração EDITÁVEL AQUI —
// as marcas dos subs 2/3 (reserva) serão definidas depois; quando os
// números forem cadastrados no Twilio, preencher `number` (E.164) pra
// que o `to` do sms_stop case direto com a subconta/marca.
//
// A aba SMS monta um card de saúde por subconta ATIVA; reservas aparecem
// apagadas ("Reserva — sem tráfego"). O ingest usa `subaccountByNumber`
// pra atribuir STOPs (o `to` do sms_stop é o NOSSO número).

export interface SmsSubaccount {
  subIndex: number;
  // null = reserva ainda sem marca definida.
  brand: string | null;
  role: 'active' | 'reserve';
  // Nosso número de envio (E.164, ex "+15559876543"); null até cadastrar.
  number: string | null;
}

export const SMS_SUBACCOUNTS: SmsSubaccount[] = [
  { subIndex: 0, brand: 'NeuroMind', role: 'active', number: null },
  { subIndex: 1, brand: 'Thermo Burn', role: 'active', number: null },
  { subIndex: 2, brand: null, role: 'reserve', number: null },
  { subIndex: 3, brand: null, role: 'reserve', number: null },
];

// utm_source que marca venda vinda dos disparos de SMS. Os links das
// mensagens (Mautic) carregam ?utm_source=smsbrdcst; a Digistore devolve
// os UTMs no IPN e o conector grava em Order.trafficSource. A aba SMS
// agrega a receita dessas vendas (comparação case-insensitive).
export const SMS_UTM_SOURCE = 'smsbrdcst';

export function subaccountByNumber(number: string | null | undefined): SmsSubaccount | null {
  if (!number) return null;
  return SMS_SUBACCOUNTS.find((s) => s.number === number) ?? null;
}

export function subaccountByBrand(brand: string | null | undefined): SmsSubaccount | null {
  if (!brand) return null;
  return SMS_SUBACCOUNTS.find((s) => s.brand === brand) ?? null;
}

export function subaccountByIndex(subIndex: number | null | undefined): SmsSubaccount | null {
  if (subIndex == null) return null;
  return SMS_SUBACCOUNTS.find((s) => s.subIndex === subIndex) ?? null;
}
