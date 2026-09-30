import { describe, expect, it } from 'vitest';
import { attachmentKindOf, toAttachmentDTO, type AttachmentDocRow } from './attachmentDto';

const base: AttachmentDocRow & { meta?: unknown } = {
  id: 'ckatt1',
  title: 'extrato.pdf',
  fileName: 'extrato.pdf',
  mimeType: 'application/pdf',
  byteSize: 2048,
  pageCount: 12,
  status: 'READY',
  error: null,
  deliveryMode: 'inline',
  conversationId: 'conv1',
  messageId: 'msg1',
  createdAt: new Date('2026-09-30T12:00:00.000Z'),
  meta: null,
  table: null,
};

describe('attachmentKindOf', () => {
  it('meta.kind da extração vence', () => {
    expect(attachmentKindOf('text/plain', 'indexed', { kind: 'docx' })).toBe('docx');
    expect(attachmentKindOf('text/plain', 'indexed', { kind: 'planilha' })).toBe('text');
  });
  it('cai pro MIME detectado', () => {
    expect(attachmentKindOf('application/pdf', 'indexed', null)).toBe('pdf');
    expect(attachmentKindOf('image/png', 'inline', null)).toBe('image');
    expect(attachmentKindOf('text/csv', 'table', null)).toBe('table');
    expect(attachmentKindOf('application/json', 'table', null)).toBe('table');
    expect(
      attachmentKindOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'inline', null),
    ).toBe('docx');
    expect(attachmentKindOf('text/markdown', 'inline', null)).toBe('text');
  });
});

describe('toAttachmentDTO', () => {
  it('mapeia os campos do contrato', () => {
    expect(toAttachmentDTO(base)).toEqual({
      id: 'ckatt1',
      fileName: 'extrato.pdf',
      mimeType: 'application/pdf',
      byteSize: 2048,
      pageCount: 12,
      status: 'READY',
      error: null,
      kind: 'pdf',
      deliveryMode: 'inline',
      conversationId: 'conv1',
      messageId: 'msg1',
      createdAt: '2026-09-30T12:00:00.000Z',
    });
  });
  it('sem fileName usa o título; valores fora do contrato caem no default', () => {
    // Status fora do enum simula linha gravada por versão futura do schema.
    const status = 'WEIRD' as unknown as AttachmentDocRow['status'];
    const dto = toAttachmentDTO({ ...base, fileName: null, title: 'colado', byteSize: null, status, deliveryMode: 'x' });
    expect(dto.fileName).toBe('colado');
    expect(dto.byteSize).toBe(0);
    expect(dto.status).toBe('PENDING');
    expect(dto.deliveryMode).toBe('indexed');
  });
  it('EXPIRED passa (a UI mostra o chip esmaecido)', () => {
    expect(toAttachmentDTO({ ...base, status: 'EXPIRED' }).status).toBe('EXPIRED');
  });
  it('imagem: dimensões de meta ou de meta.image', () => {
    const a = toAttachmentDTO({ ...base, mimeType: 'image/jpeg', meta: { width: 1920, height: 1080 } });
    expect(a.meta).toEqual({ width: 1920, height: 1080 });
    const b = toAttachmentDTO({ ...base, mimeType: 'image/jpeg', meta: { image: { width: 800, height: 600 } } });
    expect(b.meta).toEqual({ width: 800, height: 600 });
  });
  it('planilha: completa linhas/abas/colunas pela KbTable', () => {
    const dto = toAttachmentDTO({
      ...base,
      mimeType: 'text/csv',
      deliveryMode: 'table',
      pageCount: null,
      table: {
        sheets: [
          { name: 'Vendas', rowCount: 100, columns: [{ key: 'a', label: 'Data' }, { key: 'valor' }] },
          { name: 'Estornos', rowCount: 5, columns: [] },
        ],
      },
    });
    expect(dto.kind).toBe('table');
    expect(dto.meta).toEqual({ rows: 105, sheets: ['Vendas', 'Estornos'], columns: ['Data', 'valor'] });
  });
  it('meta explícito vence a KbTable', () => {
    const dto = toAttachmentDTO({
      ...base,
      mimeType: 'text/csv',
      meta: { rows: 7, columns: ['x'] },
      table: { sheets: [{ name: 'S', rowCount: 100, columns: [{ label: 'y' }] }] },
    });
    expect(dto.meta).toEqual({ rows: 7, columns: ['x'], sheets: ['S'] });
  });
});
