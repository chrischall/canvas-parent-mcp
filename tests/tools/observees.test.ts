import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerObserveeTools } from '../../src/tools/observees.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

function setup(returnValue: unknown[]) {
  const client = new CanvasClient(account);
  vi.spyOn(client, 'requestPaginated').mockResolvedValue(returnValue as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  registerObserveeTools(server, client);
  return { client, handlers };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_observees', () => {
  it('calls /api/v1/users/self/observees and returns the array', async () => {
    const observees = [{ id: 1, name: 'Kid A' }];
    const { client, handlers } = setup(observees);
    const result = await handlers.get('canvas_list_observees')!({});
    expect(client.requestPaginated).toHaveBeenCalledWith(expect.stringContaining('/api/v1/users/self/observees'));
    expect(JSON.parse(result.content[0].text)).toEqual(observees);
  });

  it('returns [] when there are no observees', async () => {
    const { handlers } = setup([]);
    const result = await handlers.get('canvas_list_observees')!({});
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
