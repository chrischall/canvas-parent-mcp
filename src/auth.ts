// ────────────────────────────────────────────────────────────────────────────
// Auth resolution — Pattern A template
// ────────────────────────────────────────────────────────────────────────────
//
// Canvas supports four auth paths. This file picks one, in priority order,
// and hands the chosen path to `CanvasClient`. It mirrors the Pattern A
// shape used by sibling MCPs (ofw-mcp/src/auth.ts, signupgenius-mcp/src/auth.ts)
// so all the MCPs in this family stay structurally aligned.
//
// THE FOUR PATHS, in priority order:
//
//   1. Personal access token (existing)
//      CANVAS_TOKEN set → stateless `Authorization: Bearer <token>`. The
//      most reliable mode but most schools have disabled token creation
//      for non-admins. Unchanged from pre-fetchproxy behavior.
//
//   2. OAuth refresh token (existing)
//      CANVAS_CLIENT_ID + CANVAS_CLIENT_SECRET + CANVAS_REFRESH_TOKEN →
//      `grant_type=refresh_token` against `/login/oauth2/token`, bootstrap
//      via the bundled QR-login helper. Unchanged.
//
//   3. Username/password session-scrape (existing)
//      CANVAS_USERNAME + CANVAS_PASSWORD → scrape `authenticity_token`
//      from `/login/canvas`, POST creds, capture `canvas_session` +
//      `pseudonym_credentials` cookies. Brittle (breaks on SSO/2FA and
//      every Canvas login-page restyling) but works for direct Canvas
//      accounts. Unchanged from pre-fetchproxy behavior.
//
//   4. fetchproxy fallback (new)
//      When no env vars are set, lift the user's session out of their
//      already-signed-in canvas tab. `@fetchproxy/bootstrap` opens a
//      one-shot WebSocket bridge, asks the extension for the
//      `canvas_session` + `pseudonym_credentials` cookies (declared
//      upfront — that's the security boundary), and closes the bridge.
//      Subsequent Canvas API calls go out via plain Node `fetch()` with
//      those cookies attached — fetchproxy is NOT in the request hot path.
//
//      Note: `pseudonym_credentials` is HttpOnly, which is fine —
//      @fetchproxy/bootstrap@^0.3.0 uses `chrome.cookies.get` to read
//      it, and the security gate is the declared cookie key list, not
//      HttpOnly status.
//
//      Users opt out with CANVAS_DISABLE_FETCHPROXY=1 (anyone who wants
//      the old behavior of "fail loudly when creds are missing").
//
//   5. Error
//      Nothing to authenticate with. We throw a message that names every
//      escape hatch the user can try.
//
// Testability:
//   - `@fetchproxy/bootstrap` is mocked at the module boundary in tests.
//   - `loadAccount()` (the existing env-var resolver) is reused as-is so
//     the legacy paths keep working unchanged.

import { bootstrap } from '@fetchproxy/bootstrap';
import { classifyBridgeError, FetchproxyBridgeDownError } from '@fetchproxy/server';
import { loadAccount, type Account, type SessionAccount } from './config.js';
import pkg from '../package.json' with { type: 'json' };

/** Result of resolving auth, regardless of which path was taken. */
export interface ResolvedAuth {
  /**
   * Account config the client should treat as authoritative. For paths 1-3
   * this is a fully-loaded Account from env. For the fetchproxy path it's
   * a synthesized `SessionAccount` with empty credentials — the client sees
   * `preloaded` and skips the form-login because we hand it pre-seeded
   * cookies.
   */
  account: Account;
  /**
   * For the fetchproxy path: the cookie header we pulled from the browser.
   * The client uses this in place of running `sessionLogin()`. For env-var
   * paths this is undefined and the client follows its normal flow.
   */
  preloaded?: { cookie: string };
  /** Which path produced this. Diagnostics only — callers should not branch. */
  source: 'env' | 'fetchproxy';
}

function readEnv(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === 'undefined' || trimmed === 'null') return undefined;
  if (/^\$\{[^}]*\}$/.test(trimmed)) return undefined;
  return trimmed;
}

