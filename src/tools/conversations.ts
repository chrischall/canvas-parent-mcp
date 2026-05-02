import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath } from './_shared.js';

const listArgs = z.object({
  scope: z.enum(['unread', 'starred', 'archived', 'sent']).optional(),
  filter: z.array(z.string()).optional().describe('Array of context codes (course_X, group_X, user_X).'),
});

const getArgs = z.object({
  id: z.string(),
});

export function registerConversationTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_conversations', {
    description: "List Canvas inbox conversations. Optional `scope` (unread/starred/archived/sent) and `filter` (array of context codes).",
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    const path = buildPath('/api/v1/conversations', {
      scope: args.scope,
      'filter[]': args.filter,
      'include[]': ['participant_avatars'],
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });

  server.registerTool('canvas_get_conversation', {
    description: 'Get a full Canvas conversation thread with all messages.',
    annotations: { readOnlyHint: true },
    inputSchema: getArgs.shape,
  }, async (rawArgs) => {
    const args = getArgs.parse(rawArgs);
    const path = buildPath(`/api/v1/conversations/${encodeURIComponent(args.id)}`, {
      'include[]': ['participant_avatars'],
    });
    const data = await client.request(path);
    return textContent(data);
  });
}
