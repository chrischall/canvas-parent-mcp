import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile as fsWriteFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CanvasClient, TokenExpiredError, CanvasUnreachableError,
  InvalidPathError, ParentDirectoryMissingError, FileExistsError,
  parseLinkHeader,
} from '../src/client.js';
import type { Account } from '../src/config.js';

const tokenAccount: Account = {
  mode: 'token', name: 'cms', baseUrl: 'https://cms.instructure.com', token: 'tok_abc',
};
const oauthAccount = (): Account => ({
  mode: 'oauth', name: 'cms', baseUrl: 'https://cms.instructure.com',
  clientId: 'cid', clientSecret: 'csec', refreshToken: 'rtok',
});
const sessionAccount: Account = {
  mode: 'session', name: 'cms', baseUrl: 'https://cms.instructure.com',
  cookie: 'canvas_session=abc; pseudonym_credentials=def',
};

function jsonRes(body: unknown, init: ResponseInit = {}) {
  const headers = { 'content-type': 'application/json', ...((init.headers as Record<string, string>) ?? {}) };
  return new Response(JSON.stringify(body), { status: 200, ...init, headers });
}

afterEach(() => vi.restoreAllMocks());

describe('TokenExpiredError', () => {
  it('formats a token-mode message', () => {
    expect(new TokenExpiredError('token').message).toContain('Canvas access token rejected');
  });
  it('formats an oauth-mode message', () => {
    expect(new TokenExpiredError('oauth').message).toContain('Canvas OAuth refresh failed');
  });
  it('formats a session-mode message naming the re-login CLI', () => {
    expect(new TokenExpiredError('session').message).toMatch(/session cookie|canvas-parent-mcp-login/i);
  });
  it('appends detail in parens', () => {
    expect(new TokenExpiredError('token', 'extra').message).toContain('(extra)');
  });
});

describe('CanvasUnreachableError', () => {
  it('formats with status', () => {
    expect(new CanvasUnreachableError(503).message).toContain('503');
  });
});

describe('CanvasClient.describe', () => {
  it('returns metadata without secrets', () => {
    const c = new CanvasClient(tokenAccount);
    expect(c.describe()).toEqual({ name: 'cms', baseUrl: 'https://cms.instructure.com', mode: 'token' });
  });
});

describe('CanvasClient.request (token mode)', () => {
  it('sends Authorization: Bearer + Accept and returns parsed JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes({ id: 1, name: 'A' }));
    const c = new CanvasClient(tokenAccount);
    const data = await c.request<{ id: number; name: string }>('/api/v1/users/self');
    expect(data).toEqual({ id: 1, name: 'A' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cms.instructure.com/api/v1/users/self');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok_abc');
    expect(headers.Accept).toContain('application/json+canvas-string-ids');
  });

  it('throws TokenExpiredError on 401 (no retry attempted)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const c = new CanvasClient(tokenAccount);
    await expect(c.request('/api/v1/users/self')).rejects.toBeInstanceOf(TokenExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws Canvas 404 on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    const c = new CanvasClient(tokenAccount);
    await expect(c.request('/api/v1/x')).rejects.toThrow('Canvas 404 /api/v1/x');
  });

  it('throws CanvasUnreachableError on 5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
    const c = new CanvasClient(tokenAccount);
    await expect(c.request('/api/v1/x')).rejects.toBeInstanceOf(CanvasUnreachableError);
  });

  it('throws generic on other !ok statuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('bad', { status: 422, statusText: 'Unprocessable' }));
    const c = new CanvasClient(tokenAccount);
    await expect(c.request('/api/v1/x'))
      .rejects.toThrow(/Canvas 422 Unprocessable for \/api\/v1\/x/);
  });

  it('responseType:text returns raw string with text Accept header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('hello', { status: 200 }));
    const c = new CanvasClient(tokenAccount);
    const data = await c.request<string>('/x', { responseType: 'text' });
    expect(data).toBe('hello');
    const [, init] = fetchMock.mock.calls[0];
    expect(((init as RequestInit).headers as Record<string, string>).Accept).toContain('text/html');
  });

  it('strips while(1); XSSI prefix before JSON parsing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('while(1);{"x":1}', { status: 200 }));
    const c = new CanvasClient(tokenAccount);
    expect(await c.request('/x')).toEqual({ x: 1 });
  });

  it('returns null for empty response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 200 }));
    const c = new CanvasClient(tokenAccount);
    expect(await c.request('/x')).toBeNull();
  });

  it('passes method, body, and custom headers through to fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes({}));
    const c = new CanvasClient(tokenAccount);
    await c.request('/x', { method: 'POST', body: 'b', headers: { 'X-Custom': 'v' } });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe('b');
    expect(((init as RequestInit).headers as Record<string, string>)['X-Custom']).toBe('v');
  });
});

