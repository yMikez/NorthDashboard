// Builder de CSV com convenções pt-BR: separador ';', decimal ',' e BOM
// UTF-8 — abre direto no Excel pt-BR e no Google Sheets sem import wizard.
// (Vírgula como separador + ponto decimal viraria coluna única/data no
// Excel em pt-BR.) Mesmas convenções do downloadCsv client-side em
// public/src/utils.jsx — mudou aqui, mude lá.
//
// Células string têm guarda contra CSV/formula injection: valor começando
// com = + - @ ganha apóstrofo (nickname de afiliado é input externo).

export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  }
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [headers.map(csvCell).join(';')];
  for (const r of rows) lines.push(r.map(csvCell).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
