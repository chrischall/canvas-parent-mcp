import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerPlannerTools } from '../../src/tools/planner.js';

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
  registerPlannerTools(server, client);
  return { handlers, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_planner_items', () => {
  it('uses /api/v1/planner/items with no observeeId', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_planner_items')!({});
    expect(pagSpy.mock.calls[0][0]).toBe('/api/v1/planner/items');
  });

  it('uses /api/v1/users/{id}/planner/items when observeeId set', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_planner_items')!({
      observeeId: '99', startDate: '2026-01-01', endDate: '2026-01-31',
      contextCodes: ['course_1'], filter: 'new_activity',
    });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/users/99/planner/items');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-01-31');
    expect(url).toContain('context_codes%5B%5D=course_1');
    expect(url).toContain('filter=new_activity');
  });
});
