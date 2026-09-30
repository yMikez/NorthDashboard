// Bytes → texto sem adivinhar pela extensão. Ordem: BOM (UTF-8/UTF-16) →
// UTF-16 sem BOM (NULs alternados) → UTF-8 estrito → windows-1252.
//
// O fallback importa: o export de transações da Digistore sai em latin-1
// ("Endereço" viraria "Endere?o" e o cabeçalho não casaria), e planilha
// salva como CSV no Excel pt-BR costuma sair em windows-1252.

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
}

const SAMPLE = 8192;

function utf16Guess(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length - (bytes.length % 2), SAMPLE);
  // Amostra pequena demais pra estatística (5 bytes de binário "parecem" UTF-16).
  if (n < 16) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero++;
    if (bytes[i + 1] === 0) oddZero++;
  }
  const half = n / 2;
  // Texto latino em UTF-16: quase todo caractere tem um byte zero.
  const guess = oddZero / half > 0.4 && evenZero / half < 0.05 ? 'utf-16le' : evenZero / half > 0.4 && oddZero / half < 0.05 ? 'utf-16be' : null;
  if (!guess) return null;
  // Binário com zeros alternados não decodifica em texto limpo: confere.
  const sample = new TextDecoder(guess).decode(bytes.subarray(0, n));
  const bad = [...sample].filter((ch) => ch === '\uFFFD' || (ch < ' ' && !'\t\n\r\f\v'.includes(ch))).length;
  return bad / Math.max(1, sample.length) < 0.01 ? guess : null;
}

/**
 * Parece texto? Sem NUL nos primeiros 8 KB (salvo UTF-16) e quase nenhum
 * caractere de controle. Binário desconhecido cai aqui como "não suportado".
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return true;
  if (utf16Guess(bytes)) return true;
  const n = Math.min(bytes.length, SAMPLE);
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    // \t \n \v \f \r e ESC são comuns em texto; o resto é sinal de binário.
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0b && b !== 0x0c && b !== 0x0d && b !== 0x1b) control++;
  }
  return n === 0 || control / n < 0.01;
}

/**
 * windows-1252 precisa do ICU completo no TextDecoder; num Node compilado com
 * ICU reduzido cai pro latin-1 do Buffer (difere só em 0x80–0x9F: € ‘ ’ “ ”).
 */
function decodeWindows1252(bytes: Uint8Array): string {
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  }
}

export function decodeText(bytes: Uint8Array): DecodedText {
  let encoding: TextEncodingName;
  let text: string;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'utf-8';
    text = new TextDecoder('utf-8').decode(bytes.subarray(3));
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  } else {
    const guess = utf16Guess(bytes);
    if (guess) {
      encoding = guess;
      text = new TextDecoder(guess).decode(bytes);
    } else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        encoding = 'utf-8';
      } catch {
        text = decodeWindows1252(bytes);
        encoding = 'windows-1252';
      }
    }
  }
  // BOM que sobrou (UTF-16 decodificado sem strip) e quebras de linha do Windows.
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return { text, encoding };
}
