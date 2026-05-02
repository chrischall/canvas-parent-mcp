import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CanvasClient } from '../client.js';
import { textContent } from './_shared.js';

export function registerObserveeTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_observees', {
    description: "List students linked to your Canvas observer account. Returns an empty array for plain student tokens.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = await client.requestPaginated('/api/v1/users/self/observees?include[]=avatar_url');
    return textContent(data);
  });
}
