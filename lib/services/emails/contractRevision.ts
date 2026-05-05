// Email: contrato revisado.
// Disparado quando admin altera termos comerciais da network (commission,
// período, billing email, etc.). Nova versão do contrato é gerada e o
// partner precisa re-aceitar no próximo login.
//
// Conteúdo: aviso da revisão, antes/depois dos termos que mudaram, link
// pro portal pra revisar e aceitar.

import { renderLayout } from './layout';
import { sendMail, dashboardUrl } from '../email';

export interface ContractRevisionInput {
  to: string;
  networkName: string;
  newVersion: number;
  changes: Array<{ field: string; before: string; after: string }>;
}

export async function sendContractRevision(input: ContractRevisionInput): Promise<void> {
  const changesRows = input.changes
    .map((c) => `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5eaf3; font-size: 12px; color: #0F1F4D; font-weight: 600;">${c.field}</td>
        <td style="padding: 8px 0 8px 12px; border-bottom: 1px solid #e5eaf3; font-size: 12px; color: #94621A; text-decoration: line-through;">${c.before}</td>
        <td style="padding: 8px 0 8px 12px; border-bottom: 1px solid #e5eaf3; font-size: 12px; color: #166534; font-weight: 600;">${c.after}</td>
      </tr>
    `)
    .join('');

  const html = renderLayout({
    title: `Contrato atualizado — versão ${input.newVersion}`,
    preheader: `Termos da sua network foram atualizados. Re-aceite necessário.`,
    body: `
      <p style="margin: 0 0 12px;">Olá ${input.networkName},</p>
      <p style="margin: 0 0 16px;">
        Os termos comerciais do seu contrato foram atualizados. Uma nova versão
        (<strong>v${input.newVersion}</strong>) foi gerada e está disponível no
        portal.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f4f6fb; border-radius: 6px; padding: 16px; margin: 16px 0;">
        <tr><td>
          <div style="font-family: Arial, sans-serif; font-size: 11px; color: #8CA1C8; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 12px;">Mudanças nos termos</div>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <thead>
              <tr>
                <th style="text-align: left; font-size: 10px; color: #8CA1C8; font-weight: 600; padding-bottom: 6px;">CAMPO</th>
                <th style="text-align: left; font-size: 10px; color: #8CA1C8; font-weight: 600; padding-bottom: 6px; padding-left: 12px;">ANTES</th>
                <th style="text-align: left; font-size: 10px; color: #8CA1C8; font-weight: 600; padding-bottom: 6px; padding-left: 12px;">DEPOIS</th>
              </tr>
            </thead>
            <tbody>
              ${changesRows}
            </tbody>
          </table>
        </td></tr>
      </table>

      <p style="margin: 16px 0 0;">
        <strong>Próximo passo:</strong> no seu próximo login no portal, você
        verá o contrato atualizado em PDF e precisará marcar a caixa
        <em>"Li e concordo com o contrato"</em> antes de continuar.
      </p>

      <p style="margin: 12px 0 0; font-size: 12px; color: #94621A;">
        ⚠ Comissões já contabilizadas mantêm os termos da época em que foram
        geradas. Apenas vendas a partir desta data usam os novos termos.
      </p>
    `,
    ctaUrl: `${dashboardUrl()}/login`,
    ctaLabel: 'Revisar e aceitar →',
    footerNote: `Esse aviso é automático e disparado a cada nova versão do contrato. Caso tenha dúvidas, responda este email.`,
  });

  await sendMail({
    to: input.to,
    subject: `Contrato atualizado — ${input.networkName} (v${input.newVersion})`,
    html,
  });
}
