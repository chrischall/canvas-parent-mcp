---
name: canvas-parent-mcp
description: This skill should be used when the user asks about Canvas LMS data — their own student account or any observed student. Triggers on phrases like "check Canvas", "what's my grade", "Canvas inbox", "what's due", "missing assignments", "Canvas LMS", "Instructure", "course announcements", "syllabus", or any request about courses, assignments, grades, conversations, announcements, planner items, or files in Canvas.
---

# canvas-parent-mcp

MCP server for Canvas LMS (Instructure) — read courses, grades, assignments, announcements, planner items, and conversations; download course files. Mirrors the parent/observer scope of the sibling `infinitecampus-mcp`.

- **npm:** [npmjs.com/package/canvas-parent-mcp](https://www.npmjs.com/package/canvas-parent-mcp)
- **Source:** [github.com/chrischall/canvas-parent-mcp](https://github.com/chrischall/canvas-parent-mcp)

## Setup

### Option A — npx (recommended)

Add to `.mcp.json` in your project or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": ["-y", "canvas-parent-mcp"],
      "env": {
        "CANVAS_BASE_URL": "https://cms.instructure.com",
        "CANVAS_TOKEN": "your-personal-access-token"
      }
    }
  }
}
```

### Option B — from source

```bash
git clone https://github.com/chrischall/canvas-parent-mcp
cd canvas-parent-mcp
npm install && npm run build
```

## Authentication

Pick one mode:

**Personal access token (recommended).** Generate from Canvas: Account → Settings → "+ New Access Token". Set `CANVAS_TOKEN`.

**Username/password (when admins disable token creation).** Set `CANVAS_USERNAME` + `CANVAS_PASSWORD`. The server logs in lazily and silently re-mints session cookies on 401. Direct Canvas accounts only — no SAML/Google/Microsoft SSO or 2FA.

**Session cookie (precomputed).** Set `CANVAS_COOKIE` from the `canvas-parent-mcp-login` or `canvas-parent-mcp-qr-login` CLIs. Re-run when the cookie expires (~2 weeks).

**OAuth (advanced).** Set `CANVAS_CLIENT_ID`, `CANVAS_CLIENT_SECRET`, and `CANVAS_REFRESH_TOKEN` — the server will refresh access tokens automatically.

Precedence when multiple are set: `CANVAS_TOKEN` > session env vars > OAuth.

## Tools (prefix `canvas_`)

### Profile & observees
- `canvas_get_profile` — your Canvas profile
- `canvas_list_observees` — students linked to your observer account

### Courses
- `canvas_list_courses` — your active courses with grades
- `canvas_get_course(courseId)` — course detail with syllabus + teachers

### Assignments & submissions
- `canvas_list_assignments(courseId)` — assignments in a course
- `canvas_list_missing_submissions` — past-due unsubmitted work
- `canvas_get_submission(courseId, assignmentId)` — your submission with comments + rubric
- `canvas_list_recent_submissions(courseId)` — recently graded submissions (default 14d)

### Grades
- `canvas_list_enrollments` — per-course grades

### Calendar & planner
- `canvas_list_calendar_events` — calendar events / assignments
- `canvas_list_upcoming_events` — server-curated next 7 days
- `canvas_list_planner_items` — unified to-do feed

### Communication
- `canvas_list_announcements(contextCodes)` — course announcements
- `canvas_list_conversations` — inbox
- `canvas_get_conversation(id)` — full conversation thread
- `canvas_list_discussion_topics(courseId)` — course discussion topics

### Files
- `canvas_list_course_files(courseId)` — file metadata
- `canvas_download_file(url, destinationPath)` — download a file to disk

## Notes

- Set `CANVAS_NAME` if you want a friendly label other than the host portion of the base URL.
- All read tools that target a user accept an optional `observeeId` parameter (defaults to `self`) — useful when an observer is checking on a linked student.
