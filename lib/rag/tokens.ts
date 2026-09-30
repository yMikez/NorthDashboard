// Estimativa de tokens sem ida à API. Texto pt-BR com números e termos do
// dash fica em ~3,6 caracteres por token no tokenizer da família Claude
// (calibrado contra messages.countTokens nos docs de docs/kb). É usado só
// pra dimensionar trechos e orçamentos — nunca pra cobrança.

export const CHARS_PER_TOKEN = 3.6;

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function tokensToChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN));
}
