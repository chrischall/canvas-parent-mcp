import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath, userSegment } from './_shared.js';

const listArgs = z.object({
  observeeId: z.string().optional().describe("Observed student's user ID; omit for self."),
});

const getArgs = z.object({
  courseId: z.string(),
});

export function registerCourseTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_courses', {
    description: 'List active Canvas courses (with course-level grades, total scores, current grading period scores, and term).',
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    const path = buildPath(`/api/v1/${userSegment(args.observeeId)}/courses`, {
      enrollment_state: 'active',
      'state[]': 'available',
      'include[]': ['total_scores', 'current_grading_period_scores', 'term'],
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });

  server.registerTool('canvas_get_course', {
    description: 'Get a single Canvas course with its syllabus, teachers, and term.',
    annotations: { readOnlyHint: true },
    inputSchema: getArgs.shape,
  }, async (rawArgs) => {
    const args = getArgs.parse(rawArgs);
    const path = buildPath(`/api/v1/courses/${encodeURIComponent(args.courseId)}`, {
      'include[]': ['syllabus_body', 'teachers', 'term'],
    });
    const data = await client.request(path);
    return textContent(data);
  });
}
