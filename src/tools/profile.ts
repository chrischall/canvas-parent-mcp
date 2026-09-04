import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CanvasClient } from '../client.js';
import { viewArg, viewResponse } from '../view.js';

export function registerProfileTools(server: McpServer, client: CanvasClient): void {
  server.registerTool('canvas_get_profile', {
    description: "Get the logged-in user's Canvas profile (id, name, primary_email, login_id, locale, time_zone). Useful first call to confirm credentials.",
    annotations: { readOnlyHint: true },
    inputSchema: { view: viewArg() },
  }, async ({ view }) => {
    const data = await client.request('/api/v1/users/self/profile');
    return viewResponse(view, data);
  });
}
