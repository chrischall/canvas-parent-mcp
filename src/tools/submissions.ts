import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath } from './_shared.js';

const getArgs = z.object({
  courseId: z.string(),
  assignmentId: z.string(),
  userId: z.string().optional().describe("'self' or a numeric Canvas user ID. Defaults to 'self'."),
});

const recentArgs = z.object({
  courseId: z.string(),
  studentId: z.string().optional().describe("'self' or a numeric Canvas user ID. Defaults to 'self'."),
  since: z.string().optional().describe('ISO 8601 timestamp; defaults to 14 days ago.'),
});

export function registerSubmissionTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_get_submission', {
    description: "Get a single submission with rubric assessment and grader comments. userId defaults to 'self'.",
    annotations: { readOnlyHint: true },
    inputSchema: getArgs.shape,
  }, async (rawArgs) => {
    const args = getArgs.parse(rawArgs);
    const userId = args.userId ?? 'self';
    const path = buildPath(
      `/api/v1/courses/${encodeURIComponent(args.courseId)}/assignments/${encodeURIComponent(args.assignmentId)}/submissions/${encodeURIComponent(userId)}`,
      { 'include[]': ['submission_comments', 'rubric_assessment', 'assignment'] },
    );
    const data = await client.request(path);
    return textContent(data);
  });

  server.registerTool('canvas_list_recent_submissions', {
    description: "List recently graded submissions in a course. Defaults to a 14-day window for the calling user.",
    annotations: { readOnlyHint: true },
    inputSchema: recentArgs.shape,
  }, async (rawArgs) => {
    const args = recentArgs.parse(rawArgs);
    const studentId = args.studentId ?? 'self';
    const since = args.since ?? new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const path = buildPath(`/api/v1/courses/${encodeURIComponent(args.courseId)}/students/submissions`, {
      'student_ids[]': studentId,
      'workflow_state[]': 'graded',
      graded_since: since,
      'include[]': ['assignment', 'submission_comments'],
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });
}
