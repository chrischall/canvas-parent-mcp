// Canvas mobile QR login flow — mirrors the canvas-ios reference implementation
// (Core/Core/Features/Login/{MobileVerify,APIOAuth,GetSSOLogin}.swift).
//
// 1. The QR encodes:    https://sso.canvaslms.com/canvas/login?domain=<host>&code=<one-time>
// 2. mobile_verify.json hands out the mobile client_id/client_secret for that domain.
// 3. POST /login/oauth2/token (authorization_code grant) trades the code for access+refresh tokens.
//
// Once we have the refresh_token + client_id + client_secret, the existing CanvasClient
// OAuth refresh path takes over for ongoing use.

import { truncateErrorMessage } from '@chrischall/mcp-utils';

const SSO_HOSTS = ['sso.canvaslms.com', 'sso.beta.canvaslms.com', 'sso.test.canvaslms.com'] as const;

export class QrLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrLoginError';
  }
}

export interface ParsedQr {
  ssoHost: string;
  domain: string;
  code: string;
}

export function parseQrLoginUrl(qrUrl: string): ParsedQr {
  let url: URL;
  try {
    url = new URL(qrUrl);
  } catch {
    throw new QrLoginError(`Not a valid URL: ${qrUrl}`);
  }
  if (url.protocol !== 'https:') {
    throw new QrLoginError(`QR URL must be https, got ${url.protocol}`);
  }
  if (!(SSO_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new QrLoginError(
      `Unrecognized SSO host '${url.hostname}'; expected one of ${SSO_HOSTS.join(', ')}`,
    );
  }
  if (url.pathname !== '/canvas/login') {
    throw new QrLoginError(`Expected path /canvas/login, got '${url.pathname}'`);
  }
  const rawDomain = url.searchParams.get('domain');
  if (!rawDomain) throw new QrLoginError("QR URL is missing 'domain' query parameter");
  const code = url.searchParams.get('code');
  if (!code) throw new QrLoginError("QR URL is missing 'code' query parameter");
  return { ssoHost: url.hostname, domain: normalizeDomain(rawDomain), code };
}

function normalizeDomain(raw: string): string {
  const stripped = raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return stripped;
}

export interface MobileClient {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export async function fetchMobileClient(domain: string, ssoHost: string): Promise<MobileClient> {
  const url = `https://${ssoHost}/api/v1/mobile_verify.json?domain=${encodeURIComponent(domain)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    // Fleet-shared sanitizer: redacts Bearer tokens/JWTs FIRST, then truncates,
    // so upstream error bodies can't leak secrets into the thrown message.
    const body = truncateErrorMessage(await res.text(), 200);
    throw new QrLoginError(`mobile_verify failed: ${res.status} ${res.statusText}: ${body}`);
  }
  const data = (await res.json()) as {
    authorized?: boolean;
    base_url?: string;
    client_id?: string;
    client_secret?: string;
  };
  if (data.authorized !== true) {
    throw new QrLoginError(
      `mobile_verify returned not authorized for domain '${domain}'. ` +
        'The host may not allow mobile logins.',
    );
  }
  if (!data.base_url) {
    throw new QrLoginError(`mobile_verify response is missing base_url for domain '${domain}'`);
  }
  if (!data.client_id || !data.client_secret) {
    throw new QrLoginError(
      `mobile_verify response is missing mobile client credentials for domain '${domain}'`,
    );
  }
  return {
    baseUrl: data.base_url.replace(/\/$/, ''),
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
}

export interface ExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  user: { id: string; name: string };
}

export async function exchangeAuthCode(
  client: MobileClient,
  code: string,
): Promise<ExchangeResult> {
  const res = await fetch(`${client.baseUrl}/login/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
  });
  if (!res.ok) {
    // The token endpoint can echo the POSTed client_secret/code in its error
    // body — redact (then truncate) before surfacing, matching the client.ts
    // OAuth refresh path.
    const body = truncateErrorMessage(await res.text(), 200);
    throw new QrLoginError(`Token exchange failed: ${res.status} ${res.statusText}: ${body}`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: { id: string; name: string };
  };
  if (!data.access_token) throw new QrLoginError('Token response missing access_token');
  if (!data.refresh_token) {
    throw new QrLoginError(
      'Token response missing refresh_token — cannot persist this session. ' +
        'The QR code may be one-shot only on this Canvas instance.',
    );
  }
  if (!data.user) throw new QrLoginError('Token response missing user');
  const result: ExchangeResult = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    user: data.user,
  };
  if (data.expires_in !== undefined) result.expiresIn = data.expires_in;
  return result;
}

export interface QrLoginResult extends MobileClient, ExchangeResult {}

export async function qrLogin(qrUrl: string): Promise<QrLoginResult> {
  const parsed = parseQrLoginUrl(qrUrl);
  const client = await fetchMobileClient(parsed.domain, parsed.ssoHost);
  const tokens = await exchangeAuthCode(client, parsed.code);
  return { ...client, ...tokens };
}
