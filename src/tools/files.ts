import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { textContent, buildPath } from './_shared.js';

const listArgs = z.object({
  courseId: z.string(),
  searchTerm: z.string().optional(),
  contentTypes: z.array(z.string()).optional(),
});

const downloadArgs = z.object({
  url: z.string().describe('The url field returned by canvas_list_course_files (an https /files/ URL on the configured Canvas host; anything else is refused).'),
  destinationPath: z.string().describe('Where to write the file. Must be inside the download directory (CANVAS_OUTPUT_DIR, default ~/Downloads); a relative path is resolved against it.'),
  overwrite: z.boolean().optional(),
});

export function registerFileTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_course_files', {
    description: "List a course's files (metadata only — use canvas_download_file with the `url` field).",
    annotations: { readOnlyHint: true },
    inputSchema: listArgs,
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
    description: "Download a Canvas file to disk. `url` is the absolute URL from canvas_list_course_files (only file URLs on the configured Canvas host are accepted); `destinationPath` is required and must be inside the download directory (CANVAS_OUTPUT_DIR, default ~/Downloads).",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: downloadArgs,
  }, async (rawArgs) => {
    const args = downloadArgs.parse(rawArgs);
    const meta = await client.download(args.url, args.destinationPath, {
      overwrite: args.overwrite ?? false,
    });
    return textContent(meta);
  });
}
