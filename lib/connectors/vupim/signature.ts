// Assinatura do webhook da Vupim (X-Webhook-Signature), dois formatos:
//   - com data (todo webhook criado desde 21/10/2026):
//       "t=<unix>,v1=<hex>", v1 = HMAC-SHA256(segredo, "<t>.<corpo cru>");
//       recusa t a mais de 5 min do relógio (entrega copiada não é reaproveitada);
//   - antigo (webhook que não trocou): "sha256=<hex>" do corpo cru.
// Só vale sobre os bytes exatos que chegaram — por isso o n8n repassa o corpo
// cru (binário) em vez do JSON reprocessado.
//
// VUPIM_WEBHOOK_SECRET aceita mais de um segredo separado por vírgula: a
// Vupim recomenda aceitar o antigo e o novo por alguns minutos na troca.

import crypto from 'node:crypto';

export type VupimSignatureResult = 'VALID' | 'INVALID' | 'EXPIRED' | 'NOT_CONFIGURED';

/** Diferença máxima entre o t da assinatura e o nosso relógio (doc: 5 min). */
export const VUPIM_SIGNATURE_TOLERANCE_S = 300;

export function vupimSecrets(raw: string | undefined | null): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

const hmacHex = (secret: string, payload: string) => crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

/** Formato antigo: "sha256=<hex>" do corpo. */
export function signVupimBody(rawBody: string, secret: string): string {
  return 'sha256=' + hmacHex(secret, rawBody);
}

/** Formato com data: "t=<unix>,v1=<hex>" de "<t>.<corpo>". */
export function signVupimTimestamped(rawBody: string, secret: string, t: number): string {
  return `t=${t},v1=${hmacHex(secret, `${t}.${rawBody}`)}`;
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a.trim().toLowerCase());
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function verifyVupimSignature(
  rawBody: string,
  header: string | null,
  secrets: string[],
  nowMs: number = Date.now(),
): VupimSignatureResult {
  if (!secrets.length) return 'NOT_CONFIGURED';
  const h = (header ?? '').trim();
  if (/^sha256=/i.test(h)) {
    return secrets.some((s) => sameHex(h, signVupimBody(rawBody, s))) ? 'VALID' : 'INVALID';
  }
  // t=…,v1=… (pode haver mais de um v1 na troca de segredo).
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of h.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  if (!t || !/^\d+$/.test(t) || !v1.length) return 'INVALID';
  const ok = secrets.some((s) => {
    const expected = hmacHex(s, `${t}.${rawBody}`);
    return v1.some((sig) => sameHex(sig, expected));
  });
  if (!ok) return 'INVALID';
  return Math.abs(nowMs / 1000 - Number(t)) > VUPIM_SIGNATURE_TOLERANCE_S ? 'EXPIRED' : 'VALID';
}
