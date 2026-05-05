// SMTP mailer via nodemailer. Config 100% por env vars; ausência de SMTP_*
// faz o sendMail virar no-op + log (não quebra a operação que disparou).
//
// Vars lidas (ver .env.example):
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
//   SMTP_FROM_EMAIL, SMTP_FROM_NAME
//   DASHBOARD_URL — base URL pública (ex: https://dash.thenorthscales.com)
//                   usada nos links dos templates.
//
// Reuso de transporter: criamos 1 vez no boot do processo e reusamos. Se
// faltar config, transporter fica null e sendMail loga + retorna { ok: false }.

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../logger';

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

function loadConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const portStr = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM_EMAIL || user;

  if (!host || !portStr || !user || !pass || !fromEmail) {
    return null;
  }
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port)) return null;

  return {
    host,
    port,
    // SMTP_SECURE=true → SSL puro (port 465). false → STARTTLS (port 587).
    secure: process.env.SMTP_SECURE === 'true',
    user,
    pass,
    fromEmail,
    fromName: process.env.SMTP_FROM_NAME || 'NorthScale',
  };
}

let cachedTransporter: Transporter | null = null;
let cachedConfig: SmtpConfig | null = null;
let initAttempted = false;

function getTransporter(): { transporter: Transporter; cfg: SmtpConfig } | null {
  if (initAttempted) {
    return cachedTransporter && cachedConfig
      ? { transporter: cachedTransporter, cfg: cachedConfig }
      : null;
  }
  initAttempted = true;
  const cfg = loadConfig();
  if (!cfg) {
    logger.warn('[email] SMTP_* env vars ausentes — emails serão skipped');
    return null;
  }
  cachedConfig = cfg;
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  return { transporter: cachedTransporter, cfg };
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  // Plain-text fallback. Se omitido, gerado a partir do HTML por strip básico.
  text?: string;
}

export interface SendMailResult {
  ok: boolean;
  reason?: string;
  messageId?: string;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Envia email via SMTP. Fail-soft: se config ausente OU falha de envio,
 * loga e retorna { ok: false } — caller continua a operação. Não quebra
 * fluxos críticos (criar network, marcar payout).
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const t = getTransporter();
  if (!t) return { ok: false, reason: 'smtp_not_configured' };

  try {
    const info = await t.transporter.sendMail({
      from: `"${t.cfg.fromName}" <${t.cfg.fromEmail}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text || htmlToText(input.html),
    });
    logger.info({ to: input.to, subject: input.subject, messageId: info.messageId }, '[email] sent');
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    logger.error({ err, to: input.to, subject: input.subject }, '[email] send failed');
    return { ok: false, reason: err instanceof Error ? err.message : 'send_failed' };
  }
}

/**
 * Base URL público do dashboard, usado nos links dos templates. Prefere
 * DASHBOARD_URL; se ausente, retorna placeholder pra evitar URLs quebrados.
 */
export function dashboardUrl(): string {
  return process.env.DASHBOARD_URL || 'https://dash.thenorthscales.com';
}
