---
name: canvas
description: This skill should be used when the user asks about Canvas LMS (Instructure) data for themselves or any student they observe. Triggers on phrases like "check Canvas", "what's my grade", "Canvas inbox", "what's due", "missing assignments", "Canvas LMS", "Instructure", "course announcements", "syllabus", or any request about courses, assignments, grades, conversations, announcements, planner items, or files.
---

# canvas-parent-mcp

MCP server for Canvas LMS (Instructure) — 18 tools covering profile, observees, courses, assignments, submissions, grades, calendar, planner, announcements, conversations, discussions, and files. Read-only except for one file-download tool.

- **Source:** [github.com/chrischall/canvas-parent-mcp](https://github.com/chrischall/canvas-parent-mcp)
- **npm:** [npmjs.com/package/canvas-parent-mcp](https://www.npmjs.com/package/canvas-parent-mcp)

## Setup

Pick one auth mode. **Username/password is recommended** — most schools have disabled personal-access-token creation.

### Option A — Claude Code (direct MCP, no mcporter)

Add to `.mcp.json` in your project or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": ["-y", "canvas-parent-mcp"],
      "env": {
        "CANVAS_BASE_URL": "https://cms.instructure.com",
        "CANVAS_USERNAME": "me@example.com",
        "CANVAS_PASSWORD": "your-canvas-password",
        "CANVAS_NAME": "CMS"
      }
    }
  }
}
```

The server logs in lazily on the first request and silently re-mints cookies on 401, so you never have to re-bootstrap. Direct Canvas accounts only — won't work with SAML/Google/Microsoft SSO or 2FA.

#### Advanced alternatives

If your admin still allows tokens, swap `CANVAS_USERNAME`/`CANVAS_PASSWORD` for `CANVAS_TOKEN`:

```json
"env": {
  "CANVAS_BASE_URL": "https://cms.instructure.com",
  "CANVAS_TOKEN": "your-personal-access-token"
}
```

If your account uses SSO (so username/password won't work), mint OAuth credentials by reusing the Canvas mobile-app QR-login flow (`canvas-parent-mcp-qr-login`), then:

```json
"env": {
  "CANVAS_BASE_URL": "https://cms.instructure.com",
  "CANVAS_CLIENT_ID": "...",
  "CANVAS_CLIENT_SECRET": "...",
  "CANVAS_REFRESH_TOKEN": "..."
}
```

### Option B — mcporter

#### 1. Install

```bash
npm install -g canvas-parent-mcp
```

Or from source:
```bash
git clone https://github.com/chrischall/canvas-parent-mcp
cd canvas-parent-mcp
npm install && npm run build
```

#### 2. Configure credentials

```bash
cp .env.example .env
# Edit .env: set CANVAS_BASE_URL plus one of CANVAS_TOKEN, CANVAS_USERNAME+CANVAS_PASSWORD, CANVAS_COOKIE, or the OAuth triple.
```

#### 3. Register with mcporter

```bash
mcporter config add canvas \
  --command "canvas-parent-mcp" \
  --env "CANVAS_BASE_URL=https://cms.instructure.com" \
  --env "CANVAS_USERNAME=me@example.com" \
  --env "CANVAS_PASSWORD=your-canvas-password" \
  --env "CANVAS_NAME=CMS" \
  --config ~/.mcporter/mcporter.json
