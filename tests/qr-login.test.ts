import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseQrLoginUrl,
  fetchMobileClient,
  exchangeAuthCode,
  qrLogin,
  QrLoginError,
} from '../src/qr-login.js';

afterEach(() => vi.restoreAllMocks());

const VALID_QR =
  'https://sso.canvaslms.com/canvas/login?domain=cms.instructure.com&code=abc123';

function jsonRes(body: unknown, init: ResponseInit = {}) {
  const headers = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  return new Response(JSON.stringify(body), { status: 200, ...init, headers });
}

describe('parseQrLoginUrl', () => {
  it('extracts domain and code from a canonical QR URL', () => {
    expect(parseQrLoginUrl(VALID_QR)).toEqual({
      ssoHost: 'sso.canvaslms.com',
      domain: 'cms.instructure.com',
      code: 'abc123',
    });
  });

  it('accepts the beta SSO host', () => {
    const url = 'https://sso.beta.canvaslms.com/canvas/login?domain=x.beta.instructure.com&code=c';
    expect(parseQrLoginUrl(url).ssoHost).toBe('sso.beta.canvaslms.com');
  });

  it('accepts the test SSO host', () => {
    const url = 'https://sso.test.canvaslms.com/canvas/login?domain=x.test.instructure.com&code=c';
    expect(parseQrLoginUrl(url).ssoHost).toBe('sso.test.canvaslms.com');
  });

  it('throws QrLoginError on a non-URL input', () => {
    expect(() => parseQrLoginUrl('not-a-url')).toThrow(QrLoginError);
  });

  it('throws on a non-https URL', () => {
    const url = 'http://sso.canvaslms.com/canvas/login?domain=cms.instructure.com&code=x';
    expect(() => parseQrLoginUrl(url)).toThrow(/must be https/i);
  });

  it('throws on an unrecognized host', () => {
    const url = 'https://evil.example.com/canvas/login?domain=cms.instructure.com&code=x';
    expect(() => parseQrLoginUrl(url)).toThrow(/SSO host/i);
  });

  it('throws on the wrong path', () => {
    const url = 'https://sso.canvaslms.com/other/path?domain=cms.instructure.com&code=x';
    expect(() => parseQrLoginUrl(url)).toThrow(/\/canvas\/login/);
  });

  it('throws when domain is missing', () => {
    const url = 'https://sso.canvaslms.com/canvas/login?code=x';
    expect(() => parseQrLoginUrl(url)).toThrow(/domain/);
  });

  it('throws when domain is empty', () => {
    const url = 'https://sso.canvaslms.com/canvas/login?domain=&code=x';
    expect(() => parseQrLoginUrl(url)).toThrow(/domain/);
  });

  it('throws when code is missing', () => {
    const url = 'https://sso.canvaslms.com/canvas/login?domain=cms.instructure.com';
    expect(() => parseQrLoginUrl(url)).toThrow(/code/);
  });

  it('throws when code is empty', () => {
    const url = 'https://sso.canvaslms.com/canvas/login?domain=cms.instructure.com&code=';
    expect(() => parseQrLoginUrl(url)).toThrow(/code/);
  });

  it('strips a trailing slash and protocol from domain if present', () => {
    const url = 'https://sso.canvaslms.com/canvas/login?domain=https://cms.instructure.com/&code=x';
    expect(parseQrLoginUrl(url).domain).toBe('cms.instructure.com');
  });
});

describe('fetchMobileClient', () => {
  it('GETs the mobile_verify endpoint on the correct SSO host with the domain query', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonRes({
          authorized: true,
          base_url: 'https://cms.instructure.com/',
          client_id: 'mobile-cid',
          client_secret: 'mobile-csec',
        }),
      );
    const client = await fetchMobileClient('cms.instructure.com', 'sso.canvaslms.com');
    expect(client).toEqual({
      baseUrl: 'https://cms.instructure.com',
      clientId: 'mobile-cid',
      clientSecret: 'mobile-csec',
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://sso.canvaslms.com/api/v1/mobile_verify.json?domain=cms.instructure.com',
    );
  });

  it('throws when authorized is false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({ authorized: false, base_url: null, client_id: null, client_secret: null }),
    );
    await expect(fetchMobileClient('cms.instructure.com', 'sso.canvaslms.com')).rejects.toThrow(
      /not authorized/i,
    );
  });

  it('throws when client_id or client_secret is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({ authorized: true, base_url: 'https://cms.instructure.com/' }),
    );
    await expect(fetchMobileClient('cms.instructure.com', 'sso.canvaslms.com')).rejects.toThrow(
      /client credentials/i,
    );
  });

  it('throws when base_url is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({ authorized: true, client_id: 'a', client_secret: 'b' }),
    );
    await expect(fetchMobileClient('cms.instructure.com', 'sso.canvaslms.com')).rejects.toThrow(
      /base_url/,
    );
  });

  it('throws on non-OK response with status and body snippet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('nope', { status: 503, statusText: 'unavailable' }),
    );
    await expect(fetchMobileClient('cms.instructure.com', 'sso.canvaslms.com')).rejects.toThrow(
      /503.*nope/,
    );
  });

  it('strips a trailing slash from the returned base_url', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({
        authorized: true,
        base_url: 'https://cms.instructure.com/',
        client_id: 'a',
        client_secret: 'b',
      }),
    );
    const client = await fetchMobileClient('cms.instructure.com', 'sso.canvaslms.com');
    expect(client.baseUrl).toBe('https://cms.instructure.com');
  });
});

