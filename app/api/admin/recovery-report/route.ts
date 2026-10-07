// Backfill da recuperação que não chega por IPN (relatório "Customers" da
// BuyGoods — ver lib/services/recoveryReport.ts). Ainda sem tela.
//
//   GET  /api/admin/recovery-report        → totais do backfill por empresa,
//        por janela do relatório e de onde vieram os clientes já conhecidos.
//   POST /api/admin/recovery-report        multipart:
//        file        = o .xlsx exportado do painel (Customers, com Affiliate Name)
//        partners    = JSON {"lusk1nha":"MailX"} — afiliado do relatório → empresa
//                      (a mesma "empresa" da marcação de recuperação). Reimport
//                      herda o mapa do import anterior.
//        reportDate  = YYYY-MM-DD, só se o título do arquivo não trouxer
//        dryRun      = "1" pra só contar
//   Auth: bearer INGEST_SECRET OU sessão ADMIN.
//
// Idempotente: (plataforma, afiliado, cliente) é único; relatório mais novo
// atualiza o LTV, mais velho é ignorado. O arquivo é lido em memória e
// descartado — só o md5 do e-mail é gravado.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guard';
import { checkIngestSecret } from '@/lib/ingest/auth';
import { readZipDirectory, assertSafeZip } from '@/lib/rag/extract/zip';
import { readXlsxSheets } from '@/lib/rag/extract/xlsx';
import { importRecoveryReport, parseCustomersReport, recoveryReportSummary } from '@/lib/services/recoveryReport';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024;

async function authorize(req: Request): Promise<NextResponse | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (bearer && checkIngestSecret(bearer)) return null;
  const auth = await requireAdmin();
  return auth.ok ? null : auth.response;
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  return NextResponse.json(await recoveryReportSummary('buygoods'));
}

export async function POST(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'envie multipart com o campo file' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'campo file ausente' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'arquivo acima de 15 MB' }, { status: 413 });

  let partners: Record<string, string> = {};
  const rawPartners = form.get('partners');
  if (typeof rawPartners === 'string' && rawPartners.trim()) {
    try {
      const p = JSON.parse(rawPartners) as unknown;
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('não é objeto');
      partners = Object.fromEntries(Object.entries(p as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    } catch {
      return NextResponse.json({ error: 'partners deve ser JSON {"afiliado":"Empresa"}' }, { status: 400 });
    }
  }
  const reportDate = String(form.get('reportDate') ?? '').trim() || null;
  if (reportDate && !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return NextResponse.json({ error: 'reportDate deve ser YYYY-MM-DD' }, { status: 400 });
  const dryRun = /^(1|true)$/i.test(String(form.get('dryRun') ?? ''));

  const bytes = Buffer.from(await file.arrayBuffer());
  let parsed: ReturnType<typeof parseCustomersReport> | null = null;
  try {
    await assertSafeZip(bytes, readZipDirectory(bytes));
    const sheets = await readXlsxSheets(bytes, 5);
    for (const s of sheets) {
      parsed = parseCustomersReport(s.rows);
      if (!('error' in parsed)) break;
    }
  } catch (err) {
    return NextResponse.json({ error: `não consegui ler o xlsx: ${err instanceof Error ? err.message : String(err)}` }, { status: 400 });
  }
  if (!parsed) return NextResponse.json({ error: 'planilha vazia' }, { status: 400 });
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const batchTag = `customers-report-${new Date().toISOString().slice(0, 10)}`;
  const result = await importRecoveryReport({ parsed, platformSlug: 'buygoods', partners, reportDate, batchTag, dryRun });
  if ('error' in result) return NextResponse.json(result, { status: 400 });
  logger.info({ ...result, unmappedAffiliates: Object.keys(result.unmappedAffiliates).length }, 'recovery-report import');
  return NextResponse.json(result);
}
