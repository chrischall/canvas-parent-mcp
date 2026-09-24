import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { buildPath } from './_shared.js';
import { viewArg, viewResponse } from '../view.js';

const listArgs = z.object({
  scope: z.enum(['unread', 'starred', 'archived', 'sent']).optional(),
  filter: z.array(z.string()).optional().describe('Array of context codes (course_X, group_X, user_X).'),
  view: viewArg(),
});

const getArgs = z.object({
  id: z.string(),
  view: viewArg(),
});

export function registerConversationTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_conversations', {
    description: "List Canvas inbox conversations. Optional `scope` (unread/starred/archived/sent) and `filter` (array of context codes).",
    annotations: { readOnlyHint: true },
    inputSchema: listArgs,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    const path = buildPath('/api/v1/conversations', {
      scope: args.scope,
      'filter[]': args.filter,
      'include[]': ['participant_avatars'],
    });
    const data = await client.requestPaginated(path);
    return viewResponse(args.view, data);
  });

  server.registerTool('canvas_get_conversation', {
    description: 'Get a full Canvas conversation thread with all messages. Read-only: does not mark the conversation as read.',
    annotations: { readOnlyHint: true },
    inputSchema: getArgs,
  }, async (rawArgs) => {
    const args = getArgs.parse(rawArgs);
    // Canvas marks a conversation read on GET unless told otherwise; pin it
    // off so this tool honours its readOnlyHint and never sends the parent's
    // read receipt to the teacher on a model's behalf (fleet-audit#926).
    const path = buildPath(`/api/v1/conversations/${encodeURIComponent(args.id)}`, {
      auto_mark_as_read: false,
      'include[]': ['participant_avatars'],
    });
    const data = await client.request(path);
    return viewResponse(args.view, data);
  });
}
