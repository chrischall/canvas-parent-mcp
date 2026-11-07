import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../../src/client.js';
import { registerFileTools } from '../../src/tools/files.js';
import { MAX_FETCH_FILE_BYTES } from '../../src/client.js';

type Block = { type: string; text?: string; data?: string; mimeType?: string; resource?: { mimeType: string; blob: string } };
type Handler = (args: Record<string, unknown>) => Promise<{ content: Block[] }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

const configs = new Map<string, { description?: string; annotations?: Record<string, unknown> }>();

function setup() {
  const client = new CanvasClient(account);
  const pagSpy = vi.spyOn(client, 'requestPaginated').mockResolvedValue([] as never);
  const dlSpy = vi.spyOn(client, 'download').mockResolvedValue({
    path: '/tmp/x', bytes: 0, contentType: 'application/pdf',
  } as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    configs.set(name, c as { description?: string; annotations?: Record<string, unknown> });
    return undefined as never;
  });
  registerFileTools(server, client);
  const fetchSpy = vi.spyOn(client, 'fetchFile');
  return { handlers, pagSpy, dlSpy, fetchSpy };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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

describe('canvas_download_file registration (fleet-audit#64)', () => {
  it('is annotated destructive + open-world (it fetches a URL and writes to disk)', () => {
    setup();
    expect(configs.get('canvas_download_file')!.annotations).toMatchObject({
      destructiveHint: true, openWorldHint: true,
    });
  });

  it('tells the model the destination is confined to CANVAS_OUTPUT_DIR', () => {
    setup();
    expect(configs.get('canvas_download_file')!.description).toContain('CANVAS_OUTPUT_DIR');
  });
});

const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const BLOB_BASE = 'https://host.example/b/reg_0123456789abcdef01234567';
const FILE_URL = 'https://cms.instructure.com/files/1/download';

/** A hosted deployment: the blob store env, with its PUTs captured behind a stubbed fetch. */
function hostedWithStore() {
  vi.stubEnv('MCP_BLOB_BASE_URL', BLOB_BASE);
  vi.stubEnv('MCP_BLOB_SIGNING_KEY', 'a2V5');
  const puts: Array<{ url: string; type: string; bytes: Uint8Array }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    puts.push({ url, type: new Headers(init!.headers).get('content-type')!, bytes: new Uint8Array(init!.body as ArrayBuffer) });
    return new Response(null, { status: 201 });
  }));
  return puts;
}

function json(result: { content: Block[] }): Record<string, unknown> {
  const text = result.content.find((b) => b.type === 'text')!.text!;
  return JSON.parse(text) as Record<string, unknown>;
}

