import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadAccount } from '../src/config.js';

const tokenEnv = {
  CANVAS_BASE_URL: 'https://cms.instructure.com',
  CANVAS_TOKEN: 'tok_abc',
};

const oauthEnv = {
  CANVAS_BASE_URL: 'https://cms.instructure.com',
  CANVAS_CLIENT_ID: 'cid',
  CANVAS_CLIENT_SECRET: 'csec',
  CANVAS_REFRESH_TOKEN: 'rtok',
};

const userPassEnv = {
  CANVAS_BASE_URL: 'https://cms.instructure.com',
  CANVAS_USERNAME: 'me@example.com',
  CANVAS_PASSWORD: 'hunter2',
};

afterEach(() => vi.restoreAllMocks());

describe('loadAccount (token mode)', () => {
  it('returns a TokenAccount when CANVAS_TOKEN is set', () => {
    expect(loadAccount(tokenEnv)).toEqual({
      mode: 'token',
      name: 'cms.instructure.com',
      baseUrl: 'https://cms.instructure.com',
      token: 'tok_abc',
    });
  });

  it('uses CANVAS_NAME when provided', () => {
    expect(loadAccount({ ...tokenEnv, CANVAS_NAME: 'CMS' }).name).toBe('CMS');
  });

  it('strips trailing slash from base URL', () => {
    const env = { ...tokenEnv, CANVAS_BASE_URL: 'https://cms.instructure.com/' };
    expect(loadAccount(env).baseUrl).toBe('https://cms.instructure.com');
  });

  it('falls back to host portion of base URL when CANVAS_NAME is empty', () => {
    expect(loadAccount({ ...tokenEnv, CANVAS_NAME: '' }).name).toBe('cms.instructure.com');
  });
});

describe('loadAccount (oauth mode)', () => {
  it('returns an OAuthAccount when the full triple is set', () => {
    expect(loadAccount(oauthEnv)).toEqual({
      mode: 'oauth',
      name: 'cms.instructure.com',
      baseUrl: 'https://cms.instructure.com',
      clientId: 'cid',
      clientSecret: 'csec',
      refreshToken: 'rtok',
      accessToken: undefined,
    });
  });

  it('respects CANVAS_ACCESS_TOKEN as a pre-cached token', () => {
    const acct = loadAccount({ ...oauthEnv, CANVAS_ACCESS_TOKEN: 'cached' });
    expect(acct.mode).toBe('oauth');
    if (acct.mode === 'oauth') expect(acct.accessToken).toBe('cached');
  });
});

describe('loadAccount (session mode)', () => {
  it('returns a SessionAccount when CANVAS_USERNAME+CANVAS_PASSWORD are set', () => {
    expect(loadAccount(userPassEnv)).toEqual({
      mode: 'session',
      name: 'cms.instructure.com',
      baseUrl: 'https://cms.instructure.com',
      username: 'me@example.com',
      password: 'hunter2',
    });
  });

  it('throws when CANVAS_USERNAME is set without CANVAS_PASSWORD', () => {
    expect(() =>
      loadAccount({
        CANVAS_BASE_URL: 'https://cms.instructure.com',
        CANVAS_USERNAME: 'me@example.com',
      }),
    ).toThrow(/CANVAS_PASSWORD/);
  });

  it('throws when CANVAS_PASSWORD is set without CANVAS_USERNAME', () => {
    expect(() =>
      loadAccount({
        CANVAS_BASE_URL: 'https://cms.instructure.com',
        CANVAS_PASSWORD: 'hunter2',
      }),
    ).toThrow(/CANVAS_USERNAME/);
  });
});

describe('loadAccount (precedence)', () => {
  it('prefers token mode when both token and full OAuth are set; warns to stderr', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...tokenEnv, ...oauthEnv };
    const acct = loadAccount(env);
    expect(acct.mode).toBe('token');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CANVAS_TOKEN takes precedence'),
    );
  });

  it('prefers token over username/password when both are set; warns to stderr', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const acct = loadAccount({ ...tokenEnv, ...userPassEnv });
    expect(acct.mode).toBe('token');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('username/password'));
  });

  it('prefers username/password over OAuth when both are set; warns to stderr', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const acct = loadAccount({ ...oauthEnv, ...userPassEnv });
    expect(acct.mode).toBe('session');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('OAuth'));
  });
});

describe('loadAccount errors', () => {
  it('throws when CANVAS_BASE_URL is missing', () => {
    expect(() => loadAccount({})).toThrow(/Missing required env var: CANVAS_BASE_URL/);
  });

  it('throws on non-https BASE_URL', () => {
    const env = { ...tokenEnv, CANVAS_BASE_URL: 'http://cms.instructure.com' };
    expect(() => loadAccount(env)).toThrow(/CANVAS_BASE_URL must be an https URL/);
  });

  it('throws when no auth mode is configured', () => {
    expect(() => loadAccount({ CANVAS_BASE_URL: 'https://cms.instructure.com' }))
      .toThrow(/Missing Canvas auth config/);
  });

  it('throws on partial OAuth (only client_id) listing the missing pieces', () => {
    const env = { CANVAS_BASE_URL: 'https://cms.instructure.com', CANVAS_CLIENT_ID: 'cid' };
    expect(() => loadAccount(env))
      .toThrow(/Incomplete OAuth config.*CANVAS_CLIENT_SECRET.*CANVAS_REFRESH_TOKEN/s);
  });

  it('throws on partial OAuth (missing client_id)', () => {
    const env = {
      CANVAS_BASE_URL: 'https://cms.instructure.com',
      CANVAS_CLIENT_SECRET: 's', CANVAS_REFRESH_TOKEN: 'r',
    };
    expect(() => loadAccount(env)).toThrow(/Incomplete OAuth config.*CANVAS_CLIENT_ID/);
  });
});
