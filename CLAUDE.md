# canvas-parent-mcp

MCP server for Canvas LMS (Instructure). Stdio transport, read-mostly tools scoped for student self-access and parent observers (mirrors sibling `infinitecampus-mcp`'s parent-portal scope).

The npm package is `canvas-parent-mcp` because `canvas-mcp` and `canvas-lms-mcp` are both taken. Tools, env vars, and the user-facing skill stay branded `canvas` / `Canvas` because that's what users say.

## Commands

```bash
npm run build        # tsc + esbuild bundle → dist/
npm test             # tsc typecheck + vitest run (all tests)
npm run test:watch   # vitest in watch mode
npm run dev          # node --env-file=.env dist/index.js (needs prior build)
```

`dist/` is gitignored; CI rebuilds it and the published npm tarball includes it (`files` array in `package.json`).

## Bins

- `canvas-parent-mcp` → `dist/index.js` — the MCP server (stdio).
- `canvas-parent-mcp-qr-login` → `dist/qr-login-cli.js` — one-off helper that decodes a Canvas mobile-login QR URL and prints OAuth env vars to stdout. Used for SSO accounts that can't use username/password.

## Architecture

```
src/
  index.ts            # MCP server entry — loads dotenv, runs resolveAuth(), builds client, registers all tools
  auth.ts             # resolveAuth(): four-path priority (token → OAuth → session-scrape → fetchproxy → error). Template for sibling MCPs
  config.ts           # loadAccount(env) → discriminated union Account = TokenAccount | SessionAccount | OAuthAccount
  client.ts           # CanvasClient: auth+401-retry, pagination, download. Custom error types. Accepts a `refreshSession` browser lift from the fetchproxy path
  session-login.ts    # POSTs /login/canvas form, harvests pseudonym_credentials cookie (legacy path 3)
  qr-login.ts         # Mobile QR → mobile_verify.json → authorization_code exchange → OAuth tokens (bootstraps path 2)
  qr-login-cli.ts     # Thin CLI wrapper around qr-login (printed as env vars)
  view.ts             # CV_VIEWS/viewArg/viewResponse — the `view` rung (compact default, full opt-in). Wired ONLY into the reads whose Canvas payload embeds a user object; see its docblocks for the KEEP/DROP reasoning
  tools/
    _shared.ts        # textContent(), buildPath(), userSegment(), is404(), toArray()
    profile.ts        announcements.ts   calendar.ts        conversations.ts
    courses.ts        discussions.ts     files.ts           grades.ts
    observees.ts      planner.ts         submissions.ts     assignments.ts
tests/                # Mirrors src/. Mocks CanvasClient.request/requestPaginated/download via vi.spyOn
```

Each `tools/*.ts` exports `register<Domain>Tools(server, client)`. Schemas use the const-zod pattern: `const args = z.object({...})`; SDK gets `args.shape`, handler does `args.parse(rawArgs)`. Single source of truth for schema and runtime safety.

## Environment

Set `CANVAS_BASE_URL` plus **one** of four auth modes. Priority order (see `config.ts:loadAccount`): `CANVAS_TOKEN` > `CANVAS_USERNAME+PASSWORD` > full OAuth triple > fetchproxy fallback.

```
CANVAS_BASE_URL=https://cms.instructure.com   # required, must be https
CANVAS_NAME=cms                                # optional, defaults to host

# Mode A — fetchproxy fallback (recommended, zero-config).
# Leave all CANVAS_* auth vars unset. Install the fetchproxy browser
# extension, sign into your Canvas instance once. The MCP reads
# `canvas_session` + `pseudonym_credentials` from your tab at startup.
CANVAS_DISABLE_FETCHPROXY=  # set to "1" to opt out

# Mode B — username/password session-scrape (legacy). Direct Canvas
# accounts only (no SAML/Google/Microsoft SSO, no 2FA). Brittle.
CANVAS_USERNAME=
CANVAS_PASSWORD=

# Mode C — personal access token (most schools have disabled creation for non-admins).
CANVAS_TOKEN=

# Mode D — OAuth (bootstrap via `canvas-parent-mcp-qr-login "<qr-url>" >> .env`).
CANVAS_CLIENT_ID=
CANVAS_CLIENT_SECRET=
CANVAS_REFRESH_TOKEN=

# Session cache — applies to modes B and D, the two with a login to skip.
# Mode C (token) has no session to cache, and mode A does not cache: its
# identity lives in the browser, so there is nothing to bind a record to.
CANVAS_SESSION_CACHE=false   # optional; skip the on-disk cache, re-authenticate every start
CANVAS_SESSION_FILE=         # optional; 0600 file, default $MCP_DATA_DIR/.canvas-parent-mcp/session.json
```

`config.ts:readVar` and `auth.ts:readEnv` treat empty/whitespace, the literal strings `"undefined"` / `"null"`, and unsubstituted shell placeholders (`${...}`) as unset — Claude Desktop sometimes passes these for unset user_config refs.

## Auth resolution (Pattern A template)

`src/auth.ts` is the canonical "browser-bootstrap + Node-direct" auth shape used across our MCP servers. Sibling MCPs (ofw-mcp, signupgenius-mcp, …) model their auth on the same shape — keep the structure flat, the path-selection explicit, the error messages actionable. Four paths in priority order:

1. **Token / OAuth / session-scrape (env-var paths)** → delegated to `loadAccount()` in `config.ts`. Existing behavior unchanged.
2. **fetchproxy fallback (new)** → `@fetchproxy/bootstrap` snapshots `canvas_session` + `pseudonym_credentials` cookies from a signed-in Canvas tab in one round-trip, then closes the bridge. Subsequent Canvas API calls go out via direct Node fetch with `Cookie: canvas_session=…; pseudonym_credentials=…` — fetchproxy is NOT in the hot path.
3. **Error** → tells the user how to fix it (set creds, OR install the extension and sign in).

Declared domain is `instructure.com` for any `*.instructure.com` Canvas tenant (the matcher does `*.${domain}` matching), so the user pairs the extension once and any district they switch to via `CANVAS_BASE_URL` works. Non-`.instructure.com` self-hosted Canvas installations declare the literal hostname.

`pseudonym_credentials` is HttpOnly. `@fetchproxy/bootstrap` uses `chrome.cookies.get` which sees HttpOnly cookies — the security gate is the declared cookie key list, not HttpOnly status.

## Auth modes

| Mode | Loop | What can fail |
|---|---|---|
| `token` | `Authorization: Bearer <token>`. No refresh. | 401 throws `TokenExpiredError('token')` immediately. |
| `session` (env-var) | POST `/login/canvas` form, harvest `pseudonym_credentials` cookie. Re-mints on 401. | If the login response lacks `pseudonym_credentials`, the helper throws `SessionLoginError` with a hint (wrong creds, SSO redirect, or locked account). |
| `session` (fetchproxy) | Cookies lifted from the browser per mint; no form login. | 401 re-lifts the browser session and replays once. Only when that lift also fails does it surface — a form login with empty creds is never attempted. |
| `oauth` | `grant_type=refresh_token` against `/login/oauth2/token`. Refreshes proactively 60s before `expires_in`, reactively on 401. | Refresh failure throws `TokenExpiredError('oauth')` with status + first 200 chars of the error body. |

`CanvasClient.authedFetch` routes every authed request through a shared `CookieSessionManager` (`@chrischall/mcp-utils/session`): it single-flights the initial `login()`, and on a 401 flagged by `isExpired` re-mints + replays the request exactly once. token 401s aren't flagged as expired (`canReauth()` is false), so they pass back as a 401 Response that `doRawRequest`/`download` map to `TokenExpiredError`; legacy session, oauth, and fetchproxy-session get the one forced re-auth — for fetchproxy that re-auth is a fresh browser lift rather than a form POST. The manager owns the single-flight semaphore and clear-on-settle (a rejected login never sticks). oauth's *proactive* 60s-before-expiry refresh isn't response-driven, so it lives in `proactivelyExpire()`, which `invalidate()`s the manager when the live token is inside the skew window.

## Tools

19 tools across profile, observees, courses, assignments, submissions, grades, calendar, planner, announcements, conversations, discussions, files, plus a credential healthcheck. All read-only except `canvas_download_file` (annotated `destructiveHint: true`).

Read tools that target a user accept an optional `observeeId`; when set, `userSegment()` swaps `users/self` → `users/${observeeId}`.

### Response shape (`view`)

Nine reads take `view: compact | full` (`src/view.ts`), compact by default. This
server projects nothing — every tool hands back Canvas's payload verbatim — so
compact does the one thing that needs no knowledge of the API: it removes avatar
URLs. `full` returns Canvas untouched.

**Only the reads whose payload embeds a Canvas USER object are wired**, because
that is the only place Canvas hangs an avatar: `canvas_get_profile`,
`canvas_list_observees`, `canvas_get_course` (its `teachers`),
`canvas_get_submission` / `canvas_list_recent_submissions` (comment authors),
`canvas_list_announcements`, `canvas_list_discussion_topics` (authors), and
`canvas_list_conversations` / `canvas_get_conversation` (participants — both
request `include[]=participant_avatars`). The rest take no `view` at all: courses,
assignments, missing submissions, enrollments, calendar, upcoming events and
planner items carry no user object, and a parameter that changes nothing is worse
than no parameter. The two file tools are excluded for the opposite reason — their
product is the URL. `tests/tools/view-wiring.test.ts` pins that set on both sides,
and fails if a new tool is added without making the call.

**Both avatar fields are named explicitly in `DROP`, because the shared helper's
built-in rules miss them.** `MEDIA_KEY` anchors a media noun at the start and
allows only a `Link|Uri|Url` suffix run directly against it, so it matches
`avatarUrl` but not Canvas's snake_case `avatar_url`, and not `avatar_image_url`
under any form — Canvas names everything snake_case, so the key rule fires
nowhere here. The value rule fires only by accident: a DEFAULT avatar ends
`…/avatar-50.png` and is dropped, while an UPLOADED one is
`…/images/thumbnails/11689524/MVccGA…`, extension-less, and survives. Both
spellings came back in one live `canvas_list_conversations`, so leaving it to the
built-ins produced a payload where one participant kept their avatar and the
other lost it. `url`, `html_url` and `preview_url` are in `KEEP` for the mirror
reason: they are Canvas's link fields, and an `online_url` submission's `url` IS
the student's work.

## Canvas API quirks (handled in `client.ts`)

- **String IDs:** request `Accept: application/json+canvas-string-ids, application/json` to avoid JS 2^53 issues.
- **XSSI prefix:** some endpoints prepend `while(1);` to JSON — `parseJsonBody` strips it.
- **Pagination:** RFC 5988 `Link: <...>; rel="next"`. `requestPaginated` follows `next` until exhausted or `maxPages` (default 50). `per_page` injected if absent (default 100).
- **Downloads:** `download()` requires parent dir to exist; refuses to overwrite unless `overwrite: true`. Custom errors: `InvalidPathError`, `FileExistsError`, `ParentDirectoryMissingError`.
- **5xx:** mapped to `CanvasUnreachableError`.

## Testing

```bash
npm test
```

`npm test` runs the typecheck first, then vitest — vitest transpiles with esbuild and never invokes `tsc`, so a green suite is not a green typecheck on its own.

`vitest.config.ts` enforces 100% lines/functions/branches/statements across `src/**` (excluding `src/index.ts`, `src/qr-login-cli.ts`, `src/session-login-cli.ts` — the stdio/CLI entry points). No real network calls — tests mock at the `CanvasClient` / `fetch` level. Adding a tool or a branch requires a test or CI fails.

`tests/_setup.ts` forces the session cache off, pins its path into a temp dir, and fails the suite if anything reached the real `~/.canvas-parent-mcp`.

## Plugin / marketplace

```
.claude-plugin/plugin.json       # Claude Code plugin manifest (mcp + skill ref)
.claude-plugin/marketplace.json  # Marketplace catalog entry
.mcp.json                        # Standalone MCP config
manifest.json                    # MCPB / Claude Desktop bundle manifest
server.json                      # MCP registry manifest
skills/canvas-parent/SKILL.md    # User-facing skill (when/how to invoke tools) — plugin-discovered via "./skills/"
```

## Publishing constraints

The MCP Registry's [server.schema.json](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) caps `server.json`'s `description` at **100 characters**. Values over that fail `mcp-publisher publish` with HTTP 422 (`validation failed: expected length <= 100, location: body.description`). The other description fields (`manifest.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) have no published length constraint and can stay longer.

Sanity-check before committing a description change:

```bash
jq -r '.description | length' server.json
```

## Versioning

Version appears in SEVEN places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → `npm install --package-lock-only` after changing (or `npm version` does it)
3. `src/index.ts` → `McpServer` constructor `version` field
4. `manifest.json` → `"version"`
5. `server.json` → `"version"` AND `packages[].version` (two entries)
6. `.claude-plugin/plugin.json` → `"version"`
7. `.claude-plugin/marketplace.json` → `metadata.version` AND `plugins[].version`

### Release flow

Commits land on `main` via PR. release-please (`.github/workflows/release-please.yml`) opens or updates a `chore(main): release X.Y.Z` PR whenever Conventional-Commit messages (`feat:`, `fix:`, etc.) accumulate. Merging the release PR (arm `ready-to-merge`) creates the tag and a GitHub Release; the `publish` job then packs `.mcpb` + `.skill`, publishes to npm with provenance, and pushes to the MCP Registry.

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. release-please owns versioning.

<!-- pr-workflow:v3 -->
## Pull requests & release notes

Fleet policy — Conventional-Commit PR titles, labels, the auto-review /
auto-merge ladder, auto-review follow-up issues, PR timing, and release PRs —
lives in `~/.claude/CLAUDE.md`. Don't restate it here; the copies drifted.

Shared technical conventions (publishing, bundling, versioning guards,
write-verification, transport archetypes, testing traps) live in
[`chrischall/workflows`](https://github.com/chrischall/workflows):
`docs/fleet-conventions.md`, plus `README.md` for the CI pipeline contract.

## Gotchas

- **ESM + NodeNext:** imports must use `.js` extensions even for `.ts` sources (e.g. `import { db } from './db.js'`).
- **stdio transport:** server logs to **stderr** only — stdout is reserved for JSON-RPC. `dotenv` is loaded with `quiet: true` for the same reason.
- **Session-scrape mode requires direct Canvas auth:** if the login page omits `authenticity_token` or redirects to an external IdP, `SessionLoginError` is thrown with a SSO/2FA hint. There is no fallback — use the fetchproxy fallback or OAuth mode instead.
- **fetchproxy 401s renew, they don't dead-end:** the synthesized SessionAccount has empty username/password, so the client cannot re-mint via the form login — instead `refresh` re-reads the signed-in browser tab and the request replays once. `canReauth()` counts a lift as re-auth capability. Only a lift that itself fails (the user is signed out in the browser too) surfaces `TokenExpiredError('session')`. Capturing the cookie once at startup — the pre-fix shape — is what made a 401 terminal and a restart the only cure.
- **QR login flow:** `parseQrLoginUrl` only accepts `https://sso[.beta|.test].canvaslms.com/canvas/login?domain=...&code=...`. `mobile_verify.json` must return `authorized: true` plus mobile client credentials.
- **Bundling:** `dist/bundle.js` is the MCPB / `manifest.json` entry point (single-file via esbuild, with `dotenv` external). `dist/index.js` is the npm/`bin` entry. `npm run build` produces both.
- **vitest excludes:** `src/index.ts`, `src/qr-login-cli.ts`, and `src/session-login-cli.ts` are excluded from coverage. The last one is currently aspirational (no such file exists) — leave the exclude in until it does or until a coverage failure forces a cleanup.