describe('canvas_download_file — delivery', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-deliver-'));
    vi.stubEnv('CANVAS_OUTPUT_DIR', dir);
    vi.stubEnv('MCP_BLOB_BASE_URL', '');
    vi.stubEnv('MCP_BLOB_SIGNING_KEY', '');
    vi.stubEnv('MCP_DATA_DIR', '');
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('local with destinationPath: unchanged — streams to disk via download(), returns its metadata', async () => {
    const { handlers, dlSpy, fetchSpy } = setup();
    const out = await handlers.get('canvas_download_file')!({ url: FILE_URL, destinationPath: join(dir, 'r.pdf') });
    expect(dlSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(json(out)).toEqual({ path: '/tmp/x', bytes: 0, contentType: 'application/pdf' });
    expect(out.content).toHaveLength(1);
  });

  it('local without destinationPath: saves a fresh file in the download directory', async () => {
    const { handlers, dlSpy, fetchSpy } = setup();
    fetchSpy.mockResolvedValue({ bytes: PDF, contentType: 'application/pdf', fileName: 'notes.pdf' });
    const out = await handlers.get('canvas_download_file')!({ url: FILE_URL });
    expect(dlSpy).not.toHaveBeenCalled();
    const meta = json(out);
    expect(meta).toMatchObject({ via: 'disk', fileName: 'notes.pdf', mimeType: 'application/pdf', bytes: PDF.length, contentType: 'application/pdf' });
    expect(meta.path).toBe(join(dir, 'notes.pdf'));
    expect([...await readFile(join(dir, 'notes.pdf'))]).toEqual([...PDF]);
    expect(fetchSpy).toHaveBeenCalledWith(FILE_URL, { maxBytes: undefined });
  });

  it('hosted: a non-image comes back as a signed link, and nothing is written to disk', async () => {
    const puts = hostedWithStore();
    const { handlers, dlSpy, fetchSpy } = setup();
    fetchSpy.mockResolvedValue({ bytes: PDF, contentType: 'application/pdf', fileName: 'notes.pdf' });
    const out = await handlers.get('canvas_download_file')!({ url: FILE_URL });
    expect(dlSpy).not.toHaveBeenCalled();
    const meta = json(out);
    expect(meta.via).toBe('link');
    expect(meta.url).toMatch(new RegExp(`^${BLOB_BASE}/files/[^/]+/notes\\.pdf\\?exp=`));
    expect(typeof meta.expiresAt).toBe('string');
    expect(meta).not.toHaveProperty('path');
    expect(puts).toHaveLength(1);
    expect(puts[0].type).toBe('application/pdf');
    expect(await readdir(dir)).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith(FILE_URL, { maxBytes: MAX_FETCH_FILE_BYTES });
  });

  it('hosted: a destinationPath is ignored (never written) and the note says so', async () => {
    hostedWithStore();
    const { handlers, dlSpy, fetchSpy } = setup();
    fetchSpy.mockResolvedValue({ bytes: PDF, contentType: 'application/pdf', fileName: 'notes.pdf' });
    const out = await handlers.get('canvas_download_file')!({ url: FILE_URL, destinationPath: join(dir, 'r.pdf') });
    expect(dlSpy).not.toHaveBeenCalled();
    const meta = json(out);
    expect(meta.via).toBe('link');
    expect(String(meta.note)).toContain('destinationPath');
    expect(await readdir(dir)).toEqual([]);
  });

  it('hosted: a small image is returned inline as image content', async () => {
    const puts = hostedWithStore();
    const { handlers, fetchSpy } = setup();
    fetchSpy.mockResolvedValue({ bytes: PNG, contentType: 'image/png;charset=UTF-8', fileName: 'diagram.png' });
    const out = await handlers.get('canvas_download_file')!({ url: FILE_URL });
    expect(out.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(json(out).via).toBe('image');
    expect(puts).toHaveLength(0);
  });

  it('hosted: an image over the inline cap goes out as a link', async () => {
    hostedWithStore();
    const { handlers, fetchSpy } = setup();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG);
    fetchSpy.mockResolvedValue({ bytes: big, contentType: 'image/png', fileName: 'scan.png' });
    const meta = json(await handlers.get('canvas_download_file')!({ url: FILE_URL }));
    expect(meta.via).toBe('link');
    expect(String(meta.note)).toContain('too large to return inline');
  });

  it('hosted with no blob store: an over-cap file is a clear too_large refusal, not a disk write', async () => {
    vi.stubEnv('MCP_DATA_DIR', dir);
    const { handlers, fetchSpy } = setup();
    fetchSpy.mockResolvedValue({ bytes: new Uint8Array(10 * 1024 * 1024 + 1), contentType: 'application/pdf', fileName: 'big.pdf' });
    await expect(handlers.get('canvas_download_file')!({ url: FILE_URL })).rejects.toMatchObject({ kind: 'too_large' });
    expect(await readdir(dir)).toEqual([]);
  });

  it('hosted with no blob store: a small file still comes back inline', async () => {
    vi.stubEnv('MCP_DATA_DIR', join(dir, 'data'));
    const { handlers, fetchSpy } = setup();
    fetchSpy.mockResolvedValue({ bytes: PDF, contentType: 'application/pdf', fileName: 'notes.pdf' });
    const out = await handlers.get('canvas_download_file')!({ url: FILE_URL });
    expect(out.content[0]).toMatchObject({ type: 'resource', resource: { mimeType: 'application/pdf' } });
    expect(json(out).via).toBe('resource');
    expect(await readdir(dir)).toEqual([]);
  });

  it('hosted: an over-cap download is refused by the client cap before delivery', async () => {
    hostedWithStore();
    const { handlers, fetchSpy } = setup();
    const { DownloadTooLargeError } = await import('../../src/client.js');
    fetchSpy.mockRejectedValue(new DownloadTooLargeError(MAX_FETCH_FILE_BYTES));
    await expect(handlers.get('canvas_download_file')!({ url: FILE_URL })).rejects.toBeInstanceOf(DownloadTooLargeError);
  });

  it('describes the hosted link route', () => {
    setup();
    expect(configs.get('canvas_download_file')!.description).toMatch(/link/i);
  });
});
