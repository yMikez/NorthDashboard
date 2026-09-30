import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  PNG_KEEP_MAX_BYTES,
  attachmentMetaLabel,
  checkSize,
  formatBytes,
  guessAttachmentKind,
  pastedFileName,
  planImageResize,
  rejectionNotice,
  renameForFormat,
  selectAttachments,
  uploadErrorMessage,
} from './attachmentRules';

const MB = 1024 * 1024;
const f = (name: string, size = 1000, type = '') => ({ name, size, type });

describe('guessAttachmentKind', () => {
  it('classifica pela extensão, sem diferenciar maiúsculas', () => {
    expect(guessAttachmentKind('Extrato.PDF')).toBe('pdf');
    expect(guessAttachmentKind('vendas.xlsx')).toBe('table');
    expect(guessAttachmentKind('export.tsv')).toBe('table');
    expect(guessAttachmentKind('contrato.docx')).toBe('docx');
    expect(guessAttachmentKind('notas.md')).toBe('text');
    expect(guessAttachmentKind('print.webp')).toBe('image');
  });
  it('print colado sem extensão entra pelo MIME', () => {
    expect(guessAttachmentKind('', 'image/png')).toBe('image');
    expect(guessAttachmentKind('blob', 'application/pdf')).toBe('pdf');
  });
  it('recusa formatos que o servidor não lê', () => {
    expect(guessAttachmentKind('antigo.xls')).toBeNull();
    expect(guessAttachmentKind('foto.heic', 'image/heic')).toBeNull();
    expect(guessAttachmentKind('deck.pptx')).toBeNull();
  });
  it('accept do input cobre exatamente as extensões aceitas', () => {
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual(
      expect.arrayContaining(['.pdf', '.png', '.jpg', '.csv', '.xlsx', '.docx', '.txt', '.md', '.json']),
    );
    expect(ATTACHMENT_ACCEPT).not.toContain('.xls,');
  });
});

describe('selectAttachments', () => {
  it('aceita até 5 por mensagem e explica o excedente', () => {
    const files = Array.from({ length: 7 }, (_, i) => f(`a${i}.pdf`));
    const r = selectAttachments(files, 0, 0);
    expect(r.accepted).toHaveLength(5);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reason).toContain('5 anexos por mensagem');
  });
  it('conta o que já está no composer', () => {
    const r = selectAttachments([f('a.pdf'), f('b.pdf')], 4, 0);
    expect(r.accepted.map((x) => x.name)).toEqual(['a.pdf']);
  });
  it('respeita o limite de 20 por conversa', () => {
    const r = selectAttachments([f('a.pdf'), f('b.pdf')], 0, 19);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected[0].reason).toContain('20 anexos por conversa');
  });
  it('recusa > 25 MB de não-imagem já na seleção; imagem espera o redimensionamento', () => {
    const r = selectAttachments([f('grande.csv', 26 * MB), f('foto.jpg', 30 * MB, 'image/jpeg')], 0, 0);
    expect(r.accepted.map((x) => x.name)).toEqual(['foto.jpg']);
    expect(r.rejected[0].reason).toBe('Arquivo maior que 25 MB.');
  });
  it('dá o caminho de conversão pros formatos antigos', () => {
    const r = selectAttachments([f('base.xls'), f('x.zip')], 0, 0);
    expect(r.rejected[0].reason).toContain('.xlsx');
    expect(r.rejected[1].reason).toContain('Tipo não suportado');
  });
  it('recusa arquivo vazio', () => {
    expect(selectAttachments([f('vazio.txt', 0)], 0, 0).rejected[0].reason).toBe('Arquivo vazio.');
  });
});

describe('checkSize / rejectionNotice', () => {
  it('limite exato passa, um byte a mais não', () => {
    expect(checkSize(ATTACHMENT_MAX_BYTES)).toBeNull();
    expect(checkSize(ATTACHMENT_MAX_BYTES + 1)).toContain('25 MB');
  });
  it('resume várias recusas', () => {
    expect(rejectionNotice([])).toBeNull();
    expect(rejectionNotice([{ name: 'a.xls', reason: 'x' }])).toBe('a.xls: x');
    const many = rejectionNotice(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, reason: 'r' })));
    expect(many).toContain('+2 arquivo(s) recusado(s)');
  });
});

