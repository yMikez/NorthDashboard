// Imagem: o servidor NUNCA decodifica pixels (decisão do dono — sem sharp;
// quem reduz pra ≤ 2000 px é o navegador). Aqui só se lê o cabeçalho
// (image-size) pra validar dimensão e o tipo declarado nele bater com os
// magic bytes, dentro dos tetos da API.

import { imageSize } from 'image-size';
import { ExtractError } from './errors';
import type { ImageMime } from './sniff';
import type { ExtractLimits } from './limits';

const HEADER_TYPE: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface ImageInfo {
  width: number;
  height: number;
}

export function inspectImage(bytes: Buffer, mimeType: ImageMime, limits: ExtractLimits): ImageInfo {
  if (bytes.length > limits.imageMaxBytes) {
    throw new ExtractError(
      'too_large',
      `Imagem maior que ${Math.round(limits.imageMaxBytes / (1024 * 1024))} MB — reduza (ou envie um print) e tente de novo.`,
    );
  }
  let size: { width?: number; height?: number; type?: string };
  try {
    size = imageSize(bytes);
  } catch {
    throw new ExtractError('corrupt', 'Imagem corrompida ou incompleta — salve de novo e reenvie.');
  }
  const { width = 0, height = 0 } = size;
  if (!(width > 0 && height > 0) || (size.type && size.type !== HEADER_TYPE[mimeType])) {
    throw new ExtractError('corrupt', 'Imagem corrompida ou incompleta — salve de novo e reenvie.');
  }
  if (width > limits.imageMaxEdge || height > limits.imageMaxEdge) {
    throw new ExtractError('too_large', `Imagem de ${width}×${height} px passa do limite de ${limits.imageMaxEdge} px por lado — reduza e reenvie.`);
  }
  return { width, height };
}
