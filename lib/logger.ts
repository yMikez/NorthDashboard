import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'dashboard' },
  redact: {
    paths: [
      '*.email',
      '*.buyer_email',
      '*.address.email',
      '*.customer.billing.email',
      '*.customer.shipping.email',
      '*.phone_no',
      '*.buyer_phone_no',
    ],
    censor: '***redacted***',
  },
});

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain || !local) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
