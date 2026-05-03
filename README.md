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

Set the base URL plus *one* auth mode. **Username/password is recommended** — most schools have disabled personal-access-token creation, and this mode auto-logs-in on first request and silently re-mints session cookies on 401, so you never have to re-bootstrap.

**Username/password (recommended):**

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_USERNAME=me@example.com
CANVAS_PASSWORD=your-canvas-password
CANVAS_NAME=cms                # optional, defaults to host portion of base URL
```

**Direct Canvas accounts only** — won't work with SAML/Google/Microsoft SSO or 2FA. Treat `.env` like a password file: do not commit it.

### Advanced alternatives

If your account uses SSO/2FA, or if your admin still allows personal access tokens, pick one of these instead:

<details>
<summary><b>Personal access token</b> — simplest if your admin allows it</summary>

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_TOKEN=your-personal-access-token
```

Generate via Canvas → Account → Settings → "+ New Access Token". Most institutions have disabled this for non-admins.
</details>

<details>
<summary><b>Session cookie</b> — precomputed, no auto-renewal</summary>

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_COOKIE=canvas_session=...; pseudonym_credentials=...; ...
```

Mint via the bundled `canvas-parent-mcp-login` CLI:

```
canvas-parent-mcp-login -b https://cms.instructure.com -u me@example.com >> .env
# Password: ******    (TTY prompt with no echo)
```

Or pipe stdin instead of the prompt:

```
canvas-parent-mcp-login -b https://cms.instructure.com -u me@example.com <<< "$PW" >> .env
```

The `pseudonym_credentials` "remember me" cookie is good for ~2 weeks; re-run the CLI when API calls start returning 401s. (This is essentially username/password without auto-renewal — prefer the recommended mode unless you specifically need a long-lived cookie.)
</details>

<details>
<summary><b>OAuth via mobile QR code</b> — bootstrapped from the mobile-app login flow</summary>

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_CLIENT_ID=...
CANVAS_CLIENT_SECRET=...
CANVAS_REFRESH_TOKEN=...
```

If your admin has disabled tokens entirely AND your account uses SSO (so username/password won't work), mint OAuth credentials by reusing the Canvas mobile-app QR-login flow:

1. In Canvas web, open **Account → QR for Mobile Login** — Canvas shows a QR that's valid for 10 minutes.
2. Decode the QR with any QR reader. The result is a URL on `sso.canvaslms.com` like `https://sso.canvaslms.com/canvas/login?domain=...&code=...`.
3. Run the bundled helper:

   ```
   npx canvas-parent-mcp-qr-login "<decoded-qr-url>" >> .env
   ```

   It hits Canvas's public `mobile_verify.json` endpoint to fetch the mobile client_id/client_secret, exchanges the QR's one-time code for an access+refresh token pair, and prints all four `CANVAS_*` env vars. The refresh token is sensitive — treat it like a password.

This reuses the same SSO + OAuth endpoints the official Canvas Student/Parent apps use; from Canvas's perspective the resulting session looks like a mobile-app session. Use it only against accounts you legitimately control.
</details>

**Precedence when multiple are set:** `CANVAS_TOKEN` > session env vars (`CANVAS_USERNAME`+`CANVAS_PASSWORD` and/or `CANVAS_COOKIE`) > OAuth. If both `CANVAS_COOKIE` and username/password are set, the cookie is used initially and username/password is the fallback for re-minting on 401.

See `.env.example`.

## Status

Unofficial — not affiliated with Instructure. AI-maintained.
