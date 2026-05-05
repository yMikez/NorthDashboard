// Layout HTML compartilhado pelos templates de email. Inline CSS porque
// clientes de email (Outlook, Gmail) não confiam em <style> externo —
// inline é o padrão da indústria. Largura fixa 600px (max compatível).

export interface LayoutInput {
  title: string;
  preheader?: string;  // Texto invisível mostrado no preview do inbox.
  body: string;        // Conteúdo HTML do corpo (já inline-styled).
  ctaUrl?: string;
  ctaLabel?: string;
  footerNote?: string;
}

export function renderLayout(input: LayoutInput): string {
  const preheader = input.preheader || '';
  const cta = input.ctaUrl && input.ctaLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
         <tr><td align="center" bgcolor="#5BC8FF" style="border-radius: 6px;">
           <a href="${input.ctaUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; font-family: Arial, sans-serif; font-size: 14px; font-weight: 600; color: #03061A; text-decoration: none; border-radius: 6px;">
             ${input.ctaLabel}
           </a>
         </td></tr>
       </table>`
    : '';
  const footerNote = input.footerNote
    ? `<p style="margin: 16px 0 0; font-family: Arial, sans-serif; font-size: 11px; color: #8CA1C8; line-height: 1.5;">${input.footerNote}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${input.title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6fb; font-family: Arial, sans-serif;">
  <span style="display: none; font-size: 1px; color: #f4f6fb;">${preheader}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f4f6fb;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background: #ffffff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
          <tr>
            <td style="padding: 24px 32px 16px; border-bottom: 1px solid #e5eaf3;">
              <div style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 18px; font-weight: 600; color: #0F1F4D; letter-spacing: -0.01em;">
                north<span style="color: #5BC8FF;">scale</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px 32px;">
              <h1 style="margin: 0 0 16px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 20px; font-weight: 600; color: #0F1F4D;">
                ${input.title}
              </h1>
              <div style="font-family: Arial, sans-serif; font-size: 14px; color: #3C4865; line-height: 1.6;">
                ${input.body}
              </div>
              ${cta}
              ${footerNote}
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px 24px; border-top: 1px solid #e5eaf3;">
              <p style="margin: 0; font-family: Arial, sans-serif; font-size: 11px; color: #8CA1C8;">
                Email automatizado · NorthScale Marketing<br>
                Você está recebendo isso como parceiro cadastrado em nossa rede.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
