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

Set the base URL plus *one* auth mode:

**Personal access token (recommended):**

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_TOKEN=your-personal-access-token
CANVAS_NAME=cms                # optional, defaults to host portion of base URL
```

**Username/password (auto-login + auto-renew, simplest when tokens are disabled):**

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_USERNAME=me@example.com
CANVAS_PASSWORD=your-canvas-password
```

The MCP logs in lazily on the first request and silently re-mints cookies on 401, so you never have to re-bootstrap. **Direct Canvas accounts only** — won't work with SAML/Google/Microsoft SSO or 2FA. Treat `.env` like a password file: do not commit it.

**OAuth (advanced):**

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_CLIENT_ID=...
CANVAS_CLIENT_SECRET=...
CANVAS_REFRESH_TOKEN=...
```

Precedence when multiple are set: `CANVAS_TOKEN` > `CANVAS_USERNAME`+`CANVAS_PASSWORD` > OAuth.

See `.env.example`.

### Bootstrapping OAuth via the mobile QR code

If your Canvas admin has disabled personal-access-token creation (some institutions restrict tokens to "the mobile app only"), you can mint OAuth credentials by going through the same QR-login flow that the official Canvas mobile apps use:

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
