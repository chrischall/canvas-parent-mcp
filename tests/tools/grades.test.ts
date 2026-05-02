import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerGradeTools } from '../../src/tools/grades.js';

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
  registerGradeTools(server, client);
  return { handlers, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_enrollments', () => {
  it('targets users/self when no observeeId, with state[]=active and type[]=StudentEnrollment', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_enrollments')!({});
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/users/self/enrollments');
    expect(url).toContain('state%5B%5D=active');
    expect(url).toContain('type%5B%5D=StudentEnrollment');
    expect(url).toContain('include%5B%5D=grades');
  });

  it('targets users/{id} when observeeId set', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_enrollments')!({ observeeId: '123' });
    expect(pagSpy.mock.calls[0][0] as string).toContain('/api/v1/users/123/enrollments');
  });
});
