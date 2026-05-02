import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerSubmissionTools } from '../../src/tools/submissions.js';

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
  registerSubmissionTools(server, client);
  return { handlers, reqSpy, pagSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_get_submission', () => {
  it("defaults userId to 'self'", async () => {
    const { handlers, reqSpy } = setup();
    await handlers.get('canvas_get_submission')!({ courseId: '1', assignmentId: '2' });
    const url = reqSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/courses/1/assignments/2/submissions/self');
    expect(url).toContain('include%5B%5D=submission_comments');
    expect(url).toContain('include%5B%5D=rubric_assessment');
    expect(url).toContain('include%5B%5D=assignment');
  });

  it('uses the explicit userId when provided', async () => {
    const { handlers, reqSpy } = setup();
    await handlers.get('canvas_get_submission')!({ courseId: '1', assignmentId: '2', userId: '99' });
    expect(reqSpy.mock.calls[0][0] as string).toContain('/api/v1/courses/1/assignments/2/submissions/99');
  });
});

describe('canvas_list_recent_submissions', () => {
  it('defaults since to 14 days ago and student_ids[] to self', async () => {
    const { handlers, pagSpy } = setup();
    const before = Date.now();
    await handlers.get('canvas_list_recent_submissions')!({ courseId: '1' });
    const url = decodeURIComponent(pagSpy.mock.calls[0][0] as string);
    expect(url).toContain('/api/v1/courses/1/students/submissions');
    expect(url).toContain('student_ids[]=self');
    expect(url).toContain('workflow_state[]=graded');
    const sinceMatch = url.match(/graded_since=([^&]+)/);
    expect(sinceMatch).toBeTruthy();
    const sinceMs = Date.parse(sinceMatch![1]);
    // ~14 days ago, with a 5s tolerance
    expect(before - sinceMs).toBeGreaterThan(14 * 24 * 3600 * 1000 - 5000);
    expect(before - sinceMs).toBeLessThan(14 * 24 * 3600 * 1000 + 5000);
  });

  it('honors explicit since and studentId', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_recent_submissions')!({
      courseId: '1', studentId: '99', since: '2026-01-01T00:00:00Z',
    });
    const url = decodeURIComponent(pagSpy.mock.calls[0][0] as string);
    expect(url).toContain('student_ids[]=99');
    expect(url).toContain('graded_since=2026-01-01T00:00:00Z');
  });
});
