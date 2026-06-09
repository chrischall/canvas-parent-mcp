// Username/password login via the Canvas web form (/login/canvas).
//
// Required when the institution has restricted personal-access-token creation
// to the official mobile app. We reproduce a browser session: GET the login
// page to capture the CSRF cookie + authenticity_token, then POST credentials
// and harvest the resulting session cookies (canvas_session, pseudonym_credentials).
//
// The returned cookie jar is held in memory by CanvasClient's
// CookieSessionManager (as the minted session) and sent on every API request in
// place of an OAuth bearer token; on a 401 the manager re-invokes sessionLogin
// to mint a fresh jar. pseudonym_credentials is the "remember me" cookie with a
// meaningful expiry (~14 days); canvas_session piggybacks on it.

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export class SessionLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionLoginError';
  }
}

export function extractAuthenticityToken(html: string): string | null {
  const tagRegex = /<input\b[^>]*\bname=["']authenticity_token["'][^>]*>/gi;
  const matches = html.match(tagRegex);
  if (!matches) return null;
  for (const tag of matches) {
    const valMatch = tag.match(/\bvalue=["']([^"']+)["']/);
    if (valMatch) return valMatch[1];
  }
  return null;
}

export interface Cookie {
  name: string;
  value: string;
}

export function parseSetCookie(setCookieValue: string): Cookie | null {
  const semi = setCookieValue.indexOf(';');
  const nameValue = semi === -1 ? setCookieValue : setCookieValue.slice(0, semi);
  const eq = nameValue.indexOf('=');
  if (eq === -1) return null;
  const name = nameValue.slice(0, eq).trim();
  const value = nameValue.slice(eq + 1).trim();
  if (!name) return null;
  return { name, value };
}

export function serializeCookies(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function collectSetCookies(headers: Headers): Cookie[] {
  const out: Cookie[] = [];
  // Node 18+: Headers.getSetCookie() returns each Set-Cookie as a separate string.
  for (const sc of headers.getSetCookie()) {
    const parsed = parseSetCookie(sc);
    if (parsed) out.push(parsed);
  }
  return out;
}

export interface SessionLoginResult {
  cookie: string;
}

export async function sessionLogin(opts: {
  baseUrl: string;
  username: string;
  password: string;
}): Promise<SessionLoginResult> {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const loginUrl = `${baseUrl}/login/canvas`;

  // 1. GET the login page to capture the CSRF cookie + authenticity_token form value.
  const getRes = await fetch(loginUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!getRes.ok) {
    throw new SessionLoginError(
      `Login page fetch failed: ${getRes.status} ${getRes.statusText}`,
    );
  }
  const html = await getRes.text();
  const initialCookies = collectSetCookies(getRes.headers);
  const authToken = extractAuthenticityToken(html);
  if (!authToken) {
    throw new SessionLoginError(
      "Could not find authenticity_token on the login page. " +
        "This Canvas instance may use SSO (SAML/Google/Microsoft) — direct password login is not available.",
    );
  }

  // 2. POST the credentials. Mirror the field set Canvas's web form submits, including
  //    the duplicate remember_me=0/1 (Rails idiom for unchecked-then-checked) so the
  //    response carries a long-lived pseudonym_credentials cookie.
  const body = new URLSearchParams();
  body.append('utf8', '✓');
  body.append('authenticity_token', authToken);
  body.append('redirect_to_ssl', '1');
  body.append('pseudonym_session[unique_id]', opts.username);
  body.append('pseudonym_session[password]', opts.password);
  body.append('pseudonym_session[remember_me]', '0');
  body.append('pseudonym_session[remember_me]', '1');

  const postRes = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': USER_AGENT,
      Cookie: serializeCookies(initialCookies),
      Origin: baseUrl,
      Referer: loginUrl,
    },
    body: body.toString(),
  });

  // 3. Verify success by looking for the pseudonym_credentials cookie. Canvas sets it
  //    only when authentication actually succeeded; a failed login returns a fresh
  //    csrf token but no credentials cookie.
  const respCookies = collectSetCookies(postRes.headers);
  const hasCreds = respCookies.some((c) => c.name === 'pseudonym_credentials');

  if (!hasCreds) {
    const location = postRes.headers.get('location') ?? '';
    if (location && !location.startsWith(baseUrl) && !location.includes('sso.canvaslms.com')) {
      throw new SessionLoginError(
        `Login redirected to an external identity provider (${location.slice(0, 100)}). ` +
          'This Canvas account requires SSO/2FA — direct password login is not supported.',
      );
    }
    throw new SessionLoginError(
      'Login response did not include a pseudonym_credentials cookie — ' +
        'incorrect username or password, or the account is locked.',
    );
  }

  // Filter to the cookies that actually authenticate API calls. Path/Secure/HttpOnly
  // attributes are stripped during parseSetCookie, so we just join name=value pairs.
  const sessionCookies = respCookies.filter((c) =>
    ['canvas_session', 'pseudonym_credentials', '_csrf_token', 'log_session_id'].includes(c.name),
  );

  return { cookie: serializeCookies(sessionCookies) };
}
