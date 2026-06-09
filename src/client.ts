import { writeFile, stat } from 'fs/promises';
import { dirname } from 'path';
import { parseLinkHeader, truncateErrorMessage } from '@chrischall/mcp-utils';
import { CookieSessionManager } from '@chrischall/mcp-utils/session';
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

/**
 * The session shape the {@link CookieSessionManager} mints and replays for us.
 * Canvas spans three auth modes (token / oauth / session-cookie), so rather than
 * a bare `cookieHeader` we carry the ready-to-attach auth `headers` plus, for
 * oauth, the absolute access-token expiry. The manager owns *when* `login` runs
 * (lazy first call + reactive re-login on a flagged 401); the proactive-refresh
 * nuance oauth needs (re-mint 60s before expiry) lives here, in the client's
 * `authState()` guard, because the manager's expiry detection is response-driven
 * and has no proactive-window concept.
 */
interface CanvasAuth {
  headers: Record<string, string>;
  /** Absolute oauth access-token expiry (epoch ms); undefined for token/session. */
  accessTokenExpiresAt?: number;
}

export class CanvasClient {
  private account: Account;
  private sessionLoginFn: SessionLoginFn;
  private preloadedCookie: string | null;
  private auth: CookieSessionManager<CanvasAuth>;

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
    this.preloadedCookie = opts.preloaded?.cookie ?? null;
    this.auth = new CookieSessionManager<CanvasAuth>({
      login: () => this.login(),
      // Reactive expiry: only a 401 in a mode that can re-mint warrants a replay.
      // token mode and fetchproxy-session (empty creds) can't re-auth here — their
      // 401 falls through as a Response and `mapStatus` turns it into a
      // TokenExpiredError so the user is told to re-sign-in / re-config.
      isExpired: (res) => res.status === 401 && this.canReauth(),
    });
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
    if (res.status === 401) throw new TokenExpiredError(this.account.mode);
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

    if (res.status === 401) throw new TokenExpiredError(this.account.mode);
    if (res.status === 404) throw new Error(`Canvas 404 ${path}`);
    if (res.status >= 500) throw new CanvasUnreachableError(res.status);
    if (!res.ok) throw new Error(`Canvas ${res.status} ${res.statusText} for ${path}`);
    return res;
  }

  /**
   * Fetch with auth headers attached, routed through the shared
   * {@link CookieSessionManager}: it single-flights the initial login, and on a
   * 401 that {@link canReauth} permits, re-mints the credential and replays the
   * request EXACTLY once. token mode and fetchproxy-session 401s aren't flagged
   * as expired, so they pass straight back as a 401 Response — the request/
   * download callers map that to a {@link TokenExpiredError}. Used by both API
   * requests and file downloads.
   */
  private async authedFetch(url: string, init: RequestInit): Promise<Response> {
    this.proactivelyExpire();
    return this.auth.withSession(async (state) =>
      fetch(url, {
        ...init,
        headers: { ...state.headers, ...(init.headers as Record<string, string> | undefined) },
      }),
    );
  }

  /**
   * oauth's proactive refresh: the manager only re-logs-in reactively (on a
   * flagged 401), but Canvas oauth tokens should be re-minted 60s *before*
   * expiry (the 60s skew is baked into `accessTokenExpiresAt`). When the live
   * access token is inside that window we invalidate the manager so the next
   * `ensure()` (inside `withSession`) mints a fresh one. No-op for token/session
   * (no `accessTokenExpiresAt`) and before the first login (no current session).
   */
  private proactivelyExpire(): void {
    const state = this.auth.current;
    if (
      state?.accessTokenExpiresAt !== undefined &&
      Date.now() >= state.accessTokenExpiresAt
    ) {
      this.auth.invalidate();
    }
  }

  /** Whether a 401 in the current mode can be recovered by re-running login(). */
  private canReauth(): boolean {
    const acct = this.account;
    if (acct.mode === 'oauth') return true;
    // session: only when we hold real form credentials. The fetchproxy path
    // synthesizes a SessionAccount with empty username/password and a preloaded
    // cookie — it can't re-mint, so its 401 is terminal.
    if (acct.mode === 'session') return !!acct.username && !!acct.password;
    return false; // token mode: no refresh path.
  }

  /** Mint the auth credential for the current mode. Invoked by the manager. */
  private async login(): Promise<CanvasAuth> {
    const acct = this.account;
    if (acct.mode === 'token') {
      return { headers: { Authorization: `Bearer ${acct.token}` } };
    }
    if (acct.mode === 'session') {
      // fetchproxy path: a preloaded cookie stands in for a form login on the
      // first ensure(). (A 401 here is terminal — canReauth() is false — so the
      // manager never asks login() to re-mint with empty creds.)
      if (this.preloadedCookie !== null) {
        return { headers: { Cookie: this.preloadedCookie } };
      }
      return { headers: { Cookie: await this.mintSessionCookie(acct) } };
    }
    return this.refreshAccessToken(acct);
  }

  private async mintSessionCookie(acct: SessionAccount): Promise<string> {
    const result = await this.sessionLoginFn({
      baseUrl: acct.baseUrl,
      username: acct.username,
      password: acct.password,
    });
    return result.cookie;
  }

  private async refreshAccessToken(acct: OAuthAccount): Promise<CanvasAuth> {
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
      // never reaches the client-facing error (audit HIGH finding).
      const errBody = await res.text();
      throw new TokenExpiredError(
        'oauth',
        `${res.status} ${res.statusText}: ${truncateErrorMessage(errBody, 200)}`,
      );
    }
    const data = await res.json() as { access_token: string; expires_in?: number };
    const expiresIn = data.expires_in ?? 3600;
    return {
      headers: { Authorization: `Bearer ${data.access_token}` },
      accessTokenExpiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
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
