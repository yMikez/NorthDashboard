// XLSX → linhas cruas por aba (read-excel-file: só leitura, mantido, sem as
// CVEs do pacote `xlsx` do npm). Chamado DEPOIS da guarda de zip-bomb.
//
// Fórmulas chegam pelo valor em cache (o que o Excel mostrou da última vez);
// datas formatadas chegam como Date em UTC representando o relógio da
// planilha — viram "YYYY-MM-DD[ HH:mm:ss]" sem fuso, igual a um CSV.

import readXlsxFile from 'read-excel-file/node';
import type { RawCell, RawSheet } from '../tables';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateCell(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  return h || m || s ? `${day} ${pad(h)}:${pad(m)}:${pad(s)}` : day;
}

function toRawCell(v: unknown): RawCell {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return dateCell(v);
  return String(v);
}

export async function readXlsxSheets(bytes: Buffer, maxSheets: number): Promise<RawSheet[]> {
  const sheets = await readXlsxFile(bytes);
  return sheets.slice(0, maxSheets).map((s) => ({
    name: s.sheet,
    rows: s.data.map((row) => row.map(toRawCell)),
  }));
}
