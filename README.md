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

**OAuth (advanced):**

```
CANVAS_BASE_URL=https://cms.instructure.com
CANVAS_CLIENT_ID=...
CANVAS_CLIENT_SECRET=...
CANVAS_REFRESH_TOKEN=...
```

If both modes are set, the token wins.

See `.env.example`.

## Status

Unofficial — not affiliated with Instructure. AI-maintained.
