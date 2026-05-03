export type Account = TokenAccount | OAuthAccount | SessionAccount;

export interface TokenAccount {
  mode: 'token';
  name: string;
  baseUrl: string;
  token: string;
}

export interface OAuthAccount {
  mode: 'oauth';
  name: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
}

export interface SessionAccount {
  mode: 'session';
  name: string;
  baseUrl: string;
  /** Initial cookie jar; minted lazily from username/password if not provided. */
  cookie?: string;
  /** When set with `password`, the client auto-logs-in at first request and re-mints on 401. */
  username?: string;
  password?: string;
}

export function loadAccount(env: Record<string, string | undefined> = process.env): Account {
  const baseUrl = env.CANVAS_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      'Missing required env var: CANVAS_BASE_URL. ' +
      'Set CANVAS_BASE_URL (e.g. https://cms.instructure.com) plus either CANVAS_TOKEN or the OAuth triple.',
    );
  }
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error(`CANVAS_BASE_URL must be an https URL, got: '${baseUrl}'`);
  }
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const name = env.CANVAS_NAME || new URL(cleanBaseUrl).host;

  const token = env.CANVAS_TOKEN;
  const cookie = env.CANVAS_COOKIE;
  const username = env.CANVAS_USERNAME;
  const password = env.CANVAS_PASSWORD;
  const clientId = env.CANVAS_CLIENT_ID;
  const clientSecret = env.CANVAS_CLIENT_SECRET;
  const refreshToken = env.CANVAS_REFRESH_TOKEN;

  const oauthSet = [clientId, clientSecret, refreshToken].filter((v) => !!v);
  const hasFullOAuth = oauthSet.length === 3;
  const hasPartialOAuth = oauthSet.length > 0 && oauthSet.length < 3;
  const hasFullUserPass = !!username && !!password;
  const hasPartialUserPass = (!!username) !== (!!password);
  const hasSession = !!cookie || hasFullUserPass;

  if (token) {
    const others = [hasFullOAuth ? 'OAuth' : null, hasSession ? 'session env vars' : null]
      .filter(Boolean)
      .join(' and ');
    if (others) {
      console.error(
        `[canvas-mcp] CANVAS_TOKEN takes precedence over ${others} — using CANVAS_TOKEN. ` +
          `Unset CANVAS_TOKEN to use ${others}.`,
      );
    }
    return { mode: 'token', name, baseUrl: cleanBaseUrl, token };
  }

  if (hasPartialUserPass) {
    const missing = !username ? 'CANVAS_USERNAME' : 'CANVAS_PASSWORD';
    throw new Error(
      `Incomplete username/password config — missing: ${missing}. ` +
        'Set both CANVAS_USERNAME and CANVAS_PASSWORD, or unset both.',
    );
  }

  if (hasSession) {
    if (hasFullOAuth) {
      console.error(
        '[canvas-mcp] Session env vars (CANVAS_COOKIE / CANVAS_USERNAME+CANVAS_PASSWORD) take precedence ' +
          'over OAuth — using session mode. Unset them to use OAuth.',
      );
    }
    const acct: SessionAccount = { mode: 'session', name, baseUrl: cleanBaseUrl };
    if (cookie) acct.cookie = cookie;
    if (hasFullUserPass) {
      acct.username = username;
      acct.password = password;
    }
    return acct;
  }

  if (hasPartialOAuth) {
    const missing: string[] = [];
    if (!clientId) missing.push('CANVAS_CLIENT_ID');
    if (!clientSecret) missing.push('CANVAS_CLIENT_SECRET');
    if (!refreshToken) missing.push('CANVAS_REFRESH_TOKEN');
    throw new Error(
      `Incomplete OAuth config — missing: ${missing.join(', ')}. ` +
      'Set all three of CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, CANVAS_REFRESH_TOKEN ' +
      '(or set CANVAS_TOKEN / CANVAS_COOKIE / CANVAS_USERNAME+CANVAS_PASSWORD instead).',
    );
  }

  if (hasFullOAuth) {
    return {
      mode: 'oauth',
      name,
      baseUrl: cleanBaseUrl,
      clientId: clientId!,
      clientSecret: clientSecret!,
      refreshToken: refreshToken!,
      accessToken: env.CANVAS_ACCESS_TOKEN,
    };
  }

  throw new Error(
    'Missing Canvas auth config. Set one of: CANVAS_TOKEN (personal access token), ' +
      'CANVAS_USERNAME+CANVAS_PASSWORD (auto-login), ' +
      'CANVAS_COOKIE (session cookie jar from canvas-parent-mcp-login), ' +
      'or all three of CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, CANVAS_REFRESH_TOKEN.',
  );
}
