import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CanvasClient } from '../../src/client.js';
import { registerFileTools } from '../../src/tools/files.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

function setup() {
  const client = new CanvasClient(account);
  const pagSpy = vi.spyOn(client, 'requestPaginated').mockResolvedValue([] as never);
  const dlSpy = vi.spyOn(client, 'download').mockResolvedValue({
    path: '/tmp/x', bytes: 0, contentType: 'application/pdf',
  } as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  registerFileTools(server, client);
  return { handlers, pagSpy, dlSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_course_files', () => {
  it('hits /api/v1/courses/{id}/files with no extra params', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_course_files')!({ courseId: '42' });
    expect(pagSpy.mock.calls[0][0]).toBe('/api/v1/courses/42/files');
  });

  it('threads searchTerm and contentTypes into the URL', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_course_files')!({
      courseId: '42', searchTerm: 'midterm', contentTypes: ['application/pdf'],
    });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('search_term=midterm');
    expect(url).toContain('content_types%5B%5D=application%2Fpdf');
  });
});

describe('canvas_download_file', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'canvas-tool-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('forwards url + destinationPath + overwrite:false default', async () => {
    const { handlers, dlSpy } = setup();
    const dest = join(dir, 'r.pdf');
    await handlers.get('canvas_download_file')!({
      url: 'https://cms.instructure.com/files/1/download', destinationPath: dest,
    });
    expect(dlSpy).toHaveBeenCalledWith(
      'https://cms.instructure.com/files/1/download', dest, { overwrite: false },
    );
  });

  it('passes overwrite:true through', async () => {
    const { handlers, dlSpy } = setup();
    await handlers.get('canvas_download_file')!({
      url: 'https://cms/x', destinationPath: '/tmp/x', overwrite: true,
    });
    expect(dlSpy).toHaveBeenCalledWith('https://cms/x', '/tmp/x', { overwrite: true });
  });
});
