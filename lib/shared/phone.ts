// Telefone de CLIENTE guardado só com dígitos (Customer.phone,
// SalesboundTransaction.phone): DDI incluso quando a origem manda, "00" de
// discagem internacional removido, fora de 7–15 dígitos (E.164) = lixo.
// Sem inferir DDI: cada plataforma manda num formato e um "1" chutado
// estragaria número de fora dos EUA. Pra casar dois números (ex.: SMS da
// Twilio em +1…), compare os últimos 10 dígitos.
//
// A mesma regra em SQL está na MV lead_summary (telefone do call center, que
// é guardado cru).

export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

/** Primeiro candidato que vira telefone válido. */
export function firstPhone(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const p = normalizePhone(c);
    if (p) return p;
  }
  return null;
}
