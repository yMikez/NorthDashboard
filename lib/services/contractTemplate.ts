// Contract generation. Each Network can have many NetworkContract rows
// (versioned). Whenever the commercial terms change (commissionType,
// commissionValue, paymentPeriodValue, paymentPeriodUnit, billingEmail)
// we issue a new version and the partner re-signs.
//
// Renderer: PDFKit (server-side, no browser binary). The same data drives
// (a) the markdown source we persist (auditável) and (b) the binary PDF
// served via /api/admin/networks/[id]/contract.pdf and the partner mirror.

import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import type { Network, NetworkContract } from '@prisma/client';
import { db } from '../db';

const CONTRACTS_DIR = path.join(process.cwd(), 'public', 'uploads', 'contracts');

function ensureDir(): void {
  if (!fs.existsSync(CONTRACTS_DIR)) {
    fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
  }
}

export interface ContractContext {
  networkName: string;
  commissionDescription: string;   // ex: "USD 25,00 por venda" ou "5% do valor bruto"
  paymentPeriodText: string;       // ex: "a cada 7 dias"
  contractStart: string;           // dd/mm/yyyy
  billingEmail: string;
  version: number;
  generatedAt: string;             // dd/mm/yyyy HH:mm
}

const PT_MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                   'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function fmtDateTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(d)} ${hh}:${mi}`;
}

export function buildContext(
  network: Pick<Network,
    'name' | 'commissionType' | 'commissionValue' | 'paymentPeriodValue'
    | 'paymentPeriodUnit' | 'contractStart' | 'billingEmail'>,
  version: number,
): ContractContext {
  const cv = Number(network.commissionValue);
  const commissionDescription = network.commissionType === 'FIXED'
    ? `USD ${cv.toFixed(2).replace('.', ',')} por cada venda frontend aprovada`
    : `${(cv * 100).toFixed(2).replace('.', ',')}% do valor bruto (gross) de cada venda frontend aprovada`;

  const unitLabel = network.paymentPeriodUnit === 'DAYS' ? 'dia(s)'
                  : network.paymentPeriodUnit === 'WEEKS' ? 'semana(s)'
                  : 'mês(es)';
  const paymentPeriodText = `a cada ${network.paymentPeriodValue} ${unitLabel}`;

  return {
    networkName: network.name,
    commissionDescription,
    paymentPeriodText,
    contractStart: fmtDate(network.contractStart),
    billingEmail: network.billingEmail || '(a definir)',
    version,
    generatedAt: fmtDateTime(new Date()),
  };
}

/**
 * Markdown source — persistido em NetworkContract.contentMd como audit
 * trail. NÃO é o PDF; é o conteúdo que gerou o PDF, pra revisão humana.
 */
