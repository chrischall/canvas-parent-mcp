import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  sessionCachePath,
  createSessionCache,
  reportCacheWriteFailure,
} from '../src/session-cache.js';
import type { OAuthAccount, SessionAccount, TokenAccount } from '../src/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-cache-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const BASE = 'https://school.instructure.com';

const sessionAcct = (over: Partial<SessionAccount> = {}): SessionAccount => ({
  mode: 'session',
  name: 'n',
  baseUrl: BASE,
  username: 'parent@example.com',
  password: 'pw1',
  ...over,
});
const oauthAcct = (over: Partial<OAuthAccount> = {}): OAuthAccount => ({
  mode: 'oauth',
  name: 'n',
  baseUrl: BASE,
  clientId: 'cid',
  clientSecret: 'csecret',
  refreshToken: 'rt1',
  ...over,
});
const tokenAcct = (): TokenAccount => ({ mode: 'token', name: 'n', baseUrl: BASE, token: 'tok' });

const on = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  MCP_DATA_DIR: '',
  CANVAS_SESSION_CACHE: 'true',
  ...over,
});
const envFor = (d: string, over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  on({ MCP_DATA_DIR: d, ...over });

const record = () => ({ session: { headers: { Cookie: 'sid=abc' } }, sessionAt: Date.now() });
const cacheFile = (d: string): string => join(d, '.canvas-parent-mcp', 'session.json');

describe('sessionCachePath', () => {
  it('prefers MCP_DATA_DIR, the variable mcp-host injects', () => {
    expect(sessionCachePath({ MCP_DATA_DIR: '/data' })).toBe(
      '/data/.canvas-parent-mcp/session.json',
    );
  });

  it('honours an explicit CANVAS_SESSION_FILE', () => {
    expect(sessionCachePath({ CANVAS_SESSION_FILE: '/tmp/x.json', MCP_DATA_DIR: '/data' })).toBe(
      '/tmp/x.json',
    );
  });

  it('ignores a sentinel override rather than making a relative ./null', () => {
    expect(sessionCachePath({ CANVAS_SESSION_FILE: 'null', HOME: '/home/u' })).toBe(
      '/home/u/.canvas-parent-mcp/session.json',
    );
  });
});

describe('which modes are worth caching', () => {
  it('caches a credentialed session account', () => {
    expect(createSessionCache(sessionAcct(), { env: envFor(dir) })).not.toBeNull();
  });

  it('caches an oauth account — every login spends a refresh exchange', () => {
    expect(createSessionCache(oauthAcct(), { env: envFor(dir) })).not.toBeNull();
  });

  it('does NOT cache a token account — its login makes no network call', () => {
    // Caching would save nothing and put a bearer token on disk for no reason.
    expect(createSessionCache(tokenAcct(), { env: envFor(dir) })).toBeNull();
  });

  it('does NOT cache a fetchproxy-backed session — the cookie is re-read per mint', () => {
    expect(
      createSessionCache(sessionAcct(), { env: envFor(dir), browserBacked: true }),
    ).toBeNull();
  });

  it('is disabled by CANVAS_SESSION_CACHE=false', () => {
    const env = envFor(dir, { CANVAS_SESSION_CACHE: 'false' });
    expect(createSessionCache(sessionAcct(), { env })).toBeNull();
    expect(createSessionCache(oauthAcct(), { env })).toBeNull();
    expect(existsSync(join(dir, '.canvas-parent-mcp'))).toBe(false);
  });
});

describe('credential binding', () => {
  it('round-trips through a 0600 file for the same credentials', () => {
    const env = envFor(dir);
    createSessionCache(sessionAcct(), { env })!.save(record());
    expect(statSync(cacheFile(dir)).mode & 0o777).toBe(0o600);
    expect(createSessionCache(sessionAcct(), { env })!.load()).toEqual(
      expect.objectContaining({ session: { headers: { Cookie: 'sid=abc' } } }),
    );
  });

  it.each([
    ['a rotated password', sessionAcct({ password: 'pw2' })],
    ['a different username', sessionAcct({ username: 'other@example.com' })],
    ['a different Canvas instance', sessionAcct({ baseUrl: 'https://other.instructure.com' })],
  ])('discards the cache on %s', (_label, changed) => {
    const env = envFor(dir);
    createSessionCache(sessionAcct(), { env })!.save(record());
    expect(createSessionCache(changed, { env })!.load()).toBeNull();
  });

  it.each([
    ['a re-bootstrapped refresh token', oauthAcct({ refreshToken: 'rt2' })],
    ['a different client id', oauthAcct({ clientId: 'cid2' })],
  ])('discards an oauth cache on %s', (_label, changed) => {
    const env = envFor(dir);
    createSessionCache(oauthAcct(), { env })!.save(record());
    expect(createSessionCache(changed, { env })!.load()).toBeNull();
  });

  it('matches the username case-insensitively', () => {
    const env = envFor(dir);
    createSessionCache(sessionAcct(), { env })!.save(record());
    const cased = sessionAcct({ username: '  Parent@Example.COM ' });
    expect(createSessionCache(cased, { env })!.load()).not.toBeNull();
  });

  it('does not let a session record be read by an oauth account, or vice versa', () => {
    // The mode is part of the binding, so two accounts on one host cannot read
    // each other's record even if the rest of the material happened to align.
    const env = envFor(dir);
    createSessionCache(sessionAcct(), { env })!.save(record());
    expect(createSessionCache(oauthAcct(), { env })!.load()).toBeNull();
  });

  it('writes no credential material to disk', () => {
    const env = envFor(dir);
    createSessionCache(sessionAcct(), { env })!.save(record());
    const body = readFileSync(cacheFile(dir), 'utf8');
    expect(body).not.toContain('pw1');
    expect(body).not.toContain('parent@example.com');
  });
});

describe('stored-record shape guard', () => {
  it.each([
    ['null', null],
    ['a primitive', 'nope'],
    ['a missing sessionAt', { session: { headers: { Cookie: 'c' } } }],
    ['a primitive session', { session: 'nope', sessionAt: 1 }],
    ['missing headers', { session: {}, sessionAt: 1 }],
    ['empty headers', { session: { headers: {} }, sessionAt: 1 }],
    ['a non-string header value', { session: { headers: { Cookie: 7 } }, sessionAt: 1 }],
    [
      'a non-numeric accessTokenExpiresAt',
      { session: { headers: { Cookie: 'c' }, accessTokenExpiresAt: 'soon' }, sessionAt: 1 },
    ],
  ])('rejects %s rather than handing it to the session manager', (_label, body) => {
    const env = envFor(dir);
    const p = createSessionCache(sessionAcct(), { env })!;
    p.save(record());
    // Swap only the STATE, keeping the envelope's salted binding intact —
    // overwriting the whole file would be rejected by the binding check before
    // the shape guard ever ran, which is the wrong reason to pass.
    const envelope = JSON.parse(readFileSync(cacheFile(dir), 'utf8')) as { state: unknown };
    envelope.state = body;
    writeFileSync(cacheFile(dir), JSON.stringify(envelope), { mode: 0o600 });
    expect(createSessionCache(sessionAcct(), { env })!.load()).toBeNull();
  });

  it('accepts an oauth record carrying its access-token expiry', () => {
    const env = envFor(dir);
    const p = createSessionCache(oauthAcct(), { env })!;
    const at = Date.now() + 3_600_000;
    p.save({ session: { headers: { Authorization: 'Bearer x' }, accessTokenExpiresAt: at }, sessionAt: Date.now() });
    // The expiry has to survive: proactivelyExpire() reads it off the restored
    // session to re-mint before Canvas rejects the token.
    expect(p.load()?.session.accessTokenExpiresAt).toBe(at);
  });
});

describe('reportCacheWriteFailure', () => {
  it.each([
    ['an Error', new Error('EROFS'), 'EROFS'],
    ['a non-Error', 'disk gone', 'disk gone'],
  ])('names the cause for %s and stays on stderr', (_label, thrown, expected) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      reportCacheWriteFailure(thrown);
      expect(err).toHaveBeenCalledWith(expect.stringContaining(expected as string));
      // stdout is the JSON-RPC channel; a stray write there corrupts the stream.
      expect(out).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
  });
});
