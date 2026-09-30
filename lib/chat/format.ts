// Formatação compartilhada dos blocos de resposta do chat — usada pela UI
// (DataTableBlock) E pelo servidor (texto dos blocos no histórico, grader do
// eval). Uma função só: o que o usuário vê é o que se avalia.
//
// Contrato de unidade: format 'percent' recebe PONTOS PERCENTUAIS
// (12.3 → "12.3%"; 0.45 → "0.45%"). A heurística antiga (v ≤ 1 → ×100)
// transformava 0.8% em "80.0%". Fração (0.123) exige format 'fraction'.

export type CellFormat = 'currency' | 'percent' | 'fraction' | 'number' | 'text';

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/** Casas decimais pra percentual: pequenos pedem mais precisão (0,45%). */
function pctDigits(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return 0;
  if (a < 1) return 2;
  if (a < 10) return 1;
  return 1;
}

export function formatCell(value: unknown, format?: CellFormat | string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  switch (format) {
    case 'currency':
      return USD.format(value);
    case 'percent':
      return `${value.toFixed(pctDigits(value))}%`;
    case 'fraction': {
      const pp = value * 100;
      return `${pp.toFixed(pctDigits(pp))}%`;
    }
    case 'number':
      return NUM.format(value);
    case 'text':
      // Coluna de texto com número (ID, ano, SKU) sai como está — "2026",
      // não "2,026".
      return String(value);
    default:
      return NUM.format(value);
  }
}

type AnyBlock = { type?: string; [k: string]: unknown };

function cellText(v: unknown, fmt?: string): string {
  return formatCell(v, fmt).replace(/\|/g, '/');
}

/**
 * Blocos → texto compacto (markdown). Usado:
 *   - no histórico (o modelo lembra da tabela que respondeu, sem JSON cortado
 *     no meio);
 *   - no grader do eval (avalia o que a UI mostra).
 * Nunca corta no meio de uma estrutura: se passar do teto, para ENTRE linhas
 * e diz quantas ficaram de fora.
 */
export function renderBlocksToText(blocks: unknown, maxChars = 12_000): string {
  if (!Array.isArray(blocks)) return '';
  const out: string[] = [];
  let size = 0;
  let omitted = 0;
  const push = (line: string): boolean => {
    if (size + line.length + 1 > maxChars) { omitted += 1; return false; }
    out.push(line);
    size += line.length + 1;
    return true;
  };
  for (const raw of blocks as AnyBlock[]) {
    if (!raw || typeof raw !== 'object') continue;
    switch (raw.type) {
      case 'summary': {
        push(`### ${String(raw.title ?? 'Resumo')}`);
        for (const k of (raw.kpis as AnyBlock[] | undefined) ?? []) {
          const d = k.delta as { value?: string; trend?: string } | undefined;
          push(`- ${String(k.label)}: ${String(k.value)}${d?.value ? ` (${d.value})` : ''}`);
        }
        break;
      }
      case 'insights': {
        for (const i of (raw.insights as AnyBlock[] | undefined) ?? []) {
          push(`- [${String(i.severity ?? 'neutral')}] ${String(i.title)} — ${String(i.value ?? '')} — ${String(i.description ?? '')}`);
        }
        break;
      }
      case 'table': {
        const cols = ((raw.columns as AnyBlock[] | undefined) ?? []).map((c) => ({ key: String(c.key), label: String(c.label ?? c.key), format: c.format as string | undefined }));
        if (raw.title) push(`### ${String(raw.title)}`);
        if (!cols.length) break;
        push(`| ${cols.map((c) => c.label).join(' | ')} |`);
        push(`| ${cols.map(() => '---').join(' | ')} |`);
        const rows = (raw.rows as Array<Record<string, unknown>> | undefined) ?? [];
        for (let i = 0; i < rows.length; i++) {
          if (!push(`| ${cols.map((c) => cellText(rows[i][c.key], c.format)).join(' | ')} |`)) {
            omitted += rows.length - i - 1;
            break;
          }
        }
        break;
      }
      case 'chart': {
        const series = (raw.series as Array<{ name?: string; data?: Array<{ x: unknown; y: unknown }> }> | undefined) ?? [];
        push(`### Gráfico: ${String(raw.title ?? '')}`);
        for (const s of series) {
          const pts = (s.data ?? []).map((p) => `${String(p.x)}=${String(p.y)}`);
          push(`- ${String(s.name ?? 'série')}: ${pts.join(', ')}`);
        }
        break;
      }
      case 'markdown':
        push(String(raw.content ?? ''));
        break;
      default:
        break;
    }
  }
  if (omitted > 0) out.push(`… (+${omitted} linhas omitidas no histórico)`);
  return out.join('\n');
}
