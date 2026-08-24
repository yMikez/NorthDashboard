// Cliente HTTP da API da Logicall. Endpoint único:
//   GET https://api.logicall.io/transactions?key=&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
// Datas inclusivas no fuso deles. Resposta: { result, message, totalResults, data[] }.

import type { LogicallResponse, LogicallTransaction } from './types';

const BASE_URL = process.env.LOGICALL_API_BASE ?? 'https://api.logicall.io';

export async function fetchLogicallTransactions(
  apiKey: string,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LogicallTransaction[]> {
  const url = new URL('/transactions', BASE_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);

  const res = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Logicall HTTP ${res.status}`);
  }
  const body = (await res.json()) as LogicallResponse;
  if (String(body.result ?? '').toUpperCase() !== 'SUCCESS') {
    throw new Error(`Logicall result=${body.result ?? '?'}: ${body.message ?? ''}`.trim());
  }
  return Array.isArray(body.data) ? body.data : [];
}