function fetchproxyDisabled(): boolean {
  const raw = readEnv('CANVAS_DISABLE_FETCHPROXY');
  if (raw === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/**
 * The exact error message `loadAccount()` throws when NO auth env vars are
 * set. We catch this specific string so partial-config errors (which the
 * user MUST fix) still propagate, but the "you didn't set anything at all"
 * case falls through to fetchproxy.
 */
const NO_ENV_CONFIG_MARKER = 'Missing Canvas auth config';

/**
 * Resolve Canvas auth using the four-path priority described at the top of
 * this file. Throws with an actionable message when no path succeeds.
 */
export async function resolveAuth(): Promise<ResolvedAuth> {
  // ── Paths 1, 2, 3: env-var credentials. loadAccount() handles precedence,
  //    partial-config errors, and env-var sanitization for us.
  try {
    const account = loadAccount();
    return { account, source: 'env' };
  } catch (e) {
    // Partial-config errors (missing one of USERNAME/PASSWORD, incomplete
    // OAuth triple, non-https BASE_URL, etc.) are USER MISTAKES — they
    // propagate. Only the "no auth config set at all" case falls through.
    if (!(e as Error).message.startsWith(NO_ENV_CONFIG_MARKER)) {
      throw e;
    }
  }

  // ── Path 4: fetchproxy fallback.
  if (!fetchproxyDisabled()) {
    // CANVAS_BASE_URL is guaranteed valid here — loadAccount() validates it
    // before throwing the NO_ENV_CONFIG_MARKER error we caught above.
    const baseUrl = readEnv('CANVAS_BASE_URL')!;
    const baseHost = new URL(baseUrl).hostname;
    // Wildcard match: Canvas tenants live on per-district subdomains of
    // *.instructure.com. The 0.2.0+ matcher does `*.${domain}` matching, so
    // declaring `instructure.com` covers every district the user might
    // switch between. Self-hosted Canvas installations (rare) declare the
    // literal hostname instead.
    const declaredDomain = baseHost.endsWith('.instructure.com')
      ? 'instructure.com'
      : baseHost;
    const name = readEnv('CANVAS_NAME') ?? baseHost;
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    try {
      const session = await bootstrap({
        serverName: pkg.name,
        version: pkg.version,
        domains: [declaredDomain],
        declare: {
          cookies: ['canvas_session', 'pseudonym_credentials'],
          localStorage: [],
          sessionStorage: [],
          captureHeaders: [],
        },
      });

      const canvasSession = session.cookies['canvas_session'];
      const pseudoCreds = session.cookies['pseudonym_credentials'];
      if (!canvasSession || !pseudoCreds) {
        throw new Error(
          `required cookies not found on ${baseHost}. ` +
            'Sign into your Canvas instance in the browser ' +
            '(with the fetchproxy extension installed) and retry.',
        );
      }

      const cookie = `canvas_session=${canvasSession}; pseudonym_credentials=${pseudoCreds}`;

      // Synthesize a session account with empty creds — the client will see
      // `preloaded` and skip the form login. This mirrors the cookie shape
      // the legacy session-scrape path produces, so everything downstream
      // (Cookie header, 401-retry, file downloads) keeps working.
      const account: SessionAccount = {
        mode: 'session',
        name,
        baseUrl: cleanBaseUrl,
        username: '',
        password: '',
      };

      return {
        account,
        preloaded: { cookie },
        source: 'fetchproxy',
      };
    } catch (e) {
      // 0.8.0+ typed-error discrimination. The fetchproxy server already
      // retries once on SW eviction (bridgeReviveDelayMs=2000 default), so
      // a thrown FetchproxyBridgeDownError means the retry also failed —
      // the extension's service worker is genuinely down and the user
      // needs to wake it. The `.hint` is the actionable copy
      // ("click the extension toolbar icon...") that we'd otherwise have
      // to hand-write here. Surface it verbatim so users in path 4 get
      // the same self-service guidance as path 5.
      if (classifyBridgeError(e) === 'bridge_down') {
        const downErr = e as FetchproxyBridgeDownError;
        throw new Error(
          `Canvas auth: fetchproxy bridge is down (extension service worker unreachable after retry). ${downErr.hint}`,
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Canvas auth: no CANVAS_TOKEN, CANVAS_CLIENT_*/CANVAS_REFRESH_TOKEN, or CANVAS_USERNAME/CANVAS_PASSWORD set, ` +
          `and fetchproxy fallback failed: ${msg}`,
      );
    }
  }

  // ── Path 5: nothing configured and fetchproxy explicitly disabled.
  throw new Error(
    'Missing Canvas auth config. Set one of: CANVAS_TOKEN (personal access token), ' +
      'CANVAS_USERNAME+CANVAS_PASSWORD (auto-login), ' +
      'all three of CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET, CANVAS_REFRESH_TOKEN (OAuth), ' +
      'or install the fetchproxy extension and sign into your Canvas instance ' +
      '(unset CANVAS_DISABLE_FETCHPROXY if it is set).',
  );
}
