import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// resolveAuth() drives four paths:
//   1. CANVAS_TOKEN → token mode
//   2. CANVAS_CLIENT_ID + SECRET + REFRESH_TOKEN → oauth mode
//   3. CANVAS_USERNAME + PASSWORD → session-scrape mode (legacy)
//   4. fetchproxy fallback → read canvas_session + pseudonym_credentials cookies
//      from the user's signed-in Canvas tab
//
// These tests verify path selection, error shapes, declared cookie/domain
// fingerprint, and that we don't preempt env-var auth when it's set.

const bootstrapMock = vi.fn();
vi.mock('@fetchproxy/bootstrap', () => ({
  bootstrap: (...args: unknown[]) => bootstrapMock(...args),
}));

import { resolveAuth } from '../src/auth.js';

describe('resolveAuth', () => {
  const ENV_KEYS = [
    'CANVAS_BASE_URL',
    'CANVAS_NAME',
    'CANVAS_TOKEN',
    'CANVAS_USERNAME',
    'CANVAS_PASSWORD',
    'CANVAS_CLIENT_ID',
    'CANVAS_CLIENT_SECRET',
    'CANVAS_REFRESH_TOKEN',
    'CANVAS_ACCESS_TOKEN',
    'CANVAS_DISABLE_FETCHPROXY',
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.CANVAS_BASE_URL = 'https://cms.instructure.com';
    bootstrapMock.mockReset();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  describe('path 1: token mode (CANVAS_TOKEN)', () => {
    it('returns a TokenAccount when CANVAS_TOKEN is set', async () => {
      process.env.CANVAS_TOKEN = 'tok_abc';
      const result = await resolveAuth();
      expect(result.account).toEqual({
        mode: 'token',
        name: 'cms.instructure.com',
        baseUrl: 'https://cms.instructure.com',
        token: 'tok_abc',
      });
      expect(result.source).toBe('env');
      expect(result.preloaded).toBeUndefined();
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('takes precedence over OAuth + session creds when all are set', async () => {
      process.env.CANVAS_TOKEN = 'tok_abc';
      process.env.CANVAS_CLIENT_ID = 'cid';
      process.env.CANVAS_CLIENT_SECRET = 'csec';
      process.env.CANVAS_REFRESH_TOKEN = 'rtok';
      process.env.CANVAS_USERNAME = 'me@example.com';
      process.env.CANVAS_PASSWORD = 'hunter2';
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await resolveAuth();
      expect(result.account.mode).toBe('token');
      expect(bootstrapMock).not.toHaveBeenCalled();
    });
  });

  describe('path 2: OAuth (CANVAS_CLIENT_ID + SECRET + REFRESH_TOKEN)', () => {
    it('returns an OAuthAccount when the full triple is set', async () => {
      process.env.CANVAS_CLIENT_ID = 'cid';
      process.env.CANVAS_CLIENT_SECRET = 'csec';
      process.env.CANVAS_REFRESH_TOKEN = 'rtok';
      const result = await resolveAuth();
      expect(result.account).toMatchObject({
        mode: 'oauth',
        baseUrl: 'https://cms.instructure.com',
        clientId: 'cid',
        clientSecret: 'csec',
        refreshToken: 'rtok',
      });
      expect(result.source).toBe('env');
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('does not fall through to fetchproxy when OAuth is incomplete', async () => {
      // Partial OAuth is a USER MISTAKE and propagates. Don't silently fall through.
      process.env.CANVAS_CLIENT_ID = 'cid';
      await expect(resolveAuth()).rejects.toThrow(/Incomplete OAuth config/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });
  });

  describe('path 3: session-scrape (CANVAS_USERNAME + CANVAS_PASSWORD)', () => {
    it('returns a SessionAccount when both username and password are set', async () => {
      process.env.CANVAS_USERNAME = 'me@example.com';
      process.env.CANVAS_PASSWORD = 'hunter2';
      const result = await resolveAuth();
      expect(result.account).toEqual({
        mode: 'session',
        name: 'cms.instructure.com',
        baseUrl: 'https://cms.instructure.com',
        username: 'me@example.com',
        password: 'hunter2',
      });
      expect(result.source).toBe('env');
      expect(result.preloaded).toBeUndefined();
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('does not fall through to fetchproxy when only username is set (partial config)', async () => {
      process.env.CANVAS_USERNAME = 'me@example.com';
      await expect(resolveAuth()).rejects.toThrow(/CANVAS_PASSWORD/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('does not fall through to fetchproxy when only password is set (partial config)', async () => {
      process.env.CANVAS_PASSWORD = 'hunter2';
      await expect(resolveAuth()).rejects.toThrow(/CANVAS_USERNAME/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });
  });

  describe('path 4: fetchproxy fallback', () => {
    it('reads canvas_session + pseudonym_credentials cookies via bootstrap()', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {
          canvas_session: 'cs_val',
          pseudonym_credentials: 'pc_val',
        },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });

      const result = await resolveAuth();

      expect(bootstrapMock).toHaveBeenCalledTimes(1);
      const opts = bootstrapMock.mock.calls[0][0] as {
        serverName: string;
        version: string;
        domains: string[];
        declare: { cookies: string[]; localStorage: string[]; sessionStorage: string[]; captureHeaders: unknown[] };
      };
      expect(opts.serverName).toBe('canvas-parent-mcp');
      expect(typeof opts.version).toBe('string');
      expect(opts.domains).toEqual(['instructure.com']);
      expect(opts.declare.cookies).toEqual(['canvas_session', 'pseudonym_credentials']);
      expect(opts.declare.localStorage).toEqual([]);
      expect(opts.declare.sessionStorage).toEqual([]);
      expect(opts.declare.captureHeaders).toEqual([]);

      expect(result.source).toBe('fetchproxy');
      expect(result.account.mode).toBe('session');
      expect(result.account.baseUrl).toBe('https://cms.instructure.com');
      expect(result.preloaded?.cookie).toBe('canvas_session=cs_val; pseudonym_credentials=pc_val');
    });

    it('declares the literal hostname when CANVAS_BASE_URL is not on *.instructure.com', async () => {
      process.env.CANVAS_BASE_URL = 'https://canvas.private-school.edu';
      bootstrapMock.mockResolvedValue({
        cookies: { canvas_session: 'cs', pseudonym_credentials: 'pc' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });

      await resolveAuth();

      const opts = bootstrapMock.mock.calls[0][0] as { domains: string[] };
      expect(opts.domains).toEqual(['canvas.private-school.edu']);
    });

    it('uses "instructure.com" wildcard for any *.instructure.com host', async () => {
      process.env.CANVAS_BASE_URL = 'https://uiowa.instructure.com';
      bootstrapMock.mockResolvedValue({
        cookies: { canvas_session: 'cs', pseudonym_credentials: 'pc' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });

      await resolveAuth();

      const opts = bootstrapMock.mock.calls[0][0] as { domains: string[] };
      expect(opts.domains).toEqual(['instructure.com']);
    });

    it('throws when canvas_session cookie is missing', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: { pseudonym_credentials: 'pc' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      await expect(resolveAuth()).rejects.toThrow(/required cookies not found/);
      await expect(resolveAuth()).rejects.toThrow(/Sign into.*Canvas/i);
    });

    it('throws when pseudonym_credentials cookie is missing', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: { canvas_session: 'cs' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      await expect(resolveAuth()).rejects.toThrow(/required cookies not found/);
    });

    it('throws when both required cookies are missing', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      await expect(resolveAuth()).rejects.toThrow(/required cookies not found/);
    });

    it('wraps bootstrap() errors with actionable context', async () => {
      bootstrapMock.mockRejectedValue(new Error('extension offline'));
      await expect(resolveAuth()).rejects.toThrow(/fetchproxy fallback failed: extension offline/);
    });

    it('handles non-Error rejections from bootstrap()', async () => {
      bootstrapMock.mockRejectedValue('plain string failure');
      await expect(resolveAuth()).rejects.toThrow(/fetchproxy fallback failed: plain string failure/);
    });

    it('surfaces FetchproxyBridgeDownError.hint verbatim when the SW retry exhausts', async () => {
      // 0.8.0+: bootstrap propagates FetchproxyBridgeDownError when the
      // server's lazy-revive retry also fails. We surface the typed
      // `.hint` so users see the actionable "click the extension toolbar
      // icon" message in path 4, matching the self-service guidance in
      // path 5.
      const { FetchproxyBridgeDownError } = await import('@fetchproxy/server');
      const downErr = new FetchproxyBridgeDownError({
        originalError: 'content_script_unreachable',
        retryAttempted: true,
        op: 'fetch',
      });
      bootstrapMock.mockRejectedValue(downErr);

      await expect(resolveAuth()).rejects.toThrow(/fetchproxy bridge is down/);
      await expect(resolveAuth()).rejects.toThrow(downErr.hint.slice(0, 20));
    });

    it('uses the resolved hostname as cache name when CANVAS_NAME is unset', async () => {
      process.env.CANVAS_BASE_URL = 'https://uiowa.instructure.com';
      bootstrapMock.mockResolvedValue({
        cookies: { canvas_session: 'cs', pseudonym_credentials: 'pc' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      const result = await resolveAuth();
      expect(result.account.name).toBe('uiowa.instructure.com');
    });

    it('honors CANVAS_NAME on the synthesized session account', async () => {
      process.env.CANVAS_NAME = 'My Canvas';
      bootstrapMock.mockResolvedValue({
        cookies: { canvas_session: 'cs', pseudonym_credentials: 'pc' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      const result = await resolveAuth();
      expect(result.account.name).toBe('My Canvas');
    });
  });

  describe('path 5: nothing configured', () => {
    it('skips fetchproxy when CANVAS_DISABLE_FETCHPROXY=1 is set', async () => {
      process.env.CANVAS_DISABLE_FETCHPROXY = '1';
      await expect(resolveAuth()).rejects.toThrow(/Missing Canvas auth config/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it.each(['1', 'true', 'yes', 'on', 'TRUE'])(
      'treats CANVAS_DISABLE_FETCHPROXY=%j as disabled',
      async (val) => {
        process.env.CANVAS_DISABLE_FETCHPROXY = val;
        await expect(resolveAuth()).rejects.toThrow(/Missing Canvas auth config/);
        expect(bootstrapMock).not.toHaveBeenCalled();
      },
    );

    it.each(['0', 'false', 'no', '', 'off'])(
      'treats CANVAS_DISABLE_FETCHPROXY=%j as enabled (default)',
      async (val) => {
        process.env.CANVAS_DISABLE_FETCHPROXY = val;
        bootstrapMock.mockResolvedValue({
          cookies: { canvas_session: 'cs', pseudonym_credentials: 'pc' },
          localStorage: {},
          sessionStorage: {},
          capturedHeaders: {},
        });
        await resolveAuth();
        expect(bootstrapMock).toHaveBeenCalled();
      },
    );

    // Mirrors the readVar() hardening in config.ts: defend against MCP hosts
    // that pass `${VAR}` placeholders or stringified undefined/null through.
    it.each(['undefined', 'null', '${CANVAS_DISABLE_FETCHPROXY}'])(
      'treats CANVAS_DISABLE_FETCHPROXY=%j as unset (falls through to fetchproxy)',
      async (val) => {
        process.env.CANVAS_DISABLE_FETCHPROXY = val;
        bootstrapMock.mockResolvedValue({
          cookies: { canvas_session: 'cs', pseudonym_credentials: 'pc' },
          localStorage: {},
          sessionStorage: {},
          capturedHeaders: {},
        });
        await resolveAuth();
        expect(bootstrapMock).toHaveBeenCalled();
      },
    );

    it('treats CANVAS_NAME=${CANVAS_NAME} as unset and falls back to hostname', async () => {
      process.env.CANVAS_NAME = '${CANVAS_NAME}';
      bootstrapMock.mockResolvedValue({
        cookies: { canvas_session: 'cs', pseudonym_credentials: 'pc' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      const result = await resolveAuth();
      expect(result.account.name).toBe('cms.instructure.com');
    });

    it('treats CANVAS_NAME=null as unset and falls back to hostname', async () => {
      process.env.CANVAS_NAME = 'null';
      bootstrapMock.mockResolvedValue({
        cookies: { canvas_session: 'cs', pseudonym_credentials: 'pc' },
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: {},
      });
      const result = await resolveAuth();
      expect(result.account.name).toBe('cms.instructure.com');
    });

    it('propagates the missing-base-url config error before trying fetchproxy', async () => {
      delete process.env.CANVAS_BASE_URL;
      await expect(resolveAuth()).rejects.toThrow(/CANVAS_BASE_URL/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });
  });
});