describe('CanvasClient.request (session mode)', () => {
  it('sends Cookie header (no Authorization) and returns parsed JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes({ id: 7 }));
    const c = new CanvasClient(sessionAccount);
    const data = await c.request<{ id: number }>('/api/v1/users/self');
    expect(data).toEqual({ id: 7 });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Cookie).toBe('canvas_session=abc; pseudonym_credentials=def');
    expect(headers.Authorization).toBeUndefined();
  });

  it('throws TokenExpiredError on 401 (no retry attempted)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const c = new CanvasClient(sessionAccount);
    await expect(c.request('/api/v1/users/self')).rejects.toBeInstanceOf(TokenExpiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('describe() reports session mode', () => {
    expect(new CanvasClient(sessionAccount).describe().mode).toBe('session');
  });
});

describe('CanvasClient.request (session mode + auto-login from username/password)', () => {
  function makeAccount(overrides: Partial<Account> = {}): Account {
    return {
      mode: 'session',
      name: 'cms',
      baseUrl: 'https://cms.instructure.com',
      username: 'me@example.com',
      password: 'hunter2',
      ...overrides,
    } as Account;
  }

  it('logs in lazily on first request when no cookie is cached', async () => {
    const sessionLoginMock = vi
      .fn()
      .mockResolvedValueOnce({ baseUrl: 'https://cms.instructure.com', cookie: 'fresh=1' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes({ id: 9 }));
    const c = new CanvasClient(makeAccount(), { sessionLogin: sessionLoginMock });
    expect(await c.request('/api/v1/users/self')).toEqual({ id: 9 });
    expect(sessionLoginMock).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'https://cms.instructure.com',
      username: 'me@example.com',
      password: 'hunter2',
    });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Cookie).toBe('fresh=1');
  });

  it('uses the cached cookie on the second request, not re-logging in', async () => {
    const sessionLoginMock = vi
      .fn()
      .mockResolvedValueOnce({ baseUrl: 'https://cms.instructure.com', cookie: 'fresh=1' });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ id: 1 }))
      .mockResolvedValueOnce(jsonRes({ id: 2 }));
    const c = new CanvasClient(makeAccount(), { sessionLogin: sessionLoginMock });
    await c.request('/x');
    await c.request('/y');
    expect(sessionLoginMock).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent first-time logins to a single sessionLogin call', async () => {
    let resolveLogin: ((r: { baseUrl: string; cookie: string }) => void) | undefined;
    const loginPromise = new Promise<{ baseUrl: string; cookie: string }>((r) => {
      resolveLogin = r;
    });
    const sessionLoginMock = vi.fn().mockReturnValueOnce(loginPromise);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(jsonRes({ ok: true })));
    const c = new CanvasClient(makeAccount(), { sessionLogin: sessionLoginMock });
    const p1 = c.request('/x');
    const p2 = c.request('/y');
    resolveLogin!({ baseUrl: 'https://cms.instructure.com', cookie: 'k=v' });
    await Promise.all([p1, p2]);
    expect(sessionLoginMock).toHaveBeenCalledTimes(1);
  });

  it('re-mints on 401 when username/password are present, then retries successfully', async () => {
    const sessionLoginMock = vi
      .fn()
      .mockResolvedValueOnce({ baseUrl: 'https://cms.instructure.com', cookie: 'second=1' });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const c = new CanvasClient(
      makeAccount({ cookie: 'stale=1' } as Partial<Account>),
      { sessionLogin: sessionLoginMock },
    );
    expect(await c.request('/x')).toEqual({ ok: true });
    expect(sessionLoginMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Cookie).toBe('second=1');
  });

  it('throws TokenExpiredError on a second 401 even after a successful re-mint', async () => {
    const sessionLoginMock = vi
      .fn()
      .mockResolvedValueOnce({ baseUrl: 'https://cms.instructure.com', cookie: 'second=1' });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const c = new CanvasClient(
      makeAccount({ cookie: 'stale=1' } as Partial<Account>),
      { sessionLogin: sessionLoginMock },
    );
    await expect(c.request('/x')).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('propagates the underlying SessionLoginError when sessionLogin throws (e.g. wrong password)', async () => {
    const sessionLoginMock = vi.fn().mockRejectedValueOnce(new Error('bad password'));
    const c = new CanvasClient(makeAccount(), { sessionLogin: sessionLoginMock });
    await expect(c.request('/x')).rejects.toThrow(/bad password/);
  });

  it('throws TokenExpiredError when session mode has neither cookie nor username/password (defensive)', async () => {
    const sessionLoginMock = vi.fn();
    const c = new CanvasClient(
      { mode: 'session', name: 'cms', baseUrl: 'https://cms.instructure.com' },
      { sessionLogin: sessionLoginMock },
    );
    await expect(c.request('/x')).rejects.toBeInstanceOf(TokenExpiredError);
    expect(sessionLoginMock).not.toHaveBeenCalled();
  });

  it('does not auto-login when only a cookie is configured (no username/password)', async () => {
    const sessionLoginMock = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 401 }));
    const c = new CanvasClient(
      {
        mode: 'session',
        name: 'cms',
        baseUrl: 'https://cms.instructure.com',
        cookie: 'only=cookie',
      },
      { sessionLogin: sessionLoginMock },
    );
    await expect(c.request('/x')).rejects.toBeInstanceOf(TokenExpiredError);
    expect(sessionLoginMock).not.toHaveBeenCalled();
  });
});

