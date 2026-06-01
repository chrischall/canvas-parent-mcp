import { writeFile, stat } from 'fs/promises';
import { dirname } from 'path';
import { parseLinkHeader, truncateErrorMessage } from '@chrischall/mcp-utils';
import type { Account, OAuthAccount, SessionAccount } from './config.js';
import { sessionLogin as defaultSessionLogin } from './session-login.js';

// Re-export the fleet-shared RFC 5988 Link parser so existing importers
// (`tests/client.test.ts`, and any sibling that pulled it from here) keep
// working unchanged. `@chrischall/mcp-utils`'s `parseLinkHeader` uses the
// identical regex and skips malformed entries the same way.
export { parseLinkHeader };

export type SessionLoginFn = typeof defaultSessionLogin;

export interface RequestOpts {
  method?: 'GET' | 'POST';
  body?: BodyInit;
  headers?: Record<string, string>;
  responseType?: 'json' | 'text';
}

export interface PaginatedOpts extends RequestOpts {
  perPage?: number;
  maxPages?: number;
}

const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 50;

export class CanvasClient {
  private account: Account;
  private refreshInFlight: Promise<void> | null = null;
  private accessTokenExpiresAt = 0;
  private sessionCookie: string | null = null;
  private sessionLoginFn: SessionLoginFn;

  /**
   * `preloaded` is the fetchproxy escape hatch: when set, the client uses
   * the supplied cookie header as-if it had just successfully run
   * `sessionLogin()`. On a 401 it falls back to the lazy login flow only if
   * usable credentials are present on the account — otherwise the 401
   * surfaces as a TokenExpiredError (re-sign-in happens in the browser, not
   * by re-running a form login with empty creds).
   */
  constructor(
    account: Account,
    opts: { sessionLogin?: SessionLoginFn; preloaded?: { cookie: string } } = {},
  ) {
    this.account = account;
    this.sessionLoginFn = opts.sessionLogin ?? defaultSessionLogin;
    if (opts.preloaded) this.sessionCookie = opts.preloaded.cookie;
  }

  /** Account metadata (no secrets) — useful for diagnostics. */
  describe(): { name: string; baseUrl: string; mode: 'token' | 'oauth' | 'session' } {
    return { name: this.account.name, baseUrl: this.account.baseUrl, mode: this.account.mode };
  }

