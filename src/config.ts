export type Account = TokenAccount | OAuthAccount;

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
  const clientId = env.CANVAS_CLIENT_ID;
  const clientSecret = env.CANVAS_CLIENT_SECRET;
  const refreshToken = env.CANVAS_REFRESH_TOKEN;

  const oauthSet = [clientId, clientSecret, refreshToken].filter((v) => !!v);
  const hasFullOAuth = oauthSet.length === 3;
  const hasPartialOAuth = oauthSet.length > 0 && oauthSet.length < 3;

  if (token) {
    if (hasFullOAuth) {
      console.error(
        '[canvas-mcp] Both CANVAS_TOKEN and OAuth env vars are set — using CANVAS_TOKEN. ' +
        'Unset CANVAS_TOKEN to use OAuth.',
      );
    }
    return { mode: 'token', name, baseUrl: cleanBaseUrl, token };
  }

  if (hasPartialOAuth) {
    const missing: string[] = [];
    if (!clientId) missing.push('CANVAS_CLIENT_ID');
    if (!clientSecret) missing.push('CANVAS_CLIENT_SECRET');
    if (!refreshToken) missing.push('CANVAS_REFRESH_TOKEN');
    throw new Error(
      `Incomplete OAuth config — missing: ${missing.join(', ')}. ` +
      'Set all three of CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, CANVAS_REFRESH_TOKEN ' +
      '(or set CANVAS_TOKEN instead for personal-access-token auth).',
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
    'Missing Canvas auth config. Set either CANVAS_TOKEN (personal access token) ' +
    'or all three of CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, CANVAS_REFRESH_TOKEN.',
  );
}
