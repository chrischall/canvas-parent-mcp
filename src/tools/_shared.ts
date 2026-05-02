/** Wrap a value as an MCP text content block — the standard tool return shape. */
export function textContent(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Detect "Canvas 404 ..." errors thrown by CanvasClient.request for endpoints that don't exist. */
export function is404(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith('Canvas 404 ');
}

/**
 * Coerce a value to an array. Defensive against odd serializers that return
 * a bare object for single-item collections, and against null/undefined.
 */
export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Build a URL path with mixed scalar and array params. Handles Canvas's
 * `include[]=foo&include[]=bar` shape naturally — pass an array value with a
 * key like 'include[]'. Skips undefined / null. Booleans become "true"/"false".
 */
export type QueryValue = string | number | boolean | string[] | undefined | null;

export function buildPath(
  base: string,
  params: Record<string, QueryValue> = {},
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `${base}?${parts.join('&')}` : base;
}

/** Compute the user path segment: 'users/self' or 'users/{id}'. */
export function userSegment(observeeId?: string): string {
  return observeeId ? `users/${encodeURIComponent(observeeId)}` : 'users/self';
}
