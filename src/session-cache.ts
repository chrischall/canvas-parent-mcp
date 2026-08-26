import {
  createFileStatePersistence,
  resolveStateFile,
  type PersistedCookieSession,
  type SyncStatePersistence,
} from '@chrischall/mcp-utils/session';
import { parseBoolEnv } from '@chrischall/mcp-utils';
import type { Account } from './config.js';

/** What the client keeps per session — the auth headers, plus an oauth expiry. */
export interface CanvasAuthRecord {
  headers: Record<string, string>;
  accessTokenExpiresAt?: number;
}

/** Where the signed-in session is cached between runs. */
export function sessionCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveStateFile({
    env,
    envVar: 'CANVAS_SESSION_FILE',
    subdir: '.canvas-parent-mcp',
    fileName: 'session.json',
  });
}

/** Guard the stored envelope: real headers, and a login time. */
function isRecord(raw: unknown): raw is PersistedCookieSession<CanvasAuthRecord> {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Partial<PersistedCookieSession<CanvasAuthRecord>>;
  if (typeof r.sessionAt !== 'number') return false;
  const s = r.session as Partial<CanvasAuthRecord> | undefined;
  if (s === null || typeof s !== 'object') return false;
  const h = s.headers;
  if (h === null || typeof h !== 'object' || Object.keys(h).length === 0) return false;
  if (Object.values(h).some((v) => typeof v !== 'string')) return false;
  return s.accessTokenExpiresAt === undefined || typeof s.accessTokenExpiresAt === 'number';
}

/**
 * The credential a cached record is bound to, or `null` when this account has
 * nothing worth caching.
 *
 * Mode decides, because what a login COSTS differs by mode:
 *
 *  - `token` — the login builds an `Authorization` header from a static env
 *    token and makes no network call at all. Caching it would save nothing and
 *    put a bearer token on disk for no reason.
 *  - `session` with a fetchproxy lift — the cookie is re-read from a signed-in
 *    browser tab on every mint, which is both cheap and the point of that path.
 *    There is also no stored secret to bind to.
 *  - `session` with credentials — a real form login. Worth caching.
 *  - `oauth` — every login spends a refresh-token exchange against Canvas.
 *    Worth caching.
 */
function bindingFor(account: Account, browserBacked: boolean): string | null {
  if (account.mode === 'token') return null;
  if (account.mode === 'session') {
    if (browserBacked) return null;
    return ['session', account.baseUrl, account.username.trim().toLowerCase(), account.password].join(
      '\u0000',
    );
  }
  // oauth: the refresh token and client identity are what a re-bootstrap changes.
  return ['oauth', account.baseUrl, account.clientId, account.refreshToken].join('\u0000');
}

/** Options for {@link createSessionCache}. */
export interface SessionCacheOptions {
  env?: NodeJS.ProcessEnv;
  /** True when a fetchproxy lift supplies the cookie — see {@link bindingFor}. */
  browserBacked?: boolean;
}

/**
 * The session cache for this account, or `null` when caching is off, or when
 * the mode has nothing worth caching (see {@link bindingFor}).
 *
 * The record is bound to the credentials that minted it — username+password for
 * a session account, refresh token + client id for an oauth one — so rotating
 * any of them discards it. Only a salted digest is written, never the values.
 * The base URL is part of the binding too, so pointing the same credentials at
 * a different Canvas instance does not reuse a session from the old one.
 */
export function createSessionCache(
  account: Account,
  opts: SessionCacheOptions = {},
): SyncStatePersistence<PersistedCookieSession<CanvasAuthRecord>> | null {
  const env = opts.env ?? process.env;
  if (!parseBoolEnv('CANVAS_SESSION_CACHE', { env, default: true })) return null;
  const boundTo = bindingFor(account, opts.browserBacked === true);
  if (boundTo === null) return null;

  return createFileStatePersistence<PersistedCookieSession<CanvasAuthRecord>>({
    filePath: sessionCachePath(env),
    boundTo,
    validate: (raw) => (isRecord(raw) ? raw : null),
  });
}

/**
 * Report a cache write that failed. Not fatal: the session is re-mintable from
 * the credentials in the environment, so a lost write costs the next start a
 * login rather than access. Canvas oauth refresh tokens are reusable — unlike a
 * single-use rotating one, losing a write here cannot strand the account.
 *
 * stderr only; stdout is the JSON-RPC channel.
 */
export function reportCacheWriteFailure(err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(
    `[canvas-parent-mcp] could not cache the session (${detail}); continuing without the ` +
      'cache — every restart will authenticate again until this is fixed.',
  );
}
