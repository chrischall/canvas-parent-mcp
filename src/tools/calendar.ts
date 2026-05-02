import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath } from './_shared.js';

const eventsArgs = z.object({
  contextCodes: z.array(z.string()).optional().describe('Array like ["course_123", "user_456"].'),
  type: z.enum(['event', 'assignment']).optional(),
  startDate: z.string().optional().describe('YYYY-MM-DD or ISO 8601.'),
  endDate: z.string().optional(),
  allEvents: z.boolean().optional(),
});

export function registerCalendarTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_calendar_events', {
    description: 'List Canvas calendar events or assignments across selected contexts (courses/users).',
    annotations: { readOnlyHint: true },
    inputSchema: eventsArgs.shape,
  }, async (rawArgs) => {
    const args = eventsArgs.parse(rawArgs);
    const path = buildPath('/api/v1/calendar_events', {
      type: args.type,
      start_date: args.startDate,
      end_date: args.endDate,
      'context_codes[]': args.contextCodes,
      all_events: args.allEvents,
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });

  server.registerTool('canvas_list_upcoming_events', {
    description: "List the calling user's upcoming events (Canvas's curated next-7-days view).",
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = await client.request('/api/v1/users/self/upcoming_events');
    return textContent(data);
  });
}
