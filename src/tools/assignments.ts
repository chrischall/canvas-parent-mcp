import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath, userSegment } from './_shared.js';

const listArgs = z.object({
  courseId: z.string(),
  bucket: z.enum(['past', 'overdue', 'undated', 'ungraded', 'unsubmitted', 'upcoming', 'future']).optional()
    .describe('Optional Canvas-side filter.'),
});

const missingArgs = z.object({
  observeeId: z.string().optional(),
  courseIds: z.array(z.string()).optional().describe('Required when observeeId is set.'),
});

export function registerAssignmentTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_assignments', {
    description: "List a course's assignments (with the user's submission inline). Supports the standard Canvas `bucket` filter.",
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    const path = buildPath(`/api/v1/courses/${encodeURIComponent(args.courseId)}/assignments`, {
      'include[]': ['submission'],
      bucket: args.bucket,
      order_by: 'due_at',
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });

  server.registerTool('canvas_list_missing_submissions', {
    description: "List past-due unsubmitted assignments for the user (or a linked observee). For an observee, courseIds is required.",
    annotations: { readOnlyHint: true },
    inputSchema: missingArgs.shape,
  }, async (rawArgs) => {
    const args = missingArgs.parse(rawArgs);
    const path = buildPath(`/api/v1/${userSegment(args.observeeId)}/missing_submissions`, {
      'include[]': ['planner_overrides', 'course'],
      'filter[]': 'submittable',
      'course_ids[]': args.courseIds,
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });
}
