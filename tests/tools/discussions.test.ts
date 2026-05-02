import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerDiscussionTools } from '../../src/tools/discussions.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

function setup() {
  const client = new CanvasClient(account);
  const pagSpy = vi.spyOn(client, 'requestPaginated').mockResolvedValue([] as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  registerDiscussionTools(server, client);
  return { handlers, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_discussion_topics', () => {
  it('builds /api/v1/courses/{id}/discussion_topics with default only_announcements=false', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_discussion_topics')!({ courseId: '42' });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/courses/42/discussion_topics');
    expect(url).toContain('only_announcements=false');
  });

  it('honors only_announcements=true and orderBy', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_discussion_topics')!({
      courseId: '42', onlyAnnouncements: true, orderBy: 'recent_activity',
    });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('only_announcements=true');
    expect(url).toContain('order_by=recent_activity');
  });
});
