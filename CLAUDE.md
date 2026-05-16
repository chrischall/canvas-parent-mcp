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
  index.ts            # MCP server entry — loads dotenv, builds account+client, registers all tools, stdio transport
  config.ts           # loadAccount(env) → discriminated union Account = TokenAccount | SessionAccount | OAuthAccount
  client.ts           # CanvasClient: auth+401-retry, pagination, download. Custom error types
  session-login.ts    # POSTs /login/canvas form, harvests pseudonym_credentials cookie
  qr-login.ts         # Mobile QR → mobile_verify.json → authorization_code exchange → OAuth tokens
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

Set `CANVAS_BASE_URL` plus **one** auth mode. Precedence when multiple are set: `CANVAS_TOKEN` > `CANVAS_USERNAME`+`CANVAS_PASSWORD` > OAuth (a startup warning is logged when a lower-precedence mode is shadowed).

```
CANVAS_BASE_URL=https://cms.instructure.com   # required, must be https
CANVAS_NAME=cms                                # optional, defaults to host

# Mode A — session (recommended). Direct Canvas accounts only (no SAML/Google/Microsoft SSO, no 2FA).
CANVAS_USERNAME=
CANVAS_PASSWORD=

# Mode B — personal access token (most schools have disabled creation for non-admins).
CANVAS_TOKEN=

# Mode C — OAuth (bootstrap via `canvas-parent-mcp-qr-login "<qr-url>" >> .env`).
CANVAS_CLIENT_ID=
CANVAS_CLIENT_SECRET=
CANVAS_REFRESH_TOKEN=
```

`config.ts:readVar` treats empty/whitespace, the literal strings `"undefined"` / `"null"`, and unsubstituted shell placeholders (`${...}`) as unset — Claude Desktop sometimes passes these for unset user_config refs.

## Auth modes

| Mode | Loop | What can fail |
|---|---|---|
| `token` | `Authorization: Bearer <token>`. No refresh. | 401 throws `TokenExpiredError('token')` immediately. |
| `session` | POST `/login/canvas` form, harvest `pseudonym_credentials` cookie. Re-mints on 401. | If the login response lacks `pseudonym_credentials`, the helper throws `SessionLoginError` with a hint (wrong creds, SSO redirect, or locked account). |
| `oauth` | `grant_type=refresh_token` against `/login/oauth2/token`. Refreshes proactively 60s before `expires_in`, reactively on 401. | Refresh failure throws `TokenExpiredError('oauth')` with status + first 200 chars of the error body. |

`CanvasClient.authedFetch` is the single 401-retry path: token mode throws immediately, session and oauth get exactly one forced re-auth before giving up. `ensureAuth` deduplicates concurrent refreshes via `refreshInFlight`.

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

## Versioning

Version appears in SEVEN places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → `npm install --package-lock-only` after changing (or `npm version` does it)
3. `src/index.ts` → `McpServer` constructor `version` field
4. `manifest.json` → `"version"`
5. `server.json` → `"version"` AND `packages[].version` (two entries)
6. `.claude-plugin/plugin.json` → `"version"`
7. `.claude-plugin/marketplace.json` → `metadata.version` AND `plugins[].version`

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. Versioning is handled by the **Tag & Bump** GitHub Action (`.github/workflows/tag-and-bump.yml`):

1. Runs CI (build + test)
2. Tags the current commit with the current version
3. `npm version patch --no-git-tag-version` + a node script walks every JSON `version` field and `sed` updates `src/index.ts`
4. Rebuilds, commits `chore: bump version to vX.Y.Z`, pushes main + tag
5. The tag push triggers the **Release** workflow (npm publish + GitHub release)

Main is always one version ahead of the latest tag.

<!-- pr-workflow:v1 -->
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

The **PR title** becomes the bullet — write it like a user-facing changelog entry, not internal shorthand. Conventional-commit prefixes are still fine in commit messages, but the PR title should read clean.

Open with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a line), then **immediately** run `gh pr merge <num> --auto --merge` so the PR merges as soon as CI passes. The repo allows merge commits only (no squash, no rebase) — don't pass `--squash`/`--rebase` or the call will fail.

## Gotchas

- **ESM + NodeNext:** imports must use `.js` extensions even for `.ts` sources (e.g. `import { db } from './db.js'`).
- **stdio transport:** server logs to **stderr** only — stdout is reserved for JSON-RPC. `dotenv` is loaded with `quiet: true` for the same reason.
- **Session mode requires direct Canvas auth:** if the login page omits `authenticity_token` or redirects to an external IdP, `SessionLoginError` is thrown with a SSO/2FA hint. There is no fallback — use OAuth mode instead.
- **QR login flow:** `parseQrLoginUrl` only accepts `https://sso[.beta|.test].canvaslms.com/canvas/login?domain=...&code=...`. `mobile_verify.json` must return `authorized: true` plus mobile client credentials.
- **Bundling:** `dist/bundle.js` is the MCPB / `manifest.json` entry point (single-file via esbuild, with `dotenv` external). `dist/index.js` is the npm/`bin` entry. `npm run build` produces both.
- **vitest excludes:** `src/index.ts`, `src/qr-login-cli.ts`, and `src/session-login-cli.ts` are excluded from coverage. The last one is currently aspirational (no such file exists) — leave the exclude in until it does or until a coverage failure forces a cleanup.
