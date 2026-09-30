// Redimensionamento de imagem NO NAVEGADOR antes do upload (decisão do dono:
// o servidor valida tipo/tamanho/dimensão pelo cabeçalho e nunca decodifica
// — sem sharp no container). O plano (manter, PNG ou JPEG) vem de
// planImageResize; aqui só a parte que precisa de canvas.

import { JPEG_QUALITY, PNG_KEEP_MAX_BYTES, planImageResize, renameForFormat } from './attachmentRules';

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: File): Promise<Decoded | null> {
  // createImageBitmap aplica a orientação do EXIF (foto de celular deitada
  // chegaria girada ao modelo se desenhássemos os pixels crus).
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* formato que o browser não decodifica em bitmap — tenta <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Devolve o arquivo pronto pro upload: o original (GIF, print pequeno ou
 * imagem que o browser não decodifica — o servidor decide) ou uma cópia
 * redesenhada com lado maior ≤ 2000 px, sem EXIF.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  const decoded = await decode(file);
  if (!decoded) return file;
  try {
    const plan = planImageResize({ width: decoded.width, height: decoded.height, type: file.type, size: file.size });
    if (plan.action === 'keep') return file;

    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const g = canvas.getContext('2d');
    if (!g) return file;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';

    for (const format of plan.formats) {
      // JPEG não tem alfa: fundo branco, senão a transparência vira preto.
      g.clearRect(0, 0, plan.width, plan.height);
      if (format === 'image/jpeg') {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, plan.width, plan.height);
      }
      g.drawImage(decoded.source, 0, 0, plan.width, plan.height);
      const blob = await toBlob(canvas, format, format === 'image/jpeg' ? JPEG_QUALITY : undefined);
      if (!blob) continue;
      const isLast = format === plan.formats[plan.formats.length - 1];
      if (format === 'image/png' && blob.size > PNG_KEEP_MAX_BYTES && !isLast) continue;
      return new File([blob], renameForFormat(file.name, format), { type: format, lastModified: file.lastModified });
    }
    return file;
  } finally {
    decoded.close();
  }
}
