// Paginação cursor-based — porte de handlers/_shared.ts (Node usa Buffer no
// lugar de atob/btoa). Cursor = base64(JSON({ ts, id })).
export type Cursor = { ts: string; id: string };

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (typeof decoded?.ts === 'string' && typeof decoded?.id === 'string') return decoded as Cursor;
  } catch {
    /* cursor inválido = primeira página */
  }
  return null;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64');
}

export function parsePagination(query: Record<string, unknown>): {
  limit: number;
  cursor: Cursor | null;
  hasLimitParam: boolean;
} {
  const rawLimit = typeof query.limit === 'string' ? query.limit : null;
  const hasLimitParam = rawLimit !== null;
  let limit = parseInt(rawLimit || '50', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;
  const rawCursor = typeof query.cursor === 'string' ? query.cursor : null;
  return { limit, cursor: decodeCursor(rawCursor), hasLimitParam };
}

// Aplica filtro cursor numa query Supabase ordenada por (tsField DESC, id DESC).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCursor(q: any, cursor: Cursor | null, tsField: string): any {
  if (!cursor) return q;
  const tsLt = `${tsField}.lt.${cursor.ts}`;
  const tieEq = `${tsField}.eq.${cursor.ts}`;
  const idLt = `id.lt.${cursor.id}`;
  return q.or(`${tsLt},and(${tieEq},${idLt})`);
}

// Monta o corpo paginado: array nu (compat, sem ?limit) ou { items, nextCursor, total? }.
export function buildPaginated(
  items: Array<Record<string, unknown> & { id: string }>,
  limit: number,
  hasLimitParam: boolean,
  tsField: string,
  total?: number,
): unknown {
  if (!hasLimitParam) return items;
  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const last = sliced[sliced.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ ts: String(last[tsField]), id: last.id }) : null;
  const body: Record<string, unknown> = { items: sliced, nextCursor };
  if (typeof total === 'number') body.total = total;
  return body;
}
