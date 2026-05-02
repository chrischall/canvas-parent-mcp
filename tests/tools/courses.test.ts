import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerCourseTools } from '../../src/tools/courses.js';

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
  registerCourseTools(server, client);
  return { handlers, reqSpy, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_courses', () => {
  it('builds /api/v1/users/self/courses with default includes when observeeId omitted', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_courses')!({});
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/users/self/courses');
    expect(url).toContain('enrollment_state=active');
    expect(url).toContain('include%5B%5D=total_scores');
    expect(url).toContain('include%5B%5D=current_grading_period_scores');
    expect(url).toContain('include%5B%5D=term');
  });

  it('uses /api/v1/users/{id}/courses when observeeId provided', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_courses')!({ observeeId: '99' });
    expect(pagSpy.mock.calls[0][0] as string).toContain('/api/v1/users/99/courses');
  });
});

describe('canvas_get_course', () => {
  it('calls /api/v1/courses/{id} with syllabus, teachers, term includes', async () => {
    const { handlers, reqSpy } = setup();
    await handlers.get('canvas_get_course')!({ courseId: '42' });
    const url = reqSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/courses/42');
    expect(url).toContain('include%5B%5D=syllabus_body');
    expect(url).toContain('include%5B%5D=teachers');
    expect(url).toContain('include%5B%5D=term');
  });

  it('rejects when courseId is missing', async () => {
    const { handlers } = setup();
    await expect(handlers.get('canvas_get_course')!({})).rejects.toThrow();
  });
});
