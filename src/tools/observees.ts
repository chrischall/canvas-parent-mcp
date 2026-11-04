import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { viewArg, viewResponse } from '../view.js';
import { schoolMeta } from './_shared.js';

const argsSchema = z.object({
  view: viewArg(),
});

export function registerObserveeTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_observees', {
    description: "List students linked to your Canvas observer account. Returns an empty array for plain student tokens.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: schoolMeta('lookup'),
    inputSchema: argsSchema,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const data = await client.requestPaginated('/api/v1/users/self/observees?include[]=avatar_url');
    return viewResponse(args.view, data);
  });
}

/**
 * The observer's linked students, as display labels a caller can name a child
 * by (mcp-host spec 2026-11-03 D5: subjects are enums of LABELS, accepting
 * label or id).
 */
export interface ObserveeDirectory {
  /** One label per observee, in Canvas's order; never empty. */
  labels: string[];
  /** A label (any case, trimmed) or an observee id → that observee's id. Throws naming the labels otherwise. */
  resolve(value: string): string;
}

/** Bound on the start-time listing: a host must not wait on it to list tools. */
export const OBSERVEE_LIST_TIMEOUT_MS = 5_000;

interface ObserveeUser { id: string; label: string }

function readObservees(data: unknown): ObserveeUser[] {
  if (!Array.isArray(data)) return [];
  const out: ObserveeUser[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' && typeof r.id !== 'number') continue;
    const id = String(r.id);
    const name = [r.name, r.short_name].find((v): v is string => typeof v === 'string' && v.trim() !== '');
    out.push({ id, label: name?.trim() ?? id });
  }
  return out;
}

function buildDirectory(users: ObserveeUser[]): ObserveeDirectory | null {
  if (users.length === 0) return null;
  const counts = new Map<string, number>();
  for (const u of users) counts.set(u.label.toLowerCase(), (counts.get(u.label.toLowerCase()) ?? 0) + 1);
  // Two children with one display name would make the name ambiguous, so each
  // carries its id; the label stays resolvable and never picks the wrong child.
  const labelled = users.map((u) => ({
    id: u.id,
    label: counts.get(u.label.toLowerCase())! > 1 ? `${u.label} (${u.id})` : u.label,
  }));
  const byLabel = new Map(labelled.map((u) => [u.label.toLowerCase(), u.id]));
  const ids = new Set(labelled.map((u) => u.id));
  const labels = labelled.map((u) => u.label);
  return {
    labels,
    resolve(value: string): string {
      const id = byLabel.get(value.trim().toLowerCase());
      if (id !== undefined) return id;
      if (ids.has(value.trim())) return value.trim();
      throw new Error(`Unknown observee "${value}". Known: ${labels.join(', ')}.`);
    },
  };
}

/**
 * List the observees ONCE, at server start, for the planner's `observeeId`
 * enum. Answers null — so the property is published with no `enum` keyword,
 * never an empty one — when the account observes nobody, when the listing
 * fails (no browser for the fetchproxy path, a dead credential), or when it has
 * not answered within `timeoutMs`. Never throws.
 */
export async function loadObserveeDirectory(
  client: CanvasClient,
  timeoutMs: number = OBSERVEE_LIST_TIMEOUT_MS,
): Promise<ObserveeDirectory | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref();
  });
  const listing = client
    .requestPaginated('/api/v1/users/self/observees')
    .then((data) => buildDirectory(readObservees(data)))
    .catch(() => null);
  try {
    return await Promise.race([listing, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
