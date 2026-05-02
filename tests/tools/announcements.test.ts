import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerAnnouncementTools } from '../../src/tools/announcements.js';

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
  registerAnnouncementTools(server, client);
  return { handlers, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_announcements', () => {
  it('requires contextCodes', async () => {
    const { handlers } = setup();
    await expect(handlers.get('canvas_list_announcements')!({})).rejects.toThrow();
  });

  it('builds /api/v1/announcements with context_codes[] and active_only=true by default', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_announcements')!({ contextCodes: ['course_1'] });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/announcements');
    expect(url).toContain('context_codes%5B%5D=course_1');
    expect(url).toContain('active_only=true');
  });

  it('threads start/end and explicit activeOnly=false', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_announcements')!({
      contextCodes: ['course_1'], startDate: '2026-01-01', endDate: '2026-01-31', activeOnly: false,
    });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-01-31');
    expect(url).toContain('active_only=false');
  });
});
