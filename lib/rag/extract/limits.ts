// Tetos da extração. Os que dependem de hardware/uso vêm do env (mesma
// convenção envInt do route do chat); os que a API da Anthropic impõe
// (imagem ≤ 5 MB e ≤ 8000 px) são fixos — acima disso a requisição inteira
// falharia, não só o anexo.

function envInt(name: string, fallback: number, min = 1): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

const MB = 1024 * 1024;

export interface ExtractLimits {
  /** Tamanho máximo de qualquer arquivo (decisão do dono: 25 MB). */
  maxFileBytes: number;
  /** Imagem vai inteira pro modelo: a API recusa acima de 5 MB. */
  imageMaxBytes: number;
  /** Lado máximo aceito pela API (o browser já reduz pra ≤ 2000 px). */
  imageMaxEdge: number;
  /** ZIP (docx/xlsx): entradas e tamanho descompactado — guarda contra zip-bomb. */
  zipMaxEntries: number;
  zipMaxUncompressedBytes: number;
  /** Uma entrada que expande mais que isso por byte comprimido é suspeita. */
  zipMaxRatio: number;
  /** Planilha: células/linhas/colunas carregadas (o resto vira aviso). */
  tableMaxCells: number;
  tableMaxRows: number;
  tableMaxColumns: number;
  tableMaxSheets: number;
  /** Texto extraído guardado (≈ 1M tokens) — acima disso é truncado com aviso. */
  textMaxChars: number;
  /** Páginas de PDF lidas na extração de texto. */
  pdfMaxPages: number;
}

export const EXTRACT_LIMITS: ExtractLimits = {
  maxFileBytes: envInt('CHAT_ATTACH_MAX_FILE_MB', 25) * MB,
  imageMaxBytes: 5 * MB,
  imageMaxEdge: 8000,
  zipMaxEntries: 5000,
  zipMaxUncompressedBytes: envInt('CHAT_ATTACH_ZIP_MAX_MB', 256) * MB,
  zipMaxRatio: 250,
  tableMaxCells: envInt('CHAT_ATTACH_TABLE_MAX_CELLS', 5_000_000),
  tableMaxRows: envInt('CHAT_ATTACH_TABLE_MAX_ROWS', 200_000),
  tableMaxColumns: 500,
  tableMaxSheets: 50,
  textMaxChars: 4_000_000,
  pdfMaxPages: 2000,
};
