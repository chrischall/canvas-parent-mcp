import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath } from './_shared.js';

const argsSchema = z.object({
  contextCodes: z.array(z.string()).describe('Required. Array like ["course_123", "course_456"].'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  activeOnly: z.boolean().optional(),
});

export function registerAnnouncementTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_announcements', {
    description: "List announcements across one or more courses. `contextCodes` is required (e.g. [\"course_123\"]). Defaults to active-only.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const path = buildPath('/api/v1/announcements', {
      'context_codes[]': args.contextCodes,
      start_date: args.startDate,
      end_date: args.endDate,
      active_only: args.activeOnly ?? true,
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });
}
