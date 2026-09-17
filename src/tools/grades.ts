import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath, userSegment } from './_shared.js';

const argsSchema = z.object({
  observeeId: z.string().optional(),
});

export function registerGradeTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_enrollments', {
    description: 'List active student enrollments with per-course grades (current_score, final_score, current_grade, final_grade, current grading period info).',
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const path = buildPath(`/api/v1/${userSegment(args.observeeId)}/enrollments`, {
      'state[]': 'active',
      'type[]': 'StudentEnrollment',
      'include[]': ['current_points', 'grades'],
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });
}
