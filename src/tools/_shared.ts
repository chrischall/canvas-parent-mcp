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

/**
 * Context-group hints, published on each tool as `_meta.mint` (mcp-host's
 * `mintHintSchema`, spec 2026-11-03 D4). Inert data: a host that does not read
 * them sees an extra `_meta` key and nothing else. The shape is fixed by the
 * host's contract, so it is restated here rather than imported — this server
 * takes no dependency on mcp-host.
 *
 * `subject` and `when` name THIS tool's own argument names (the host fills
 * them), never values; `aliases` are lowercase, at most 8, each at most 40
 * chars.
 */
export type MintIntent =
  | 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';

export interface MintHint {
  domain: 'school';
  intent: MintIntent;
  canonical?: true;
  subject?: string;
  when?: { start: string; end: string };
  aliases?: string[];
}

/** `_meta` for a Canvas tool: every tool here is in the `school` domain. */
export function schoolMeta(
  intent: MintIntent,
  extra: Omit<MintHint, 'domain' | 'intent'> = {},
): { mint: MintHint } {
  return { mint: { domain: 'school', intent, ...extra } };
}