  async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const res = await this.doRawRequest(path, opts);
    const text = await res.text();
    if (opts.responseType === 'text') return text as T;
    return (parseJsonBody<T>(text) ?? null) as T;
  }

  async requestPaginated<T>(path: string, opts: PaginatedOpts = {}): Promise<T[]> {
    const perPage = opts.perPage ?? DEFAULT_PER_PAGE;
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    let url = injectPerPage(path, perPage);
    const out: T[] = [];
    for (let page = 0; page < maxPages; page++) {
      const res = await this.doRawRequest(url, opts);
      const text = await res.text();
      const parsed = parseJsonBody<T[]>(text) ?? [];
      for (const item of parsed) out.push(item);
      const linkHeader = res.headers.get('link');
      const next = linkHeader ? parseLinkHeader(linkHeader).next : undefined;
      if (!next) break;
      url = next;
    }
    return out;
  }

  async download(
    path: string, destinationPath: string,
    opts: { overwrite?: boolean } = {},
  ): Promise<{ path: string; bytes: number; contentType: string }> {
    let destStat: Awaited<ReturnType<typeof stat>> | null = null;
    try { destStat = await stat(destinationPath); } catch { /* not present, ok */ }
    if (destStat?.isDirectory()) throw new InvalidPathError(destinationPath);
    if (destStat && !opts.overwrite) throw new FileExistsError(destinationPath);

    const parent = dirname(destinationPath);
    try { await stat(parent); } catch { throw new ParentDirectoryMissingError(parent); }

    const url = /^https?:\/\//i.test(path) ? path : `${this.account.baseUrl}${path}`;
    const res = await this.authedFetch(url, {});
    if (res.status === 404) throw new Error(`Canvas download 404 for ${path}`);
    if (!res.ok) throw new Error(`Canvas download ${res.status} for ${path}`);

    const buf = new Uint8Array(await res.arrayBuffer());
    await writeFile(destinationPath, buf);
    return {
      path: destinationPath,
      bytes: buf.byteLength,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  private async doRawRequest(path: string, opts: RequestOpts): Promise<Response> {
    const url = /^https?:\/\//i.test(path) ? path : `${this.account.baseUrl}${path}`;
    const accept = opts.responseType === 'text'
      ? 'text/html, text/plain, */*'
      : 'application/json+canvas-string-ids, application/json';
    const res = await this.authedFetch(url, {
      method: opts.method ?? 'GET',
      headers: { Accept: accept, ...(opts.headers ?? {}) },
      body: opts.body,
    });

    if (res.status === 404) throw new Error(`Canvas 404 ${path}`);
    if (res.status >= 500) throw new CanvasUnreachableError(res.status);
    if (!res.ok) throw new Error(`Canvas ${res.status} ${res.statusText} for ${path}`);
    return res;
  }

  /**
   * Fetch with auth headers attached and transparent 401 retry. Token mode has
   * no refresh path so a 401 throws immediately; oauth and session both attempt
   * one re-auth before giving up. Used by both API requests and file downloads.
   */
  private async authedFetch(
    url: string,
    init: RequestInit,
    isRetry = false,
  ): Promise<Response> {
    await this.ensureAuth();
    const res = await fetch(url, {
      ...init,
      headers: { ...this.getAuthHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });

    if (res.status === 401) {
      if (isRetry || this.account.mode === 'token') {
        throw new TokenExpiredError(this.account.mode);
      }
      // fetchproxy path: session account with empty creds — we can't
      // re-mint here. Surface the 401 so the user is told to re-sign-in
      // in their browser.
      if (this.account.mode === 'session' && !this.account.username && !this.account.password) {
        throw new TokenExpiredError('session');
      }
      await this.ensureAuth({ force: true });
      return this.authedFetch(url, init, true);
    }
    return res;
  }

  private getAuthHeaders(): Record<string, string> {
    const acct = this.account;
    if (acct.mode === 'token') return { Authorization: `Bearer ${acct.token}` };
    // For oauth/session: callers always invoke ensureAuth() first, which guarantees the credential is set.
    if (acct.mode === 'session') return { Cookie: this.sessionCookie! };
    return { Authorization: `Bearer ${acct.accessToken!}` };
  }

  private async ensureAuth(opts: { force?: boolean } = {}): Promise<void> {
    const acct = this.account;
    if (acct.mode === 'token') return;

    if (!opts.force) {
      if (acct.mode === 'oauth' && acct.accessToken && Date.now() < this.accessTokenExpiresAt) return;
      if (acct.mode === 'session' && this.sessionCookie) return;
    }

    if (this.refreshInFlight) { await this.refreshInFlight; return; }
    this.refreshInFlight = acct.mode === 'oauth'
      ? this.refreshAccessToken(acct)
      : this.mintSessionCookie(acct);
    try { await this.refreshInFlight; } finally { this.refreshInFlight = null; }
  }

  private async mintSessionCookie(acct: SessionAccount): Promise<void> {
    const result = await this.sessionLoginFn({
      baseUrl: acct.baseUrl,
      username: acct.username,
      password: acct.password,
    });
    this.sessionCookie = result.cookie;
  }

  private async refreshAccessToken(acct: OAuthAccount): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: acct.clientId,
      client_secret: acct.clientSecret,
      refresh_token: acct.refreshToken,
    }).toString();
    const res = await fetch(`${acct.baseUrl}/login/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      // Run the upstream body through the fleet-shared sanitizer: it redacts
      // `Bearer <token>` headers and JWTs FIRST, then truncates — so if Canvas's
      // /login/oauth2/token error echoes the client_secret or refresh_token, it
      // never reaches the client-facing error (audit HIGH finding, client.ts:199).
      const errBody = await res.text();
      throw new TokenExpiredError(
        'oauth',
        `${res.status} ${res.statusText}: ${truncateErrorMessage(errBody, 200)}`,
      );
    }
    const data = await res.json() as { access_token: string; expires_in?: number };
    acct.accessToken = data.access_token;
    const expiresIn = data.expires_in ?? 3600;
    this.accessTokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
  }
}

/** Strip Canvas's `while(1);` XSSI prefix and JSON-parse. Returns null for empty body. */
function parseJsonBody<T>(text: string): T | null {
  if (!text) return null;
  const stripped = text.replace(/^while\(1\);/, '');
  return JSON.parse(stripped) as T;
}

/** Inject ?per_page=N into a path, preserving existing query. No-op if already set. */
function injectPerPage(pathOrUrl: string, perPage: number): string {
  if (/[?&]per_page=/.test(pathOrUrl)) return pathOrUrl;
  const sep = pathOrUrl.includes('?') ? '&' : '?';
  return `${pathOrUrl}${sep}per_page=${perPage}`;
}

export class TokenExpiredError extends Error {
  constructor(public mode: 'token' | 'oauth' | 'session', public detail?: string) {
    const base =
      mode === 'token'
        ? 'Canvas access token rejected (401). Check CANVAS_TOKEN — it may be expired or revoked.'
        : mode === 'session'
          ? 'Canvas session login failed (401). Check CANVAS_USERNAME / CANVAS_PASSWORD — they may have changed, or the account may be locked or behind SSO.'
          : 'Canvas OAuth refresh failed. Check CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, CANVAS_REFRESH_TOKEN.';
    super(detail ? `${base} (${detail})` : base);
    this.name = 'TokenExpiredError';
  }
}

export class CanvasUnreachableError extends Error {
  constructor(public status: number) {
    super(`Canvas unreachable (status ${status})`);
    this.name = 'CanvasUnreachableError';
  }
}

export class InvalidPathError extends Error {
  constructor(public path: string) {
    super(`InvalidPath: destinationPath must be a filename, not a directory: ${path}`);
    this.name = 'InvalidPathError';
  }
}
export class ParentDirectoryMissingError extends Error {
  constructor(public path: string) {
    super(`ParentDirectoryMissing: ${path}`);
    this.name = 'ParentDirectoryMissingError';
  }
}
export class FileExistsError extends Error {
  constructor(public path: string) {
    super(`FileExists at ${path}. Pass overwrite:true to replace.`);
    this.name = 'FileExistsError';
  }
}
