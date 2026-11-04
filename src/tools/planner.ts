import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath, schoolMeta } from './_shared.js';
import type { ObserveeDirectory } from './observees.js';

const OBSERVEE_DESCRIPTION =
  "A linked observee (child): their display name as listed, or their Canvas user id. Omit for your own planner.";

/**
 * `observeeId` publishes the observee LABELS as a JSON Schema `enum` when the
 * server could list them at start (mcp-host spec D5), via `.meta()` — so the
 * runtime schema is still any string and the handler accepts a label or an id.
 * With no listing the property is published plain: an empty `enum` is invalid
 * JSON Schema.
 */
function observeeIdArg(observees: ObserveeDirectory | null | undefined) {
  const base = z.string();
  return (observees ? base.meta({ enum: observees.labels }) : base).optional().describe(OBSERVEE_DESCRIPTION);
}

const BRIEF_MAX = 120;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * One planner item as one line, `title — due <ISO date | no date> — <status>`,
 * at most 120 characters (the title is shortened). Read only from the fields
 * Canvas's planner item carries: `plannable.title`/`name`, `plannable.due_at`
 * (else `plannable_date`), and `submissions`. An item with no submission at
 * all (`submissions: false` — a note, a page, an event) gets no status, since
 * "not submitted" would be untrue of something nobody submits.
 */
export function briefLine(item: unknown): string {
  const it = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const p = (it.plannable && typeof it.plannable === 'object' ? it.plannable : {}) as Record<string, unknown>;
  const title = str(p.title) ?? str(p.name) ?? str(it.title) ?? '(untitled)';
  const due = str(p.due_at) ?? str(it.plannable_date) ?? 'no date';
  const sub = it.submissions;
  let status = '';
  if (sub && typeof sub === 'object') {
    const s = sub as Record<string, unknown>;
    status = s.missing === true ? 'missing' : s.submitted === true ? 'submitted' : 'not submitted';
  }
  const tail = ` — due ${due}${status ? ` — ${status}` : ''}`;
  const room = BRIEF_MAX - tail.length;
  const shown = title.length > room ? `${title.slice(0, Math.max(room - 1, 0))}…` : title;
  return `${shown}${tail}`;
}

export function registerPlannerTools(
  server: McpServer,
  client: CanvasClient,
  observees?: ObserveeDirectory | null,
): void {
  const argsSchema = z.object({
    observeeId: observeeIdArg(observees),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    contextCodes: z.array(z.string()).optional(),
    filter: z.enum(['new_activity']).optional(),
    view: z.enum(['full', 'brief']).optional().describe(
      '"full" (default) returns Canvas\'s planner items verbatim; "brief" returns one line per item: ' +
      'title — due <ISO date or "no date"> — <submitted|not submitted|missing>.',
    ),
  });

  server.registerTool('canvas_list_planner_items', {
    description: "List planner items (assignments + announcements + planner notes + calendar events) for the user or a linked observee.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: schoolMeta('whats-due', {
      canonical: true,
      subject: 'observeeId',
      when: { start: 'startDate', end: 'endDate' },
      aliases: ['homework', 'assignments', 'due', 'kids', 'school'],
    }),
    inputSchema: argsSchema,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const observeeId = args.observeeId !== undefined && observees
      ? observees.resolve(args.observeeId)
      : args.observeeId;
    const base = observeeId
      ? `/api/v1/users/${encodeURIComponent(observeeId)}/planner/items`
      : '/api/v1/planner/items';
    const path = buildPath(base, {
      start_date: args.startDate,
      end_date: args.endDate,
      'context_codes[]': args.contextCodes,
      filter: args.filter,
    });
    const data = await client.requestPaginated(path);
    if (args.view === 'brief') {
      return { content: [{ type: 'text' as const, text: data.map(briefLine).join('\n') }] };
    }
    return textContent(data);
  });
}
