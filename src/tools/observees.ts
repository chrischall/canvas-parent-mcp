import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CanvasClient } from '../client.js';
import { viewArg, viewResponse } from '../view.js';

const argsSchema = z.object({
  view: viewArg(),
});

export function registerObserveeTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_list_observees', {
    description: "List students linked to your Canvas observer account. Returns an empty array for plain student tokens.",
    annotations: { readOnlyHint: true },
    inputSchema: argsSchema.shape,
  }, async (rawArgs) => {
    const args = argsSchema.parse(rawArgs);
    const data = await client.requestPaginated('/api/v1/users/self/observees?include[]=avatar_url');
    return viewResponse(args.view, data);
  });
}
