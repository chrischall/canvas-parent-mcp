import { writeFile, stat } from 'fs/promises';
import { dirname } from 'path';
import { createOAuth2Refresher, parseLinkHeader } from '@chrischall/mcp-utils';
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
  /**
   * fetchproxy lift. Called on the first login AND on every renewal, which is
   * what keeps the path alive once the browser cookie lapses.
   */
  private refreshSession: (() => Promise<string>) | null;
  private auth: CookieSessionManager<CanvasAuth>;
  /** Lazily-built shared refresh_token exchanger (oauth mode only). */
  private oauthRefresh: ReturnType<typeof createOAuth2Refresher> | null = null;

  /**
   * `refreshSession` is the fetchproxy escape hatch: when set, it REPLACES
   * `sessionLogin()` as the way this client mints a session cookie. It is
   * called lazily on the first request and again on every 401, so a lapsed
   * browser cookie recovers by re-reading the tab instead of dead-ending.
   *
   * It must re-read the browser each time rather than return a captured
   * value — that capture-once shape is precisely what made a 401 terminal
   * here, with a restart the only cure.
   */
  constructor(
    account: Account,
    opts: { sessionLogin?: SessionLoginFn; refreshSession?: () => Promise<string> } = {},
  ) {
    this.account = account;
    this.sessionLoginFn = opts.sessionLogin ?? defaultSessionLogin;
    this.refreshSession = opts.refreshSession ?? null;
    this.auth = new CookieSessionManager<CanvasAuth>({
      login: () => this.login(),
      // Reactive expiry: only a 401 in a mode that can re-mint warrants a
      // replay. token mode still can't (no refresh path), and a session
      // account with neither a lift nor credentials still can't — those 401s
      // fall through as a Response and `mapStatus` turns them into a
      // TokenExpiredError.
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
    // session: either a browser lift (fetchproxy) or real form credentials
    // can re-mint. The lift is the fetchproxy path's re-auth — before it
    // existed, that path synthesized empty username/password and a captured
    // cookie, so its 401 was terminal and only a restart recovered.
    if (acct.mode === 'session') return !!this.refreshSession || (!!acct.username && !!acct.password);
    return false; // token mode: no refresh path.
  }

  /** Mint the auth credential for the current mode. Invoked by the manager. */
  private async login(): Promise<CanvasAuth> {
    const acct = this.account;
    if (acct.mode === 'token') {
      return { headers: { Authorization: `Bearer ${acct.token}` } };
    }
    if (acct.mode === 'session') {
      // fetchproxy path: re-read the browser instead of posting a form login.
      // Runs on every mint, not just the first, so an expiry renews.
      if (this.refreshSession !== null) {
        return { headers: { Cookie: await this.refreshSession() } };
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

  /**
   * Exchange the refresh token for a fresh access token via the fleet-shared
   * `createOAuth2Refresher` (which owns the form-encoded POST, the single-
   * in-flight guard, and the redact-then-truncate sanitizing of upstream error
   * bodies — so if Canvas's /login/oauth2/token error echoes the client_secret
   * or refresh_token, it never reaches the client-facing error). Canvas-specific
   * bits stay here: the TokenExpiredError('oauth') wrapper and the 60s
   * proactive-expiry skew baked into `accessTokenExpiresAt`.
   */
  private async refreshAccessToken(acct: OAuthAccount): Promise<CanvasAuth> {
    this.oauthRefresh ??= createOAuth2Refresher({
      endpoint: `${acct.baseUrl}/login/oauth2/token`,
      refreshToken: acct.refreshToken,
      params: { client_id: acct.clientId, client_secret: acct.clientSecret },
    });
    let accessToken: string;
    let expiresIn: number;
    try {
      const result = await this.oauthRefresh();
      accessToken = result.accessToken;
      expiresIn = result.expiresIn ?? 3600;
    } catch (e) {
      // The refresher always throws Error (McpToolError) with a pre-redacted,
      // pre-truncated message — safe to embed as the TokenExpiredError detail.
      throw new TokenExpiredError('oauth', (e as Error).message);
    }
    return {
      headers: { Authorization: `Bearer ${accessToken}` },
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
