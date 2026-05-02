import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath } from './_shared.js';

const argsSchema = z.object({
  observeeId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  contextCodes: z.array(z.string()).optional(),
  filter: z.enum(['new_activity']).optional(),
});

export function registerPlannerTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_planner_items', {
    description: "List planner items (assignments + announcements + planner notes + calendar events) for the user or a linked observee.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const base = args.observeeId
      ? `/api/v1/users/${encodeURIComponent(args.observeeId)}/planner/items`
      : '/api/v1/planner/items';
    const path = buildPath(base, {
      start_date: args.startDate,
      end_date: args.endDate,
      'context_codes[]': args.contextCodes,
      filter: args.filter,
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });
}
