import { writeFile, stat } from 'fs/promises';
import { dirname } from 'path';
import type { Account } from './config.js';

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

  constructor(account: Account) {
    this.account = account;
  }

  /** Account metadata (no secrets) — useful for diagnostics. */
  describe(): { name: string; baseUrl: string; mode: 'token' | 'oauth' } {
    return { name: this.account.name, baseUrl: this.account.baseUrl, mode: this.account.mode };
  }

  async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const res = await this.doRawRequest(path, opts, false);
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
      const res = await this.doRawRequest(url, opts, false);
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

    await this.ensureToken();
    const url = /^https?:\/\//i.test(path) ? path : `${this.account.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.getAccessToken()}` },
    });
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

  private async doRawRequest(path: string, opts: RequestOpts, isRetry: boolean): Promise<Response> {
    await this.ensureToken();
    const url = /^https?:\/\//i.test(path) ? path : `${this.account.baseUrl}${path}`;
    const accept = opts.responseType === 'text'
      ? 'text/html, text/plain, */*'
      : 'application/json+canvas-string-ids, application/json';
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.getAccessToken()}`,
        Accept: accept,
        ...(opts.headers ?? {}),
      },
      body: opts.body,
    });

    if (res.status === 401) {
      if (isRetry || this.account.mode === 'token') {
        throw new TokenExpiredError(this.account.mode);
      }
      await this.ensureToken({ force: true });
      return this.doRawRequest(path, opts, true);
    }
    if (res.status === 404) throw new Error(`Canvas 404 ${path}`);
    if (res.status >= 500) throw new CanvasUnreachableError(res.status);
    if (!res.ok) throw new Error(`Canvas ${res.status} ${res.statusText} for ${path}`);
    return res;
  }

  private getAccessToken(): string {
    if (this.account.mode === 'token') return this.account.token;
    if (!this.account.accessToken) throw new TokenExpiredError('oauth', 'no access token cached — refresh first');
    return this.account.accessToken;
  }

  private async ensureToken(opts: { force?: boolean } = {}): Promise<void> {
    if (this.account.mode === 'token') {
      if (opts.force) throw new TokenExpiredError('token');
      return;
    }
    // OAuth mode: refresh if forced, missing, or near expiry.
    if (!opts.force && this.account.accessToken && Date.now() < this.accessTokenExpiresAt) return;
    if (this.refreshInFlight) { await this.refreshInFlight; return; }
    this.refreshInFlight = this.refreshAccessToken();
    try { await this.refreshInFlight; } finally { this.refreshInFlight = null; }
  }

  private async refreshAccessToken(): Promise<void> {
    /* istanbul ignore if */
    if (this.account.mode !== 'oauth') return;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.account.clientId,
      client_secret: this.account.clientSecret,
      refresh_token: this.account.refreshToken,
    }).toString();
    const res = await fetch(`${this.account.baseUrl}/login/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new TokenExpiredError('oauth', `${res.status} ${res.statusText}: ${errBody.slice(0, 200)}`);
    }
    const data = await res.json() as { access_token: string; expires_in?: number };
    this.account.accessToken = data.access_token;
    const expiresIn = data.expires_in ?? 3600;
    this.accessTokenExpiresAt = Date.now() + Math.max(0, (expiresIn - 60) * 1000);
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

/**
 * Parse RFC 5988 Link header. Returns object keyed by `rel`. Malformed entries
 * are skipped.
 */
export function parseLinkHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(',')) {
    const m = part.trim().match(/^<([^>]+)>\s*;\s*rel="?([^";]+)"?/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

export class TokenExpiredError extends Error {
  constructor(public mode: 'token' | 'oauth', public detail?: string) {
    const base = mode === 'token'
      ? 'Canvas access token rejected (401). Check CANVAS_TOKEN — it may be expired or revoked.'
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
