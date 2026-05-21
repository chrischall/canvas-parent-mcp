# canvas-parent-mcp

MCP server for Canvas LMS (Instructure), scoped for parent observers and student self-access. Targets `https://cms.instructure.com` by default but works against any Canvas instance.

Mirrors the read-only parent-portal scope of sibling [`infinitecampus-mcp`](https://github.com/chrischall/infinitecampus-mcp). Users interact via the `canvas_*` tool prefix.

## Tools

18 tools across profile, observees, courses, assignments, submissions, grades, calendar, planner, announcements, conversations, discussions, and files.

| Domain | Tools |
|---|---|
| Profile | `canvas_get_profile` |
| Observees | `canvas_list_observees` |
| Courses | `canvas_list_courses`, `canvas_get_course` |
| Assignments | `canvas_list_assignments`, `canvas_list_missing_submissions` |
| Submissions | `canvas_get_submission`, `canvas_list_recent_submissions` (default 14d window) |
| Grades | `canvas_list_enrollments` |
| Calendar | `canvas_list_calendar_events`, `canvas_list_upcoming_events` |
| Planner | `canvas_list_planner_items` |
| Announcements | `canvas_list_announcements` |
| Conversations | `canvas_list_conversations`, `canvas_get_conversation` |
| Discussions | `canvas_list_discussion_topics` |
| Files | `canvas_list_course_files`, `canvas_download_file` |

Tools that the harness will gate as write/IO operations: `canvas_download_file`.

## Configuration

Set `CANVAS_BASE_URL` plus one of four auth modes. `canvas-parent-mcp` tries them in priority order:

1. **`CANVAS_TOKEN`** → personal access token
2. **`CANVAS_CLIENT_ID` + `CANVAS_CLIENT_SECRET` + `CANVAS_REFRESH_TOKEN`** → OAuth
3. **`CANVAS_USERNAME` + `CANVAS_PASSWORD`** → session-scrape (direct Canvas accounts only)
4. **fetchproxy fallback** → no env vars needed; reads `canvas_session` + `pseudonym_credentials` cookies from your signed-in Canvas tab via the [fetchproxy](https://github.com/chrischall/fetchproxy) browser extension

If none succeed, you get an error that names every escape hatch.

### Mode A — fetchproxy fallback (recommended, zero config)

```
CANVAS_BASE_URL=https://cms.instructure.com
```

Install the fetchproxy 0.3.0 Chrome / Safari extension (Chrome Web Store / Safari `.dmg`), sign into your Canvas instance once, and the MCP reads your session cookies at startup. After that, all Canvas API calls go directly from Node — the extension is **not** in the request hot path. Works with any auth flow (SSO/SAML/2FA included) because Canvas itself handled the sign-in.

Multiple districts? Declared domain `instructure.com` matches every `*.instructure.com` host, so you only pair the extension once. The MCP uses whichever district you set in `CANVAS_BASE_URL`.

Set `CANVAS_DISABLE_FETCHPROXY=1` to opt out (missing creds become a hard error — useful in headless CI).

### Mode B — username/password (legacy session-scrape)

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_USERNAME=me@example.com
CANVAS_PASSWORD=your-canvas-password
CANVAS_NAME=cms                # optional, defaults to host portion of base URL
```

**Direct Canvas accounts only** — won't work with SAML/Google/Microsoft SSO or 2FA. Brittle (breaks on every Canvas login-page restyling). Prefer fetchproxy if your tab is already signed in. Treat `.env` like a password file.

### Advanced alternatives

<details>
<summary><b>Personal access token</b> — simplest if your admin allows it</summary>

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_TOKEN=your-personal-access-token
```

Generate via Canvas → Account → Settings → "+ New Access Token". Most institutions have disabled this for non-admins.
</details>

<details>
<summary><b>OAuth via mobile QR code</b> — bootstrapped from the mobile-app login flow</summary>

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_CLIENT_ID=...
CANVAS_CLIENT_SECRET=...
CANVAS_REFRESH_TOKEN=...
```

If your account uses SSO and you can't use fetchproxy (e.g. headless server), mint OAuth credentials by reusing the Canvas mobile-app QR-login flow — see [Bootstrapping OAuth via the mobile QR code](#bootstrapping-oauth-via-the-mobile-qr-code) below.
</details>

**Precedence when multiple are set:** `CANVAS_TOKEN` > username/password > OAuth > fetchproxy.

See `.env.example`.

### Bootstrapping OAuth via the mobile QR code

If your Canvas admin has disabled personal-access-token creation (some institutions restrict tokens to "the mobile app only") AND your account uses SSO so username/password can't auth, you can mint OAuth credentials by going through the same QR-login flow that the official Canvas mobile apps use:

1. In Canvas web, open **Account → QR for Mobile Login** — Canvas shows a QR that's valid for 10 minutes.
2. Decode the QR with any QR reader. The result is a URL on `sso.canvaslms.com` like `https://sso.canvaslms.com/canvas/login?domain=...&code=...`.
3. Run the bundled helper:

   ```
   npx canvas-parent-mcp-qr-login "<decoded-qr-url>" >> .env
   ```

   It hits Canvas's public `mobile_verify.json` endpoint to fetch the mobile client_id/client_secret, exchanges the QR's one-time code for an access+refresh token pair, and prints `CANVAS_BASE_URL` / `CANVAS_CLIENT_ID` / `CANVAS_CLIENT_SECRET` / `CANVAS_REFRESH_TOKEN` to stdout. The refresh token is sensitive — treat it like a password.

This reuses the same SSO + OAuth endpoints the official Canvas Student/Parent apps use; from Canvas's perspective the resulting session looks like a mobile-app session. Use it only against accounts you legitimately control.

## Status

Unofficial — not affiliated with Instructure. AI-maintained.
