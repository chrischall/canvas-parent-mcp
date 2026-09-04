import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CanvasClient } from '../client.js';
import { viewArg, viewResponse } from '../view.js';

export function registerObserveeTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_observees', {
    description: "List students linked to your Canvas observer account. Returns an empty array for plain student tokens.",
    annotations: { readOnlyHint: true },
    inputSchema: { view: viewArg() },
  }, async ({ view }) => {
    const data = await client.requestPaginated('/api/v1/users/self/observees?include[]=avatar_url');
    return viewResponse(view, data);
  });
}