```

(Or substitute `CANVAS_TOKEN` / OAuth env vars per the alternatives above.)

#### 4. Verify

```bash
mcporter list --config ~/.mcporter/mcporter.json
mcporter call canvas.canvas_get_profile --config ~/.mcporter/mcporter.json
```

## Calling tools (mcporter)

```bash
mcporter call canvas.<tool_name> [key=value ...] --config ~/.mcporter/mcporter.json
```

Always pass `--config ~/.mcporter/mcporter.json` unless a local `config/mcporter.json` exists.

Most tools accept an optional `observeeId` (defaults to `self`) — set it to a student's user ID when an observer is checking on a linked student. List the candidates with `canvas_list_observees`.

## Tools

### Profile & observees
| Tool | Notes |
|------|-------|
| `canvas_get_profile` | Your Canvas profile (id, name, email, login, locale, timezone). Call this first to confirm credentials work. |
| `canvas_list_observees` | Students linked to your observer account. Returns `[]` for plain student tokens. |

### Courses
| Tool | Notes |
|------|-------|
| `canvas_list_courses(observeeId?)` | Active courses with course-level grades. Includes total scores + current grading period scores. |
| `canvas_get_course(courseId)` | Course detail: syllabus, teachers, term. |

### Assignments & submissions
| Tool | Notes |
|------|-------|
| `canvas_list_assignments(courseId, bucket?)` | Assignments for a course. `bucket` can be `upcoming`, `overdue`, `past`, or `undated`. Includes the user's submission inline. |
| `canvas_list_missing_submissions(observeeId?, courseIds?)` | Past-due unsubmitted assignments. For an observee, `courseIds` is required. |
| `canvas_get_submission(courseId, assignmentId, userId?)` | A single submission with comments + rubric assessment. `userId` defaults to `self`. |
| `canvas_list_recent_submissions(courseId, since?)` | Recently graded submissions in a course. Defaults to a 14-day window. |

### Grades
| Tool | Notes |
|------|-------|
| `canvas_list_enrollments(observeeId?)` | Active student enrollments with `grades` (current_score, final_score, current_grade, final_grade, current grading period). |

### Calendar & planner
| Tool | Notes |
|------|-------|
| `canvas_list_calendar_events(contextCodes?, type?, startDate?, endDate?)` | Calendar events / assignments. `contextCodes` is an array like `["course_123", "user_456"]`. |
| `canvas_list_upcoming_events` | Canvas's curated next-7-days view. |
| `canvas_list_planner_items(observeeId?, startDate?, endDate?, contextCodes?)` | Unified planner: assignments + announcements + planner notes + calendar events. |

### Communication
| Tool | Notes |
|------|-------|
| `canvas_list_announcements(contextCodes, startDate?, endDate?)` | Announcements across one or more courses. `contextCodes` is required (e.g. `["course_123"]`). Defaults to the last 14 days. |
| `canvas_list_conversations(scope?)` | Inbox conversation list. `scope` ∈ `unread` / `starred` / `archived`. |
| `canvas_get_conversation(id)` | Full conversation thread with messages. |
| `canvas_list_discussion_topics(courseId)` | Discussion topic list for a course (read-only). |

### Files
| Tool | Notes |
|------|-------|
| `canvas_list_course_files(courseId, searchTerm?)` | File metadata: id, display_name, size, content-type, **`url`**. |
| `canvas_download_file(url, destinationPath, overwrite?)` | Writes the file to `destinationPath` on disk. **`destinationPath` is required** — confirm the path with the user before calling. |

## Workflows

**Discovery (first time):**
1. `canvas_get_profile` → confirm credentials
2. `canvas_list_observees` → if empty, you're a student; otherwise capture observee IDs
3. `canvas_list_courses` → capture course IDs

**Is everything OK at school?**
1. `canvas_list_courses` (capture IDs)
2. `canvas_list_recent_submissions(courseId)` for each — last 14 days of grading
3. `canvas_list_missing_submissions` — past-due work
4. `canvas_list_announcements(contextCodes=["course_<id>"])` — recent announcements

**What got graded this week?**
- `canvas_list_recent_submissions(courseId, since="YYYY-MM-DDTHH:MM:SSZ")`

**What's due soon?**
- `canvas_list_planner_items(startDate=..., endDate=...)` — unified planner
- Or `canvas_list_assignments(courseId, bucket="upcoming")` per course

**Today's calendar:**
- `canvas_list_upcoming_events`

**Read a syllabus:**
- `canvas_get_course(courseId)` — `syllabus_body` is included

**Inbox:**
1. `canvas_list_conversations` — find a thread
2. `canvas_get_conversation(id)` — read it

**Download a file:**
1. `canvas_list_course_files(courseId)` → find the file's `url`
2. Confirm destination path with the user
3. `canvas_download_file(url, destinationPath="/Users/.../file.pdf")`

## Caution

- `canvas_download_file` writes to disk at `destinationPath` — confirm the path with the user; pass `overwrite:true` to replace.
- All auth credentials (password, token, refresh token, cookie) grant the same access as the user account. Treat them as secrets — never commit `.env`.
- Endpoints that return paginated results follow Canvas's RFC 5988 `Link` headers automatically up to 50 pages (5,000 items at the default `per_page=100`).
