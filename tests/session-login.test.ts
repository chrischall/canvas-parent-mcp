import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SessionLoginError,
  extractAuthenticityToken,
  parseSetCookie,
  serializeCookies,
  sessionLogin,
} from '../src/session-login.js';

afterEach(() => vi.restoreAllMocks());

describe('SessionLoginError', () => {
  it('exposes a stable name', () => {
    const err = new SessionLoginError('boom');
    expect(err.name).toBe('SessionLoginError');
    expect(err.message).toBe('boom');
  });
});

describe('extractAuthenticityToken', () => {
  it('extracts the value from the Rails-canonical hidden input', () => {
    const html = '<input type="hidden" name="authenticity_token" value="3P/frAxZ==" />';
    expect(extractAuthenticityToken(html)).toBe('3P/frAxZ==');
  });

  it('handles value attribute appearing before name', () => {
    const html = '<input value="abc123==" name="authenticity_token" type="hidden">';
    expect(extractAuthenticityToken(html)).toBe('abc123==');
  });

  it('handles single-quoted attributes', () => {
    const html = "<input name='authenticity_token' value='single==' />";
    expect(extractAuthenticityToken(html)).toBe('single==');
  });

  it('returns null when no authenticity_token input is present', () => {
    expect(extractAuthenticityToken('<form><input name="other" value="x"></form>')).toBeNull();
  });

  it('returns null when the input has no value attribute', () => {
    expect(extractAuthenticityToken('<input name="authenticity_token">')).toBeNull();
  });

  it('picks the first matching input when multiple are present', () => {
    const html =
      '<input name="authenticity_token" value="first">' +
      '<input name="authenticity_token" value="second">';
    expect(extractAuthenticityToken(html)).toBe('first');
  });

  it('skips a name=authenticity_token input that lacks value, then returns the next one', () => {
    const html =
      '<input name="authenticity_token">' +
      '<input name="authenticity_token" value="real">';
    expect(extractAuthenticityToken(html)).toBe('real');
  });
});

describe('parseSetCookie', () => {
  it('returns name and value, ignoring attributes', () => {
    expect(parseSetCookie('canvas_session=abc; Path=/; Secure; HttpOnly')).toEqual({
      name: 'canvas_session',
      value: 'abc',
    });
  });

  it('preserves URL-encoded characters in the value', () => {
    expect(parseSetCookie('_csrf_token=3P%2FfrAx%3D%3D; path=/')).toEqual({
      name: '_csrf_token',
      value: '3P%2FfrAx%3D%3D',
    });
  });

  it('handles a cookie with no attributes', () => {
    expect(parseSetCookie('foo=bar')).toEqual({ name: 'foo', value: 'bar' });
  });

  it('returns null for malformed input (no equals sign)', () => {
    expect(parseSetCookie('garbage')).toBeNull();
  });

  it('returns null when name is empty', () => {
    expect(parseSetCookie('=value; Path=/')).toBeNull();
  });

  it('preserves an empty value', () => {
    expect(parseSetCookie('foo=; Path=/')).toEqual({ name: 'foo', value: '' });
  });
});

describe('serializeCookies', () => {
  it('joins name=value pairs with "; "', () => {
    expect(
      serializeCookies([
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
      ]),
    ).toBe('a=1; b=2');
  });

  it('returns an empty string for an empty list', () => {
    expect(serializeCookies([])).toBe('');
  });

  it('preserves URL-encoded values', () => {
    expect(serializeCookies([{ name: '_csrf_token', value: '3P%2FfrAx%3D%3D' }])).toBe(
      '_csrf_token=3P%2FfrAx%3D%3D',
    );
  });
});

const LOGIN_HTML = `
<!DOCTYPE html>
<html><body>
  <form action="/login/canvas" method="post">
    <input type="hidden" name="authenticity_token" value="csrf-raw-value==">
    <input name="pseudonym_session[unique_id]">
    <input name="pseudonym_session[password]" type="password">
  </form>
</body></html>
`;

