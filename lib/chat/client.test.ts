import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPersistedMessageId, parseSSE, sendFeedback, sendMessage, type StreamCallbacks } from './client';

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function streamResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseSSE', () => {
  it('done traz o messageId persistido', () => {
    expect(parseSSE('event: done\ndata: {"conversationId":"c1","messageId":"m9"}')).toEqual({
      type: 'done',
      conversationId: 'c1',
      messageId: 'm9',
    });
    expect(parseSSE('event: done\ndata: {"conversationId":"c1"}')).toEqual({
      type: 'done',
      conversationId: 'c1',
      messageId: undefined,
    });
  });
  it('citation normaliza citedText e exige n', () => {
    const evt = parseSSE(
      'event: citation\ndata: ' +
        JSON.stringify({ n: 2, source: 'anexo:ck1#p3', kind: 'attachment', title: 'x.pdf', page: 3, citedText: ['a', 5] }),
    );
    expect(evt).toEqual({
      type: 'citation',
      citation: { n: 2, source: 'anexo:ck1#p3', kind: 'attachment', title: 'x.pdf', page: 3, citedText: ['a'] },
    });
    expect(parseSSE('event: citation\ndata: {"source":"x"}')).toBeNull();
  });
  it('tool_use_result carrega ok/bytes/truncated/ms', () => {
    expect(parseSSE(sse('tool_use_result', { name: 'calc', id: 't1', ok: false, bytes: 10, truncated: false, ms: 5 }))).toEqual(
      { type: 'tool_use_result', name: 'calc', id: 't1', ok: false, bytes: 10, truncated: false, ms: 5 },
    );
  });
  it('ping e evento desconhecido são ignorados', () => {
    expect(parseSSE(': ping')).toBeNull();
    expect(parseSSE(sse('attachment_status', { id: 'x' }))).toBeNull();
    expect(parseSSE('event: token\ndata: {quebrado')).toBeNull();
  });
});

describe('sendMessage', () => {
  it('manda attachmentIds e entrega os eventos na ordem', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      streamResponse([
        sse('conversation', { id: 'c1' }),
        sse('tool_use_start', { name: 'search_knowledge', id: 't1' }),
        // evento partido entre dois chunks da rede
        'event: tool_use_result\ndata: {"name":"search_knowledge",',
        '"id":"t1","ok":true,"bytes":900,"truncated":false,"ms":40}\n\n',
        sse('citation', { n: 1, source: 'kb:d@v1#0', kind: 'kb', title: 'Cohort.md', citedText: ['censura'] }),
        sse('token', { text: 'Resposta' }),
        sse('token', { text: ' [[cite:1]]' }),
        // último evento sem a linha em branco final
        'event: done\ndata: {"conversationId":"c1","messageId":"m1"}',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const log: string[] = [];
    const cb: StreamCallbacks = {
      onConversation: (e) => log.push(`conv:${e.id}`),
      onToolUseStart: (e) => log.push(`start:${e.name}`),
      onToolUseResult: (e) => log.push(`result:${e.id}:${e.ok}`),
      onCitation: (c) => log.push(`cite:${c.n}:${c.citedText.join('|')}`),
      onToken: (e) => log.push(`tok:${e.text}`),
      onDone: (e) => log.push(`done:${e.conversationId}:${e.messageId}`),
      onError: (e) => log.push(`err:${e.message}`),
    };
    await sendMessage({ conversationId: null, message: '', attachmentIds: ['ckA', 'ckB'] }, cb);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.attachmentIds).toEqual(['ckA', 'ckB']);
    expect(body.message).toBe('');
    expect(log).toEqual([
      'conv:c1',
      'start:search_knowledge',
      'result:t1:true',
      'cite:1:censura',
      'tok:Resposta',
      'tok: [[cite:1]]',
      'done:c1:m1',
    ]);
  });

  it('sem anexos não manda o campo', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => streamResponse([sse('done', { conversationId: 'c' })]));
    vi.stubGlobal('fetch', fetchMock);
    await sendMessage({ message: 'oi', attachmentIds: [] }, {});
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect('attachmentIds' in body).toBe(false);
  });

  it('erro HTTP antes do stream vira onError com a mensagem do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Anexo expirado' }), { status: 400 })),
    );
    const onError = vi.fn();
    await sendMessage({ message: 'x', attachmentIds: ['a'] }, { onError });
    expect(onError).toHaveBeenCalledWith({ message: 'Anexo expirado' });
  });
});

describe('feedback', () => {
  it('ids locais não votam', () => {
    for (const id of ['temp-1', 'asst-2', 'err-3', 'rl-4', '']) expect(isPersistedMessageId(id)).toBe(false);
    expect(isPersistedMessageId('cm1abc')).toBe(true);
  });
  it('POST devolve o registro salvo (ou o que foi enviado, sem corpo)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ feedback: { rating: -1, reasons: ['inventou'], comment: 'x' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const fb = await sendFeedback('m1', { rating: -1, reasons: ['inventou'], comment: 'x', shared: true });
    expect(fb).toEqual({ rating: -1, reasons: ['inventou'], comment: 'x' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/messages/m1/feedback');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    expect(await sendFeedback('m1', { rating: 1 })).toEqual({ rating: 1, reasons: [], comment: null });
  });
  it('falha do servidor rejeita (o botão volta ao estado anterior)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    await expect(sendFeedback('m1', { rating: 1 })).rejects.toThrow('403');
  });
});
