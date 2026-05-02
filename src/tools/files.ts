import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath } from './_shared.js';

const listArgs = z.object({
  courseId: z.string(),
  searchTerm: z.string().optional(),
  contentTypes: z.array(z.string()).optional(),
});

const downloadArgs = z.object({
  url: z.string().describe('The url field returned by canvas_list_course_files (absolute https URL).'),
  destinationPath: z.string().describe('Absolute path where the file should be written.'),
  overwrite: z.boolean().optional(),
});

export function registerFileTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_course_files', {
    description: "List a course's files (metadata only — use canvas_download_file with the `url` field).",
    annotations: { readOnlyHint: true },
    inputSchema: listArgs.shape,
  }, async (rawArgs) => {
    const args = listArgs.parse(rawArgs);
    const path = buildPath(`/api/v1/courses/${encodeURIComponent(args.courseId)}/files`, {
      search_term: args.searchTerm,
      'content_types[]': args.contentTypes,
    });
    const data = await client.requestPaginated(path);
    return textContent(data);
  });

  server.registerTool('canvas_download_file', {
    description: "Download a Canvas file to disk. `url` is the absolute URL from canvas_list_course_files; `destinationPath` is required.",
    annotations: { destructiveHint: true },
    inputSchema: downloadArgs.shape,
  }, async (rawArgs) => {
    const args = downloadArgs.parse(rawArgs);
    const meta = await client.download(args.url, args.destinationPath, {
      overwrite: args.overwrite ?? false,
    });
    return textContent(meta);
  });
}
