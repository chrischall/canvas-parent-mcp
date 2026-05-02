import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath } from './_shared.js';

const argsSchema = z.object({
  courseId: z.string(),
  onlyAnnouncements: z.boolean().optional(),
  orderBy: z.enum(['position', 'recent_activity', 'title']).optional(),
});

export function registerDiscussionTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_discussion_topics', {
    description: 'List discussion topics for a course (read-only).',
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const path = buildPath(`/api/v1/courses/${encodeURIComponent(args.courseId)}/discussion_topics`, {
      only_announcements: args.onlyAnnouncements ?? false,
      order_by: args.orderBy,
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });
}