describe('sessionLogin', () => {
  function loginPageRes() {
    return new Response(LOGIN_HTML, {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'set-cookie': '_csrf_token=csrf-raw-value%3D%3D; path=/; secure',
      },
    });
  }

  function postSuccessRes() {
    const headers = new Headers();
    headers.append(
      'set-cookie',
      'pseudonym_credentials=pcVal; path=/; expires=Sun, 17 May 2026 13:47:52 GMT; secure; httponly',
    );
    headers.append('set-cookie', 'canvas_session=csVal; path=/; secure; httponly');
    headers.append('set-cookie', '_csrf_token=newCsrf%3D%3D; path=/; secure');
    headers.append('set-cookie', 'log_session_id=logVal; path=/; secure; httponly');
    headers.set(
      'location',
      'https://sso.canvaslms.com/delegated_auth_pass_through?target=https%3A%2F%2Fcms.instructure.com%2F%3Flogin_success%3D1',
    );
    return new Response('', { status: 302, headers });
  }

  it('GETs the login page, POSTs creds with the matching authenticity_token, and returns the cookie jar', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(loginPageRes())
      .mockResolvedValueOnce(postSuccessRes());

    const result = await sessionLogin({
      baseUrl: 'https://cms.instructure.com',
      username: 'chris@example.com',
      password: 'hunter2',
    });

    // jar contains the post-login cookies
    expect(result.cookie).toContain('pseudonym_credentials=pcVal');
    expect(result.cookie).toContain('canvas_session=csVal');

    // GET call: fetched the login page
    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(getUrl).toBe('https://cms.instructure.com/login/canvas');
    expect((getInit as RequestInit).method ?? 'GET').toBe('GET');

    // POST call: sent form body with authenticity_token from the page
    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(postUrl).toBe('https://cms.instructure.com/login/canvas');
    expect((postInit as RequestInit).method).toBe('POST');
    const headers = (postInit as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers.Cookie).toContain('_csrf_token=csrf-raw-value%3D%3D');
    expect((postInit as RequestInit).redirect).toBe('manual');
    const bodyParams = new URLSearchParams((postInit as RequestInit).body as string);
    expect(bodyParams.get('authenticity_token')).toBe('csrf-raw-value==');
    expect(bodyParams.get('pseudonym_session[unique_id]')).toBe('chris@example.com');
    expect(bodyParams.get('pseudonym_session[password]')).toBe('hunter2');
    // Rails idiom: hidden 0 + checkbox 1, last value wins server-side → "remember me" checked
    expect(bodyParams.getAll('pseudonym_session[remember_me]')).toEqual(['0', '1']);
  });

  it('strips a trailing slash from the supplied base URL', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(loginPageRes())
      .mockResolvedValueOnce(postSuccessRes());
    await sessionLogin({
      baseUrl: 'https://cms.instructure.com/',
      username: 'u',
      password: 'p',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://cms.instructure.com/login/canvas');
  });

  it('throws when the login page GET returns non-OK', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 503, statusText: 'Service Unavailable' }),
    );
    await expect(
      sessionLogin({ baseUrl: 'https://cms.instructure.com', username: 'u', password: 'p' }),
    ).rejects.toThrow(/login page.*503/i);
  });

  it('throws when authenticity_token is missing from the page (likely SSO instance)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html><body>No form here</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    await expect(
      sessionLogin({ baseUrl: 'https://cms.instructure.com', username: 'u', password: 'p' }),
    ).rejects.toThrow(/authenticity_token|SSO/i);
  });

  it('throws SessionLoginError when login does not return a pseudonym_credentials cookie', async () => {
    const failHeaders = new Headers();
    failHeaders.append('set-cookie', '_csrf_token=newCsrf; path=/; secure');
    failHeaders.append('set-cookie', 'log_session_id=newLog; path=/; secure; httponly');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(loginPageRes())
      .mockResolvedValueOnce(new Response('', { status: 302, headers: failHeaders }));
    await expect(
      sessionLogin({ baseUrl: 'https://cms.instructure.com', username: 'u', password: 'wrong' }),
    ).rejects.toThrow(/incorrect username or password|pseudonym_credentials/i);
  });

  it('flags a likely SSO/2FA redirect when the response is a 302 to an unrelated host', async () => {
    const ssoHeaders = new Headers();
    // No pseudonym_credentials, redirect to identity provider
    ssoHeaders.set('location', 'https://idp.example.edu/saml/login?SAMLRequest=...');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(loginPageRes())
      .mockResolvedValueOnce(new Response('', { status: 302, headers: ssoHeaders }));
    await expect(
      sessionLogin({ baseUrl: 'https://cms.instructure.com', username: 'u', password: 'p' }),
    ).rejects.toThrow(/SSO|identity provider|2FA|cannot/i);
  });

  it('silently skips malformed Set-Cookie headers from the server', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'this-is-not-a-cookie'); // malformed: no '='
    headers.append(
      'set-cookie',
      'pseudonym_credentials=ok; path=/; expires=Sun, 17 May 2026 13:47:52 GMT; secure; httponly',
    );
    headers.append('set-cookie', 'canvas_session=cs2; path=/; secure; httponly');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(loginPageRes())
      .mockResolvedValueOnce(new Response('', { status: 302, headers }));
    const result = await sessionLogin({
      baseUrl: 'https://cms.instructure.com',
      username: 'u',
      password: 'p',
    });
    expect(result.cookie).toContain('pseudonym_credentials=ok');
    expect(result.cookie).toContain('canvas_session=cs2');
    expect(result.cookie).not.toContain('this-is-not-a-cookie');
  });

  it('passes through the User-Agent and Origin headers on the POST', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(loginPageRes())
      .mockResolvedValueOnce(postSuccessRes());
    await sessionLogin({
      baseUrl: 'https://cms.instructure.com',
      username: 'u',
      password: 'p',
    });
    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/Mozilla|canvas-parent-mcp/);
    expect(headers.Origin).toBe('https://cms.instructure.com');
    expect(headers.Referer).toBe('https://cms.instructure.com/login/canvas');
  });
});
