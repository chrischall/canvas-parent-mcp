#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // quiet:true suppresses dotenv's startup banner — required because MCP uses
  // stdout for JSON-RPC and any extra output corrupts the stream.
  config({ path: join(__dirname, '..', '.env'), override: false, quiet: true });
} catch {
  // dotenv not available — rely on process.env
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveAuth, type ResolvedAuth } from './auth.js';
import { CanvasClient } from './client.js';
import { registerProfileTools } from './tools/profile.js';
import { registerObserveeTools } from './tools/observees.js';
import { registerCourseTools } from './tools/courses.js';
import { registerAssignmentTools } from './tools/assignments.js';
import { registerSubmissionTools } from './tools/submissions.js';
import { registerGradeTools } from './tools/grades.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerPlannerTools } from './tools/planner.js';
import { registerAnnouncementTools } from './tools/announcements.js';
import { registerConversationTools } from './tools/conversations.js';
import { registerDiscussionTools } from './tools/discussions.js';
import { registerFileTools } from './tools/files.js';

// Defer config errors so the server can still start cleanly when env vars
// aren't set (e.g. during the host's install-time smoke test, before the
// user has filled in user_config). When not configured we register no tools
// and log a clear stderr message — far better than the previous crash loop.
//
// Auth resolution (see src/auth.ts): try env vars first (token > OAuth >
// username/password), then fall back to reading session cookies from the
// signed-in browser tab via @fetchproxy/bootstrap. Bootstrap runs at
// startup only — the bridge closes before any tool call.
let resolved: ResolvedAuth | null = null;
let configError: Error | null = null;
try {
  resolved = await resolveAuth();
} catch (e) {
  configError = e as Error;
}

const server = new McpServer({ name: 'canvas', version: '1.1.2' }); // x-release-please-version

if (resolved) {
  const client = new CanvasClient(resolved.account, {
    preloaded: resolved.preloaded,
  });
  registerProfileTools(server, client);
  registerObserveeTools(server, client);
  registerCourseTools(server, client);
  registerAssignmentTools(server, client);
  registerSubmissionTools(server, client);
  registerGradeTools(server, client);
  registerCalendarTools(server, client);
  registerPlannerTools(server, client);
  registerAnnouncementTools(server, client);
  registerConversationTools(server, client);
  registerDiscussionTools(server, client);
  registerFileTools(server, client);

  console.error(
    `[canvas-parent-mcp] Canvas: ${resolved.account.name} (${resolved.account.baseUrl}) [${resolved.account.mode}, source: ${resolved.source}]`,
  );
} else {
  console.error(`[canvas-parent-mcp] Not configured: ${configError?.message ?? 'unknown error'}`);
  console.error('[canvas-parent-mcp] Server is running with no tools registered. Set the required env vars and reinstall.');
}
console.error('[canvas-parent-mcp] Developed and maintained by AI (Claude). Use at your own discretion.');

const transport = new StdioServerTransport();
await server.connect(transport);
