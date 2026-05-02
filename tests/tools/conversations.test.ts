import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerConversationTools } from '../../src/tools/conversations.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

function setup() {
  const client = new CanvasClient(account);
  const reqSpy = vi.spyOn(client, 'request').mockResolvedValue({} as never);
  const pagSpy = vi.spyOn(client, 'requestPaginated').mockResolvedValue([] as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  registerConversationTools(server, client);
  return { handlers, reqSpy, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_conversations', () => {
  it('hits /api/v1/conversations with default include[]=participant_avatars and no scope', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_conversations')!({});
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/conversations');
    expect(url).toContain('include%5B%5D=participant_avatars');
    expect(url).not.toContain('scope=');
  });

  it('threads scope and filter[] into the URL', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_conversations')!({ scope: 'unread', filter: ['course_1'] });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('scope=unread');
    expect(url).toContain('filter%5B%5D=course_1');
  });
});

describe('canvas_get_conversation', () => {
  it('hits /api/v1/conversations/{id} with include[]=participant_avatars', async () => {
    const { handlers, reqSpy } = setup();
    await handlers.get('canvas_get_conversation')!({ id: '42' });
    const url = reqSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/conversations/42');
    expect(url).toContain('include%5B%5D=participant_avatars');
  });
});
