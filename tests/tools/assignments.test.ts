import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerAssignmentTools } from '../../src/tools/assignments.js';

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
  registerAssignmentTools(server, client);
  return { handlers, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_assignments', () => {
  it('builds /api/v1/courses/{id}/assignments with submission include and order_by=due_at', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_assignments')!({ courseId: '42' });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/courses/42/assignments');
    expect(url).toContain('include%5B%5D=submission');
    expect(url).toContain('order_by=due_at');
    expect(url).not.toContain('bucket=');
  });

  it('threads the bucket filter into the URL when set', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_assignments')!({ courseId: '42', bucket: 'upcoming' });
    expect(pagSpy.mock.calls[0][0] as string).toContain('bucket=upcoming');
  });
});

describe('canvas_list_missing_submissions', () => {
  it('builds /api/v1/users/self/missing_submissions with filter[]=submittable when no observeeId', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_missing_submissions')!({});
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/users/self/missing_submissions');
    expect(url).toContain('filter%5B%5D=submittable');
    expect(url).not.toContain('course_ids');
  });

  it('targets the observee path and includes course_ids[] when both set', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_missing_submissions')!({ observeeId: '99', courseIds: ['1', '2'] });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/users/99/missing_submissions');
    expect(url).toContain('course_ids%5B%5D=1');
    expect(url).toContain('course_ids%5B%5D=2');
  });
});
