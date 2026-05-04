// Pagination helper. Single source of truth pra parse + response shape.
// Offset-based (page+pageSize) é suficiente pro nosso volume (até centenas
// de milhares de rows por tabela). Cursor-based só ganha em altíssimo
// volume e dificulta jumping ("ir pra página 50").
//
// Convenção de query: ?page=1&pageSize=25
// Convenção de response: { items: [...], page, pageSize, total, hasMore }
//
// Caps: max pageSize = 100 (defendendo o servidor de scrapes acidentais).

export interface PaginationParams {
  page: number;       // 1-indexed
  pageSize: number;   // clamped a 1..MAX_PAGE_SIZE
  skip: number;       // pra usar direto em Prisma findMany({ skip, take })
  take: number;       // alias pra pageSize
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Parse pagination params from URL search params. Defaults: page=1,
 * pageSize=25. Both clamped to safe ranges (page>=1, 1<=pageSize<=100).
 *
 * Aceita URL ou URLSearchParams pra flexibilidade.
 */
export function parsePagination(
  source: URL | URLSearchParams,
  opts: { defaultPageSize?: number; maxPageSize?: number } = {},
): PaginationParams {
  const params = source instanceof URL ? source.searchParams : source;
  const defaultPS = opts.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPS = opts.maxPageSize ?? MAX_PAGE_SIZE;

  const rawPage = Number.parseInt(params.get('page') ?? '1', 10);
  const rawSize = Number.parseInt(params.get('pageSize') ?? String(defaultPS), 10);

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const pageSize = Number.isFinite(rawSize) ? Math.min(Math.max(rawSize, 1), maxPS) : defaultPS;

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

/**
 * Build the standard paginated response envelope. `total` é o count
 * total no DB pra mesma where clause; usado pra calcular hasMore +
 * exibir "página X de Y" no UI.
 */
export function paginatedResponse<T>(
  items: T[],
  total: number,
  params: PaginationParams,
): PaginatedResponse<T> {
  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total,
    hasMore: params.skip + items.length < total,
  };
}
