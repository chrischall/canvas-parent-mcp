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
//   2. Username/password session-scrape (existing)
//      CANVAS_USERNAME + CANVAS_PASSWORD → scrape `authenticity_token`
//      from `/login/canvas`, POST creds, capture `canvas_session` +
//      `pseudonym_credentials` cookies. Brittle (breaks on SSO/2FA and
//      every Canvas login-page restyling) but works for direct Canvas
//      accounts. Takes precedence over OAuth (path 3) — see the
//      precedence order in `loadAccount()` (config.ts), which returns the
//      username/password account before checking the OAuth triple.
//      Unchanged from pre-fetchproxy behavior.
//
//   3. OAuth refresh token (existing)
//      CANVAS_CLIENT_ID + CANVAS_CLIENT_SECRET + CANVAS_REFRESH_TOKEN →
//      `grant_type=refresh_token` against `/login/oauth2/token`, bootstrap
//      via the bundled QR-login helper. Unchanged.
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
import { readEnvVar } from '@chrischall/mcp-utils';
import { loadAccount, type Account, type SessionAccount } from './config.js';
import pkg from '../package.json' with { type: 'json' };

/** Result of resolving auth, regardless of which path was taken. */
export interface ResolvedAuth {
  /**
   * Account config the client should treat as authoritative. For paths 1-3
   * this is a fully-loaded Account from env. For the fetchproxy path it's
   * a synthesized `SessionAccount` with empty credentials — the client sees
   * `refresh` and skips the form-login because we hand it a browser lift
   * cookies.
   */
  account: Account;
  /**
   * For the fetchproxy path: the cookie header we pulled from the browser.
   * The client uses this in place of running `sessionLogin()`. For env-var
   * paths this is undefined and the client follows its normal flow.
   */
  refresh?: () => Promise<string>;
  /** Which path produced this. Diagnostics only — callers should not branch. */
  source: 'env' | 'fetchproxy';
}

// Fleet-shared env sanitization (`@chrischall/mcp-utils`): trim + suppress
// empty/"undefined"/"null"/unsubstituted-${...}-placeholder. Reads process.env
// by default. Thin alias keeps the existing call sites unchanged.
function readEnv(key: string): string | undefined {
  return readEnvVar(key);
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
  //
  // NOTE: the browser is NOT read here. resolveAuth() runs once at process
  // start; the lift is handed to the client as `refresh` and runs lazily on
  // the first request and again on every 401. A cookie captured at boot made
  // a 401 terminal — the account has empty creds, so there was nothing to
  // re-mint with and only a restart recovered.
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

    // Synthesized session account with empty creds — the client sees `refresh`
    // and skips the form login. Cookie shape matches the legacy session-scrape
    // path so everything downstream (Cookie header, 401 replay, downloads)
    // keeps working.
    const account: SessionAccount = {
      mode: 'session',
      name,
      baseUrl: cleanBaseUrl,
      username: '',
      password: '',
    };

    return {
      account,
      refresh: () => liftBrowserCookie(declaredDomain, baseHost),
      source: 'fetchproxy',
    };
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

/**
 * Lift a fresh Canvas session cookie out of the user's signed-in tab.
 *
 * Runs on every mint, not once at startup. `@fetchproxy/bootstrap` opens a
 * one-shot bridge, reads the declared cookies, and closes it — fetchproxy is
 * not in the request hot path, only the renewal path.
 */
async function liftBrowserCookie(declaredDomain: string, baseHost: string): Promise<string> {
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
    return `canvas_session=${canvasSession}; pseudonym_credentials=${pseudoCreds}`;
  } catch (e) {
    // 0.8.0+ typed-error discrimination. The fetchproxy server already retries
    // once on SW eviction, so a thrown FetchproxyBridgeDownError means the
    // retry also failed — the extension's service worker is genuinely down and
    // the user needs to wake it. `.hint` is the actionable copy.
    if (classifyBridgeError(e) === 'bridge_down') {
      const downErr = e as FetchproxyBridgeDownError;
      throw new Error(
        `Canvas auth: fetchproxy bridge is down (extension service worker unreachable after retry). ${downErr.hint}`,
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Canvas auth: no CANVAS_TOKEN, CANVAS_CLIENT_*/CANVAS_REFRESH_TOKEN, or CANVAS_USERNAME/CANVAS_PASSWORD set, ` +
        `and fetchproxy lift failed: ${msg}`,
    );
  }
}