describe('planImageResize', () => {
  it('print PNG pequeno segue intacto (texto nítido)', () => {
    expect(planImageResize({ width: 1440, height: 900, type: 'image/png', size: 800_000 })).toEqual({ action: 'keep' });
  });
  it('PNG grande em bytes redesenha tentando PNG antes de JPEG', () => {
    expect(planImageResize({ width: 1440, height: 900, type: 'image/png', size: PNG_KEEP_MAX_BYTES + 1 })).toEqual({
      action: 'encode',
      width: 1440,
      height: 900,
      formats: ['image/png', 'image/jpeg'],
    });
  });
  it('reduz o lado maior pra 2000 px mantendo a proporção', () => {
    expect(planImageResize({ width: 4000, height: 3000, type: 'image/jpeg', size: 5 * MB })).toEqual({
      action: 'encode',
      width: 2000,
      height: 1500,
      formats: ['image/jpeg'],
    });
    expect(planImageResize({ width: 1000, height: 5000, type: 'image/png', size: 100 })).toMatchObject({
      width: 400,
      height: 2000,
    });
  });
  it('JPEG sempre redesenha (EXIF/GPS não sai do navegador)', () => {
    expect(planImageResize({ width: 800, height: 600, type: 'image/jpeg', size: 90_000 })).toMatchObject({
      action: 'encode',
      width: 800,
      height: 600,
    });
  });
  it('GIF e dimensão desconhecida seguem intactos', () => {
    expect(planImageResize({ width: 5000, height: 5000, type: 'image/gif', size: 1 })).toEqual({ action: 'keep' });
    expect(planImageResize({ width: 0, height: 0, type: 'image/png', size: 1 })).toEqual({ action: 'keep' });
  });
  it('renomeia pela conversão', () => {
    expect(renameForFormat('foto.webp', 'image/jpeg')).toBe('foto.jpg');
    expect(renameForFormat('tela.png', 'image/png')).toBe('tela.png');
    expect(renameForFormat('.png', 'image/jpeg')).toBe('imagem.jpg');
  });
});

describe('pastedFileName', () => {
  const now = new Date(2026, 8, 30, 14, 25, 1);
  it('dá nome com data/hora ao print genérico', () => {
    expect(pastedFileName('image.png', 'image/png', now)).toBe('captura-20260930-142501.png');
    expect(pastedFileName('', 'image/jpeg', now, 1)).toBe('captura-20260930-142501-2.jpg');
  });
  it('mantém nome real de arquivo colado do explorador', () => {
    expect(pastedFileName('relatorio.pdf', 'application/pdf', now)).toBe('relatorio.pdf');
  });
});

describe('formatBytes / attachmentMetaLabel', () => {
  it('formata tamanhos no padrão americano', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(340 * 1024)).toBe('340 KB');
    expect(formatBytes(2.34 * MB)).toBe('2.3 MB');
    expect(formatBytes(12.6 * MB)).toBe('13 MB');
  });
  it('monta a linha de metadados por tipo', () => {
    expect(attachmentMetaLabel({ kind: 'pdf', byteSize: 2 * MB, pageCount: 12 })).toBe('12 págs · 2.0 MB');
    expect(attachmentMetaLabel({ kind: 'pdf', byteSize: 1024, pageCount: 1 })).toBe('1 pág. · 1 KB');
    expect(
      attachmentMetaLabel({
        kind: 'table',
        byteSize: 6.5 * MB,
        pageCount: null,
        meta: { rows: 11354, columns: Array.from({ length: 42 }, (_, i) => `c${i}`), sheets: ['A', 'B'] },
      }),
    ).toBe('11,354 linhas · 42 colunas · 2 abas · 6.5 MB');
    expect(attachmentMetaLabel({ kind: 'image', byteSize: 300 * 1024, pageCount: null, meta: { width: 1920, height: 1080 } })).toBe(
      '1920×1080 · 300 KB',
    );
  });
});

describe('uploadErrorMessage', () => {
  it('mensagem do servidor (PT-BR) vence', () => {
    expect(uploadErrorMessage(422, 'PDF protegido por senha')).toBe('PDF protegido por senha');
  });
  it('mapa por status quando o corpo não ajuda', () => {
    expect(uploadErrorMessage(0)).toContain('rede');
    expect(uploadErrorMessage(413)).toContain('25 MB');
    expect(uploadErrorMessage(415)).toContain('Tipo não suportado');
    expect(uploadErrorMessage(409)).toContain('20 anexos');
    expect(uploadErrorMessage(500, '  ')).toBe('Falha no envio (HTTP 500).');
  });
});
