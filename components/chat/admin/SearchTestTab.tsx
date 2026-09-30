// Aba "Testar busca" — depuração do ranking do search_knowledge. O admin
// digita a pergunta como a IA faria e vê os trechos que voltariam, com a
// nota de cada ranqueador (textual pt/simples, trigram, denso), a fusão RRF
// e o rerank. É onde se descobre por que um documento certo não aparece
// (desligado? sem trecho com o termo? rebaixado por ser retrato datado?).

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/ui-utils';
import { NsIcon } from '../NsIcon';
import { adminFetch, errorText, isAbortError } from './adminApi';
import {
  fmtDay,
  fmtInt,
  fmtMs,
  kindLabel,
  pageRange,
  plural,
  rankCells,
  type PassageDTO,
  type SearchDebugDTO,
} from './adminCore';
import { Expandable, FIELD, ReadState, TOUCH_TEXT, ToneBadge } from './ui';

interface SearchResult {
  passages: PassageDTO[];
  lowConfidence: boolean;
  debug?: SearchDebugDTO | null;
}

function fmtScore(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}

export function SearchTestTab() {
  const [query, setQuery] = React.useState('');
  const [result, setResult] = React.useState<{ query: string; data: SearchResult; ms: number } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const inputId = React.useId();
  const errorId = React.useId();

  React.useEffect(() => () => abortRef.current?.abort(), []);

  async function search() {
    const q = query.trim();
    if (!q) {
      setError('Digite uma pergunta para testar.');
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const data = await adminFetch<SearchResult>('/api/admin/kb/search', {
        method: 'POST',
        json: { query: q },
        signal: ctrl.signal,
      });
      // chunkIds vira lista sempre: a chave e o selo "trechos unidos" dependem dela.
      const passages = (data?.passages ?? []).map((p) => ({ ...p, chunkIds: Array.isArray(p.chunkIds) ? p.chunkIds : [] }));
      setResult({
        query: q,
        data: { passages, lowConfidence: !!data?.lowConfidence, debug: data?.debug ?? null },
        ms: performance.now() - t0,
      });
    } catch (err) {
      if (!isAbortError(err)) setError(errorText(err));
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  const passages = result?.data.passages ?? [];

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        noValidate
      >
        <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
          Pergunta
        </label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ex.: como a coorte de reembolso trata meses imaturos"
            aria-invalid={(error != null && !query.trim()) || undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(FIELD, 'h-9 flex-1', TOUCH_TEXT)}
          />
          <Button type="submit" disabled={loading} aria-busy={loading || undefined} className={cn('min-w-[104px]', TOUCH_TEXT)}>
            <NsIcon name={loading ? 'loader' : 'search'} className={loading ? 'motion-safe:animate-spin' : undefined} />
            {loading ? 'Buscando…' : 'Buscar'}
          </Button>
        </div>
        <p className="text-xs leading-[18px] text-muted-foreground">
          Mesma busca da IA na base global (sem anexos de conversa). O rerank chama um modelo (Haiku ou Voyage),
          então cada teste tem um custo pequeno.
        </p>
      </form>

      {error && (
        <ReadState kind="falha" id={errorId}>
          {error}
        </ReadState>
      )}

      {!result && !error && !loading && (
        <ReadState kind="vazio" title="Nenhuma busca ainda.">
          Os trechos aparecem aqui com a posição em cada ranqueador (Português, Simples, Trigram, Denso), a nota da
          fusão RRF e a nota do rerank (0–3).
        </ReadState>
      )}

      {result && (
        <div className="flex flex-col gap-2" aria-busy={loading || undefined}>
          <p className="text-xs leading-[18px] text-muted-foreground" aria-live="polite">
            {plural(passages.length, 'trecho', 'trechos')} para “{result.query}” em {fmtMs(result.ms)}
          </p>
          {result.data.debug && <DebugLine debug={result.data.debug} />}
          {result.data.lowConfidence && (
            <ReadState kind="parcial" title="Baixa confiança">
              Nenhum trecho passou no rerank. A IA receberia estes trechos marcados como baixa confiança e deveria dizer
              que a base não cobre bem a pergunta.
            </ReadState>
          )}
          {passages.length === 0 ? (
            <ReadState kind="vazio" title="Nenhum trecho encontrado.">
              Confira se o documento está ligado e pronto na aba Documentos, ou tente com outros termos.
            </ReadState>
          ) : (
            <ol className="flex flex-col gap-2">
              {passages.map((p, i) => (
                <PassageCard key={`${p.documentId}:${p.chunkIds.join(',')}:${i}`} passage={p} position={i + 1} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function PassageCard({ passage, position }: { passage: PassageDTO; position: number }) {
  const cells = rankCells(passage.ranks);
  return (
    <li className="nx-glass-card rounded-lg p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs font-semibold tabular-nums text-ring" aria-label={`Posição ${position}`}>
          #{position}
        </span>
        <span className="min-w-0 text-sm font-medium text-foreground">{passage.docTitle}</span>
        <ToneBadge tone="neutral">{kindLabel(passage.kind)}</ToneBadge>
        {pageRange(passage.page, passage.pageEnd) && (
          <ToneBadge tone="neutral">{pageRange(passage.page, passage.pageEnd)}</ToneBadge>
        )}
        {passage.docVersion != null && <ToneBadge tone="neutral">v{fmtInt(passage.docVersion)}</ToneBadge>}
        {passage.chunkIds.length > 1 && (
          <ToneBadge tone="neutral" title="Trechos vizinhos do mesmo documento unidos numa passagem">
            {fmtInt(passage.chunkIds.length)} trechos unidos
          </ToneBadge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {passage.effectiveDate ? `vigência ${fmtDay(passage.effectiveDate)} · ` : ''}
          atualizado {fmtDay(passage.updatedAt)} · nota final{' '}
          <span className="font-mono tabular-nums text-foreground">{fmtScore(passage.score)}</span>
        </span>
      </div>
      {passage.label && passage.label !== passage.docTitle && (
        <p className="mt-1 text-xs leading-[18px] text-muted-foreground">{passage.label}</p>
      )}
      <Expandable lines={6} className="mt-2 rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 text-foreground">
        {passage.text}
      </Expandable>
      <dl className="mt-2 flex flex-wrap gap-1.5" aria-label="Notas por ranqueador">
        {cells.map((c) => (
          <div
            key={c.key}
            className={cn(
              'inline-flex items-baseline gap-1 rounded-[4px] border px-2 py-0.5 text-xs',
              c.present ? 'border-border bg-card text-foreground' : 'border-dashed border-border text-muted-foreground',
            )}
          >
            <dt className="text-muted-foreground">{c.label}</dt>
            <dd className="font-mono tabular-nums">{c.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/** Como a pergunta virou consulta: sinônimos expandidos e o que rodou. */
function DebugLine({ debug }: { debug: SearchDebugDTO }) {
  const queries = debug.queries ?? [];
  const parts: string[] = [];
  if (debug.candidates != null) parts.push(plural(debug.candidates, 'candidato', 'candidatos'));
  if (debug.reranked != null) parts.push(debug.reranked ? 'com rerank' : 'sem rerank');
  if (debug.trigram === false) parts.push('sem trigram');
  if (debug.dense != null) parts.push(debug.dense ? 'com busca semântica' : 'sem busca semântica');
  if (debug.ms != null) parts.push(`${fmtMs(debug.ms)} no servidor`);
  if (!queries.length && !parts.length) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2 text-xs leading-[18px] text-muted-foreground">
      {queries.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span>Consultas:</span>
          {queries.map((q, i) => (
            <span
              key={`${q.text}:${i}`}
              className={cn(
                'rounded-[4px] border px-1.5 py-px',
                q.original ? 'border-border text-foreground' : 'border-dashed border-border',
              )}
              title={q.original ? 'Escrita pela pergunta' : 'Sinônimo expandido pelo servidor'}
            >
              {q.text}
              {!q.original && <span className="font-mono tabular-nums"> ×{q.weight}</span>}
            </span>
          ))}
        </div>
      )}
      {parts.length > 0 && <div>{parts.join(' · ')}</div>}
    </div>
  );
}
