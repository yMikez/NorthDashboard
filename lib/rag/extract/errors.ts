// Erro de extração com mensagem PT-BR pronta pro usuário e o status HTTP que
// a rota devolve. A mensagem diz O QUE FAZER (converter, remover senha,
// dividir o arquivo) — o chip de anexo mostra exatamente este texto.

export type ExtractErrorCode =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'encrypted'
  | 'corrupt'
  | 'unsafe_archive'
  | 'too_many_cells';

const STATUS: Record<ExtractErrorCode, number> = {
  empty: 422,
  too_large: 413,
  unsupported_type: 415,
  encrypted: 422,
  corrupt: 422,
  unsafe_archive: 422,
  too_many_cells: 413,
};

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  readonly status: number;

  constructor(code: ExtractErrorCode, message: string) {
    super(message);
    this.name = 'ExtractError';
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isExtractError(err: unknown): err is ExtractError {
  return err instanceof ExtractError;
}

export const UNSUPPORTED_MESSAGE =
  'Tipo de arquivo não suportado — use PDF, imagem (PNG, JPG, WebP, GIF), planilha (CSV, TSV, XLSX), DOCX, TXT/MD, JSON ou HTML.';
