// Assinatura do webhook da Vupim: X-Webhook-Signature = "sha256=" +
// HMAC-SHA256(segredo do webhook, corpo CRU) em hex. Só vale sobre os bytes
// exatos que chegaram — por isso o n8n repassa o corpo cru (binário) em vez
// do JSON reprocessado.
//
// VUPIM_WEBHOOK_SECRET aceita mais de um segredo separado por vírgula: a
// Vupim recomenda aceitar o antigo e o novo por alguns minutos na troca.

import crypto from 'node:crypto';

export type VupimSignatureResult = 'VALID' | 'INVALID' | 'NOT_CONFIGURED';

export function vupimSecrets(raw: string | undefined | null): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function signVupimBody(rawBody: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifyVupimSignature(rawBody: string, header: string | null, secrets: string[]): VupimSignatureResult {
  if (!secrets.length) return 'NOT_CONFIGURED';
  const received = Buffer.from((header ?? '').trim().toLowerCase());
  for (const secret of secrets) {
    const expected = Buffer.from(signVupimBody(rawBody, secret));
    if (received.length === expected.length && crypto.timingSafeEqual(received, expected)) return 'VALID';
  }
  return 'INVALID';
}