export function renderMarkdown(ctx: ContractContext): string {
  return `# CONTRATO DE PARCERIA — REDE DE AFILIADOS

**NorthScale Marketing** ("Empresa") e **${ctx.networkName}** ("Parceiro") celebram o presente contrato sob as seguintes condições:

## 1. Objeto

O Parceiro indicará afiliados para promover os produtos comercializados pela Empresa nas plataformas ClickBank e Digistore24. Cada venda frontend (FE) gerada por afiliado vinculado ao Parceiro gera comissão a ser paga ao Parceiro nos termos abaixo.

## 2. Comissão

A Empresa pagará ao Parceiro **${ctx.commissionDescription}** de afiliado vinculado.

A comissão é calculada exclusivamente sobre vendas frontend aprovadas. Reembolsos posteriores não afetam a comissão já contabilizada — uma vez creditada, permanece devida ao Parceiro.

## 3. Período de pagamento

Os pagamentos serão realizados **${ctx.paymentPeriodText}**, a contar da data de início do contrato (${ctx.contractStart}). A cada ciclo, o Parceiro receberá relatório detalhado contendo todas as vendas frontend que originaram a comissão do período.

## 4. Forma de pagamento

Pagamentos serão enviados ao e-mail de cobrança fornecido pelo Parceiro: **${ctx.billingEmail}**. O Parceiro pode atualizar essa informação a qualquer momento mediante solicitação à Empresa.

## 5. Vinculação de afiliados

Afiliados são vinculados ao Parceiro mediante registro pela Empresa nas plataformas habilitadas. A Empresa se reserva o direito de aprovar ou rejeitar afiliados sob responsabilidade do Parceiro. Vendas geradas antes do vínculo formal não geram comissão retroativa.

## 6. Confidencialidade

As partes manterão sigilo sobre dados comerciais (volumes de vendas, comissões, identidade de afiliados, métricas de funil) compartilhados durante a vigência deste contrato. A obrigação de sigilo permanece por 24 (vinte e quatro) meses após a rescisão.

## 7. Vigência e rescisão

Este contrato é firmado por prazo indeterminado. Qualquer parte pode rescindi-lo mediante aviso prévio de 30 (trinta) dias enviado por escrito ao e-mail de contato. Comissões já contabilizadas até a data de rescisão serão pagas no próximo ciclo regular após o encerramento.

## 8. Aceite eletrônico

O aceite eletrônico no portal do Dashboard NorthScale, mediante login autenticado e marcação da caixa "Li e concordo com o contrato acima", possui validade jurídica equivalente à assinatura física, conforme MP 2.200-2/2001 e Lei nº 14.063/2020. O sistema registra data, hora e endereço IP do aceite como evidência probatória.

---

**Versão:** ${ctx.version}
**Data de geração:** ${ctx.generatedAt}
`;
}

/**
 * Generate PDF buffer from contract context. Uses PDFKit's stream API
 * but collected synchronously into a Buffer for simpler API.
 */
export async function renderPdf(ctx: ContractContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info: {
        Title: `Contrato de Parceria — ${ctx.networkName}`,
        Author: 'NorthScale Marketing',
        Subject: 'Contrato de Parceria — Rede de Afiliados',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.font('Helvetica-Bold').fontSize(16)
       .text('CONTRATO DE PARCERIA — REDE DE AFILIADOS', { align: 'center' });
    doc.moveDown(1.5);

    doc.font('Helvetica').fontSize(11);
    doc.text(`NorthScale Marketing ("Empresa") e ${ctx.networkName} ("Parceiro") celebram o presente contrato sob as seguintes condições:`, { align: 'justify' });
    doc.moveDown(1);

    section(doc, '1. Objeto',
      'O Parceiro indicará afiliados para promover os produtos comercializados pela Empresa nas plataformas ClickBank e Digistore24. Cada venda frontend (FE) gerada por afiliado vinculado ao Parceiro gera comissão a ser paga ao Parceiro nos termos abaixo.');

    section(doc, '2. Comissão',
      `A Empresa pagará ao Parceiro ${ctx.commissionDescription} de afiliado vinculado.\n\nA comissão é calculada exclusivamente sobre vendas frontend aprovadas. Reembolsos posteriores não afetam a comissão já contabilizada — uma vez creditada, permanece devida ao Parceiro.`);

    section(doc, '3. Período de pagamento',
      `Os pagamentos serão realizados ${ctx.paymentPeriodText}, a contar da data de início do contrato (${ctx.contractStart}). A cada ciclo, o Parceiro receberá relatório detalhado contendo todas as vendas frontend que originaram a comissão do período.`);

    section(doc, '4. Forma de pagamento',
      `Pagamentos serão enviados ao e-mail de cobrança fornecido pelo Parceiro: ${ctx.billingEmail}. O Parceiro pode atualizar essa informação a qualquer momento mediante solicitação à Empresa.`);

    section(doc, '5. Vinculação de afiliados',
      'Afiliados são vinculados ao Parceiro mediante registro pela Empresa nas plataformas habilitadas. A Empresa se reserva o direito de aprovar ou rejeitar afiliados sob responsabilidade do Parceiro. Vendas geradas antes do vínculo formal não geram comissão retroativa.');

    section(doc, '6. Confidencialidade',
      'As partes manterão sigilo sobre dados comerciais (volumes de vendas, comissões, identidade de afiliados, métricas de funil) compartilhados durante a vigência deste contrato. A obrigação de sigilo permanece por 24 (vinte e quatro) meses após a rescisão.');

    section(doc, '7. Vigência e rescisão',
      'Este contrato é firmado por prazo indeterminado. Qualquer parte pode rescindi-lo mediante aviso prévio de 30 (trinta) dias enviado por escrito ao e-mail de contato. Comissões já contabilizadas até a data de rescisão serão pagas no próximo ciclo regular após o encerramento.');

    section(doc, '8. Aceite eletrônico',
      'O aceite eletrônico no portal do Dashboard NorthScale, mediante login autenticado e marcação da caixa "Li e concordo com o contrato acima", possui validade jurídica equivalente à assinatura física, conforme MP 2.200-2/2001 e Lei nº 14.063/2020. O sistema registra data, hora e endereço IP do aceite como evidência probatória.');

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(10)
       .text(`Versão: ${ctx.version}`, { continued: false });
    doc.font('Helvetica').fontSize(10)
       .text(`Data de geração: ${ctx.generatedAt}`);

    doc.end();
  });
}

