import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerCalendarTools } from '../../src/tools/calendar.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

function setup() {
  const client = new CanvasClient(account);
  const reqSpy = vi.spyOn(client, 'request').mockResolvedValue([] as never);
  const pagSpy = vi.spyOn(client, 'requestPaginated').mockResolvedValue([] as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  registerCalendarTools(server, client);
  return { handlers, reqSpy, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_calendar_events', () => {
  it('hits /api/v1/calendar_events with no params when none are provided', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_calendar_events')!({});
    expect(pagSpy.mock.calls[0][0]).toBe('/api/v1/calendar_events');
  });

  it('threads type/start/end/contextCodes/allEvents into the URL', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_calendar_events')!({
      type: 'assignment',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      contextCodes: ['course_1', 'course_2'],
      allEvents: true,
    });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('type=assignment');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-01-31');
    expect(url).toContain('context_codes%5B%5D=course_1');
    expect(url).toContain('context_codes%5B%5D=course_2');
    expect(url).toContain('all_events=true');
  });
});

describe('canvas_list_upcoming_events', () => {
  it('hits /api/v1/users/self/upcoming_events', async () => {
    const { handlers, reqSpy } = setup();
    await handlers.get('canvas_list_upcoming_events')!({});
    expect(reqSpy).toHaveBeenCalledWith('/api/v1/users/self/upcoming_events');
  });
});
