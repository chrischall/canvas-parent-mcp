# canvas-parent-mcp

MCP server for Canvas LMS (Instructure). Stdio transport, read-mostly tools scoped for student self-access and parent observers (mirrors sibling `infinitecampus-mcp`'s parent-portal scope).

The npm package is `canvas-parent-mcp` because `canvas-mcp` and `canvas-lms-mcp` are both taken. Tools, env vars, and the user-facing skill stay branded `canvas` / `Canvas` because that's what users say.

## Commands

```bash
npm run build        # tsc + esbuild bundle → dist/
npm test             # vitest run (all tests)
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
  client.ts           # CanvasClient: auth+401-retry, pagination, download. Custom error types. Accepts `preloaded` cookie from fetchproxy path
  session-login.ts    # POSTs /login/canvas form, harvests pseudonym_credentials cookie (legacy path 3)
  qr-login.ts         # Mobile QR → mobile_verify.json → authorization_code exchange → OAuth tokens (bootstraps path 2)
  qr-login-cli.ts     # Thin CLI wrapper around qr-login (printed as env vars)
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
| `session` (fetchproxy) | Cookies preloaded from browser; no form login. | 401 throws `TokenExpiredError('session')` immediately — re-sign-in happens in the browser, not by re-running a form login with empty creds. |
| `oauth` | `grant_type=refresh_token` against `/login/oauth2/token`. Refreshes proactively 60s before `expires_in`, reactively on 401. | Refresh failure throws `TokenExpiredError('oauth')` with status + first 200 chars of the error body. |

`CanvasClient.authedFetch` routes every authed request through a shared `CookieSessionManager` (`@chrischall/mcp-utils/session`): it single-flights the initial `login()`, and on a 401 flagged by `isExpired` re-mints + replays the request exactly once. token + fetchproxy-session 401s aren't flagged as expired (`canReauth()` is false), so they pass back as a 401 Response that `doRawRequest`/`download` map to `TokenExpiredError`; legacy session + oauth get the one forced re-auth. The manager owns the single-flight semaphore and clear-on-settle (a rejected login never sticks). oauth's *proactive* 60s-before-expiry refresh isn't response-driven, so it lives in `proactivelyExpire()`, which `invalidate()`s the manager when the live token is inside the skew window.

## Tools

18 tools across profile, observees, courses, assignments, submissions, grades, calendar, planner, announcements, conversations, discussions, files. All read-only except `canvas_download_file` (annotated `destructiveHint: true`).

Read tools that target a user accept an optional `observeeId`; when set, `userSegment()` swaps `users/self` → `users/${observeeId}`.

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

`vitest.config.ts` enforces 100% lines/functions/branches/statements across `src/**` (excluding `src/index.ts`, `src/qr-login-cli.ts`, `src/session-login-cli.ts` — the stdio/CLI entry points). No real network calls — tests mock at the `CanvasClient` / `fetch` level. Adding a tool or a branch requires a test or CI fails.

## Plugin / marketplace

```
.claude-plugin/plugin.json       # Claude Code plugin manifest (mcp + skill ref)
.claude-plugin/marketplace.json  # Marketplace catalog entry
.mcp.json                        # Standalone MCP config
manifest.json                    # MCPB / Claude Desktop bundle manifest
server.json                      # MCP registry manifest
skills/canvas/SKILL.md           # User-facing skill (when/how to invoke tools)
SKILL.md                         # Plugin-level skill copy
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

<!-- pr-workflow:v2 -->
## Pull requests & release notes

**Default workflow: branch + PR, even for solo work.** Direct pushes to `main` skip review *and* skip auto-generated release notes — GitHub's `generate_release_notes` (configured in `.github/release.yml`) only picks up merged PRs. Push directly to `main` only when the user explicitly asks for it (e.g. emergency hotfix).

For every PR, apply exactly one label so it lands in the right release-notes section:

| Label                | Section in release notes |
|----------------------|--------------------------|
| `enhancement`        | Features                 |
| `bug`                | Bug Fixes                |
| `security`           | Security                 |
| `refactor`           | Refactor                 |
| `documentation`      | Documentation            |
| `test`               | Tests                    |
| `dependencies`       | Dependencies             |
| `ci` / `github_actions` | CI & Build            |
| *(none / unmatched)* | Other Changes            |
| `ignore-for-release` | Hidden from notes        |

**Exception for first-party dependency bumps.** When bumping a package we own (currently `@fetchproxy/bootstrap` — anything published from a chrischall-owned repo), label the PR `enhancement` or `bug` instead of `dependencies`, and use the matching commit prefix (`feat:` or `fix:`) instead of `chore:`. Those bumps deliver real product fixes or features through us, so they should drive a release-please version bump and show up under Features/Bug Fixes in the release notes — not get hidden under "Dependencies" (which doesn't trigger a release).

The **PR title MUST be a Conventional Commit**, written user-facing (`fix(scope): …`, `feat(scope): …`), not internal shorthand. Because the repo squash-merges, the PR title *becomes the squash commit's subject line* — the only thing release-please parses to pick the version bump and changelog section. Only `feat` (minor), `fix` (patch), and `!`/`BREAKING CHANGE` (major) cut a release; `perf`/`refactor`/`docs` show in the changelog without bumping; `ci`/`test`/`build`/`chore` are recognised but hidden (see `release-please-config.json` → `changelog-sections`). A title without a conventional type is invisible to release-please — no bump, no changelog line. Prefixes in *individual commits* don't help; squash keeps only the title.

### How PRs merge

**Don't run `gh pr merge` yourself.** The automation does it:

1. `pr-auto-review.yml` runs a Claude review on every PR **except** the release-please release PR (which it deliberately skips). On a `pass` **or** `warn` verdict it adds the `ready-to-merge` label; `warn`/`fail` also open or update an `auto-review-followup` issue (see below). Only `fail` blocks the merge.
2. `auto-merge.yml`, on the `ready-to-merge` label (or on a dependabot PR), arms `gh pr merge --auto --squash`. The moment CI is green the PR squash-merges itself.

For ordinary feature/fix PRs, opening with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a release-notes line) is the whole job. If Claude's verdict was `fail` but you've decided to ship anyway, add the label yourself: `gh pr edit <num> --add-label ready-to-merge`.

### Auto-review follow-up issues

When a PR's auto-review verdict is `warn` or `fail`, the `chrischall/workflows` pipeline opens or updates a single `auto-review-followup` issue ("Auto-review follow-ups for PR #N") whose checklist captures every finding, and links it from the PR's `<!-- auto-review-verdict -->` comment (`📋 Tracking follow-ups: #N`). `warn` (nits only) still auto-merges — the issue carries the nits forward, so most nits are fixed in a *later* PR; `fail` blocks until the important findings are addressed on the PR itself.

When asked to address the auto-review comments / review findings on a PR:

1. Read the verdict comment, open the linked `auto-review-followup` issue, and treat its checklist as the work list (alongside any inline review comments).
2. Resolve each item, checking off only what you've **verified** is genuinely fixed.
3. If every item is resolved on the current PR, add `Closes #<issue>` to that PR's body so the merge closes it; if some are deferred, check off only the resolved ones and leave the issue open.
4. For nits whose `warn` PR already auto-merged, address them in a follow-up PR that references `Closes #<issue>`.

(Mirrors the fleet-wide convention in `~/.claude/CLAUDE.md`.)

### PR timing — only open when the feature is done

Because PRs auto-merge as soon as auto-review passes, **do not open a PR until the feature is genuinely complete**. There's no draft-PR safety net here:

- Don't open a PR to "stage" work while live verification, follow-up fixes, or final passes are still pending — by the time you finish those, the half-baked PR may already be in `main`.
- Push commits to the branch first; only run `gh pr create` once tests pass, live verification (if applicable) is green, and you'd be comfortable with the change shipping as-is.
- If follow-ups land after a PR is already open, they need to land on the same branch *before* auto-review flips to `pass`. Once the PR squash-merges, late commits orphan onto a stale branch and become their own follow-up PR.
- If you genuinely need a checkpoint review without shipping, open the PR as a GitHub draft (`gh pr create --draft …`) — auto-review skips drafts. Mark it ready-for-review only when the feature is truly done.

**Release PRs are the one manual touch.** release-please opens its own release PR and leaves it open as your staging artifact — `pr-auto-review.yml` skips it on purpose, so it sits there accumulating changes until you decide to ship. When you're ready, add `ready-to-merge` to it the same way: `gh pr edit <num> --add-label ready-to-merge`. The `auto-merge.yml` arm then takes over and the publish job fires the moment the release PR lands.

The repo allows squash-merge only — `--merge` and `--rebase` are blocked at the branch-protection ruleset level.

## Gotchas

- **ESM + NodeNext:** imports must use `.js` extensions even for `.ts` sources (e.g. `import { db } from './db.js'`).
- **stdio transport:** server logs to **stderr** only — stdout is reserved for JSON-RPC. `dotenv` is loaded with `quiet: true` for the same reason.
- **Session-scrape mode requires direct Canvas auth:** if the login page omits `authenticity_token` or redirects to an external IdP, `SessionLoginError` is thrown with a SSO/2FA hint. There is no fallback — use the fetchproxy fallback or OAuth mode instead.
- **fetchproxy 401s are terminal:** when the auth came from `@fetchproxy/bootstrap`, the synthesized SessionAccount has empty username/password and the client can't re-mint cookies on a 401 — it throws `TokenExpiredError('session')` immediately. Re-sign-in happens in the user's browser, not by re-running the form login.
- **QR login flow:** `parseQrLoginUrl` only accepts `https://sso[.beta|.test].canvaslms.com/canvas/login?domain=...&code=...`. `mobile_verify.json` must return `authorized: true` plus mobile client credentials.
- **Bundling:** `dist/bundle.js` is the MCPB / `manifest.json` entry point (single-file via esbuild, with `dotenv` external). `dist/index.js` is the npm/`bin` entry. `npm run build` produces both.
- **vitest excludes:** `src/index.ts`, `src/qr-login-cli.ts`, and `src/session-login-cli.ts` are excluded from coverage. The last one is currently aspirational (no such file exists) — leave the exclude in until it does or until a coverage failure forces a cleanup.
