import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerProfileTools } from '../../src/tools/profile.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

function setup(returnValue: unknown) {
  const client = new CanvasClient(account);
  vi.spyOn(client, 'request').mockResolvedValue(returnValue as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  registerProfileTools(server, client);
  return { client, handlers };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_get_profile', () => {
  it('calls /api/v1/users/self/profile and returns the JSON', async () => {
    const profile = { id: 1, name: 'Alex', primary_email: 'a@x.com' };
    const { client, handlers } = setup(profile);
    const result = await handlers.get('canvas_get_profile')!({});
    expect(client.request).toHaveBeenCalledWith('/api/v1/users/self/profile');
    expect(JSON.parse(result.content[0].text)).toEqual(profile);
  });
});
