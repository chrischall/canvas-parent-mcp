import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { deliverFile, isHostedEnv, type DeliveredFile } from '@chrischall/mcp-utils/export';
import { MAX_FETCH_FILE_BYTES, type CanvasClient } from '../client.js';
import { textContent, buildPath, schoolMeta } from './_shared.js';

const listArgs = z.object({
  courseId: z.string(),
  searchTerm: z.string().optional(),
  contentTypes: z.array(z.string()).optional(),
});

const downloadArgs = z.object({
  url: z.string().describe('The url field returned by canvas_list_course_files (an https /files/ URL on the configured Canvas host; anything else is refused).'),
  destinationPath: z.string().optional().describe('Local installs: where to write the file. Must be inside the download directory (CANVAS_OUTPUT_DIR, default ~/Downloads); a relative path is resolved against it. Omit it to save under the file\'s own name there. Ignored on a hosted server, which returns a download link instead.'),
  overwrite: z.boolean().optional(),
});

export function registerFileTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_course_files', {
    description: "List a course's files (metadata only — use canvas_download_file with the `url` field).",
    annotations: { readOnlyHint: true, openWorldHint: true },
    _meta: schoolMeta('lookup'),
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
    description: "Download a Canvas file. `url` is the absolute URL from canvas_list_course_files (only file URLs on the configured Canvas host are accepted). On a local install the file is written to disk inside the download directory (CANVAS_OUTPUT_DIR, default ~/Downloads) — at `destinationPath` if given, else under its own name. On a hosted server it comes back as a signed, expiring download link (an image small enough is shown inline); give the link to the user.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    _meta: schoolMeta('other'),
    inputSchema: downloadArgs,
  }, async (rawArgs) => {
    const args = downloadArgs.parse(rawArgs);
    const hosted = isHostedEnv();
    // A local install with a destinationPath keeps the original streaming,
    // confined, overwrite-aware write — byte-for-byte the old behaviour.
    if (!hosted && args.destinationPath !== undefined) {
      const meta = await client.download(args.url, args.destinationPath, {
        overwrite: args.overwrite ?? false,
      });
      return textContent(meta);
    }
    // Hosted: the caller shares no filesystem with this process, so a file on
    // the runner's disk is unreachable. Buffer it (capped at the blob store's
    // object limit) and hand it back by the first route that reaches the
    // caller — inline image, else a signed link; never the runner's disk.
    const file = await client.fetchFile(args.url, { maxBytes: hosted ? MAX_FETCH_FILE_BYTES : undefined });
    const delivered = await deliverFile({
      bytes: file.bytes,
      fileName: file.fileName,
      mimeType: file.contentType,
      keyPrefix: 'files',
      ...(hosted ? {} : { prefer: 'disk' as const, disk: { dir: client.downloadRoot(), mode: 0o600 } }),
    });
    const ignored = hosted && args.destinationPath !== undefined
      ? 'destinationPath was ignored: this server is hosted and its disk is not reachable from your session.'
      : undefined;
    const note = [ignored, delivered.note].filter(Boolean).join(' ');
    const caption = textContent({
      ...deliveryFields(delivered),
      bytes: delivered.sizeBytes,
      contentType: file.contentType,
      ...(note ? { note } : {}),
    });
    return { content: [...delivered.content, ...caption.content] };
  });
}

/** The JSON half of a delivery (everything but the content blocks). */
function deliveryFields(d: DeliveredFile): Record<string, unknown> {
  return {
    via: d.via,
    fileName: d.fileName,
    mimeType: d.mimeType,
    ...(d.url !== undefined ? { url: d.url, expiresAt: d.expiresAt } : {}),
    ...(d.path !== undefined ? { path: d.path } : {}),
  };
}
