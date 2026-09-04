import { buildQueryString, minifiedResult } from '@chrischall/mcp-utils';

/**
 * Wrap a value as an MCP text content block — the standard tool return shape.
 * Backed by the fleet-shared `minifiedResult` from `@chrischall/mcp-utils`:
 * `{ content: [{ type: 'text', text: JSON.stringify(data) }] }`, with no indent
 * argument. Roughly a fifth of a large response is formatting whitespace that
 * nothing downstream reads, and this is where it stops being emitted — the
 * reads that also take a `view` reach the same helper through
 * `viewResponse` (`src/view.ts`).
 */
export const textContent = minifiedResult;

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
 * key like 'include[]' (the fleet-shared `buildQueryString` repeats the key
 * for array values). Skips undefined / null / empty-string values. Booleans
 * become "true"/"false".
 */
export type QueryValue = string | number | boolean | string[] | undefined | null;

export function buildPath(
  base: string,
  params: Record<string, QueryValue> = {},
): string {
  return `${base}${buildQueryString(params)}`;
}

/** Compute the user path segment: 'users/self' or 'users/{id}'. */
export function userSegment(observeeId?: string): string {
  return observeeId ? `users/${encodeURIComponent(observeeId)}` : 'users/self';
}