function section(doc: PDFKit.PDFDocument, title: string, body: string): void {
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).text(title);
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(11).text(body, { align: 'justify' });
}

/**
 * Persist a new contract version: write PDF to disk, save NetworkContract
 * row with markdown + pdfPath. Returns the created row.
 */
export async function generateContractVersion(networkId: string): Promise<NetworkContract> {
  ensureDir();

  const network = await db.network.findUniqueOrThrow({
    where: { id: networkId },
    select: {
      id: true, name: true, commissionType: true, commissionValue: true,
      paymentPeriodValue: true, paymentPeriodUnit: true, contractStart: true,
      billingEmail: true,
    },
  });

  // Determine next version number.
  const last = await db.networkContract.findFirst({
    where: { networkId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  const ctx = buildContext(network, version);
  const md = renderMarkdown(ctx);
  const pdf = await renderPdf(ctx);

  const fileName = `${networkId}-v${version}.pdf`;
  const fullPath = path.join(CONTRACTS_DIR, fileName);
  fs.writeFileSync(fullPath, pdf);

  const created = await db.networkContract.create({
    data: {
      networkId,
      version,
      contentMd: md,
      pdfPath: `contracts/${fileName}`,
    },
  });

  return created;
}

/**
 * Read a contract PDF from disk. Returns null if file is missing
 * (e.g., contract row exists but file was deleted manually).
 */
export function readPdf(pdfPath: string): Buffer | null {
  const fullPath = path.join(process.cwd(), 'public', 'uploads', pdfPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

/**
 * Compare two networks' commercial terms. Returns true if any term that
 * affects the contract has changed (name, commission, payment period,
 * billing email, contractStart). Used to decide whether updating the
 * Network triggers a new contract version + re-signature requirement.
 */
export function commercialTermsChanged(
  before: Pick<Network,
    'name' | 'commissionType' | 'commissionValue' | 'paymentPeriodValue'
    | 'paymentPeriodUnit' | 'contractStart' | 'billingEmail'>,
  after: Pick<Network,
    'name' | 'commissionType' | 'commissionValue' | 'paymentPeriodValue'
    | 'paymentPeriodUnit' | 'contractStart' | 'billingEmail'>,
): boolean {
  return (
    before.name !== after.name ||
    before.commissionType !== after.commissionType ||
    !before.commissionValue.equals(after.commissionValue) ||
    before.paymentPeriodValue !== after.paymentPeriodValue ||
    before.paymentPeriodUnit !== after.paymentPeriodUnit ||
    before.contractStart.getTime() !== after.contractStart.getTime() ||
    before.billingEmail !== after.billingEmail
  );
}