describe('exchangeAuthCode', () => {
  const client = {
    baseUrl: 'https://cms.instructure.com',
    clientId: 'mobile-cid',
    clientSecret: 'mobile-csec',
  };

  it('POSTs JSON to /login/oauth2/token with authorization_code grant', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'Bearer',
        expires_in: 3600,
        user: { id: '42', name: 'Test User' },
      }),
    );

    const result = await exchangeAuthCode(client, 'qrcode123');
    expect(result).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
      user: { id: '42', name: 'Test User' },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cms.instructure.com/login/oauth2/token');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      client_id: 'mobile-cid',
      client_secret: 'mobile-csec',
      grant_type: 'authorization_code',
      code: 'qrcode123',
    });
  });

  it('throws when the response omits a refresh_token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({ access_token: 'at', token_type: 'Bearer', user: { id: '1', name: 'x' } }),
    );
    await expect(exchangeAuthCode(client, 'c')).rejects.toThrow(/refresh_token/);
  });

  it('throws when the response omits an access_token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({ refresh_token: 'rt', token_type: 'Bearer', user: { id: '1', name: 'x' } }),
    );
    await expect(exchangeAuthCode(client, 'c')).rejects.toThrow(/access_token/);
  });

  it('throws on non-OK response with status and body snippet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"error":"invalid_grant"}', { status: 400, statusText: 'Bad Request' }),
    );
    await expect(exchangeAuthCode(client, 'c')).rejects.toThrow(/400.*invalid_grant/);
  });

  it('omits expiresIn when missing from response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({
        access_token: 'at',
        refresh_token: 'rt',
        token_type: 'Bearer',
        user: { id: '1', name: 'x' },
      }),
    );
    const result = await exchangeAuthCode(client, 'c');
    expect(result.expiresIn).toBeUndefined();
  });

  it('throws when user is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonRes({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' }),
    );
    await expect(exchangeAuthCode(client, 'c')).rejects.toThrow(/user/);
  });
});

describe('qrLogin orchestrator', () => {
  it('parses QR, fetches mobile client, exchanges code, and returns combined result', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonRes({
          authorized: true,
          base_url: 'https://cms.instructure.com/',
          client_id: 'mobile-cid',
          client_secret: 'mobile-csec',
        }),
      )
      .mockResolvedValueOnce(
        jsonRes({
          access_token: 'at',
          refresh_token: 'rt',
          token_type: 'Bearer',
          expires_in: 3600,
          user: { id: '42', name: 'Test User' },
        }),
      );

    const result = await qrLogin(VALID_QR);
    expect(result).toEqual({
      baseUrl: 'https://cms.instructure.com',
      clientId: 'mobile-cid',
      clientSecret: 'mobile-csec',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
      user: { id: '42', name: 'Test User' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('mobile_verify.json');
    expect(fetchMock.mock.calls[1][0]).toContain('/login/oauth2/token');
  });

  it('uses the matching SSO host (beta) when fetching mobile_verify', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonRes({
          authorized: true,
          base_url: 'https://x.beta.instructure.com',
          client_id: 'a',
          client_secret: 'b',
        }),
      )
      .mockResolvedValueOnce(
        jsonRes({
          access_token: 'at',
          refresh_token: 'rt',
          token_type: 'Bearer',
          user: { id: '1', name: 'x' },
        }),
      );

    await qrLogin('https://sso.beta.canvaslms.com/canvas/login?domain=x.beta.instructure.com&code=c');
    expect(fetchMock.mock.calls[0][0]).toContain('sso.beta.canvaslms.com');
  });
});

describe('QrLoginError', () => {
  it('exposes a stable name', () => {
    const err = new QrLoginError('boom');
    expect(err.name).toBe('QrLoginError');
    expect(err.message).toBe('boom');
  });
});
