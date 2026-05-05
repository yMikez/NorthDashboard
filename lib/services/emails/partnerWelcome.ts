// Email: novo partner criado.
// Disparado quando admin cria um User com role NETWORK_PARTNER.
// Conteúdo: boas-vindas, credenciais (email + senha em plain text), link
// pro login, aviso de que vai precisar aceitar o contrato no primeiro
// acesso. Senha vem em plain text porque é a senha que o admin definiu
// agora — primeira vez que o partner vai logar.

import { renderLayout } from './layout';
import { sendMail, dashboardUrl } from '../email';

export interface PartnerWelcomeInput {
  to: string;
  partnerName: string | null;
  networkName: string;
  loginEmail: string;
  loginPassword: string;
  commissionDescription: string; // ex: "USD 25,00 por venda" ou "5% do gross"
  paymentPeriodText: string;     // ex: "a cada 7 dias"
}

export async function sendPartnerWelcome(input: PartnerWelcomeInput): Promise<void> {
  const greeting = input.partnerName ? `Olá, ${input.partnerName}` : 'Olá';
  const html = renderLayout({
    title: `Bem-vindo, ${input.networkName}`,
    preheader: `Acesso ao portal NorthScale liberado. Senha temporária no email.`,
    body: `
      <p style="margin: 0 0 12px;">${greeting},</p>
      <p style="margin: 0 0 16px;">
        Sua network <strong>${input.networkName}</strong> foi cadastrada no portal
        NorthScale. A partir de agora, todas as vendas <em>frontend</em> aprovadas
        de afiliados vinculados à sua network geram comissão automaticamente.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f4f6fb; border-radius: 6px; padding: 16px; margin: 16px 0;">
        <tr><td>
          <div style="font-family: Arial, sans-serif; font-size: 11px; color: #8CA1C8; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 6px;">Termos do contrato</div>
          <div style="font-size: 13px; color: #0F1F4D;"><strong>Comissão:</strong> ${input.commissionDescription}</div>
          <div style="font-size: 13px; color: #0F1F4D; margin-top: 4px;"><strong>Período de pagamento:</strong> ${input.paymentPeriodText}</div>
        </td></tr>
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #fef3e0; border-radius: 6px; padding: 16px; margin: 16px 0;">
        <tr><td>
          <div style="font-family: Arial, sans-serif; font-size: 11px; color: #94621A; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 6px;">Suas credenciais de acesso</div>
          <div style="font-size: 13px; color: #0F1F4D;"><strong>Email:</strong> ${input.loginEmail}</div>
          <div style="font-size: 13px; color: #0F1F4D; margin-top: 4px;"><strong>Senha temporária:</strong> <code style="background: #fff; padding: 2px 6px; border-radius: 3px; font-family: monospace;">${input.loginPassword}</code></div>
          <div style="font-size: 11px; color: #94621A; margin-top: 8px;">⚠ Recomendamos alterar a senha após o primeiro login.</div>
        </td></tr>
      </table>

      <p style="margin: 16px 0 0;">
        No primeiro acesso, você verá o contrato em PDF e precisará marcar a caixa
        <em>"Li e concordo com o contrato"</em> antes de acessar o portal. Esse
        aceite é registrado com data, hora e IP como evidência probatória.
      </p>
    `,
    ctaUrl: `${dashboardUrl()}/login`,
    ctaLabel: 'Acessar o portal →',
    footerNote: `Se você não esperava este email, ignore — sem clique, sem aceite, sem efeito.`,
  });

  await sendMail({
    to: input.to,
    subject: `Acesso ao portal NorthScale — ${input.networkName}`,
    html,
  });
}