describe('CanvasClient.download (session mode)', () => {
  it('sends Cookie header on the download request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-dl-'));
    try {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
      const c = new CanvasClient(sessionAccount);
      await c.download('https://cms.instructure.com/files/1/download', join(dir, 'r.pdf'));
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers.Cookie).toBe('canvas_session=abc; pseudonym_credentials=def');
      expect(headers.Authorization).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('CanvasClient.request (oauth mode)', () => {
  it('lazily refreshes on first call, then uses cached token on second', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ access_token: 'at1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonRes({ id: 1 }))
      .mockResolvedValueOnce(jsonRes({ id: 2 }));
    const c = new CanvasClient(oauthAccount());
    await c.request('/x');
    await c.request('/y');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('https://cms.instructure.com/login/oauth2/token');
    const dataHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(dataHeaders.Authorization).toBe('Bearer at1');
  });

  it('refreshes once on 401 and retries successfully', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ access_token: 'at1', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonRes({ access_token: 'at2', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const c = new CanvasClient(oauthAccount());
    expect(await c.request('/x')).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('throws TokenExpiredError on a second 401 after refresh', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ access_token: 'at1', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonRes({ access_token: 'at2', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));
    const c = new CanvasClient(oauthAccount());
    await expect(c.request('/x')).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('throws TokenExpiredError when refresh POST returns non-OK', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('bad', { status: 401 }));
    const c = new CanvasClient(oauthAccount());
    await expect(c.request('/x')).rejects.toThrow(/Canvas OAuth refresh failed.*401/);
  });

  it('serializes concurrent refreshes (one POST to oauth2/token)', async () => {
    let resolveRefresh: ((r: Response) => void) | undefined;
    const refreshPromise = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (typeof url === 'string' && url.endsWith('/login/oauth2/token')) return refreshPromise;
      return Promise.resolve(jsonRes({ id: 1 }));
    });
    const c = new CanvasClient(oauthAccount());
    const p1 = c.request('/x');
    const p2 = c.request('/y');
    resolveRefresh!(jsonRes({ access_token: 'at', expires_in: 3600 }));
    await Promise.all([p1, p2]);
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => typeof url === 'string' && url.endsWith('/login/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('defaults expires_in to 3600 when refresh response omits it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ access_token: 'at1' }))
      .mockResolvedValueOnce(jsonRes({ ok: true }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const c = new CanvasClient(oauthAccount());
    await c.request('/x');
    await c.request('/y');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refreshes again proactively when expires_in falls inside the 60s window', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ access_token: 'at1', expires_in: 30 }))
      .mockResolvedValueOnce(jsonRes({ ok: true }))
      .mockResolvedValueOnce(jsonRes({ access_token: 'at2', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const c = new CanvasClient(oauthAccount());
    await c.request('/x');
    await c.request('/y');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('CanvasClient.requestPaginated', () => {
  it('returns [] on empty body with no Link header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 200 }));
    const c = new CanvasClient(tokenAccount);
    expect(await c.requestPaginated('/x')).toEqual([]);
  });

  it('injects ?per_page=100 into a path with no query string', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes([]));
    const c = new CanvasClient(tokenAccount);
    await c.requestPaginated('/x');
    expect(fetchMock.mock.calls[0][0]).toBe('https://cms.instructure.com/x?per_page=100');
  });

  it('injects &per_page=100 into a path with existing query string', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes([]));
    const c = new CanvasClient(tokenAccount);
    await c.requestPaginated('/x?foo=bar');
    expect(fetchMock.mock.calls[0][0]).toBe('https://cms.instructure.com/x?foo=bar&per_page=100');
  });

  it('does not duplicate per_page if already present', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes([]));
    const c = new CanvasClient(tokenAccount);
    await c.requestPaginated('/x?per_page=5');
    expect(fetchMock.mock.calls[0][0]).toBe('https://cms.instructure.com/x?per_page=5');
  });

  it('honors custom perPage option', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonRes([]));
    const c = new CanvasClient(tokenAccount);
    await c.requestPaginated('/x', { perPage: 25 });
    expect(fetchMock.mock.calls[0][0]).toContain('per_page=25');
  });

  it('follows Link rel="next" across multiple pages and concatenates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes([1, 2], {
        headers: {
          link: '<https://cms.instructure.com/api/v1/x?page=2&per_page=100>; rel="next", <https://cms.instructure.com/api/v1/x?page=1&per_page=100>; rel="first"',
        },
      }))
      .mockResolvedValueOnce(jsonRes([3], {
        headers: { link: '<https://cms.instructure.com/api/v1/x?page=3&per_page=100>; rel="next"' },
      }))
      .mockResolvedValueOnce(jsonRes([4]));
    const c = new CanvasClient(tokenAccount);
    expect(await c.requestPaginated<number>('/api/v1/x')).toEqual([1, 2, 3, 4]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops at maxPages even if rel="next" persists', async () => {
    // Factory — each fetch call returns a fresh Response (bodies aren't replayable).
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(jsonRes([1], {
      headers: { link: '<https://cms.instructure.com/api/v1/x?page=2>; rel="next"' },
    })));
    const c = new CanvasClient(tokenAccount);
    const data = await c.requestPaginated<number>('/api/v1/x', { maxPages: 2 });
    expect(data.length).toBe(2);
  });
});

