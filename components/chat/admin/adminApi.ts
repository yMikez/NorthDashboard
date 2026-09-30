// Cliente das APIs admin da IA (base de conhecimento, qualidade, avaliação).
// Toda falha vira AdminApiError com a mensagem PT-BR pronta pra tela
// (adminCore.apiErrorMessage) — o componente só decide ONDE mostrar.

import { apiErrorMessage } from './adminCore';

export class AdminApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Mensagem pra tela de qualquer erro (AdminApiError já vem em PT-BR). */
export function errorText(err: unknown): string {
  if (err instanceof AdminApiError) return err.message;
  return apiErrorMessage(0);
}

async function readBody(res: Response): Promise<unknown> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

interface AdminFetchInit extends Omit<RequestInit, 'body'> {
  /** Corpo JSON (serializado aqui, com Content-Type). */
  json?: unknown;
  body?: BodyInit | null;
}

/**
 * fetch das rotas admin: Accept JSON, corpo JSON opcional, 204 → undefined.
 * Aborto (AbortController) propaga como AbortError — quem chamou ignora.
 */
export async function adminFetch<T>(url: string, init: AdminFetchInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const h = new Headers(headers);
  h.set('Accept', 'application/json');
  let body = rest.body;
  if (json !== undefined) {
    h.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: h, body, credentials: 'same-origin' });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new AdminApiError(0, apiErrorMessage(0));
  }
  const data = await readBody(res);
  if (!res.ok) throw new AdminApiError(res.status, apiErrorMessage(res.status, data));
  return (res.status === 204 ? undefined : data) as T;
}

/**
 * Upload multipart com progresso. fetch não expõe o progresso do ENVIO, e
 * um PDF de 25 MB leva segundos — a barra evita o "travou?" (DS1:
 * atualização relevante anunciada). XHR só aqui.
 */
export function uploadWithProgress<T>(
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new AdminApiError(xhr.status, apiErrorMessage(xhr.status, data)));
    };
    xhr.onerror = () => reject(new AdminApiError(0, apiErrorMessage(0)));
    xhr.onabort = () => reject(new DOMException('Envio cancelado', 'AbortError'));
    if (signal) {
      // XHR ainda não enviado não dispara onabort — rejeita direto.
      if (signal.aborted) {
        reject(new DOMException('Envio cancelado', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}
