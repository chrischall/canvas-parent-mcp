# canvas-parent-mcp

MCP server for Canvas LMS (Instructure) — token-primary auth with optional OAuth refresh. Scoped for parent observers and student self-access (mirrors sibling `infinitecampus-mcp`'s parent-portal scope).

The npm package is `canvas-parent-mcp` because `canvas-mcp` and `canvas-lms-mcp` are both taken on npm. Tools, env vars, and the user-facing skill stay branded `canvas` / `Canvas` because that's what users say.

## Build & Test

```bash
npm run build        # tsc + esbuild bundle
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
```

`dist/` is gitignored; the bundle is built fresh by CI and ships via npm (per the `files` array in `package.json`). Rebuild locally with `npm run build` before publishing or when verifying a change end-to-end.

## Versioning

Version appears in three places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` → run `npm install --package-lock-only` after changing
3. `src/index.ts` → `McpServer` constructor `version` field

### Important

Do NOT manually bump versions or create tags unless the user explicitly asks. Version bumps happen in their own commits at the end of a release cycle.

## Architecture

- `src/index.ts` — MCP server setup, tool routing
- `src/config.ts` — env loader returning a discriminated union `Account = TokenAccount | OAuthAccount`
- `src/client.ts` — `CanvasClient` with bearer-token auth, optional OAuth refresh on 401, RFC 5988 Link-header pagination, download method
- `src/tools/` — one file per domain. Each exports `register<Domain>Tools(server, client)`. Tool schemas use the `argsSchema = z.object({...})` const pattern: SDK gets `argsSchema.shape`, handler does `args = argsSchema.parse(rawArgs)`. Single source of truth for the schema and runtime safety.
- `tests/tools/` — mirrors `src/tools/`, mocks `CanvasClient.request` / `requestPaginated` / `download` via `vi.spyOn`

## Coverage

`vitest.config.ts` enforces 100% lines/functions/branches/statements across `src/` (excluding `src/index.ts`, the stdio entry point). Adding a new tool or branch requires a test to keep CI green.

## Naming

| Surface | Value | Why |
|---|---|---|
| npm package / `bin` | `canvas-parent-mcp` | `canvas-mcp` and `canvas-lms-mcp` are taken on npm; "parent" parallels sibling `infinitecampus-mcp`'s Campus Parent scope |
| Tool prefix | `canvas_*` | Users say "Canvas" |
| Env var prefix | `CANVAS_*` | Users say "Canvas" |
| Skill name (frontmatter) | `canvas` | Users invoke via `/canvas` |
| `.mcp.json` server key | `canvas` | User-facing alias |
| `McpServer` name | `canvas` | What clients see |
| Display name | `Canvas LMS` | User-facing |

## Canvas notes

- Authentication is `Authorization: Bearer <token>`. Personal access tokens go straight in; OAuth tokens are minted via `/login/oauth2/token` (`grant_type=refresh_token`).
- Sessions don't expire on a fixed clock — token validity does. In OAuth mode the client refreshes proactively (60s ahead of `expires_in`) and reactively on 401.
- Pagination is via RFC 5988 `Link: <...>; rel="next"`. The `requestPaginated` helper follows `rel="next"` until exhausted (or `maxPages`, default 50).
- Canvas opts in to string IDs via `Accept: application/json+canvas-string-ids, application/json` to avoid the JS 2^53 issue.
- Some endpoints prepend `while(1);` to JSON responses as an XSSI guard — the client strips this before parsing.
- All read tools that target a user accept an optional `observeeId` arg; when set, the path swaps `users/self` → `users/${observeeId}`.