describe('parseLinkHeader', () => {
  it('parses single rel', () => {
    expect(parseLinkHeader('<https://x/y?p=2>; rel="next"')).toEqual({ next: 'https://x/y?p=2' });
  });
  it('parses multiple rels', () => {
    expect(parseLinkHeader('<a>; rel="first", <b>; rel="next", <c>; rel="last"'))
      .toEqual({ first: 'a', next: 'b', last: 'c' });
  });
  it('skips malformed entries', () => {
    expect(parseLinkHeader('garbage, <ok>; rel="next"')).toEqual({ next: 'ok' });
  });
  it('handles unquoted rel', () => {
    expect(parseLinkHeader('<u>; rel=next')).toEqual({ next: 'u' });
  });
});

describe('CanvasClient.download', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'canvas-dl-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes a file and returns metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: { 'content-type': 'application/pdf' },
    }));
    const c = new CanvasClient(tokenAccount);
    const meta = await c.download('https://cms.instructure.com/files/1/download', join(dir, 'r.pdf'));
    expect(meta).toEqual({ path: join(dir, 'r.pdf'), bytes: 3, contentType: 'application/pdf' });
    expect([...await readFile(join(dir, 'r.pdf'))]).toEqual([1, 2, 3]);
  });

  it('falls back to application/octet-stream when content-type missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array([0]), { status: 200 }));
    const c = new CanvasClient(tokenAccount);
    const meta = await c.download('https://cms/x', join(dir, 'a.bin'));
    expect(meta.contentType).toBe('application/octet-stream');
  });

  it('throws InvalidPathError when destination is a directory', async () => {
    const c = new CanvasClient(tokenAccount);
    await expect(c.download('https://cms/x', dir)).rejects.toBeInstanceOf(InvalidPathError);
  });

  it('throws FileExistsError when file exists and !overwrite', async () => {
    const dest = join(dir, 'exists.txt');
    await fsWriteFile(dest, 'old');
    const c = new CanvasClient(tokenAccount);
    await expect(c.download('https://cms/x', dest)).rejects.toBeInstanceOf(FileExistsError);
  });

  it('overwrites when overwrite:true', async () => {
    const dest = join(dir, 'exists.txt');
    await fsWriteFile(dest, 'old');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200 }));
    const c = new CanvasClient(tokenAccount);
    await c.download('https://cms/x', dest, { overwrite: true });
    expect([...await readFile(dest)]).toEqual([9]);
  });

  it('throws ParentDirectoryMissingError when parent dir missing', async () => {
    const c = new CanvasClient(tokenAccount);
    await expect(c.download('https://cms/x', join(dir, 'no-such-subdir', 'r.pdf')))
      .rejects.toBeInstanceOf(ParentDirectoryMissingError);
  });

  it('throws Canvas download 404 on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    const c = new CanvasClient(tokenAccount);
    await expect(c.download('https://cms/x', join(dir, 'r.pdf')))
      .rejects.toThrow('Canvas download 404');
  });

  it('throws Canvas download <status> on other failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
    const c = new CanvasClient(tokenAccount);
    await expect(c.download('https://cms/x', join(dir, 'r.pdf')))
      .rejects.toThrow('Canvas download 503');
  });

  it('accepts relative paths and prepends baseUrl', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(new Uint8Array([0]), { status: 200 }));
    const c = new CanvasClient(tokenAccount);
    await c.download('/api/v1/files/1/download', join(dir, 'r.pdf'));
    expect(fetchMock.mock.calls[0][0]).toBe('https://cms.instructure.com/api/v1/files/1/download');
  });
});
