// Email: payout marcado como pago.
// Disparado quando admin clica "Marcar pago" em um payout PENDING.
// Conteúdo: confirmação do valor, período coberto, número de comissões,
// método de pagamento (se informado), notas (se informadas), link pro
// portal pra ver o histórico.

import { renderLayout } from './layout';
import { sendMail, dashboardUrl } from '../email';

export interface PayoutPaidInput {
  to: string;
  networkName: string;
  totalUsd: string;            // já formatado: "1.250,30"
  commissionsCount: number;
  periodStart: string;         // já formatado: "01/04/2026"
  periodEnd: string;
  paymentMethod: string | null;
  notes: string | null;
}

export async function sendPayoutPaid(input: PayoutPaidInput): Promise<void> {
  const methodLine = input.paymentMethod
    ? `<div style="font-size: 13px; color: #0F1F4D; margin-top: 4px;"><strong>Método:</strong> ${input.paymentMethod}</div>`
    : '';
  const notesLine = input.notes
    ? `<div style="font-size: 13px; color: #0F1F4D; margin-top: 4px;"><strong>Observações:</strong> ${input.notes}</div>`
    : '';

  const html = renderLayout({
    title: `Pagamento confirmado — USD ${input.totalUsd}`,
    preheader: `Payout de ${input.commissionsCount} comissões processado.`,
    body: `
      <p style="margin: 0 0 12px;">Olá ${input.networkName},</p>
      <p style="margin: 0 0 16px;">
        Confirmamos o pagamento do seu payout. Detalhes abaixo:
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f0fdf4; border-radius: 6px; padding: 16px; margin: 16px 0;">
        <tr><td>
          <div style="font-family: Arial, sans-serif; font-size: 11px; color: #166534; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 6px;">Pagamento processado</div>
          <div style="font-size: 24px; color: #166534; font-weight: 700;">USD ${input.totalUsd}</div>
          <div style="font-size: 13px; color: #0F1F4D; margin-top: 8px;"><strong>Comissões incluídas:</strong> ${input.commissionsCount}</div>
          <div style="font-size: 13px; color: #0F1F4D; margin-top: 4px;"><strong>Período coberto:</strong> ${input.periodStart} → ${input.periodEnd}</div>
          ${methodLine}
          ${notesLine}
        </td></tr>
      </table>

      <p style="margin: 16px 0 0;">
        Você pode ver o histórico completo de pagamentos e comissões no portal.
      </p>
    `,
    ctaUrl: `${dashboardUrl()}/login`,
    ctaLabel: 'Ver no portal →',
    footerNote: `Esse email é o comprovante automático do pagamento. Em caso de divergência, responda este email.`,
  });

  await sendMail({
    to: input.to,
    subject: `Pagamento confirmado — USD ${input.totalUsd} · ${input.networkName}`,
    html,
  });
}
